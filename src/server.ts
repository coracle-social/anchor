import { instrument } from 'succinct-async'
import express, { Request, Response, NextFunction } from 'express'
import addWebsockets, { Application } from 'express-ws'
import rateLimit from 'express-rate-limit'
import { WebSocket } from 'ws'
import { appSigner } from './env.js'
import { getError } from './schema.js'
import { render } from './templates.js'
import { Connection } from './relay.js'
import { confirmSubscription, unsubscribe, ActionError } from './actions.js'

// Utils

const _err = (res: Response, status: number, error: string) => {
  res.status(status).send({ error })
}

const _ok = (res: Response, status = 200) => {
  res.status(status).send({ ok: true })
}

// Endpoints

export const server: Application = express() as unknown as Application

addWebsockets(server)

server.use(express.json())

server.use(rateLimit({ limit: 30, windowMs: 5 * 60 * 1000 }))

type Handler = (req: Request, res: Response) => Promise<any>

const addRoute = (method: 'get' | 'post', path: string, handler: Handler) => {
  server[method](
    path,
    instrument(path, async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res)
      } catch (e) {
        next(e)
      }
    })
  )
}

addRoute('get', '/', async (_req: Request, res: Response) => {
  res.set({ 'Content-Type': 'application/nostr+json; charset=utf-8' })

  res.json({
    name: 'Anchor',
    icon: 'https://pfp.nostr.build/2644089e06a950889fa4aa81f6152a51fba23497735cbba351aa6972460df6f5.jpg',
    description: 'A relay/notifier combo for email notifications',
    pubkey: await appSigner.getPubkey(),
    software: 'https://github.com/coracle-social/anchor',
  })
})

addRoute('get', '/confirm', async (req: Request, res: Response) => {
  const error = getError({ token: 'str' }, req.query)

  if (error) {
    return res.send(
      await render('pages/confirm-error.html', {
        message: 'No confirmation token was provided.',
      })
    )
  }

  try {
    await confirmSubscription(req.query as any)

    res.send(await render('pages/confirm-success.html'))
  } catch (error) {
    const isActionError = error instanceof ActionError
    const message = isActionError ? String(error) : "Oops, something went wrong on our end!"

    res.send(await render('pages/confirm-error.html', {message}))

    if (!isActionError) {
      throw error
    }
  }
})

addRoute('get', '/unsubscribe', async (req: Request, res: Response) => {
  try {
    await unsubscribe(req.query as any)
  } catch (error) {
    // pass
  }

  res.send(await render('pages/unsubscribe-success.html'))
})

server.ws('/', (socket: WebSocket, request: Request) => {
  const connection = new Connection(socket, request)

  socket.on('message', (msg) => connection.handle(msg))
  socket.on('error', () => connection.cleanup())
  socket.on('close', () => connection.cleanup())
})

server.use((err: Error, req: Request, res: Response) => {
  if (err instanceof ActionError) {
    return _err(res, 400, err.message)
  }

  console.error('Unhandled error:', err.stack)
  _err(res, 500, 'Internal server error')
})
