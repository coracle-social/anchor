import {AbstractAdapter, AdapterEvent, SocketEvent, isRelayEvent, isRelayEose, isRelayClosed, RelayMessage, ClientMessage, Socket, isClientReq, isClientClose, ClientMessageType} from '@welshman/net'
import {
  loadRelaySelections,
  makeGetPubkeysForScope,
  makeGetPubkeysForWOTRange,
  loadWot,
} from '../repository.js'
import { PushAlert } from '../alert.js'
import { getFilterId } from '@welshman/util'
import { call, on } from '@welshman/lib'
import { TrustedEvent } from '@welshman/util'
import { simplifyFeed, makeUnionFeed, FeedController } from '@welshman/feeds'
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

const createListener = (alert: PushAlert) => {
  const feed = simplifyFeed(makeUnionFeed(...alert.feeds))

  const promise = call(async () => {
    console.log(`listener: loading relay selections for ${alert.address}`)

    await loadRelaySelections(alert.pubkey)

    console.log(`listener: loading web of trust for ${alert.address}`)

    await loadWot(alert.pubkey, feed)

    console.log(`listener: waiting for events for ${alert.address}`)

    const controller = new FeedController({
      feed,
      signer: appSigner,
      getPubkeysForScope: makeGetPubkeysForScope(alert.pubkey),
      getPubkeysForWOTRange: makeGetPubkeysForWOTRange(alert.pubkey),
      onEvent: (event: TrustedEvent) => {
        console.log(`listener: received event ${event.id} for ${alert.address}`)
      },
    })

    return controller.listen()
  })

  return {stop: async () => call(await promise)}
}

export const addListener = (alert: PushAlert) => {
  listenersByAddress.get(alert.address)?.stop()
  listenersByAddress.set(alert.address, createListener(alert))
}

export const removeListener = (alert: PushAlert) => {
  listenersByAddress.get(alert.address)?.stop()
  listenersByAddress.delete(alert.address)
}
