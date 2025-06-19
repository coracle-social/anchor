import { CronExpressionParser } from 'cron-parser'
import { tryCatch, int, HOUR, removeNil } from '@welshman/lib'
import { Feed, ValidationError, validateFeed } from '@welshman/feeds'
import { makeEvent, SignedEvent, ALERT_STATUS, ALERT_REQUEST_EMAIL, ALERT_REQUEST_PUSH } from '@welshman/util'
import { appSigner } from './env.js'

export type BaseAlert = {
  address: string
  pubkey: string
  event: SignedEvent
  tags: string[][]
  token: string
  created_at: number
  deleted_at?: number
  confirmed_at?: number
  unsubscribed_at?: number
}

export type Alert = BaseAlert & {
  feeds: Feed[]
  claims: string[][]
  locale?: string
  timezone?: string
  pause_until?: number
}

export type EmailAlert = Alert & {
  cron: string
  email: string
  handlers: string[][]
}

export type PushAlert = Alert & {
  push_token: string
  platform: string
}

export const isEmailAlert = (alert: Alert): alert is EmailAlert =>
  alert.event.kind === ALERT_REQUEST_EMAIL

export const isPushAlert = (alert: Alert): alert is PushAlert =>
  alert.event.kind === ALERT_REQUEST_PUSH

export const getAlertError = async (alert: Alert) => {
  if (isEmailAlert(alert)) {
    if (!alert.cron) {
      return 'Immediate notifications are not currently supported.'
    }

    const interval = tryCatch(() => CronExpressionParser.parse(alert.cron, { strict: true }))

    if (!interval) {
      return `Cron expression "${alert.cron}" is invalid`
    }

    const dates = interval.take(10).map((d) => d.toDate().valueOf() / 1000)

    let total = 0
    for (let i = 1; i < dates.length; i++) {
      total += dates[i] - dates[i - 1]
    }

    if (total / (dates.length - 1) < int(1, HOUR)) {
      return 'Requested notification interval is too short'
    }

    if (!alert.email?.includes('@')) {
      return 'Please provide a valid email address'
    }
  }

  if (alert.feeds.length === 0) {
    return 'At least one feed is required'
  }

  const parsedFeeds = removeNil(alert.feeds)

  if (parsedFeeds.length < alert.feeds.length) {
    return 'At least one feed is invalid (must be valid JSON)'
  }

  const feedError = parsedFeeds.map(validateFeed).find((e) => e instanceof ValidationError)

  if (feedError) {
    return `At least one feed is invalid (${feedError.data.toLowerCase()}).`
  }
}

export const getStatusTags = async (alert: Alert) => {
  const error = await getAlertError(alert)

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
    makeEvent(ALERT_STATUS, {
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
