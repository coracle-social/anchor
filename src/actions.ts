import { instrument } from 'succinct-async'
import { getTagValues } from '@welshman/util'
import { NOTIFIER_SUBSCRIPTION } from './env.js'
import { Alert } from './alert.js'
import * as mailer from './mailer.js'
import * as worker from './worker.js'
import * as db from './database.js'

export class ActionError extends Error {
  toString() {
    return this.message
  }
}

export type AddAlertParams = Pick<Alert, 'event' | 'tags'>

export const addAlert = instrument('actions.addAlert', async ({ event, tags }: AddAlertParams) => {
  const alert = await db.insertAlert(event, tags)

  if (alert.email.includes('@')) {
    await mailer.sendConfirm(alert)
  }

  return alert
})

export type ConfirmAlertParams = Pick<Alert, 'token'>

export const confirmAlert = instrument(
  'actions.confirmAlert',
  async ({ token }: ConfirmAlertParams) => {
    const alert = await db.confirmAlert(token)

    if (alert) {
      worker.registerAlert(alert)
    } else {
      throw new ActionError('It looks like that confirmation code is invalid or has expired.')
    }
  }
)

export type UnsubscribeParams = Pick<Alert, 'token'>

export const unsubscribe = instrument(
  'actions.unsubscribe',
  async ({ token }: UnsubscribeParams) => {
    const alert = await db.unsubscribeAlert(token)

    if (alert) {
      worker.unregisterAlert(alert)
    }
  }
)

export type ProcessDeleteParams = Pick<Alert, 'event'>

export const processDelete = instrument(
  'actions.processDelete',
  async ({ event }: ProcessDeleteParams) => {
    for (const address of getTagValues('a', event.tags)) {
      const [kind, pubkey] = address.split(':')

      if (parseInt(kind) !== NOTIFIER_SUBSCRIPTION) {
        continue
      }

      if (pubkey !== event.pubkey) {
        continue
      }

      const alert = await db.deleteAlert(address, event.created_at)

      if (alert) {
        worker.unregisterAlert(alert)
      }
    }
  }
)
