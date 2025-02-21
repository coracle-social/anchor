import {CronJob} from 'cron'
import type {Subscription} from './types.js'

const jobsByAddress = new Map()

const createJob = (subscription: Subscription) => {
  const run = () => {
    console.log('running subscription', subscription)
  }

  new CronJob("0 * * * * *", run, null, true, 'UTC')
}

export const registerSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.set(subscription.address, createJob(subscription))
}

export const unregisterSubscription = (subscription: Subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.delete(subscription.address)
}

