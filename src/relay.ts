import { decrypt } from '@welshman/signer'
import { parseJson, pluck, ago, MINUTE, randomId, tryCatch } from '@welshman/lib'
import type { SignedEvent, Filter } from '@welshman/util'
import { DELETE, matchFilters, getTagValue, getTagValues, createEvent, hasValidSignature } from '@welshman/util'
import { appSigner, LOG_RELAY_MESSAGES, NOTIFIER_STATUS, NOTIFIER_SUBSCRIPTION } from './env.js'
import { addDelete, addSubscription, getSubscriptionsForPubkey, isSubscriptionDeleted } from './database.js'
import { registerSubscription } from './worker.js'
import { WebSocket } from 'ws'
import { Request } from 'express'

type AuthState = {
  challenge: string
  event?: SignedEvent
}

type RelayMessage = [string, ...any[]]

export class Connection {
  private _socket: WebSocket
  private _request: Request

  auth: AuthState = {
    challenge: randomId(),
    event: undefined,
  }

  constructor(socket: WebSocket, request: Request) {
    this._socket = socket
    this._request = request
    this.send(['AUTH', this.auth.challenge])
  }

  cleanup() {
    this._socket.close()
  }

  send(message: RelayMessage) {
    this._socket.send(JSON.stringify(message))

    if (LOG_RELAY_MESSAGES) {
      console.log('relay sent:', ...message)
    }
  }

  handle(message: WebSocket.Data) {
    let parsedMessage: RelayMessage
    try {
      parsedMessage = JSON.parse(message.toString())
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
      return
    }

    if (LOG_RELAY_MESSAGES) {
      console.log('relay received:', ...parsedMessage)
    }

    let verb: string
    let payload: any[]
    try {
      [verb, ...payload] = parsedMessage
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to read message'])
      return
    }

    const handler = this[`on${verb}` as keyof Connection] as ((
      ...args: any[]
    ) => Promise<void>) | undefined

    if (handler) {
      try {
        handler.call(this, ...payload)
      } catch (e) {
        console.error(e)
      }
    } else {
      this.send(['NOTICE', '', `Unable to handle ${verb} message`])
    }
  }

  async onAUTH(event: SignedEvent) {
    if (!hasValidSignature(event)) {
      return this.send(['OK', event.id, false, "invalid signature"])
    }

    if (event.kind !== 22242) {
      return this.send(['OK', event.id, false, "invalid kind"])
    }

    if (event.created_at < ago(5, MINUTE)) {
      return this.send(['OK', event.id, false, "created_at is too far from current time"])
    }

    if (getTagValue('challenge', event.tags) !== this.auth.challenge) {
      return this.send(['OK', event.id, false, "invalid challenge"])
    }

    if (!getTagValue('relay', event.tags)?.includes(this._request.get('host') || "")) {
      return this.send(['OK', event.id, false, "invalid relay"])
    }

    this.auth.event = event

    this.send(['OK', event.id, true, ""])
  }

  async onREQ(id: string, ...filters: Filter[]) {
    if (!this.auth.event) {
      return this.send(['CLOSED', id, `auth-required: subscriptions are protected`])
    }

    const userPubkey = this.auth.event.pubkey
    const subscriptions = await getSubscriptionsForPubkey(userPubkey)

    const subscriptionEvents = pluck<SignedEvent>('event', subscriptions)
    const subscriptionStatusEvents = await Promise.all(
      subscriptions.map(
        async (subscription) =>
          appSigner.sign(
            createEvent(NOTIFIER_STATUS, {
              content: await appSigner.nip44.encrypt(
                userPubkey,
                JSON.stringify([
                  ["status", "ok"],
                  ["message", "This subscription is active"],
                ])
              ),
              tags: [
                ["a", subscription.address],
                ["p", subscription.pubkey],
              ],
            })
          )
      )
    )

    for (const event of [...subscriptionEvents, ...subscriptionStatusEvents]) {
      if (matchFilters(filters, event)) {
        this.send(['EVENT', id, event])
      }
    }

    this.send(['EOSE', id])
  }

  async onEVENT(event: SignedEvent) {
    if (!hasValidSignature(event)) {
      return this.send(['OK', event.id, false, 'Invalid signature'])
    }

    try {
      if (event.kind === DELETE) {
        await this.handleDelete(event)
      } else if (event.kind === NOTIFIER_SUBSCRIPTION) {
        await this.handleNotifierSubscription(event)
      } else {
        this.send(['OK', event.id, false, 'Event kind not accepted'])
      }
    } catch (e) {
      console.error(e)
      this.send(['OK', event.id, false, 'Unknown error'])
    }
  }

  private async handleDelete(event: SignedEvent) {
    await addDelete(event)
    this.send(['OK', event.id, true, ""])
  }

  private async handleNotifierSubscription(event: SignedEvent) {
    const pubkey = await appSigner.getPubkey()

    if (!getTagValues('p', event.tags).includes(pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    if (await isSubscriptionDeleted(event)) {
      return this.send(['OK', event.id, false, 'Subscription has been deleted'])
    }

    const plaintext = await tryCatch(() => decrypt(appSigner, event.pubkey, event.content))
    const tags = await tryCatch(() => parseJson(plaintext))

    if (!Array.isArray(tags)) {
      return this.send(['OK', event.id, false, 'Failed to decrypt event content'])
    }

    registerSubscription(await addSubscription(event, tags))

    this.send(['OK', event.id, true, ""])
  }
}
