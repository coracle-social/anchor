import { CronJob } from 'cron'
import { nth, assoc, nthEq } from '@welshman/lib'
import { getIdFilters, getTagValue, getReplyFilters } from '@welshman/util'
import type { Alert } from './alert.js'
import { getAlertParams, getStatusTags } from './alert.js'
import * as digest from './digest.js'

const jobsByAddress = new Map()

const createJob = (alert: Alert) => {
  const { cron }  = getAlertParams(alert)

  const run = async () => {
    try {
      const statusTags = await getStatusTags(alert)
      const status = getTagValue('status', statusTags)
      const message = getTagValue('message', statusTags)

      if (status !== 'ok') {
        return console.log('worker: job skipped', alert.address, status, message)
      }

      console.log('worker: job starting', alert.address)

      const now = Date.now()

      if (await digest.send(alert)) {
        console.log('worker: job completed', alert.address, 'in', Date.now() - now, 'ms')
      } else {
        console.log('worker: job skipped', alert.address, 'ok', 'no data received')
      }
    } catch (e) {
      console.log('worker: job failed', alert.address, e)
    }
  }

  return CronJob.from({
    cronTime: cron,
    // cronTime: '0,15,30,45 * * * * *',
    onTick: run,
    start: true,
    timeZone: 'UTC',
  })
}

export const registerAlert = (alert: Alert) => {
  jobsByAddress.get(alert.address)?.stop()
  jobsByAddress.set(alert.address, createJob(alert))

  console.log('registered job', alert.address)
}

export const unregisterAlert = (alert: Alert) => {
  jobsByAddress.get(alert.address)?.stop()
  jobsByAddress.delete(alert.address)

  console.log('unregistered job', alert.address)
}
