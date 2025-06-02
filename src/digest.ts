import { neventEncode, decode } from 'nostr-tools/nip19'
import {
  tryCatch,
  LOCALE,
  TIMEZONE,
  spec,
  call,
  removeNil,
  now,
  sortBy,
  groupBy,
  displayList,
  nth,
  nthEq,
  dateToSeconds,
  secondsToDate,
} from '@welshman/lib'
import { parse, truncate, renderAsHtml } from '@welshman/content'
import {
  TrustedEvent,
  getParentId,
  getIdFilters,
  getReplyFilters,
  NOTE,
  COMMENT,
  REACTION,
  displayProfile,
  displayPubkey,
} from '@welshman/util'
import {
  Pool,
  makeLoader,
  Loader,
  makeSocketPolicyAuth,
  makeSocket,
  defaultSocketPolicies,
  AdapterContext,
} from '@welshman/net'
import { Router, addMinimalFallbacks } from '@welshman/router'
import { ISigner, Nip46Broker, Nip01Signer, Nip46Signer } from '@welshman/signer'
import {
  makeIntersectionFeed,
  makeKindFeed,
  simplifyFeed,
  Feed,
  makeCreatedAtFeed,
  makeUnionFeed,
  FeedController,
} from '@welshman/feeds'
import { getCronDate, displayDuration, createElement } from './util.js'
import { getAlertParams, Alert, AlertParams, getAlertBroker } from './alert.js'
import { sendDigest } from './mailer.js'
import {
  profilesByPubkey,
  loadRelaySelections,
  loadProfile,
  makeGetPubkeysForScope,
  makeGetPubkeysForWOTRange,
  loadWot,
} from './repository.js'

type DigestData = {
  events: TrustedEvent[]
  context: TrustedEvent[]
}

export class Digest {
  authd = new Set<string>()
  params: AlertParams
  broker?: Nip46Broker
  signer: ISigner
  pool: Pool
  context: AdapterContext
  load: Loader
  since: number
  feed: Feed

  constructor(readonly alert: Alert) {
    this.params = getAlertParams(alert)
    this.broker = getAlertBroker(alert)
    this.signer = this.broker ? new Nip46Signer(this.broker) : Nip01Signer.ephemeral()
    this.pool = new Pool({ makeSocket: this.makeSocket })
    this.context = { pool: this.pool }
    this.load = makeLoader({ delay: 1000, context: this.context })

    const { cron, feeds } = this.params

    this.since = dateToSeconds(getCronDate(cron, -2))
    this.feed = simplifyFeed(
      makeIntersectionFeed(
        makeKindFeed(NOTE),
        makeCreatedAtFeed({ since: this.since }),
        makeUnionFeed(...feeds)
      )
    )
  }

  makeSocket = (url: string) => {
    const socket = makeSocket(
      url,
      defaultSocketPolicies.concat([
        makeSocketPolicyAuth({
          sign: this.signer.sign,
          shouldAuth: () => Boolean(this.broker),
        }),
      ])
    )

    socket.auth.attemptAuth(this.signer.sign)

    return socket
  }

