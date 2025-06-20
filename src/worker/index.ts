import { isEmailAlert, isPushAlert, Alert } from '../alert.js'
import { addListener, removeListener } from './push.js'
import { addJob, removeJob } from './email.js'

export const registerAlert = (alert: Alert) => {
  if (isEmailAlert(alert)) {
    addJob(alert)
  }

  if (isPushAlert(alert)) {
    addListener(alert)
  }

  console.log('registered job', alert.address)
}

export const unregisterAlert = (alert: Alert) => {
  if (isEmailAlert(alert)) {
    removeJob(alert)
  }

  if (isPushAlert(alert)) {
    removeListener(alert)
  }

  console.log('unregistered job', alert.address)
}
