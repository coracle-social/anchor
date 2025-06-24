import webpush from 'web-push'
import fcm from 'firebase-admin'
import { call, on } from '@welshman/lib'
import { Tracker, Pool } from '@welshman/net'
import {parse, renderAsText} from '@welshman/content'
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
const subIdsByFilterIdByUrl = new Map<string, Map<string, Set<string>>>()

export class MultiplexingAdapter extends AbstractAdapter {
  subIdsByFilterId: Map<string, Set<string>>

  constructor(readonly socket: Socket) {
    super()

    if (!subIdsByFilterIdByUrl.has(socket.url)) {
      subIdsByFilterIdByUrl.set(socket.url, new Map<string, Set<string>>())
    }

    this.subIdsByFilterId = subIdsByFilterIdByUrl.get(socket.url)!

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

const getNotificationBody = (event: TrustedEvent) => {
  const renderer = renderAsText(parse(event), {
    createElement: tag => ({
      _text: "",
      set innerText(text: string) {
        this._text = text
      },
      get innerHTML() {
        return this._text
      },
    })
  })

  return renderer.toString()
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
      title: "New activity",
      body: getNotificationBody(event),
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

const sendAndroidNotification = async (alert: AndroidAlert, event: TrustedEvent, relays: string[]) => {
  try {
    const response = await fcm.messaging().send({
      token: alert.deviceToken,
      notification: {
        title: "New activity",
        body: getNotificationBody(event),
      },
      data: {
        relays: JSON.stringify(relays),
        event: JSON.stringify(event),
      },
      android: {
        priority: 'high' as const,
      },
    })

    console.log(`Android push notification sent to ${alert.address}:`, response)
  } catch (error: any) {
    console.error(`Failed to send Android push notification to ${alert.address}:`, error)
    failAlert(alert.address, error.message || String(error))
    removeListener(alert)
  }
}

const createListener = (alert: PushAlert) => {
  const tracker = new Tracker()
  const feed = simplifyFeed(makeUnionFeed(...alert.feeds))
  const context = {getAdapter: (url: string) => new MultiplexingAdapter(Pool.get().get(url))}

  const promise = call(async () => {
    console.log(`listener: loading relay selections for ${alert.address}`)

    await loadRelaySelections(alert.pubkey)

    console.log(`listener: loading web of trust for ${alert.address}`)

    await loadWot(alert.pubkey, feed)

    console.log(`listener: waiting for events for ${alert.address}`)

    const controller = new FeedController({
      feed,
      tracker,
      context,
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
