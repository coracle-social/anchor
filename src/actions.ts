import { instrument } from 'succinct-async'
import { getTagValues, getAddress, SignedEvent } from '@welshman/util'
import { NOTIFIER_SUBSCRIPTION } from './env.js'
import { Subscription } from './domain.js'
import * as mailer from './mailgun.js'
import * as worker from './worker.js'
import * as db from './database.js'

export class ActionError extends Error {
  toString() {
    return this.message
  }
}

export type AddSubscriptionParams = Pick<Subscription, 'event' | 'tags'>

export const addSubscription = instrument(
  'actions.addSubscription',
  async ({ event, tags }: AddSubscriptionParams) => {
    const subscription = await db.insertSubscription(event, tags)

    if (subscription.email.includes('@')) {
      await mailer.sendConfirm(subscription)
    }
  }
)

export type ConfirmSubscriptionParams = Pick<Subscription, 'token'>

export const confirmSubscription = instrument(
  'actions.confirmSubscription',
  async ({ token }: ConfirmSubscriptionParams) => {
    const subscription = await db.confirmSubscription(token)

    if (subscription) {
      worker.registerSubscription(subscription)
    } else {
      throw new ActionError('It looks like that confirmation code is invalid or has expired.')
    }
  }
)

export type UnsubscribeParams = Pick<Subscription, 'token'>

export const unsubscribe = instrument(
  'actions.unsubscribe',
  async ({ token }: UnsubscribeParams) => {
    const subscription = await db.unsubscribeSubscription(token)

    if (subscription) {
      worker.unregisterSubscription(subscription)
    }
  }
)

export type ProcessDeleteParams = Pick<Subscription, 'event'>

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

      const subscription = await db.deleteSubscription(address, event.created_at)

      if (subscription) {
        worker.unregisterSubscription(subscription)
      }
    }
  }
)
