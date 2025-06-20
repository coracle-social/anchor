import { CronJob } from 'cron'
import { getTagValue } from '@welshman/util'
import { getStatusTags, EmailAlert } from '../alert.js'
import { Digest } from '../digest.js'

const jobsByAddress = new Map()

export const runJob = async (alert: EmailAlert) => {
  try {
    const statusTags = await getStatusTags(alert)
    const status = getTagValue('status', statusTags)
    const message = getTagValue('message', statusTags)

    if (status !== 'ok') {
      console.log('worker: job skipped', alert.address, status, message)
      return false
    }

    console.log('worker: job starting', alert.address)

    const now = Date.now()
    const digest = new Digest(alert)

    if (await digest.send()) {
      console.log('worker: job completed', alert.address, 'in', Date.now() - now, 'ms')
      return true
    } else {
      console.log('worker: job skipped', alert.address, 'ok', 'no data received')
      return false
    }
  } catch (e) {
    console.log('worker: job failed', alert.address, e)
    return false
  }
}

const createJob = (alert: EmailAlert) => {
  const run = async () => {
    await runJob(alert)
  }

  return CronJob.from({
    cronTime: alert.cron,
    onTick: run,
    start: true,
    timeZone: 'UTC',
  })
}

export const addJob = (alert: EmailAlert) => {
  jobsByAddress.get(alert.address)?.stop()
  jobsByAddress.set(alert.address, createJob(alert))
}

export const removeJob = (alert: EmailAlert) => {
  jobsByAddress.get(alert.address)?.stop()
  jobsByAddress.delete(alert.address)
}
