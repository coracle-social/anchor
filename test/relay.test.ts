import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { createEvent } from '@welshman/util'
import {Nip01Signer} from '@welshman/signer'
import { appSigner } from '../src/env.js'
import { server } from '../src/server.js'
import { migrate } from '../src/database.js'

const port = 18080
const url = `ws://localhost:${port}`
const signer = Nip01Signer.ephemeral()

let wsServer

describe('WebSocket Server', () => {
  beforeEach(async () => {
    await migrate()
    await new Promise(resolve => {
      wsServer = server.listen(port, resolve)
    })
  })

  afterEach(() => {
    wsServer.close()
  })

  const withWebSocket = async (fn) => {
    const ws = new WebSocket(url)

    try {
      await fn(ws)
    } finally {
      ws.close()
    }
  }

  const waitForMessage = (ws) => {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()))
      })
    })
  }

  const makeAuthEvent = (challenge) =>
    signer.sign(createEvent(22242, {
      tags: [
        ['relay', url],
        ['challenge', challenge]
      ]
    }))

  const makeSubscriptionEvent = async () => {
    const recipient = await appSigner.getPubkey()
    const tags = [["d", "test"], ['p', recipient]]
    const content = await signer.nip44.encrypt(recipient, JSON.stringify([['email', 'test@example.com']]))
    const event = await signer.sign(createEvent(32830, {tags, content}))

    return event
  }

  const authenticate = async (ws) => {
    const [_, challenge] = await waitForMessage(ws)

    const request = await makeAuthEvent(challenge)

    ws.send(JSON.stringify(['AUTH', request]))

    const response = await waitForMessage(ws)

    return {challenge, request, response}
  }


  describe('Authentication', () => {
    it('sends AUTH challenge on connect', async () => {
      await withWebSocket(async ws => {
        const message = await waitForMessage(ws)

        assert.equal(message[0], 'AUTH')
        assert.ok(message[1], 'Challenge should be present')
      })
    })

    it('accepts valid auth event', async () => {
      await withWebSocket(async ws => {
        const {request, response} = await authenticate(ws)

        assert.deepEqual(response, ['OK', request.id, true, ''])
      })
    })

    it('rejects invalid auth event', async () => {
      await withWebSocket(async ws => {
        await waitForMessage(ws)

        const request = await makeAuthEvent('wrong_challenge')

        ws.send(JSON.stringify(['AUTH', request]))

        const response = await waitForMessage(ws)

        assert.equal(response[2], false)
        assert.ok(response[3].includes('invalid'))
      })
    })
  })

  describe('Event handling', () => {
    it('rejects non-subscription events', async () => {
      await withWebSocket(async ws => {
        await waitForMessage(ws) // Skip AUTH challenge

        const event = await signer.sign(createEvent(1))

        ws.send(JSON.stringify(['EVENT', event]))

        const response = await waitForMessage(ws)

        assert.equal(response[2], false)
        assert.ok(response[3].includes('Event kind not accepted'))
      })
    })

    it('accepts valid subscription event', async () => {
      await withWebSocket(async ws => {
        await authenticate(ws)

        const event = await makeSubscriptionEvent()

        ws.send(JSON.stringify(['EVENT', event]))

        const response = await waitForMessage(ws)

        assert.deepEqual(response, ['OK', event.id, true, ''])
      })
    })
  })
})
