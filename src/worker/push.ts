import webpush from 'web-push'
import { call, on } from '@welshman/lib'
import { Tracker } from '@welshman/net'
import { getFilterId, TrustedEvent } from '@welshman/util'
import { simplifyFeed, makeUnionFeed, FeedController } from '@welshman/feeds'
import {AbstractAdapter, AdapterEvent, SocketEvent, isRelayEvent, isRelayEose, isRelayClosed, RelayMessage, ClientMessage, Socket, isClientReq, isClientClose, ClientMessageType} from '@welshman/net'
import {
  loadRelaySelections,
  makeGetPubkeysForScope,
  makeGetPubkeysForWOTRange,
  loadWot,
} from '../repository.js'
import { PushAlert, WebAlert, IosAlert, AndroidAlert, isWebAlert, isIosAlert, isAndroidAlert } from '../alert.js'
import { failAlert } from '../database.js'
import { appSigner } from '../env.js'

const listenersByAddress = new Map()

export class MultiplexingAdapter extends AbstractAdapter {
  subIdsByFilterId = new Map<string, Set<string>>()

  constructor(readonly socket: Socket) {
    super()

    this._unsubscribers.push(
      on(socket, SocketEvent.Receive, (message: RelayMessage, url: string) => {
        if (isRelayEvent(message) || isRelayEose(message) || isRelayClosed(message)) {
          const [cmd, filterId, ...rest] = message

          for (const subId of this.subIdsByFilterId.get(filterId) || []) {
            this.emit(AdapterEvent.Receive, [cmd, subId, ...rest], url)
          }

          if (isRelayClosed(message)) {
            this.subIdsByFilterId.delete(filterId)
          }
        } else {
          this.emit(AdapterEvent.Receive, message, url)
        }
      }),
    )
  }

  get sockets() {
    return [this.socket]
  }

  get urls() {
    return [this.socket.url]
  }

  send(message: ClientMessage) {
    if (isClientReq(message)) {
      const [_, subId, ...filters] = message

      for (const filter of filters) {
        const filterId = getFilterId(filter)
        const subIds = this.subIdsByFilterId.get(filterId) || new Set<string>()

        // Only send each filter once, re-use the filter id as the sub id
        if (subIds.size === 0) {
          this.socket.send([ClientMessageType.Req, filterId, filter])
        }

        subIds.add(subId)
        this.subIdsByFilterId.set(filterId, subIds)
      }
    } else if (isClientClose(message)) {
      const [_, subId] = message

      for (const [filterId, subIds] of this.subIdsByFilterId.entries()) {
        subIds.delete(subId)

        // Only close the request when the last sub closes
        if (subIds.size === 0) {
          this.socket.send([ClientMessageType.Close, filterId])
          this.subIdsByFilterId.delete(filterId)
        }
      }
    } else {
      this.socket.send(message)
    }
  }
}

const sendWebNotification = async (alert: WebAlert, event: TrustedEvent, relays: string[]) => {
  try {
    const subscription = {
      endpoint: alert.endpoint,
      keys: {
        auth: alert.auth,
        p256dh: alert.p256dh,
      },
    }

    const payload = JSON.stringify({
      title: "New activity!",
      body: "You have received a new notification",
      relays,
      event,
    })

    await webpush.sendNotification(subscription, payload)

    console.log(`Web push notification sent to ${alert.address}`)
  } catch (error: any) {
    console.error(`Failed to send web push notification to ${alert.address}:`, error)
    failAlert(alert.address, error.body || String(error))
    removeListener(alert)
  }
}

const sendIosNotification = (alert: IosAlert, event: TrustedEvent, relays: string[]) => {
}

const sendAndroidNotification = (alert: AndroidAlert, event: TrustedEvent, relays: string[]) => {
}

const createListener = (alert: PushAlert) => {
  const tracker = new Tracker()

  const feed = simplifyFeed(makeUnionFeed(...alert.feeds))

  const promise = call(async () => {
    console.log(`listener: loading relay selections for ${alert.address}`)

    await loadRelaySelections(alert.pubkey)

    console.log(`listener: loading web of trust for ${alert.address}`)

    await loadWot(alert.pubkey, feed)

    console.log(`listener: waiting for events for ${alert.address}`)

    const controller = new FeedController({
      feed,
      tracker,
      signer: appSigner,
      getPubkeysForScope: makeGetPubkeysForScope(alert.pubkey),
      getPubkeysForWOTRange: makeGetPubkeysForWOTRange(alert.pubkey),
      onEvent: (event: TrustedEvent) => {
        if (event.pubkey === alert.pubkey) return

        const relays = Array.from(tracker.getRelays(event.id))

        if (isWebAlert(alert)) sendWebNotification(alert, event, relays)
        if (isIosAlert(alert)) sendIosNotification(alert, event, relays)
        if (isAndroidAlert(alert)) sendAndroidNotification(alert, event, relays)
      },
    })

    return controller.listen()
  })

  return {stop: () => promise.then(call)}
}

export const addListener = (alert: PushAlert) => {
  listenersByAddress.get(alert.address)?.stop()
  listenersByAddress.set(alert.address, createListener(alert))
}

export const removeListener = (alert: PushAlert) => {
  listenersByAddress.get(alert.address)?.stop()
  listenersByAddress.delete(alert.address)
}
