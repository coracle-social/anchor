import sqlite3 from 'sqlite3'
import crypto from 'crypto'
import type { SignedEvent } from '@welshman/util'
import { getTagValues, getAddress } from '@welshman/util'
import type {Subscription, EmailUser} from './domain.js'
import { NOTIFIER_SUBSCRIPTION } from './env.js'

const db = new sqlite3.Database('anchor.db')

type Param = number | string | boolean

type Row = Record<string, any>

const run = (query: string, params: Param[] = []) =>
  new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      return err ? reject(err) : resolve(this.changes > 0)
    })
  })

const all = <T=Row>(query: string, params: Param[] = []) =>
  new Promise<T[]>((resolve, reject) => {
    db.all(query, params, (err, rows: T[]) => err ? reject(err) : resolve(rows))
  })

const get = <T=Row>(query: string, params: Param[] = []) =>
  new Promise<T | undefined>((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err)
      } else if (row) {
        resolve(row as T)
      } else {
        resolve(undefined)
      }
    })
  })

const exists = (query: string, params: Param[] = []) =>
  new Promise<boolean>((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows.length > 0))
  })

async function assertResult<T>(p: Promise<T>) {
  return (await p)!
}

// Migrations

export const migrate = () =>
  new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS email_users (
          email TEXT PRIMARY KEY,
          access_token TEXT
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          address TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL,
          event JSON NOT NULL,
          tags JSON NOT NULL,
          created_at INTEGER NOT NULL,
          confirmed_at INTEGER,
          confirm_token TEXT,
          deleted_at INTEGER
        )
      `, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  })

// Email address management

export function insertEmailUser(email: string) {
  return assertResult(
    get<EmailUser>(
      `INSERT INTO email_users (email, access_token) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET email=excluded.email
       RETURNING *`,
      [email, crypto.randomBytes(32).toString('hex')],
    )
  )
}

export function confirmEmailUser(email: string, confirm_token: string) {
  return get<EmailUser>(
    `UPDATE email_users SET confirmed_at = unixepoch(), confirm_token = null
     WHERE email = ? AND confirm_token = ? AND confirmed_at IS NULL
     RETURNING *`,
    [email, confirm_token],
  )
}

export function authenticateEmailUser(email: string, access_token: string) {
  return get<EmailUser>(
    `SELECT * FROM email_users WHERE email = ? AND access_token = ?`,
    [email, access_token]
  )
}

export function deleteEmailUser(email: string) {
  return get<EmailUser>(`DELETE FROM email_users WHERE email = ? RETURNING *`, [email])
}

export function getEmailUser(email: string) {
  return get<EmailUser>(`SELECT * FROM email_users WHERE email = ?`, [email])
}

// Subscriptions

const parseSubscription = ({event, tags, ...subscription}: any): Subscription =>
  ({...subscription, event: JSON.parse(event), tags: JSON.parse(tags)})

export async function insertSubscription(event: SignedEvent, tags: string[][]) {
  return parseSubscription(
    await get(
      `INSERT INTO subscriptions (address, created_at, pubkey, event, tags, confirm_token)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        created_at=excluded.created_at,
        deleted_at=null,
        pubkey=excluded.pubkey,
        event=excluded.event,
        tags=excluded.tags
       RETURNING *`,
      [
        getAddress(event),
        event.created_at,
        event.pubkey,
        JSON.stringify(event),
        JSON.stringify(tags),
        crypto.randomBytes(32).toString('hex'),
      ]
    )
  )
}

export async function deleteSubscription(address: string, deleted_at: number) {
  return parseSubscription(
    await get(
      `UPDATE subscriptions SET deleted_at = ? confirmed_at = ? confirm_token = ?
       WHERE address = ? AND created_at < ? RETURNING *`,
      [address, deleted_at, crypto.randomBytes(32).toString('hex'), deleted_at]
    )
  )
}

export async function getAllSubscriptions() {
  const rows = await all(`SELECT * FROM subscriptions`)

  return rows.map(parseSubscription)
}

export async function getSubscription(address: string) {
  const row = await get(`SELECT * FROM subscriptions WHERE address = ?`, [address])

  if (row) {
    return parseSubscription(row)
  }
}

export async function getSubscriptionsForPubkey(pubkey: string) {
  const rows = await all(`SELECT * FROM subscriptions WHERE pubkey = ?`, [pubkey])

  return rows.map(parseSubscription)
}
