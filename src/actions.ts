import {instrument} from 'succinct-async'
import { getTagValue, getTagValues, getAddress, SignedEvent } from '@welshman/util'
import {NOTIFIER_SUBSCRIPTION} from './env.js'
import {Subscription} from './domain.js'
import * as mailer from './mailgun.js'
import * as worker from './worker.js'
import * as db from './database.js'

export class ActionError extends Error {
  toString() {
    return this.message
  }
}

export type UnsubscribeParams = Pick<Subscription, 'token'>

export const unsubscribe = instrument('actions.unsubscribe', async ({token}: UnsubscribeParams) => {
  await db.unsubscribeSubscription(token)
})

export type AddSubscriptionParams = Pick<Subscription, 'event' | 'tags'>

export const addSubscription = instrument('actions.addSubscription', async ({event, tags}: AddSubscriptionParams) => {
  const subscription = await db.insertSubscription(event, tags)

  if (subscription.email.includes('@')) {
    await mailer.sendConfirm(subscription)
  }

  worker.registerSubscription(subscription)
})

export type ConfirmSubscriptionParams = {confirm_token: string}

export const confirmSubscription = instrument('actions.confirmSubscription', async ({confirm_token}: ConfirmSubscriptionParams) => {
  if (!await db.confirmSubscription(confirm_token)) {
    throw new ActionError("It looks like that confirmation code is invalid or has expired.")
  }
})

export type ProcessDeleteParams = {event: SignedEvent}

export const processDelete = instrument('actions.processDelete', async ({event}: ProcessDeleteParams) => {
  for (const address of getTagValues('a', event.tags)) {
    const [kind, pubkey] = address.split(':')

    if (parseInt(kind) !== NOTIFIER_SUBSCRIPTION) {
      continue
    }

    if (pubkey !== event.pubkey) {
      continue
    }

    await db.deleteSubscription(getAddress(event), event.created_at)
  }
})

