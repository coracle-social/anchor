import { WebSocket } from 'ws'
import { Request } from 'express'
import { decrypt } from '@welshman/signer'
import { parseJson, gt, pluck, ago, MINUTE, randomId } from '@welshman/lib'
import type { SignedEvent, Filter } from '@welshman/util'
import {
  DELETE,
  CLIENT_AUTH,
  getAddress,
  matchFilters,
  getTagValue,
  getTagValues,
  verifyEvent,
} from '@welshman/util'
import { appSigner } from './env.js'
import { getAlertsForPubkey, getAlert } from './database.js'
import { addAlert, processDelete } from './actions.js'
import { alertKinds, createStatusEvent } from './alert.js'

type AuthState = {
  challenge: string
  event?: SignedEvent
}

type RelayMessage = [string, ...any[]]

export class Connection {
  private _socket: WebSocket
  private _request: Request
  private _subs = new Map<string, Filter[]>()

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
    if (!verifyEvent(event)) {
      return this.send(['OK', event.id, false, 'invalid signature'])
    }

    if (event.kind !== CLIENT_AUTH) {
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
      return this.send(['CLOSED', id, `auth-required: alerts are protected`])
    }

    this._subs.set(id, filters)

    const userPubkey = this.auth.event.pubkey
    const alerts = await getAlertsForPubkey(userPubkey)
    const activeAlerts = alerts.filter((alert) => !alert.deleted_at)
    const alertEvents = pluck<SignedEvent>('event', activeAlerts)
    const statusEvents = await Promise.all(activeAlerts.map(createStatusEvent))

    for (const event of [...alertEvents, ...statusEvents]) {
      if (matchFilters(filters, event)) {
        this.send(['EVENT', id, event])
      }
    }

    this.send(['EOSE', id])
  }

  async onCLOSE(id: string) {
    this._subs.delete(id)
  }

  async onEVENT(event: SignedEvent) {
    if (!verifyEvent(event)) {
      return this.send(['OK', event.id, false, 'Invalid signature'])
    }

    if (event.pubkey !== this.auth.event?.pubkey) {
      return this.send(['OK', event.id, false, 'Event not authorized'])
    }

    try {
      if (event.kind === DELETE) {
        await this.handleDelete(event)
      } else if (alertKinds.includes(event.kind)) {
        await this.handleAlertRequest(event)
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

  private async handleAlertRequest(event: SignedEvent) {
    const pubkey = await appSigner.getPubkey()

    if (!getTagValues('p', event.tags).includes(pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    const duplicate = await getAlert(getAddress(event))

    if (gt(duplicate?.deleted_at, event.created_at)) {
      return this.send(['OK', event.id, false, 'Alert has been deleted'])
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

    const alert = await addAlert({ event, tags })

    this.send(['OK', event.id, true, ''])

    for (const [id, filters] of this._subs) {
      for (const event of [alert.event, await createStatusEvent(alert)]) {
        if (matchFilters(filters, event)) {
          this.send(['EVENT', id, event])
        }
      }
    }
  }
}
