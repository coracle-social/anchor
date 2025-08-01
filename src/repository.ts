import { max, inc, pluck, uniq } from '@welshman/lib'
import {
  TrustedEvent,
  RELAYS,
  PROFILE,
  FOLLOWS,
  readList,
  readProfile,
  asDecryptedEvent,
  PublishedList,
  PublishedProfile,
  getPubkeyTagValues,
  getListTags,
} from '@welshman/util'
import { makeLoader, LoadOptions, Pool, SocketAdapter } from '@welshman/net'
import { Repository } from '@welshman/relay'
import { Router, getFilterSelections } from '@welshman/router'
import { deriveEventsMapped, collection } from '@welshman/store'
import { getFeedArgs, isScopeFeed, walkFeed, isWOTFeed, Scope, Feed } from '@welshman/feeds'

// Utilities for loading data

export const repository = Repository.get()

const pool = new Pool()

const load = makeLoader({
  delay: 500,
  timeout: 5000,
  threshold: 0.8,
  context: {
    getAdapter: (url: string) => new SocketAdapter(pool.get(url))
  },
})

export const sharedLoad = (request: LoadOptions) =>
  load({
    ...request,
    onEvent: (event, url) => {
      request.onEvent?.(event, url)
      repository.publish(event)
    },
  })

export const relaySelections = deriveEventsMapped<PublishedList>(repository, {
  filters: [{ kinds: [RELAYS] }],
  itemToEvent: (item) => item.event,
  eventToItem: (event: TrustedEvent) => readList(asDecryptedEvent(event)),
})

export const { indexStore: relaySelectionsByPubkey, loadItem: loadRelaySelections } = collection({
  name: 'relaySelections',
  store: relaySelections,
  getKey: (relaySelections) => relaySelections.event.pubkey,
  load: (pubkey: string) => {
    return sharedLoad({
      relays: Router.get().Index().getUrls(),
      filters: [{ kinds: [RELAYS], authors: [pubkey] }],
    })
  },
})

export const profiles = deriveEventsMapped<PublishedProfile>(repository, {
  filters: [{ kinds: [PROFILE] }],
  eventToItem: readProfile,
  itemToEvent: (item) => item.event,
})

export const { indexStore: profilesByPubkey, loadItem: loadProfile } = collection({
  name: 'profiles',
  store: profiles,
  getKey: (profile) => profile.event.pubkey,
  load: (pubkey: string) => {
    const { merge, Index, FromPubkey } = Router.get()

    return sharedLoad({
      relays: merge([Index(), FromPubkey(pubkey)])
        .limit(10)
        .getUrls(),
      filters: [{ kinds: [PROFILE], authors: [pubkey] }],
    })
  },
})

export const follows = deriveEventsMapped<PublishedList>(repository, {
  filters: [{ kinds: [FOLLOWS] }],
  eventToItem: (event: TrustedEvent) => readList(asDecryptedEvent(event)),
  itemToEvent: (item) => item.event,
})

export const { indexStore: followsByPubkey, loadItem: loadFollows } = collection({
  name: 'follows',
  store: follows,
  getKey: (follows) => follows.event.pubkey,
  load: (pubkey: string) => {
    const { merge, Index, FromPubkey } = Router.get()

    return sharedLoad({
      relays: merge([Index(), FromPubkey(pubkey)]).getUrls(),
      filters: [{ kinds: [FOLLOWS], authors: [pubkey] }],
    })
  },
})

export const getFollows = (pubkey: string) =>
  getPubkeyTagValues(getListTags(followsByPubkey.get().get(pubkey)))

export const getNetwork = (pubkey: string) => {
  const pubkeys = new Set(getFollows(pubkey))
  const network = new Set<string>()

  for (const follow of pubkeys) {
    for (const tpk of getFollows(follow)) {
      if (!pubkeys.has(tpk)) {
        network.add(tpk)
      }
    }
  }

  return Array.from(network)
}

export const getFollowers = (pubkey: string) =>
  uniq(pluck<string>('pubkey', repository.query([{ kinds: [FOLLOWS], '#p': [pubkey] }])))

export const loadWot = async (pubkey: string, feed: Feed) => {
  const { merge, Index, ForPubkey } = Router.get()

  let needsFollows = false
  let needsFollowers = false
  let needsNetwork = false

  walkFeed(feed, (f) => {
    needsFollows = needsFollows || (isScopeFeed(f) && getFeedArgs(f).includes(Scope.Follows))
    needsFollowers = needsFollowers || (isScopeFeed(f) && getFeedArgs(f).includes(Scope.Followers))
    needsNetwork =
      needsNetwork || isWOTFeed(f) || (isScopeFeed(f) && getFeedArgs(f).includes(Scope.Network))
  })

  const promises: Promise<any>[] = []

  if (needsFollows || needsNetwork) {
    promises.push(loadFollows(pubkey))
  }

  if (needsFollowers) {
    promises.push(
      sharedLoad({
        filters: [{ kinds: [FOLLOWS], '#p': [pubkey] }],
        relays: merge([Index(), ForPubkey(pubkey)]).getUrls(),
      })
    )
  }

  if (needsNetwork) {
    promises.push(
      ...getFilterSelections([{ kinds: [FOLLOWS], authors: getFollows(pubkey) }]).map(sharedLoad)
    )
  }

  await Promise.all(promises)
}

export const makeGetPubkeysForScope = (pubkey: string) => (scope: string) => {
  switch (scope) {
    case Scope.Self:
      return [pubkey]
    case Scope.Follows:
      return getFollows(pubkey)
    case Scope.Network:
      return getNetwork(pubkey)
    case Scope.Followers:
      return getFollowers(pubkey)
    default:
      return []
  }
}

export const makeGetPubkeysForWOTRange = (pubkey: string) => (minimum: number, maximum: number) => {
  const graph = new Map<string, number>()

  for (const follow of getFollows(pubkey)) {
    for (const pubkey of getFollows(follow)) {
      graph.set(pubkey, inc(graph.get(pubkey)))
    }
  }

  const pubkeys = []
  const maxWot = max(Array.from(graph.values()))
  const thresholdMin = maxWot * minimum
  const thresholdMax = maxWot * maximum

  for (const [tpk, score] of graph.entries()) {
    if (score >= thresholdMin && score <= thresholdMax) {
      pubkeys.push(tpk)
    }
  }

  return pubkeys
}
