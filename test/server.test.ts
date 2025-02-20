import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { server } from '../src/server.js'
import { get, run, migrate, addEmail } from '../src/database.js'
import { handleEmailConfirm, handleEmailRemove, handleNip11, handleUnsubscribe } from '../src/handlers.js'

describe('Server', () => {
  beforeEach(async () => {
    await migrate()
    await run("DELETE FROM emails WHERE email = ?", ['test@example.com'])
  })

  describe('GET /', () => {
    it('returns NIP-11 info', async () => {
      const response = await request(server)
        .get('/')
        .expect('Content-Type', 'application/nostr+json; charset=utf-8')
        .expect(200)

      assert.equal(response.body.name, 'Anchor')
      assert.equal(response.body.description, 'A relay/notifier combo for email notifications')
      assert.ok(response.body.pubkey)
    })
  })

  describe('GET /unsubscribe', () => {
    it('returns unsubscribe page', async () => {
      const response = await request(server)
        .get('/unsubscribe?email=test@example.com&token=abc123')
        .expect('Content-Type', /html/)
        .expect(200)

      assert.match(response.text, /Unsubscribing from Notifications/)
      assert.match(response.text, /test@example.com/)
      assert.match(response.text, /abc123/)
    })
  })

  describe('POST /email/confirm', () => {
    it('confirms valid email token', async () => {
      const email = 'test@example.com'
      const confirm_token = await addEmail({ email })

      const response = await request(server)
        .post('/email/confirm')
        .send({ email, confirm_token })
        .expect(200)

      assert.equal(response.body.ok, true)
    })

    it('rejects invalid token', async () => {
      const response = await request(server)
        .post('/email/confirm')
        .send({
          email: 'test@example.com',
          confirm_token: 'invalid'
        })
        .expect(400)

      assert.equal(response.body.error, 'It looks like that confirmation code is invalid or has expired.')
    })
  })

  describe('POST /email/unsubscribe', () => {
    it('removes email with valid token', async () => {
      const email = 'test@example.com'
      const confirm_token = await addEmail({ email })
      const {access_token} = await get('SELECT access_token FROM emails WHERE email = ?', [email])

      const response = await request(server)
        .post('/email/unsubscribe')
        .send({ email, access_token })
        .expect(200)

      assert.equal(response.body.ok, true)
    })

    it('rejects invalid token', async () => {
      const response = await request(server)
        .post('/email/unsubscribe')
        .send({
          email: 'test@example.com',
          access_token: 'invalid'
        })
        .expect(401)

      assert.equal(response.body.error, 'Invalid access token')
    })
  })
})
