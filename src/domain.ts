import {CronExpressionParser} from 'cron-parser'
import {tryCatch, parseJson, isPojo, fromPairs, int, HOUR} from '@welshman/lib'
import type {SignedEvent, Filter} from '@welshman/util'
import {isShareableRelayUrl, getTagValues, createEvent, getTagValue} from '@welshman/util'
import {appSigner, NOTIFIER_STATUS} from './env.js'

export type Subscription = {
  address: string
  pubkey: string
  event: SignedEvent
  tags: string[][]
}

export type ChannelParamsEmail = {
  email: string
}

export type ChannelParamsPush = {
  token: string
  platform: string
}

export type ChannelParams =
  | ChannelParamsEmail
  | ChannelParamsPush

export type SubscriptionParams = {
  cron: string
  relays: string[]
  filters: Filter[]
  channel: string
  params: ChannelParams
  bunker_url?: string
  pause_until?: number
}

export const getChannelParams = (subscription: Subscription) => {
  const {channel, email, token, platform} = fromPairs(subscription.tags)

  switch (channel) {
    case 'email': return {email}
    case 'push': return {token, platform}
    default: throw new Error(`Unsupported channel ${channel}`)
  }
}

export const getSubscriptionParams = (subscription: Subscription) => {
  const {channel, cron, bunker_url, pause_until} = fromPairs(subscription.tags)
  const relays = getTagValues('relay', subscription.tags)
  const filters = getTagValues('filter', subscription.tags).map(parseJson)
  const params = getChannelParams(subscription)

  return {channel, cron, relays, filters, params, bunker_url, pause_until}
}

export const getSubscriptionError = (subscription: Subscription) => {
  const channel = getTagValue('channel', subscription.tags)

  if (channel !== 'email') return "Only email notifications are currently supported."

  const {cron, relays, filters} = getSubscriptionParams(subscription)

  if (!cron) return "Immediate notifications are not currently supported."

  const interval = tryCatch(() => CronExpressionParser.parse(cron, {strict: true}))

  if (!interval) return `Cron expression "${cron}" is invalid`

  const dates = interval.take(10).map(d => d.toDate().valueOf() / 1000)

  let total = 0
  for (let i = 1; i < dates.length; i++) {
    total += dates[i] - dates[i - 1]
  }

  if (total / (dates.length - 1) < int(1, HOUR)) return "Requested notification interval is too short"
  if (relays.length === 0) return "At least one relay url is required"
  if (relays.some(url => !isShareableRelayUrl(url))) return "Request contained invalid relay urls"
  if (filters.length === 0) return "At least one filter is required"
  if (filters.some(filter => !isPojo(filter))) return "Request contained invalid filters"
}

export const createStatusEvent = async (subscription: Subscription) => {
  const error = getSubscriptionError(subscription)

  return appSigner.sign(
    createEvent(NOTIFIER_STATUS, {
      content: await appSigner.nip44.encrypt(
        subscription.pubkey,
        JSON.stringify([
          ["status", error ? "error" : "ok"],
          ["message", error || "This subscription is active"],
        ])
      ),
      tags: [
        ["a", subscription.address],
        ["p", subscription.pubkey],
      ],
    })
  )
}
