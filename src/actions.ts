import { getTagValue, getTagValues, getAddress, SignedEvent } from '@welshman/util'
import {NOTIFIER_SUBSCRIPTION} from './env.js'
import {EmailUser, Subscription} from './domain.js'
import { insertEmailUser, confirmEmailUser, deleteSubscription, deleteEmailUser, authenticateEmailUser, insertSubscription } from './database.js'
import { sendConfirmEmail } from './mailgun.js'
import { registerSubscription } from './worker.js'

class ApplicationError extends Error {}

export type ConfirmEmailParams = {email: string, confirm_token: string}

export async function confirmEmail({email, confirm_token}: ConfirmEmailParams) {
  if (!await confirmEmailUser(email, confirm_token)) {
    throw new ApplicationError("It looks like that confirmation code is invalid or has expired.")
  }
}

export type UnsubscribeEmailParams = {email: string, access_token: string}

export async function unsubscribeEmail({email, access_token}: UnsubscribeEmailParams) {
  if (!await authenticateEmailUser(email, access_token)) {
    throw new ApplicationError("Invalid access token")
  }

  await deleteEmailUser(email)
}

export type AddSubscriptionParams = Pick<Subscription, 'event' | 'tags'>

export async function addSubscription({event, tags}: AddSubscriptionParams) {
  const email = getTagValue('email', tags)
  const subscription = await insertSubscription(event, tags)

  if (email) {
    const user = await insertEmailUser(email)

    await sendConfirmEmail(user, subscription)
  }

  registerSubscription(subscription)
}

export type ProcessDeleteParams = {event: SignedEvent}

export const processDelete = async ({event}: ProcessDeleteParams) => {
  for (const address of getTagValues('a', event.tags)) {
    const [kind, pubkey] = address.split(':')

    if (parseInt(kind) !== NOTIFIER_SUBSCRIPTION) {
      continue
    }

    if (pubkey !== event.pubkey) {
      continue
    }

    await deleteSubscription(getAddress(event), event.created_at)
  }
}

