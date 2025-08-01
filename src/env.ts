import 'dotenv/config'
import apn from 'apn'
import fcm from 'firebase-admin'
import webpush from 'web-push'
import { always } from '@welshman/lib'
import { normalizeRelayUrl } from '@welshman/util'
import { netContext } from '@welshman/net'
import { Nip01Signer } from '@welshman/signer'
import { routerContext } from '@welshman/router'

if (!process.env.ANCHOR_URL) throw new Error('ANCHOR_URL is not defined.')
if (!process.env.ANCHOR_NAME) throw new Error('ANCHOR_NAME is not defined.')
if (!process.env.ANCHOR_SECRET) throw new Error('ANCHOR_SECRET is not defined.')
if (!process.env.POSTMARK_API_KEY) throw new Error('POSTMARK_API_KEY is not defined.')
if (!process.env.POSTMARK_SENDER_ADDRESS) throw new Error('POSTMARK_SENDER_ADDRESS is not defined.')
if (!process.env.VAPID_PRIVATE_KEY) throw new Error('VAPID_PRIVATE_KEY is not defined.')
if (!process.env.VAPID_PUBLIC_KEY) throw new Error('VAPID_PUBLIC_KEY is not defined.')
if (!process.env.VAPID_SUBJECT) throw new Error('VAPID_SUBJECT is not defined.')
if (!process.env.FCM_KEY) throw new Error('FCM_KEY is not defined.')
if (!process.env.APN_KEY) throw new Error('APN_KEY is not defined.')
if (!process.env.APN_KEY_ID) throw new Error('APN_KEY_ID is not defined.')
if (!process.env.APN_TEAM_ID) throw new Error('APN_TEAM_ID is not defined.')
if (!process.env.DEFAULT_RELAYS) throw new Error('DEFAULT_RELAYS is not defined.')
if (!process.env.INDEXER_RELAYS) throw new Error('INDEXER_RELAYS is not defined.')
if (!process.env.SEARCH_RELAYS) throw new Error('SEARCH_RELAYS is not defined.')
if (!process.env.PORT) throw new Error('PORT is not defined.')

export const ANCHOR_URL = process.env.ANCHOR_URL
export const ANCHOR_NAME = process.env.ANCHOR_NAME
export const appSigner = Nip01Signer.fromSecret(process.env.ANCHOR_SECRET)
export const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY
export const POSTMARK_SENDER_ADDRESS = process.env.POSTMARK_SENDER_ADDRESS
export const DEFAULT_RELAYS = process.env.DEFAULT_RELAYS.split(',').map(normalizeRelayUrl)
export const INDEXER_RELAYS = process.env.INDEXER_RELAYS.split(',').map(normalizeRelayUrl)
export const SEARCH_RELAYS = process.env.SEARCH_RELAYS.split(',').map(normalizeRelayUrl)
export const PORT = process.env.PORT

appSigner.getPubkey().then(pubkey => {
  console.log(`Running as ${pubkey}`)
})

netContext.pool.get = (url: string) => {
  throw new Error('Attempted to use default pool')
}

routerContext.getDefaultRelays = always(DEFAULT_RELAYS)
routerContext.getIndexerRelays = always(INDEXER_RELAYS)
routerContext.getSearchRelays = always(SEARCH_RELAYS)

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

fcm.initializeApp({
  credential: fcm.credential.cert(JSON.parse(process.env.FCM_KEY)),
})

export const apnProvider = new apn.Provider({
  production: process.env.APN_PRODUCTION === 'true',
  token: {
    key: process.env.APN_KEY,
    keyId: process.env.APN_KEY_ID,
    teamId: process.env.APN_TEAM_ID,
  },
})
