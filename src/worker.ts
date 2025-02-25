import {CronJob} from 'cron'
import {nth, assoc, nthEq} from '@welshman/lib'
import type {TrustedEvent} from '@welshman/util'
import {getIdFilters, getReplyFilters} from '@welshman/util'
import {subscribe, SubscriptionEvent} from '@welshman/net'
import type {SubscribeRequestWithHandlers} from '@welshman/net'
import type {Subscription} from './domain.js'
import {getSubscriptionParams} from './domain.js'
import {getEmailUser} from './database.js'
import {sendDigest} from './mailgun.js'

const jobsByAddress = new Map()

export const load = (request: SubscribeRequestWithHandlers) =>
  new Promise<TrustedEvent[]>(resolve => {
    const sub = subscribe({closeOnEose: true, timeout: 10_000, ...request})
    const events: TrustedEvent[] = []

    sub.on(SubscriptionEvent.Event, (url: string, e: TrustedEvent) => events.push(e))
    sub.on(SubscriptionEvent.Complete, () => resolve(events))
  })

const createJob = (subscription: Subscription) => {
  const {cron, relays, filters, handlers, email, pause_until} = getSubscriptionParams(subscription)
  const since = Math.max(pause_until || 0, subscription.event.created_at)
  const webHandlers = handlers.filter(nthEq(3, 'web'))

  const run = async () => {
    const statusTags = await getStatusTags(subscription)
    const [status, message] = statusTags.map(nth(1))

    if (status !== 'ok') {
      return console.log('skipping job', subscription.address, status, message)
    }

    console.log('running job', subscription.address)

    const now = Date.now()
    const user = await getEmailUser(email!)

    const [events, handlerEvents] = await Promise.all([
      load({relays, filters: filters.map(assoc('since', since))}),
      load({
        relays: webHandlers.map(nth(2)),
        filters: getIdFilters(webHandlers.map(nth(1))),
      }),
    ])

    const context = await load({relays, filters: getReplyFilters(events)})
    const handlerTemplates = handlerEvents.flatMap(e => e.tags.filter(nthEq(0, 'web')).map(nth(1)))
    const handlerTemplate = handlerTemplates[0] || 'https://coracle.social/'

    sendDigest(user, handlerTemplate, events, context)

    console.log('finished job', subscription.address, 'in', Date.now() - now, 'ms')
  }

  const job = CronJob.from({
    cronTime: cron,
    onTick: run,
    start: true,
    timeZone: 'UTC',
  })

  console.log('registered job', subscription.address, 'for', job.nextDate().toISO()!.slice(0, -8))

  return job
}

export const registerSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.set(subscription.address, createJob(subscription))
}

export const unregisterSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.delete(subscription.address)
}

