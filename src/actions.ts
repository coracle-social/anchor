import {instrument} from 'succinct-async'
import { getTagValue, getTagValues, getAddress, SignedEvent } from '@welshman/util'
import {NOTIFIER_SUBSCRIPTION} from './env.js'
import {EmailUser, Subscription} from './domain.js'
import * as mailer from './mailgun.js'
import * as worker from './worker.js'
import * as db from './database.js'

export class ActionError extends Error {
  toString() {
    return this.message
  }
}

export type UnsubscribeEmailParams = {email: string, access_token: string}

export const unsubscribeEmail = instrument('actions.unsubscribeEmail', async ({email, access_token}: UnsubscribeEmailParams) => {
  if (!await db.authenticateEmailUser(email, access_token)) {
    throw new ActionError("Invalid access token")
  }

  await db.deleteEmailUser(email)
})

export type AddSubscriptionParams = Pick<Subscription, 'event' | 'tags'>

export const addSubscription = instrument('actions.addSubscription', async ({event, tags}: AddSubscriptionParams) => {
  const email = getTagValue('email', tags)
  const subscription = await db.insertSubscription(event, tags)

  if (email) {
    const user = await db.insertEmailUser(email)

    await mailer.sendConfirmEmail(user, subscription)
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

