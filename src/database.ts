import sqlite3 from 'sqlite3'
import crypto from 'crypto'
import { instrument } from 'succinct-async'
import { SignedEvent, getTagValue, getAddress } from '@welshman/util'
import type { Subscription } from './domain.js'

const db = new sqlite3.Database('anchor.db')

type Param = number | string | boolean

type Row = Record<string, any>

const run = (query: string, params: Param[] = []) =>
  new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      return err ? reject(err) : resolve(this.changes > 0)
    })
  })

// prettier-ignore
const all = <T=Row>(query: string, params: Param[] = []) =>
  new Promise<T[]>((resolve, reject) => {
    db.all(query, params, (err, rows: T[]) => (err ? reject(err) : resolve(rows)))
  })

// prettier-ignore
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
    db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows.length > 0)))
  })

async function assertResult<T>(p: Promise<T>) {
  return (await p)!
}

// Migrations

export const migrate = () =>
  new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS subscriptions (
          address TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL,
          email TEXT NOT NULL,
          event JSON NOT NULL,
          tags JSON NOT NULL,
          token TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          deleted_at INTEGER,
          confirmed_at INTEGER,
          unsubscribed_at INTEGER
        )
      `,
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  })

// Subscriptions

const parseSubscription = ({ event, tags, ...subscription }: any): Subscription => ({
  ...subscription,
  event: JSON.parse(event),
  tags: JSON.parse(tags),
})

export async function insertSubscription(event: SignedEvent, tags: string[][]) {
  return parseSubscription(
    await get(
      `INSERT INTO subscriptions (address, created_at, pubkey, email, event, tags, token)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
        deleted_at=null,
        created_at=excluded.created_at,
        pubkey=excluded.pubkey,
        email=excluded.email,
        event=excluded.event,
        tags=excluded.tags,
        token=excluded.token
       RETURNING *`,
      [
        getAddress(event),
        event.created_at,
        event.pubkey,
        getTagValue('email', tags) || '',
        JSON.stringify(event),
        JSON.stringify(tags),
        crypto.randomBytes(32).toString('hex'),
      ]
    )
  )
}

export const confirmSubscription = instrument('database.confirmSubscription', (token: string) => {
  return assertResult(
    get<Subscription>(
      `UPDATE subscriptions SET confirmed_at = unixepoch()
       WHERE token = ? AND confirmed_at IS NULL RETURNING *`,
      [token]
    )
  )
})

export const unsubscribeSubscription = instrument(
  'database.unsubscribeSubscription',
  (token: string) => {
    return assertResult(
      get<Subscription>(
        `UPDATE subscriptions SET unsubscribed_at = unixepoch()
       WHERE token = ? AND unsubscribed_at IS NULL RETURNING *`,
        [token]
      )
    )
  }
)

export const deleteSubscription = instrument(
  'database.deleteSubscription',
  async (address: string, deleted_at: number) => {
    const row = await get(
      `UPDATE subscriptions SET deleted_at = ?, confirmed_at = ?
     WHERE address = ? AND created_at < ? RETURNING *`,
      [address, address, deleted_at, deleted_at]
    )

    if (row) {
      return parseSubscription(row)
    }
  }
)

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

export const getActiveSubscriptionsForPubkey = instrument(
  'database.getSubscriptionsForPubkey',
  async (pubkey: string) => {
    const rows = await all(
      `SELECT * FROM subscriptions
     WHERE pubkey = ? AND coalesce(deleted_at, 0) < coalesce(confirmed_at, 0)`,
      [pubkey]
    )

    return rows.map(parseSubscription)
  }
)
