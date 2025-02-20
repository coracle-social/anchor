const {decrypt} = require('@welshman/signer')
const {parseJson, randomId, tryCatch} = require('@welshman/lib')
const {DELETE, matchFilters, getTagValues, createEvent, hasValidSignature} = require('@welshman/util')
const {appSigner, LOG_RELAY_MESSAGES, NOTIFIER_STATUS, NOTIFIER_SUBSCRIPTION} = require('./env')
const {addDelete, addSubscription, getSubscriptionsForPubkey} = require('./database')

class Connection {
  auth = {
    challenge: randomId(),
    event: undefined,
  }

  // Lifecycle

  constructor(socket) {
    this._socket = socket
  }

  cleanup() {
    this._socket.close()
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

  async onREQ(id, ...filters) {
    if (!this.auth.event) {
      return this.send(['CLOSED', id, `auth-required: subscriptions are protected`])
    }

    const subscriptions = await getSubscriptionsForPubkey(this.auth.event.pubkey)

    const subscriptionStatusEvents = await Promise.all(
      subscriptions.map(
        async (subscription) =>
          appSigner.sign(createEvent(NOTIFIER_STATUS, {
            content: await appSigner.nip44.encrypt(
              this.auth.event.pubkey,
              JSON.stringify([
                ["status", "ok"],
                ["message", "This subscription is active"],
              ])
            ),
            tags: [
              ["a", subscription.address],
              ["p", subscription.pubkey],
            ],
          }))
      )
    )

    for (const event of [...subscriptions.events, ...subscriptionStatusEvents]) {
      if (matchFilters(filters, event)) {
        this.send(['EVENT', id, event])
      }
    }

    this.send(['EOSE', id])
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
