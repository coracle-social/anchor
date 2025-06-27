import { CronExpressionParser } from 'cron-parser'
import { tryCatch, int, HOUR, removeNil, LOCALE, TIMEZONE } from '@welshman/lib'
import { Feed, ValidationError, validateFeed } from '@welshman/feeds'
import {
  makeEvent,
  SignedEvent,
  ALERT_STATUS,
  ALERT_EMAIL,
  ALERT_WEB,
  ALERT_IOS,
  ALERT_ANDROID,
} from '@welshman/util'
import { appSigner } from './env.js'

export const alertKinds = [ALERT_EMAIL, ALERT_WEB, ALERT_IOS, ALERT_ANDROID]

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
  failed_at?: number
  failed_reason?: string
}

export type Alert = BaseAlert & {
  feeds: Feed[]
  locale?: string
  timezone?: string
  pause_until?: number
}

export type EmailAlert = Alert & {
  cron: string
  email: string
  handlers: string[][]
}

export type WebAlert = Alert & {
  endpoint: string
  p256dh: string
  auth: string
}

export type IosAlert = Alert & {
  deviceToken: string
  bundleIdentifier: string
}

export type AndroidAlert = Alert & {
  deviceToken: string
}

export type PushAlert = WebAlert | IosAlert | AndroidAlert

export const isEmailAlert = (alert: Alert): alert is EmailAlert => alert.event.kind === ALERT_EMAIL

export const isWebAlert = (alert: Alert): alert is WebAlert => alert.event.kind === ALERT_WEB

export const isIosAlert = (alert: Alert): alert is IosAlert => alert.event.kind === ALERT_IOS

export const isAndroidAlert = (alert: Alert): alert is AndroidAlert =>
  alert.event.kind === ALERT_ANDROID

export const isPushAlert = (alert: Alert): alert is PushAlert =>
  isWebAlert(alert) || isIosAlert(alert) || isAndroidAlert(alert)

export const getAlertError = async (alert: Alert) => {
  if (alert.failed_reason) {
    return alert.failed_reason
  }

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

  if (isAndroidAlert(alert)) {
    if (!alert.deviceToken) {
      return 'No FCM device_token was provided'
    }
  }

  if (isIosAlert(alert)) {
    if (!alert.deviceToken) {
      return 'No APNs device_token was provided'
    }

    if (!alert.bundleIdentifier) {
      return 'No bundle_identifier was provided'
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

export const getFormatter = (alert: Alert) => {
  // Attempt to make a formatter with as many user-provided options as we can
  for (const locale of removeNil([alert.locale, LOCALE])) {
    for (const timezone of removeNil([alert.timezone, TIMEZONE])) {
      const formatter = tryCatch(
        () =>
          new Intl.DateTimeFormat(locale, {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: timezone,
          })
      )

      if (formatter) {
        return formatter
      }
    }
  }

  throw new Error("This should never happen, it's here only because of typescript")
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
