import { CronExpressionParser } from 'cron-parser'
import { tryCatch, parseJson, isPojo, fromPairs } from '@welshman/lib'
import type { SignedEvent, Filter } from '@welshman/util'
import {
  isShareableRelayUrl,
  getTags,
  getTagValues,
  createEvent,
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
  relays: string[]
  filters: Filter[]
  handlers: string[][]
  channel: Channel
  email?: string
  bunker_url?: string
  pause_until?: number
}

export const getAlertParams = (alert: Alert): AlertParams => {
  return {
    channel: getTagValue('channel', alert.tags) as Channel,
    cron: getTagValue('cron', alert.tags) || '0 0 0 0 0 0',
    handlers: getTags('handler', alert.tags),
    relays: getTagValues('relay', alert.tags),
    filters: getTagValues('filter', alert.tags).map(parseJson),
    pause_until: parseInt(getTagValue('pause_until', alert.tags) || '') || 0,
    bunker_url: getTagValue('cron', alert.tags),
    email: getTagValue('email', alert.tags),
  }
}

export const getAlertError = async ({ channel, cron, relays, filters, email }: AlertParams) => {
  if (channel !== Channel.Email) return 'Only email notifications are currently supported.'
  if (!cron) return 'Immediate notifications are not currently supported.'

  const interval = tryCatch(() => CronExpressionParser.parse(cron, { strict: true }))

  if (!interval) return `Cron expression "${cron}" is invalid`

  const dates = interval.take(10).map((d) => d.toDate().valueOf() / 1000)

  let total = 0
  for (let i = 1; i < dates.length; i++) {
    total += dates[i] - dates[i - 1]
  }

  // if (total / (dates.length - 1) < int(1, HOUR)) return "Requested notification interval is too short"
  if (relays.length === 0) return 'At least one relay url is required'
  if (relays.some((url) => !isShareableRelayUrl(url))) return 'Request contained invalid relay urls'
  if (filters.length === 0) return 'At least one filter is required'
  if (filters.some((filter) => !isPojo(filter))) return 'Request contained invalid filters'
  if (!email?.includes('@')) return 'Please provide a valid email address'
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
