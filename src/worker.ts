import {CronJob} from 'cron'
import type {Subscription} from './domain.js'
import {getSubscriptionError, getSubscriptionParams} from './domain.js'

const jobsByAddress = new Map()

const createJob = (subscription: Subscription) => {
  const {cron, relays, filters, params, bunker_url} = getSubscriptionParams(subscription)

  const run = () => {
    console.log('running subscription', subscription)
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

