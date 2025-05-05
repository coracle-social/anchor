import { CronExpressionParser } from 'cron-parser'
import { tryCatch, int, HOUR, removeNil, parseJson } from '@welshman/lib'
import { Feed, ValidationError, validateFeed } from '@welshman/feeds'
import { Nip46Broker } from '@welshman/signer'
import {
  getTags,
  getTag,
  getTagValues,
  createEvent,
  SignedEvent,
  getTagValue,
} from '@welshman/util'
import { appSigner, NOTIFIER_STATUS } from './env.js'

export type Alert = {
  address: string
  pubkey: string
  email: string
  event: SignedEvent
  tags: string[][]
  token: string
  created_at: number
  deleted_at?: number
  confirmed_at?: number
  unsubscribed_at?: number
}

export enum Channel {
  None = 'none',
  Push = 'push',
  Email = 'email',
}

export type AlertParams = {
  cron: string
  feeds: Feed[]
  handlers: string[][]
  channel: Channel
  bunker_url?: string
  email?: string
  locale?: string
  pause_until?: number
  timezone?: string
}

export const getAlertBroker = (alert: Alert) => {
  const [_, clientSecret, bunkerUrl] = getTag('nip46', alert.tags) || []

  if (bunkerUrl) {
    const { signerPubkey, relays = [] } = Nip46Broker.parseBunkerUrl(bunkerUrl)

    if (signerPubkey && relays.length > 0) {
      return new Nip46Broker({ clientSecret, signerPubkey, relays })
    }
  }
}

export const getAlertParams = (alert: Alert): AlertParams => {
  return {
    cron: getTagValue('cron', alert.tags) || '0 0 0 0 0 0',
    feeds: getTagValues('feed', alert.tags).map(parseJson),
    handlers: getTags('handler', alert.tags),
    channel: getTagValue('channel', alert.tags) as Channel,
    bunker_url: getTagValue('cron', alert.tags),
    email: getTagValue('email', alert.tags),
    locale: getTagValue('locale', alert.tags),
    pause_until: parseInt(getTagValue('pause_until', alert.tags) || '') || 0,
    timezone: getTagValue('timezone', alert.tags),
  }
}

export const getAlertError = async ({ channel, cron, feeds, email }: AlertParams) => {
  if (channel !== Channel.Email) return 'Only email notifications are currently supported.'
  if (!cron) return 'Immediate notifications are not currently supported.'

  const interval = tryCatch(() => CronExpressionParser.parse(cron, { strict: true }))

  if (!interval) return `Cron expression "${cron}" is invalid`

  const dates = interval.take(10).map((d) => d.toDate().valueOf() / 1000)

  let total = 0
  for (let i = 1; i < dates.length; i++) {
    total += dates[i] - dates[i - 1]
  }

  if (total / (dates.length - 1) < int(1, HOUR))
    return 'Requested notification interval is too short'
  if (!email?.includes('@')) return 'Please provide a valid email address'
  if (feeds.length === 0) return 'At least one feed is required'

  const parsedFeeds = removeNil(feeds)

  if (parsedFeeds.length < feeds.length) return 'At least one feed is invalid (must be valid JSON)'

  const feedError = parsedFeeds.map(validateFeed).find((e) => e instanceof ValidationError)

  if (feedError) return `At least one feed is invalid (${feedError.data.toLowerCase()}).`
}

export const getStatusTags = async (alert: Alert) => {
  const params = getAlertParams(alert)
  const error = await getAlertError(params)

  if (error) {
    return [
      ['status', 'error'],
      ['message', error],
    ]
  }

  if (!alert.confirmed_at) {
    return [
      ['status', 'pending'],
      ['message', 'Please confirm your alert via email'],
    ]
  }

  if (alert.unsubscribed_at || alert.deleted_at) {
    return [
      ['status', 'error'],
      ['message', 'This alert has been deactivated'],
    ]
  }

  return [
    ['status', 'ok'],
    ['message', 'This alert is active'],
  ]
}

export const createStatusEvent = async (alert: Alert) =>
  appSigner.sign(
    createEvent(NOTIFIER_STATUS, {
      content: await appSigner.nip44.encrypt(
        alert.pubkey,
        JSON.stringify(await getStatusTags(alert))
      ),
      tags: [
        ['d', alert.address],
        ['p', alert.pubkey],
      ],
    })
  )
