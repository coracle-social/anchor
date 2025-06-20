import { isEmailAlert, isPushAlert, Alert } from '../alert.js'
import { addListener, removeListener } from './push.js'
import { addJob, removeJob } from './email.js'

export const registerAlert = (alert: Alert) => {
  console.log('registering job', alert.address)

  if (isEmailAlert(alert)) {
    addJob(alert)
  }

  if (isPushAlert(alert)) {
    addListener(alert)
  }
}

export const unregisterAlert = (alert: Alert) => {
  console.log('unregistering job', alert.address)

  if (isEmailAlert(alert)) {
    removeJob(alert)
  }

  if (isPushAlert(alert)) {
    removeListener(alert)
  }
}
