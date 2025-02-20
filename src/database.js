const sqlite3 = require('sqlite3')
const crypto = require('crypto')
const {getTagValues, getAddress} = require('@welshman/util')
const {NOTIFIER_SUBSCRIPTION} = require('./env')

const db = new sqlite3.Database('anchor.db')

const migrate = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS emails (
          email TEXT PRIMARY KEY,
          access_token TEXT,
          confirmed_at INTEGER,
          confirm_token TEXT,
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS deletes (
          created_at INTEGER NOT NULL,
          address TEXT NOT NULL
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          address TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL,
          event JSON NOT NULL,
          tags JSON NOT NULL
        )
      `, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

const run = (query, params) =>
  new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      return err ? reject(err) : resolve(this.changes > 0)
    })
  })

const all = (query, params) =>
  new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows))
  })

const get = (query, params, cb) =>
  new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err)
      } else if (row) {
        resolve(cb ? cb(row) : row)
      } else {
        resolve(undefined)
      }
    })
  })

const exists = (query, params) =>
  get(query, params, () => true)

// Email confirmation/unsubscription

const addEmail = async ({email}) => {
  const access_token = crypto.randomBytes(32).toString('hex')
  const confirm_token = crypto.randomBytes(32).toString('hex')

  await run(
    `INSERT INTO emails (email, access_token, confirm_token) VALUES (?, ?, ?)`,
    [email, access_token, confirm_token],
  )

  return confirm_token
}

const removeEmail = async ({email}) => {
  await run(`DELETE FROM emails WHERE email = ?`, [email])
}

const authenticateEmail = ({email, access_token}) =>
  exists(
    `SELECT email FROM emails WHERE email = ? AND access_token = ?`,
    [email, access_token]
  )

const confirmEmail = ({email, confirm_token}) =>
  run(
    `UPDATE emails SET confirmed_at = unixepoch(), confirm_token = null
     WHERE email = ? AND confirm_token = ? AND confirmed_at IS NULL`,
    [email, confirm_token],
  )

// Subscription management

const addDelete = async (event) => {
  for (const address of getTagValues('a', event.tags)) {
    const [kind, pubkey] = address.split(':')

    if (kind.toString() !== NOTIFIER_SUBSCRIPTION) {
      continue
    }

    if (pubkey !== event.pubkey) {
      continue
    }

    await run(
      `INSERT INTO deletes (created_at, address) VALUES (?, ?, ?)`,
      [event.created_at, address]
    )

    await run(
      `DELETE FROM subscriptions WHERE address = ? AND created_at <= ?`,
      [address, event.created_at]
    )
  }
}

const addSubscription = async (event, tags) => {
  const address = getAddress(event)

  const deleted = await exists(
    `SELECT * FROM deletes WHERE address = ? AND created_at > ?`,
    [address, event.created_at]
  )

  if (!deleted) {
    await run(
      `INSERT INTO subscriptions (address, pubkey, event, tags) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        pubkey=excluded.pubkey,
        event=excluded.event
        tags=excluded.tags`,
      [address, event.pubkey, JSON.stringify(event), JSON.stringify(tags)]
    )
  }
}

const getSubscriptionsForPubkey = async (pubkey) => {
  const rows = await all(`SELECT * FROM subscriptions WHERE pubkey = ?`, [pubkey])

  return rows?.map(row => ({...row, event: JSON.parse(row.event), tags: JSON.parse(row.tags)}))
}

module.exports = {
  migrate,
  addEmail,
  removeEmail,
  authenticateEmail,
  confirmEmail,
  addDelete,
  addSubscription,
  getSubscriptionsForPubkey,
}
