import {max, indexBy, assoc, uniq, nth, nthEq} from '@welshman/lib'
import {SignedEvent, Profile, getIdFilters, getReplyFilters} from '@welshman/util'
import {loadProfile, dateToSeconds} from '@welshman/app'
import {parseCronString, load, removeUndefined} from './util.js'
import {getSubscriptionParams, Subscription, SubscriptionParams} from './domain.js'
import {sendDigest} from './mailgun.js'

export const DEFAULT_HANDLER = 'https://coracle.social/'

export type DigestData = {
  events: SignedEvent[]
  context: SignedEvent[]
  profilesByPubkey: Map<string, Profile>
}

export async function fetchData({ cron, relays, filters }: SubscriptionParams) {
  const getCronDate = parseCronString(cron)
  const since = dateToSeconds(getCronDate(-1))
  const events = await load({ relays, filters: filters.map(assoc('since', since)) })

  if (events.length === 0) {
    return
  }

  const pubkeys = uniq(events.map(e => e.pubkey))
  const context = await load({ relays, filters: getReplyFilters(events) })
  const profiles = await Promise.all(pubkeys.map(pubkey => loadProfile(pubkey)))
  const profilesByPubkey = indexBy(p => p.event.pubkey, removeUndefined(profiles))

  return {events, context, profilesByPubkey} as DigestData
}

export async function buildParameters(data: DigestData) {
  return {
  }
}

export async function loadHandler({ handlers }: SubscriptionParams) {
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

export async function send(subscription: Subscription) {
  const params = getSubscriptionParams(subscription)
  const data = await fetchData(params)

  if (data) {
    const [variables, handler] = await Promise.all([
      buildParameters(data),
      loadHandler(params)
    ])

    await sendDigest(subscription, handler, variables)
  }

  return Boolean(data)
}
