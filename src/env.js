const dotenv = require('dotenv')
const {Nip01Signer} = require('@welshman/signer')

dotenv.config({path: ".env.local"})
dotenv.config({path: ".env"})

if (!process.env.ANCHOR_NAME) throw new Error('ANCHOR_NAME is not defined.')
if (!process.env.ANCHOR_SECRET) throw new Error('ANCHOR_SECRET is not defined.')
if (!process.env.MAILGUN_API_KEY) throw new Error('MAILGUN_API_KEY is not defined.')
if (!process.env.MAILGUN_DOMAIN) throw new Error('MAILGUN_DOMAIN is not defined.')
if (!process.env.PORT) throw new Error('PORT is not defined.')

module.exports = {
  ANCHOR_NAME: process.env.ANCHOR_NAME,
  appSigner: Nip01Signer.fromSecret(process.env.ANCHOR_SECRET),
  LOG_RELAY_MESSAGES: process.env.LOG_RELAY_MESSAGES === "true",
  MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
  MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN,
  PORT: process.env.PORT,
  NOTIFIER_SUBSCRIPTION: 32830,
  NOTIFIER_STATUS: 32831,
}
