import { neventEncode, decode } from 'nostr-tools/nip19'
import {
  uniqBy,
  prop,
  max,
  tryCatch,
  LOCALE,
  TIMEZONE,
  inc,
  pluck,
  spec,
  countBy,
  sleep,
  call,
  removeNil,
  now,
  sortBy,
  concat,
  groupBy,
  displayList,
  indexBy,
  assoc,
  uniq,
  nth,
  nthEq,
  dateToSeconds,
  secondsToDate,
} from '@welshman/lib'
import { parse, truncate, renderAsHtml } from '@welshman/content'
import {
  TrustedEvent,
  getParentId,
  Profile,
  getIdFilters,
  getReplyFilters,
  getTagValues,
  NOTE,
  COMMENT,
  REACTION,
  RELAYS,
  PROFILE,
  FOLLOWS,
  displayProfile,
  displayPubkey,
  readList,
  readProfile,
  asDecryptedEvent,
  PublishedList,
  PublishedProfile,
  getPubkeyTagValues,
  getListTags,
} from '@welshman/util'
import { load } from '@welshman/net'
import { Repository } from '@welshman/relay'
import { Router, routerContext, getFilterSelections, makeSelection, addMinimalFallbacks } from '@welshman/router'
import { deriveEventsMapped, collection } from '@welshman/store'
import {
  makeIntersectionFeed,
  simplifyFeed,
  feedFromFilters,
  getFeedArgs,
  isScopeFeed,
  walkFeed,
  isWOTFeed,
  Scope,
  Feed,
  makeCreatedAtFeed,
  makeUnionFeed,
  FeedController,
} from '@welshman/feeds'
import { getCronDate, displayDuration, createElement } from './util.js'
import { getAlertParams, Alert, AlertParams } from './alert.js'
import { sendDigest } from './mailer.js'

// Utilities for loading data

