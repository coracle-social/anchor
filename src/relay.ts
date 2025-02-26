import { WebSocket } from 'ws'
import { Request } from 'express'
import { decrypt } from '@welshman/signer'
import { parseJson, gt, pluck, ago, MINUTE, randomId } from '@welshman/lib'
import type { SignedEvent, Filter } from '@welshman/util'
import {
  DELETE,
  getAddress,
  matchFilters,
  getTagValue,
  getTagValues,
  hasValidSignature,
} from '@welshman/util'
import { appSigner, NOTIFIER_SUBSCRIPTION } from './env.js'
import { getSubscriptionsForPubkey, getSubscription } from './database.js'
import { addSubscription, processDelete } from './actions.js'
import { createStatusEvent } from './domain.js'

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
  }

  handle(message: WebSocket.Data) {
    let parsedMessage: RelayMessage
    try {
      parsedMessage = JSON.parse(message.toString())
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
      return
    }

    let verb: string
    let payload: any[]
    try {
      ;[verb, ...payload] = parsedMessage
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to read message'])
      return
    }

    const handler = this[`on${verb}` as keyof Connection] as
      | ((...args: any[]) => Promise<void>)
      | undefined

    if (handler) {
      handler.call(this, ...payload)
    } else {
      this.send(['NOTICE', '', `Unable to handle ${verb} message`])
    }
  }

  async onAUTH(event: SignedEvent) {
    if (!hasValidSignature(event)) {
      return this.send(['OK', event.id, false, 'invalid signature'])
    }

    if (event.kind !== 22242) {
      return this.send(['OK', event.id, false, 'invalid kind'])
    }

    if (event.created_at < ago(5, MINUTE)) {
      return this.send(['OK', event.id, false, 'created_at is too far from current time'])
    }

    if (getTagValue('challenge', event.tags) !== this.auth.challenge) {
      return this.send(['OK', event.id, false, 'invalid challenge'])
    }

    if (!getTagValue('relay', event.tags)?.includes(this._request.get('host') || '')) {
      return this.send(['OK', event.id, false, 'invalid relay'])
    }

    this.auth.event = event

    this.send(['OK', event.id, true, ''])
  }

  async onREQ(id: string, ...filters: Filter[]) {
    if (!this.auth.event) {
      return this.send(['CLOSED', id, `auth-required: subscriptions are protected`])
    }

    const userPubkey = this.auth.event.pubkey
    const subscriptions = await getSubscriptionsForPubkey(userPubkey)
    const subscriptionEvents = pluck<SignedEvent>('event', subscriptions)
    const statusEvents = await Promise.all(subscriptions.map(createStatusEvent))

    for (const event of [...subscriptionEvents, ...statusEvents]) {
      if (matchFilters(filters, event)) {
        this.send(['EVENT', id, event])
      }
    }

    this.send(['EOSE', id])
  }

  async onCLOSE() {
    // pass
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
      this.send(['OK', event.id, false, 'Unknown error'])
      throw e
    }
  }

  private async handleDelete(event: SignedEvent) {
    await processDelete({ event })

    this.send(['OK', event.id, true, ''])
  }

  private async handleNotifierSubscription(event: SignedEvent) {
    const pubkey = await appSigner.getPubkey()

    if (!getTagValues('p', event.tags).includes(pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    const subscription = await getSubscription(getAddress(event))

    if (gt(subscription?.deleted_at, event.created_at)) {
      return this.send(['OK', event.id, false, 'Subscription has been deleted'])
    }

    let plaintext: string
    try {
      plaintext = await decrypt(appSigner, event.pubkey, event.content)
    } catch (e) {
      return this.send(['OK', event.id, false, 'Failed to decrypt event content'])
    }

    const tags = parseJson(plaintext)

    if (!Array.isArray(tags)) {
      return this.send(['OK', event.id, false, 'Encrypted tags are not an array'])
    }

    await addSubscription({ event, tags })

    this.send(['OK', event.id, true, ''])
  }
}
