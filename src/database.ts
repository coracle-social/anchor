import sqlite3 from 'sqlite3'
import crypto from 'crypto'
import {instrument} from 'succinct-async'
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

export const insertEmailUser = instrument('database.insertEmailUser', (email: string) => {
  return assertResult(
    get<EmailUser>(
      `INSERT INTO email_users (email, access_token) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET email=excluded.email
       RETURNING *`,
      [email, crypto.randomBytes(32).toString('hex')],
    )
  )
})

export const authenticateEmailUser = instrument('database.authenticateEmailUser', (email: string, access_token: string) => {
  return get<EmailUser>(
    `SELECT * FROM email_users WHERE email = ? AND access_token = ?`,
    [email, access_token]
  )
})

export const deleteEmailUser = instrument('database.deleteEmailUser', (email: string) => {
  return get<EmailUser>(`DELETE FROM email_users WHERE email = ? RETURNING *`, [email])
})

export const getEmailUser = instrument('database.getEmailUser', (email: string) => {
  return get<EmailUser>(`SELECT * FROM email_users WHERE email = ?`, [email])
})

// Subscriptions

const parseSubscription = ({event, tags, ...subscription}: any): Subscription =>
  ({...subscription, event: JSON.parse(event), tags: JSON.parse(tags)})

export async function insertSubscription(event: SignedEvent, tags: string[][]) {
  return parseSubscription(
    await get(
      `INSERT INTO subscriptions (address, created_at, pubkey, event, tags, confirm_token)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        deleted_at=null,
        created_at=excluded.created_at,
        pubkey=excluded.pubkey,
        event=excluded.event,
        tags=excluded.tags,
        confirm_token=excluded.confirm_token
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

export const confirmSubscription = instrument('database.confirmSubscription', (confirm_token: string) => {
  return assertResult(
    get<Subscription>(
      `UPDATE subscriptions SET confirmed_at = unixepoch(), confirm_token = null
       WHERE confirm_token = ? AND confirmed_at IS NULL RETURNING *`,
      [confirm_token],
    )
  )
})

export const deleteSubscription = instrument('database.deleteSubscription', async (address: string, deleted_at: number) => {
  const row = await get(
    `UPDATE subscriptions SET deleted_at = ?, confirmed_at = ?
     WHERE address = ? AND created_at < ? RETURNING *`,
    [address, address, deleted_at, deleted_at]
  )

  if (row) {
    return parseSubscription(row)
  }
})

export const getActiveSubscriptions = instrument('database.getAllSubscriptions', async () => {
  const rows = await all(
    `SELECT * FROM subscriptions WHERE coalesce(deleted_at, 0) < coalesce(confirmed_at, 0)`
  )

  return rows.map(parseSubscription)
})

export const getSubscription = instrument('database.getSubscription', async (address: string) => {
  const row = await get(`SELECT * FROM subscriptions WHERE address = ?`, [address])

  if (row) {
    return parseSubscription(row)
  }
})

export const getActiveSubscriptionsForPubkey = instrument('database.getSubscriptionsForPubkey', async (pubkey: string) => {
  const rows = await all(
    `SELECT * FROM subscriptions
     WHERE pubkey = ? AND coalesce(deleted_at, 0) < coalesce(confirmed_at, 0)`,
    [pubkey]
  )

  return rows.map(parseSubscription)
})
