import { neventEncode, decode } from 'nostr-tools/nip19'
import {
  spec,
  call,
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
import { load } from '@welshman/net'
import { Router, addMinimalFallbacks } from '@welshman/router'
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
import { EmailAlert, getFormatter } from './alert.js'
import { sendDigest } from './mailer.js'
import {
  profilesByPubkey,
  loadRelaySelections,
  loadProfile,
  makeGetPubkeysForScope,
  makeGetPubkeysForWOTRange,
  loadWot,
} from './repository.js'
import { appSigner } from './env.js'

type DigestData = {
  events: TrustedEvent[]
  context: TrustedEvent[]
}

export class Digest {
  authd = new Set<string>()
  since: number
  feed: Feed

  constructor(readonly alert: EmailAlert) {
    this.since = dateToSeconds(getCronDate(alert.cron, -2))
    this.feed = simplifyFeed(
      makeIntersectionFeed(
        makeKindFeed(NOTE),
        makeCreatedAtFeed({ since: this.since }),
        makeUnionFeed(...alert.feeds)
      )
    )
  }

  loadHandler = async () => {
    const defaultHandler = 'https://coracle.social/'
    const webHandlers = this.alert.handlers.filter(nthEq(3, 'web'))
    const filters = getIdFilters(webHandlers.map(nth(1)))
    const relays = webHandlers.map(nth(2))

    if (filters.length === 0 || relays.length === 0) {
      return defaultHandler
    }

    const events = await load({ relays, filters })
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
      signer: appSigner,
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

            for (const reply of await load({
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
    const formatter = getFormatter(this.alert)
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
