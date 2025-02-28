import sqlite3 from 'sqlite3'
import crypto from 'crypto'
import { instrument } from 'succinct-async'
import { SignedEvent, getTagValue, getAddress } from '@welshman/util'
import type { Alert } from './alert.js'

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

async function assertResult<T>(p: T | Promise<T>) {
  return (await p)!
}

// Migrations

export const migrate = () =>
  new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS alerts (
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

// Alerts

const parseAlert = (row: any): Alert | undefined => {
  if (row) {
    return { ...row, event: JSON.parse(row.event), tags: JSON.parse(row.tags) }
  }
}

export async function insertAlert(event: SignedEvent, tags: string[][]) {
  return assertResult(
    parseAlert(
      await get(
        `INSERT INTO alerts (address, created_at, pubkey, email, event, tags, token)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
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
  )
}

export const confirmAlert = instrument('database.confirmAlert', async (token: string) => {
  return parseAlert(
    await get<Alert>(
      `UPDATE alerts SET confirmed_at = unixepoch()
       WHERE token = ? AND confirmed_at IS NULL RETURNING *`,
      [token]
    )
  )
})

export const unsubscribeAlert = instrument('database.unsubscribeAlert', async (token: string) => {
  return parseAlert(
    await get<Alert>(
      `UPDATE alerts SET unsubscribed_at = unixepoch() WHERE token = ? RETURNING *`,
      [token]
    )
  )
})

export const deleteAlert = instrument(
  'database.deleteAlert',
  async (address: string, deleted_at: number) => {
    return parseAlert(
      await get(`UPDATE alerts SET deleted_at = ? WHERE address = ? RETURNING *`, [
        deleted_at,
        address,
      ])
    )
  }
)

export const getActiveAlerts = instrument('database.getActiveAlerts', async () => {
  const rows = await all(
    `SELECT * FROM alerts
     WHERE coalesce(deleted_at, 0) < coalesce(confirmed_at, 0)
       AND coalesce(unsubscribed_at, 0) < coalesce(confirmed_at, 0)`
  )

  return rows.map(parseAlert) as Alert[]
})

export const getAlert = instrument('database.getAlert', async (address: string) => {
  return parseAlert(await get(`SELECT * FROM alerts WHERE address = ?`, [address]))
})

export const getAlertsForPubkey = instrument(
  'database.getAlertsForPubkey',
  async (pubkey: string) => {
    const rows = await all(`SELECT * FROM alerts WHERE pubkey = ?`, [pubkey])

    return rows.map(parseAlert) as Alert[]
  }
)