  getFormatter = () => {
    // Attempt to make a formatter with as many user-provided options as we can
    for (const locale of removeNil([this.params.locale, LOCALE])) {
      for (const timezone of removeNil([this.params.timezone, TIMEZONE])) {
        const formatter = tryCatch(
          () =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: timezone,
            })
        )

        if (formatter) {
          return formatter
        }
      }
    }

    throw new Error("This should never happen, it's here only because of typescript")
  }

  loadHandler = async () => {
    const { handlers } = getAlertParams(this.alert)
    const defaultHandler = 'https://coracle.social/'
    const webHandlers = handlers.filter(nthEq(3, 'web'))
    const filters = getIdFilters(webHandlers.map(nth(1)))
    const relays = webHandlers.map(nth(2))

    if (filters.length === 0 || relays.length === 0) {
      return defaultHandler
    }

    const events = await this.load({ relays, filters })
    const getTemplates = (e: TrustedEvent) => e.tags.filter(nthEq(0, 'web')).map(nth(1))
    const templates = events.flatMap((e) => getTemplates(e))

    return templates[0] || defaultHandler
  }

  loadData = async () => {
    console.log(`digest: loading relay selections for ${this.alert.address}`)

    await loadRelaySelections(this.alert.pubkey)

    console.log(`digest: loading web of trust for ${this.alert.address}`)

    await loadWot(this.alert.pubkey, this.feed)

    const seen = new Set<string>()
    const events: TrustedEvent[] = []
    const context: TrustedEvent[] = []
    const promises: Promise<unknown>[] = []
    const ctrl = new FeedController({
      feed: this.feed,
      signer: this.signer,
      context: this.context,
      getPubkeysForScope: makeGetPubkeysForScope(this.alert.pubkey),
      getPubkeysForWOTRange: makeGetPubkeysForWOTRange(this.alert.pubkey),
      onEvent: (e) => {
        seen.add(e.id)
        events.push(e)
        context.push(e)

        promises.push(
          call(async () => {
            await loadRelaySelections(e.pubkey)
            await loadProfile(e.pubkey)

            const relays = Router.get().Replies(e).policy(addMinimalFallbacks).getUrls()
            const filters = getReplyFilters(events, { kinds: [NOTE, COMMENT, REACTION] })

            for (const reply of await this.load({
              relays,
              filters,
              signal: AbortSignal.timeout(1000),
            })) {
              if (!seen.has(reply.id)) {
                seen.add(reply.id)
                context.push(reply)
              }
            }
          })
        )
      },
    })

    console.log(`digest: loading events for ${this.alert.address}`)

    await ctrl.load(1000)

    console.log(`digest: loading replies and reactions for ${this.alert.address}`)

    await Promise.all(promises)

    console.log(`digest: retrieved ${context.length} events for ${this.alert.address}`)

    return { events, context } as DigestData
  }

  buildParameters = async (data: DigestData) => {
    const getEventVariables = (event: TrustedEvent) => {
      const parsed = truncate(parse(event), { minLength: 400, maxLength: 800, mediaLength: 50 })

      return {
        Link: buildLink(event, handler),
        Timestamp: formatter.format(secondsToDate(event.created_at)),
        Icon: profilesByPubkey.get().get(event.pubkey)?.picture,
        Name: displayProfileByPubkey(event.pubkey),
        Content: renderAsHtml(parsed, { createElement, renderEntity }).toString(),
        Replies:
          repliesByParentId.get(event.id)?.filter((e) => [COMMENT, NOTE].includes(e.kind))
            ?.length || 0,
        Reactions: repliesByParentId.get(event.id)?.filter(spec({ kind: REACTION }))?.length || 0,
      }
    }

    const { events, context } = data
    const formatter = this.getFormatter()
    const handler = await this.loadHandler()
    const repliesByParentId = groupBy(getParentId, context)
    const eventsByPubkey = groupBy((e) => e.pubkey, events)
    const popular = sortBy((e) => -(repliesByParentId.get(e.id)?.length || 0), events).slice(0, 12)
    const topProfiles = sortBy(
      ([k, ev]) => -ev.length,
      Array.from(eventsByPubkey.entries()).filter(([k]) => profilesByPubkey.get().get(k))
    )

    return {
      Total: events.length,
      Duration: displayDuration(now() - this.since),
      Popular: popular.map((e) => getEventVariables(e)),
      HasPopular: popular.length > 0,
      TopProfiles: displayList(topProfiles.map(([pk]) => displayProfileByPubkey(pk))),
    }
  }

  send = async () => {
    const data = await this.loadData()

    if (data.events.length > 0) {
      await sendDigest(this.alert, await this.buildParameters(data))
    }

    this.pool.clear()
    this.broker?.cleanup()

    return data.events.length > 0
  }
}

// Utilities

const buildLink = (event: TrustedEvent, handler: string) => {
  const relays = Router.get().Event(event).getUrls()
  const nevent = neventEncode({ ...event, relays })

  if (handler.includes('<bech32>')) {
    return handler.replace('<bech32>', nevent)
  } else {
    return handler + nevent
  }
}

const displayProfileByPubkey = (pubkey: string) =>
  displayProfile(profilesByPubkey.get().get(pubkey), displayPubkey(pubkey))

const renderEntity = (entity: string) => {
  let display = entity.slice(0, 16) + '…'

  try {
    const { type, data } = decode(entity)

    if (type === 'npub') {
      display = '@' + displayProfileByPubkey(data)
    }

    if (type === 'nprofile') {
      display = '@' + displayProfileByPubkey(data.pubkey)
    }
  } catch (e) {
    // Pass
  }

  return display
}
