const {decrypt} = require('@welshman/signer')
const {parseJson, tryCatch} = require('@welshman/lib')
const {DELETE, matchFilters, getTagValues, hasValidSignature} = require('@welshman/util')
const {appSigner, LOG_RELAY_MESSAGES} = require('./env')
const {addEvent, removeEvents} = require('./database')

const NOTIFIER_SUBSCRIPTION = 32830

const NOTIFIER_SUBSCRIPTION_STATUS = 32831

const subscriptions = new Map()

const sendEvent = async event => {
  for (const [id, {connection, filters}] of subscriptions.entries()) {
    if (matchFilters(filters, event)) {
      connection.send(['EVENT', id, event])
    }
  }
}

class Connection {

  // Lifecycle

  constructor(socket) {
    this._socket = socket
    this._ids = new Set()
  }

  cleanup() {
    this._socket.close()

    for (const id of this._ids) {
      this.removeSub(id)
    }
  }

  // Subscription management

  addSub(id, filters) {
    subscriptions.set(id, {connection: this, filters})
    this._ids.add(id)
  }

  removeSub(id) {
    subscriptions.delete(id)
    this._ids.delete(id)
  }

  // Send/receive

  send(message) {
    this._socket.send(JSON.stringify(message))

    if (LOG_RELAY_MESSAGES) {
      console.log('relay sent:', ...message)
    }
  }

  handle(message) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
    }

    if (LOG_RELAY_MESSAGES) {
      console.log('relay received:', ...message)
    }

    let verb, payload
    try {
      [verb, ...payload] = message
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to read message'])
    }

    const handler = this[`on${verb}`]

    if (handler) {
      handler.call(this, ...payload)
    } else {
      this.send(['NOTICE', '', `Unable to handle ${verb} message`])
    }
  }

  // Verb-specific handlers

  onCLOSE(id) {
    this.removeSub(id)
  }

  onREQ(id, ...filters) {
    if (filters.every(f => f.kinds?.includes(NOTIFIER_SUBSCRIPTION_STATUS))) {
      this.addSub(id, filters)
      this.send(['EOSE', id])
    } else {
      this.send(['NOTICE', '', `Only filters matching kind ${NOTIFIER_SUBSCRIPTION_STATUS} events are accepted`])
    }
  }

  async onEVENT(event) {
    if (!hasValidSignature(event)) {
      return this.send(['OK', event.id, false, 'Invalid signature'])
    }

    try {
      if (event.kind === DELETE) {
        this.handleDelete(event)
      } else if (event.kind === NOTIFIER_SUBSCRIPTION) {
        this.handleNotifierSubscription(event)
      } else {
        this.send(['OK', event.id, false, 'Event kind not accepted'])
      }
    } catch (e) {
      console.error(e)

      this.send(['OK', event.id, false, 'Unknown error'])
    }
  }

  async handleDelete(event) {
    await addDelete(event)

    this.send(['OK', event.id, true, ""])
  }

  async handleNotifierSubscription(event) {
    const pubkey = await appSigner.getPubkey()

    if (!getTagValues('p', event.tags).includes(pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    const tags = await tryCatch(() => parseJson(decrypt(appSigner, event.pubkey, event.content)))

    if (!Array.isArray(tags)) {
      return this.send(['OK', event.id, false, 'Failed to decrypt event content'])
    }

    await addSubscription(event, tags)

    this.send(['OK', event.id, true, ""])
  }
}

module.exports = {Connection}
