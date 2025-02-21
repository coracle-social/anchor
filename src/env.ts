import 'dotenv/config'
import { Nip01Signer } from '@welshman/signer'

if (!process.env.ANCHOR_NAME) throw new Error('ANCHOR_NAME is not defined.')
if (!process.env.ANCHOR_SECRET) throw new Error('ANCHOR_SECRET is not defined.')
if (!process.env.MAILGUN_API_KEY) throw new Error('MAILGUN_API_KEY is not defined.')
if (!process.env.MAILGUN_DOMAIN) throw new Error('MAILGUN_DOMAIN is not defined.')
if (!process.env.PORT) throw new Error('PORT is not defined.')

export const ANCHOR_NAME = process.env.ANCHOR_NAME
export const appSigner = Nip01Signer.fromSecret(process.env.ANCHOR_SECRET)
export const LOG_RELAY_MESSAGES = process.env.LOG_RELAY_MESSAGES === "true"
export const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY
export const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN
export const PORT = process.env.PORT
export const NOTIFIER_SUBSCRIPTION = 32830
export const NOTIFIER_STATUS = 32831
