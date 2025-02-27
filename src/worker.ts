import { CronJob } from 'cron'
import { nth, assoc, nthEq } from '@welshman/lib'
import { getIdFilters, getTagValue, getReplyFilters } from '@welshman/util'
import type { Subscription } from './domain.js'
import { getSubscriptionParams, getStatusTags } from './domain.js'
import * as digest from './digest.js'

const jobsByAddress = new Map()

const createJob = (subscription: Subscription) => {
  const { cron, relays, filters, handlers, pause_until } = getSubscriptionParams(subscription)

  const run = async () => {
    try {
      const statusTags = await getStatusTags(subscription)
      const status = getTagValue('status', statusTags)
      const message = getTagValue('message', statusTags)

      if (status !== 'ok') {
        return console.log('worker: job skipped', subscription.address, status, message)
      }

      console.log('worker: job starting', subscription.address)

      const now = Date.now()

      if (await digest.send(subscription)) {
        console.log('worker: job completed', subscription.address, 'in', Date.now() - now, 'ms')
      } else {
        console.log('worker: job skipped', subscription.address, 'ok', 'no data received')
      }
    } catch (e) {
      console.log('worker: job failed', subscription.address, e)
    }
  }

  return CronJob.from({
    // cronTime: cron,
    cronTime: '0,15,30,45 * * * * *',
    onTick: run,
    start: true,
    timeZone: 'UTC',
  })
}

export const registerSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.set(subscription.address, createJob(subscription))

  console.log('registered job', subscription.address)
}

export const unregisterSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.delete(subscription.address)

  console.log('unregistered job', subscription.address)
}
