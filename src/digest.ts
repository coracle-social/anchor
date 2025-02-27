import {max, sortBy, concat, groupBy, indexBy, assoc, uniq, nth, nthEq} from '@welshman/lib'
import {parse, truncate, renderAsHtml} from '@welshman/content'
import {SignedEvent, getParentId, Profile, getIdFilters, getReplyFilters, NOTE, COMMENT} from '@welshman/util'
import {loadProfile, formatTimestamp, dateToSeconds, displayProfileByPubkey} from '@welshman/app'
import {parseCronString, load, removeUndefined} from './util.js'
import {getAlertParams, Alert, AlertParams} from './alert.js'
import {sendDigest} from './mailgun.js'

export const DEFAULT_HANDLER = 'https://coracle.social/'

export type DigestData = {
  events: SignedEvent[]
  context: SignedEvent[]
  profilesByPubkey: Map<string, Profile>
}

export async function fetchData({ cron, relays, filters }: AlertParams) {
  const getCronDate = parseCronString(cron)
  const since = dateToSeconds(getCronDate(-1))

  // Remove this
  filters = [{kinds: [1]}]
  relays = ['wss://pyramid.fiatjaf.com/']

  const events = await load({ relays, filters: filters.map(assoc('since', since)) })

  if (events.length === 0) {
    return
  }

  const pubkeys = uniq(events.map(e => e.pubkey))
  const replyFilters = getReplyFilters(events, {kinds: [NOTE, COMMENT]})
  const context = concat(events, await load({ relays, filters: replyFilters}))
  const profiles = await Promise.all(pubkeys.map(pubkey => loadProfile(pubkey)))
  const profilesByPubkey = indexBy(p => p.event.pubkey, removeUndefined(profiles))

  return {events, context, profilesByPubkey} as DigestData
}

export async function buildParameters({events, context, profilesByPubkey}: DigestData) {
  const repliesByParentId = groupBy(getParentId, context)
  const eventsWithProfile = events.filter(e => profilesByPubkey.has(e.pubkey))
  const eventsWithProfileSorted = sortBy(e => -e.created_at, eventsWithProfile)
  const eventsByPubkey = groupBy(e => e.pubkey, eventsWithProfileSorted)

  const getEventVariables = (event: SignedEvent) => {
    const parsed = truncate(parse(event), {minLength: 50, maxLength: 200, mediaLength: 50})

    return {
      Timestamp: formatTimestamp(event.created_at),
      Profile: displayProfileByPubkey(event.pubkey),
      Content: renderAsHtml(parsed),
    }
  }

  const total = events.length > 100 ? `{$events.length}+` : events.length
  const totalProfiles = eventsByPubkey.size
  const latest = eventsWithProfileSorted.slice(0, 3)
  const popularCandidates = eventsWithProfileSorted.filter(e => !latest.includes(e))
  const popularCandidatesSortKey = (e: SignedEvent) => -(repliesByParentId.get(e.id)?.length || 0)
  const popularCandidatesSorted = sortBy(popularCandidatesSortKey, popularCandidates)
  const popular = popularCandidatesSorted.slice(0, 3)
  const topProfiles = sortBy(([k, ev]) => -ev.length, Array.from(eventsByPubkey.entries())).slice(0, 5)

  return {
    Total: total,
    TotalProfiles: totalProfiles,
    Latest: latest.map(e => getEventVariables(e)),
    HasLatest: latest.length > 0,
    Popular: popular.map(e => getEventVariables(e)),
    HasPopular: popular.length > 0,
    TopProfiles: topProfiles,
  }
}

export async function loadHandler({ handlers }: AlertParams) {
  const webHandlers = handlers.filter(nthEq(3, 'web'))
  const filters = getIdFilters(webHandlers.map(nth(1)))
  const relays = webHandlers.map(nth(2))

  if (filters.length === 0 || relays.length === 0) {
    return DEFAULT_HANDLER
  }

  const events = await load({relays, filters})
  const getTemplates = (e: SignedEvent) => e.tags.filter(nthEq(0, 'web')).map(nth(1))
  const templates = events.flatMap(e => getTemplates(e))

  return templates[0] || DEFAULT_HANDLER
}

export async function send(alert: Alert) {
  const params = getAlertParams(alert)
  const data = await fetchData(params)

  if (data) {
    const [variables, handler] = await Promise.all([
      buildParameters(data),
      loadHandler(params)
    ])

    await sendDigest(alert, handler, variables)
  }

  return Boolean(data)
}
