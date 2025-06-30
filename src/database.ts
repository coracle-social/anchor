/* eslint @typescript-eslint/no-unused-vars: 0 */

import sqlite3 from 'sqlite3'
import crypto from 'crypto'
import { instrument } from 'succinct-async'
import { parseJson, now } from '@welshman/lib'
import {
  SignedEvent,
  getTagValue,
  getTagValues,
  getTags,
  getAddress,
  ALERT_EMAIL,
  ALERT_WEB,
  ALERT_IOS,
  ALERT_ANDROID,
} from '@welshman/util'
import type { BaseAlert, Alert, EmailAlert, WebAlert, IosAlert, AndroidAlert } from './alert.js'

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

const addColumnIfNotExists = async (tableName: string, columnName: string, columnDef: string) => {
  try {
    const tableInfo = await all(`PRAGMA table_info(${tableName})`)
    const columnExists = tableInfo.some((col: any) => col.name === columnName)

    if (!columnExists) {
      await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`)
    }
  } catch (err: any) {
    if (!err.message.includes('duplicate column name')) {
      throw err
    }
  }
}

export const migrate = () =>
  new Promise<void>(async (resolve, reject) => {
    try {
      db.serialize(async () => {
        await run(
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
        `
        )
        await addColumnIfNotExists('alerts', 'failed_at', 'INTEGER')
        await addColumnIfNotExists('alerts', 'failed_reason', 'TEXT')
        resolve()
      })
    } catch (err) {
      reject(err)
    }
  })

// Alerts

const parseAlert = (row: any): Alert | undefined => {
  if (row) {
    const event = JSON.parse(row.event)
    const tags = JSON.parse(row.tags)
    const feeds = getTagValues('feed', tags).map(parseJson)
    const claims = getTags('claim', tags)
    const locale = getTagValue('locale', tags)
    const timezone = getTagValue('timezone', tags)
    const pause_until = parseInt(getTagValue('pause_until', tags) || '') || 0
    const alert = { ...row, event, tags, feeds, claims, locale, timezone, pause_until }

    if (event.kind === ALERT_EMAIL) {
      const cron = getTagValue('cron', tags) || '0 0 0 0 0 0'
      const handlers = getTags('handler', tags)
      const email = getTagValue('email', tags)

      return { ...alert, cron, handlers, email } as EmailAlert
    }

    if (event.kind === ALERT_WEB) {
      const endpoint = getTagValue('endpoint', tags)
      const p256dh = getTagValue('p256dh', tags)
      const auth = getTagValue('auth', tags)

      return { ...alert, endpoint, p256dh, auth } as WebAlert
    }

    if (event.kind === ALERT_IOS) {
      const deviceToken = getTagValue('device_token', tags)
      const bundleIdentifier = getTagValue('bundle_identifier', tags)

      return { ...alert, deviceToken, bundleIdentifier } as AndroidAlert
    }

    if (event.kind === ALERT_ANDROID) {
      const deviceToken = getTagValue('device_token', tags)

      return { ...alert, deviceToken } as AndroidAlert
    }

    throw new Error(`Unable to parse alert of kind ${event.kind}`)
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
          token=excluded.token,
          confirmed_at=null,
          failed_at=null,
          failed_reason=null
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
    await get<BaseAlert>(
      `UPDATE alerts SET confirmed_at = unixepoch()
       WHERE token = ? AND confirmed_at IS NULL RETURNING *`,
      [token]
    )
  ) as EmailAlert
})

export const unsubscribeAlert = instrument('database.unsubscribeAlert', async (token: string) => {
  return parseAlert(
    await get<BaseAlert>(
      `UPDATE alerts SET unsubscribed_at = unixepoch() WHERE token = ? RETURNING *`,
      [token]
    )
  ) as EmailAlert
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

export const failAlert = instrument(
  'database.failAlert',
  async (address: string, reason: string) => {
    return parseAlert(
      await get(
        `UPDATE alerts SET failed_at = ?, failed_reason = ? WHERE address = ? RETURNING *`,
        [now(), reason, address]
      )
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
