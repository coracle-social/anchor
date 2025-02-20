import express from 'express'
import addWebsockets from 'express-ws'
import rateLimit from 'express-rate-limit'
import { Connection } from './relay.js'
import { handleEmailConfirm, handleEmailRemove, handleNip11, handleUnsubscribe } from './handlers.js'

export const server = express()

addWebsockets(server)

server.use(rateLimit({limit: 30, windowMs: 5 * 60 * 1000}))
server.use(express.json())

server.get('/', handleNip11)
server.get('/unsubscribe', handleUnsubscribe)
server.post('/email/confirm', handleEmailConfirm)
server.post('/email/unsubscribe', handleEmailRemove)

server.ws('/', socket => {
  const connection = new Connection(socket)

  socket.on('message', msg => connection.handle(msg))
  socket.on('error', () => connection.cleanup())
  socket.on('close', () => connection.cleanup())
})
