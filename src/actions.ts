import { instrument } from 'succinct-async'
import {
  getTags,
  getTagValues,
  makeEvent,
  AUTH_JOIN,
  ALERT_REQUEST_EMAIL,
  ALERT_REQUEST_PUSH,
} from '@welshman/util'
import { Pool } from '@welshman/net'
import { appSigner } from './env.js'
import { Alert, isEmailAlert } from './alert.js'
import * as mailer from './mailer.js'
import * as worker from './worker/index.js'
import * as db from './database.js'

export class ActionError extends Error {
  toString() {
    return this.message
  }
}

export type AddAlertParams = Pick<Alert, 'event' | 'tags'>

export const addAlert = instrument('actions.addAlert', async ({ event, tags }: AddAlertParams) => {
  const alert = await db.insertAlert(event, tags)

  // Send confirmation email if we need to
  if (isEmailAlert(alert) && alert.email.includes('@')) {
    await mailer.sendConfirm(alert)
  }

  // Request access to any relays using provided invite codes
  for (const [_, url, claim] of getTags('claim', alert.tags)) {
    const template = makeEvent(AUTH_JOIN, { tags: [['claim', claim]] })
    const event = await appSigner.sign(template)

    Pool.get().get(url).send(['EVENT', event])
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

      if (![ALERT_REQUEST_EMAIL, ALERT_REQUEST_PUSH].includes(parseInt(kind))) {
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
