import {CronJob} from 'cron'
import {nth, assoc, nthEq} from '@welshman/lib'
import type {TrustedEvent} from '@welshman/util'
import {getIdFilters, getReplyFilters} from '@welshman/util'
import {subscribe, SubscriptionEvent} from '@welshman/net'
import type {SubscribeRequestWithHandlers} from '@welshman/net'
import type {Subscription} from './domain.js'
import {getSubscriptionError, getSubscriptionParams} from './domain.js'
import {getEmail} from './database.js'
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
  const {cron, relays, filters, handlers, email, bunker_url, pause_until = 0} = getSubscriptionParams(subscription)
  const since = Math.max(pause_until, subscription.event.created_at)
  const webHandlers = handlers.filter(nthEq(3, 'web'))

  const getUser = async () => {
    if (email) {
      return getEmail(email)
    }
  }

  const run = async () => {
    const user = await getUser()

    if (user) {
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
    }
  }

  new CronJob(cron, run, null, true, 'UTC')
}

export const registerSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()

  if (!getSubscriptionError(subscription)) {
    jobsByAddress.set(subscription.address, createJob(subscription))
  }
}

export const unregisterSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.delete(subscription.address)
}