export const repository = Repository.get()

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
    return load({
      relays: Router.get().Index().getUrls(),
      filters: [{ kinds: [RELAYS], authors: [pubkey] }],
      onEvent: (event) => repository.publish(event),
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

    return load({
      relays: merge([Index(), FromPubkey(pubkey)]).limit(10).getUrls(),
      filters: [{ kinds: [PROFILE], authors: [pubkey] }],
      onEvent: (event) => repository.publish(event),
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

    return load({
      relays: merge([Index(), FromPubkey(pubkey)]).getUrls(),
      filters: [{ kinds: [FOLLOWS], authors: [pubkey] }],
      onEvent: (event) => repository.publish(event),
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

// Utilities for actually building the feed

type DigestData = {
  since: number
  events: TrustedEvent[]
  context: TrustedEvent[]
}

const loadData = async (alert: Alert) => {
  await loadRelaySelections(alert.pubkey)

  const { merge, Index, ForPubkey, Replies } = Router.get()
  const { cron, feeds } = getAlertParams(alert)
  const since = dateToSeconds(getCronDate(cron, -2))
  const feed = simplifyFeed(makeIntersectionFeed(makeCreatedAtFeed({ since }), makeUnionFeed(...feeds)))

  // Fetch the required data to populate our web of trust graph

  let needsFollows = false
  let needsFollowers = false
  let needsNetwork = false

  walkFeed(feed, f => {
    needsFollows = needsFollows || isScopeFeed(f) && getFeedArgs(f).includes(Scope.Follows)
    needsFollowers = needsFollowers || isScopeFeed(f) && getFeedArgs(f).includes(Scope.Followers)
    needsNetwork = needsNetwork || isWOTFeed(f) || isScopeFeed(f) && getFeedArgs(f).includes(Scope.Network)
  })

  const wotPromises: Promise<any>[] = []

  if (needsFollows || needsNetwork) {
    wotPromises.push(loadFollows(alert.pubkey))
  }

  if (needsFollowers) {
    wotPromises.push(
      load({
        filters: [{ kinds: [FOLLOWS], '#p': [alert.pubkey] }],
        relays: merge([Index(), ForPubkey(alert.pubkey)]).getUrls(),
      })
    )
  }

  if (needsNetwork) {
    wotPromises.push(...getFilterSelections([{ kinds: [FOLLOWS], authors: getFollows(alert.pubkey) }]).map(load))
  }

  await Promise.all(wotPromises)

  // Load our feed events and any required context in one shot

  const seen = new Set<string>()
  const events: TrustedEvent[] = []
  const context: TrustedEvent[] = []
  const promises: Promise<unknown>[] = []
  const ctrl = new FeedController({
    feed,
    getPubkeysForScope: (scope: string) => {
      switch (scope) {
        case Scope.Self:
          return [alert.pubkey]
        case Scope.Follows:
          return getFollows(alert.pubkey)
        case Scope.Network:
          return getNetwork(alert.pubkey)
        case Scope.Followers:
          return getFollowers(alert.pubkey)
        default:
          return []
      }
    },
    getPubkeysForWOTRange: (minimum: number, maximum: number) => {
      const graph = new Map<string, number>()

      for (const follow of getFollows(alert.pubkey)) {
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
    },
    onEvent: (e) => {
      seen.add(e.id)
      events.push(e)
      context.push(e)

      promises.push(
        call(async () => {
          await loadRelaySelections(e.pubkey)
          await loadProfile(e.pubkey)

          const relays = Replies(e).policy(addMinimalFallbacks).getUrls()
          const filters = getReplyFilters(events, { kinds: [NOTE, COMMENT, REACTION] })

          for (const reply of await load({ relays, filters, signal: AbortSignal.timeout(1000) })) {
            if (!seen.has(reply.id)) {
              seen.add(reply.id)
              context.push(reply)
            }
          }
        })
      )
    },
  })

  await ctrl.load(200)
  await Promise.all(promises)

  return {since, events, context} as DigestData
}

const loadHandler = async (alert: Alert) => {
  const { handlers } = getAlertParams(alert)
  const defaultHandler = 'https://coracle.social/'
  const webHandlers = handlers.filter(nthEq(3, 'web'))
  const filters = getIdFilters(webHandlers.map(nth(1)))
  const relays = webHandlers.map(nth(2))

  if (filters.length === 0 || relays.length === 0) {
    return defaultHandler
  }

  const events = await load({ relays, filters })
  const getTemplates = (e: TrustedEvent) => e.tags.filter(nthEq(0, 'web')).map(nth(1))
  const templates = events.flatMap((e) => getTemplates(e))

  return templates[0] || defaultHandler
}

const getFormatter = (alert: Alert) => {
  const { locale, timezone } = getAlertParams(alert)

  // Attempt to make a formatter with as many user-provided options as we can
  for (const _locale of removeNil([locale, LOCALE])) {
    for (const _timezone of removeNil([timezone, TIMEZONE])) {
      const formatter = tryCatch(
        () =>
          new Intl.DateTimeFormat(_locale, {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: _timezone,
          })
      )

      if (formatter) {
        return formatter
      }
    }
  }

  throw new Error("This should never happen, it's here only because of typescript")
}

const buildLink = (event: TrustedEvent, handler: string) => {
  const relays = Router.get().Event(event).getUrls()
  const nevent = neventEncode({ ...event, relays })

  if (handler.includes('<bech32>')) {
    return handler.replace('<bech32>', nevent)
  } else {
    return handler + nevent
  }
}

const displayProfileByPubkey = (pubkey: string) =>
  displayProfile(profilesByPubkey.get().get(pubkey), displayPubkey(pubkey))

const renderEntity = (entity: string) => {
  let display = entity.slice(0, 16) + '…'

  try {
    const { type, data } = decode(entity)

    if (type === 'npub') {
      display = '@' + displayProfileByPubkey(data)
    }

    if (type === 'nprofile') {
      display = '@' + displayProfileByPubkey(data.pubkey)
    }
  } catch (e) {
    // Pass
  }

  return display
}

export const buildParameters = async (alert: Alert, data: DigestData) => {
  const getEventVariables = (event: TrustedEvent) => {
    const parsed = truncate(parse(event), { minLength: 400, maxLength: 800, mediaLength: 50 })

    return {
      Link: buildLink(event, handler),
      Timestamp: formatter.format(secondsToDate(event.created_at)),
      Icon: profilesByPubkey.get().get(event.pubkey)?.picture,
      Name: displayProfileByPubkey(event.pubkey),
      Content: renderAsHtml(parsed, { createElement, renderEntity }).toString(),
      Replies:
        repliesByParentId.get(event.id)?.filter((e) => [COMMENT, NOTE].includes(e.kind))?.length ||
        0,
      Reactions: repliesByParentId.get(event.id)?.filter(spec({ kind: REACTION }))?.length || 0,
    }
  }

  const { since, events, context } = data
  const formatter = getFormatter(alert)
  const handler = await loadHandler(alert)
  const repliesByParentId = groupBy(getParentId, context)
  const eventsByPubkey = groupBy((e) => e.pubkey, events)
  const popular = sortBy((e) => -(repliesByParentId.get(e.id)?.length || 0), events).slice(0, 5)
  const popularIds = new Set(popular.map((e) => e.id))
  const topProfiles = sortBy(
    ([k, ev]) => -ev.length,
    Array.from(eventsByPubkey.entries()).filter(([k]) => profilesByPubkey.get().get(k))
  )

  return {
    Total: events.length,
    Duration: displayDuration(now() - since),
    Popular: popular.map((e) => getEventVariables(e)),
    HasPopular: popular.length > 0,
    TopProfiles: displayList(topProfiles.map(([pk]) => displayProfileByPubkey(pk))),
  }
}

export const send = async (alert: Alert) => {
  const data = await loadData(alert)

  if (data.events.length > 0) {
    await sendDigest(alert, await buildParameters(alert, data))
  }

  return Boolean(data)
}
