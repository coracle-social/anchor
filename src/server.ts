import express, { Request, Response } from 'express'
import addWebsockets, { Application } from 'express-ws'
import rateLimit from 'express-rate-limit'
import { WebSocket } from 'ws'
import { appSigner } from './env.js'
import { getError } from './schema.js'
import { render } from './templates.js'
import { Connection } from './relay.js'
import { confirmEmailUser, authenticateEmailUser, removeEmailUser } from './database.js'

// Utils

const _err = (res: Response, status: number, error: string) => {
  res.status(status).send({error})
}

const _ok = (res: Response, status = 200) => {
  res.status(status).send({ok: true})
}

// Endpoints

export const server: Application = express() as unknown as Application

addWebsockets(server)

server.use(rateLimit({limit: 30, windowMs: 5 * 60 * 1000}))
server.use(express.json())

server.get('/', async (_req: Request, res: Response) => {
  res.set({'Content-Type': 'application/nostr+json; charset=utf-8'})

  res.json({
    name: "Anchor",
    icon: "https://pfp.nostr.build/2644089e06a950889fa4aa81f6152a51fba23497735cbba351aa6972460df6f5.jpg",
    description: "A relay/notifier combo for email notifications",
    pubkey: await appSigner.getPubkey(),
    software: "https://github.com/coracle-social/anchor",
  })
})

server.get('/confirm', async (req: Request, res: Response) => {
  res.send(await render('pages/confirm.html', req.query))
})

server.get('/unsubscribe', async (req: Request, res: Response) => {
  res.send(await render('pages/unsubscribe.html', req.query))
})

server.post('/email/confirm', async (req: Request, res: Response) => {
  const error = getError({email: 'str', confirm_token: 'str'}, req.body)

  if (error) {
    return _err(res, 400, error.message)
  }

  const confirmed = await confirmEmailUser(req.body)

  if (confirmed) {
    _ok(res)
  } else {
    _err(res, 400, "It looks like that confirmation code is invalid or has expired.")
  }
})

server.post('/email/unsubscribe', async (req: Request, res: Response) => {
  const error = getError({email: 'str', access_token: 'str'}, req.body)

  if (error) {
    return _err(res, 400, error.message)
  }

  const authenticated = await authenticateEmailUser(req.body)

  if (authenticated) {
    await removeEmailUser(req.body)
    _ok(res)
  } else {
    _err(res, 401, "Invalid access token")
  }
})

server.ws('/', (socket: WebSocket, request: Request) => {
  const connection = new Connection(socket, request)

  socket.on('message', msg => connection.handle(msg))
  socket.on('error', () => connection.cleanup())
  socket.on('close', () => connection.cleanup())
})
