import {neventEncode, decode} from 'nostr-tools/nip19'
import { max, now, sortBy, concat, groupBy, indexBy, assoc, uniq, nth, nthEq, formatTimestamp, dateToSeconds } from '@welshman/lib'
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
  displayProfile,
  displayPubkey,
} from '@welshman/util'
import { load } from '@welshman/net'
import { getCronDate, loadProfile, displayList, displayDuration, createElement, removeUndefined } from './util.js'
import { getAlertParams, Alert, AlertParams } from './alert.js'
import { sendDigest } from './mailgun.js'

export const DEFAULT_HANDLER = 'https://coracle.social/'

export type DigestData = {
  since: number
  relays: string[]
  events: TrustedEvent[]
  context: TrustedEvent[]
  profilesByPubkey: Map<string, Profile>
}

export async function fetchData({ cron, relays, filters }: AlertParams) {
  const since = dateToSeconds(getCronDate(cron, -2))

  // Testing code
  // const since = 1740598594
  // filters = [{ kinds: [1] }]
  // relays = ['wss://pyramid.fiatjaf.com/']

  const events = await load({ relays, filters: filters.map(assoc('since', since)) })

  if (events.length === 0) {
    return
  }

  const pubkeys = uniq(events.flatMap((e) => [e.pubkey, ...getTagValues('p', e.tags)]))
  const replyFilters = getReplyFilters(events, { kinds: [NOTE, COMMENT, REACTION] })
  const context = concat(events, await load({ relays, filters: replyFilters }))
  const profiles = await Promise.all(pubkeys.map((pubkey) => loadProfile(pubkey)))
  const profilesByPubkey = indexBy((p) => p.event.pubkey, removeUndefined(profiles))

  return { since, relays, events, context, profilesByPubkey } as DigestData
}

export async function buildParameters(data: DigestData, handler: string) {
  const buildLink = (event: TrustedEvent) => {
    const nevent = neventEncode({...event, relays})

    if (handler.includes('<bech32>')) {
      return handler.replace('<bech32>', nevent)
    } else {
      return handler + nevent
    }
  }

  const displayProfileByPubkey = (pubkey: string) =>
    displayProfile(profilesByPubkey.get(pubkey), displayPubkey(pubkey))

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

  const { since, relays, events, context, profilesByPubkey } = data
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

export async function loadHandler({ handlers }: AlertParams) {
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

export async function send(alert: Alert) {
  const params = getAlertParams(alert)
  const data = await fetchData(params)

  if (data) {
    const handler = await loadHandler(params)
    const variables = await buildParameters(data, handler)

    await sendDigest(alert, variables)
  }

  return Boolean(data)
}
