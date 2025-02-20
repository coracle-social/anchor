import {CronJob} from 'cron'

const jobsByAddress = new Map()

const createJob = subscription => {
  const run = () => {
    console.log('running subscription', subscription)
  }

  new CronJob("0,10,20,30,40,50 * * * * *", run, null, true, 'UTC')
}

export const registerSubscription = (subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.set(subscription.address, createJob(subscription))
}

export const unregisterSubscription = (subscription) => {
  jobsByAddress.get(subscription.address)?.stop()
  jobsByAddress.delete(subscription.address)
}

