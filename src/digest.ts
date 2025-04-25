import {neventEncode, decode} from 'nostr-tools/nip19'
import { max, ago, HOUR, ms, MINUTE, int, removeNil, now, sortBy, concat, groupBy, displayList, indexBy, assoc, uniq, nth, nthEq, formatTimestamp, dateToSeconds } from '@welshman/lib'
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
  displayProfile,
  displayPubkey,
  readList,
  readProfile,
  asDecryptedEvent,
  PublishedList,
  PublishedProfile,
} from '@welshman/util'
import { load } from '@welshman/net'
import { Repository } from '@welshman/relay'
import { Router, addMaximalFallbacks } from '@welshman/router'
import { deriveEventsMapped, collection } from '@welshman/store'
import { makeIntersectionFeed, Feed, makeCreatedAtFeed, makeUnionFeed, FeedController } from '@welshman/feeds'
import { getCronDate, displayDuration, createElement } from './util.js'
import { getAlertParams, Alert, AlertParams } from './alert.js'
import { sendDigest } from './mailgun.js'

// Utilities for loading data

export const repository = Repository.get()

setInterval(() => {
  // Every so often, delete old events to keep our cache lean
  for (const event of repository.query([{until: ago(HOUR)}])) {
    repository.removeEvent(event.id)
  }
}, ms(int(10, MINUTE)))

export const relaySelections = deriveEventsMapped<PublishedList>(repository, {
  filters: [{kinds: [RELAYS]}],
  itemToEvent: item => item.event,
  eventToItem: (event: TrustedEvent) => readList(asDecryptedEvent(event)),
})

export const {
  indexStore: relaySelectionsByPubkey,
  loadItem: loadRelaySelections,
} = collection({
  name: "relaySelections",
  store: relaySelections,
  getKey: relaySelections => relaySelections.event.pubkey,
  load: (pubkey: string) =>
    load({
      relays: Router.get().Index().getUrls(),
      filters: [{kinds: [RELAYS], authors: [pubkey]}],
      onEvent: event => repository.publish(event),
    }),
})

export const profiles = deriveEventsMapped<PublishedProfile>(repository, {
  filters: [{kinds: [PROFILE]}],
  eventToItem: readProfile,
  itemToEvent: item => item.event,
})

export const {
  indexStore: profilesByPubkey,
  loadItem: loadProfile,
} = collection({
  name: "profiles",
  store: profiles,
  getKey: profile => profile.event.pubkey,
  load: (pubkey: string) =>
    load({
      relays: Router.get().Index().getUrls(),
      filters: [{kinds: [RELAYS], authors: [pubkey]}],
      onEvent: event => repository.publish(event),
    }),
})

export const loadFeed = async (feed: Feed) => {
  const events: TrustedEvent[] = []
  const promises: Promise<unknown>[] = []
  const ctrl = new FeedController({
    feed,
    getPubkeysForScope: (scope: string) => [],
    getPubkeysForWOTRange: (min: number, max: number) => [],
    onEvent: e => {
      events.push(e)

      for (const pubkey of uniq([e.pubkey, ...getTagValues('p', e.tags)])) {
        promises.push(loadRelaySelections(pubkey).then(() => loadProfile(pubkey)))
      }
    },
  })

  await ctrl.load(1000)
  await Promise.all(promises)

  return events
}

// Utilities for actually building the feed

export const DEFAULT_HANDLER = 'https://coracle.social/'

export type DigestData = {
  since: number
  events: TrustedEvent[]
  context: TrustedEvent[]
}

export const fetchData = async (alert: Alert) => {
  await loadRelaySelections(alert.pubkey)

  const { cron, feeds } = getAlertParams(alert)
  const since = dateToSeconds(getCronDate(cron, -2))
  const feed = makeIntersectionFeed(makeCreatedAtFeed({since}), makeUnionFeed(...feeds))
  const events = await loadFeed(feed)

  if (events.length === 0) return

  const {merge, Replies} = Router.get()
  const relays = merge(events.map(Replies)).policy(addMaximalFallbacks).getUrls()
  const replyFilters = getReplyFilters(events, { kinds: [NOTE, COMMENT, REACTION] })
  const context = concat(events, await load({ relays, filters: replyFilters }))

  return { since, events, context } as DigestData
}

export const loadHandler = async (alert: Alert) => {
  const { handlers } = getAlertParams(alert)
  const webHandlers = handlers.filter(nthEq(3, 'web'))
  const filters = getIdFilters(webHandlers.map(nth(1)))
  const relays = webHandlers.map(nth(2))

  if (filters.length === 0 || relays.length === 0) {
    return DEFAULT_HANDLER
  }

  const events = await load({ relays, filters })
  const getTemplates = (e: TrustedEvent) => e.tags.filter(nthEq(0, 'web')).map(nth(1))
  const templates = events.flatMap((e) => getTemplates(e))

  return templates[0] || DEFAULT_HANDLER
}

export const buildParameters = async (data: DigestData, handler: string) => {
  const buildLink = (event: TrustedEvent) => {
    const relays = Router.get().Event(event).getUrls()
    const nevent = neventEncode({...event, relays})

    if (handler.includes('<bech32>')) {
      return handler.replace('<bech32>', nevent)
    } else {
      return handler + nevent
    }
  }

  const displayProfileByPubkey = (pubkey: string) =>
    displayProfile(profilesByPubkey.get().get(pubkey), displayPubkey(pubkey))

  const renderEntity = (entity: string) => {
    let display = entity.slice(0, 16) + "…"

    try {
      const {type, data} = decode(entity)

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

  const getEventVariables = (event: TrustedEvent) => {
    const parsed = truncate(parse(event), { minLength: 50, maxLength: 400, mediaLength: 50 })

    return {
      Link: buildLink(event),
      Timestamp: formatTimestamp(event.created_at),
      Profile: displayProfileByPubkey(event.pubkey),
      Content: renderAsHtml(parsed, { createElement, renderEntity }).toString(),
    }
  }

  const { since, events, context } = data
  const repliesByParentId = groupBy(getParentId, context)
  const eventsByPubkey = groupBy((e) => e.pubkey, events)
  const total = events.length > 100 ? `{$events.length}+` : events.length
  const totalProfiles = eventsByPubkey.size
  const popular = sortBy(e => -(repliesByParentId.get(e.id)?.length || 0), events).slice(0, 5)
  const popularIds = new Set(popular.map(e => e.id))
  const latest = sortBy((e) => -e.created_at, popular.filter(e => !popularIds.has(e.id))).slice(0, 5)
  const topProfiles = sortBy(([k, ev]) => -ev.length, Array.from(eventsByPubkey.entries()))

  return {
    Total: total,
    Duration: displayDuration(now() - since),
    Latest: latest.map((e) => getEventVariables(e)),
    HasLatest: latest.length > 0,
    Popular: popular.map((e) => getEventVariables(e)),
    HasPopular: popular.length > 0,
    TopProfiles: displayList(topProfiles.map(([pk]) => displayProfileByPubkey(pk))),
  }
}

export const send = async (alert: Alert) => {
  const data = await fetchData(alert)

  if (data) {
    const handler = await loadHandler(alert)
    const variables = await buildParameters(data, handler)

    await sendDigest(alert, variables)
  }

  return Boolean(data)
}
