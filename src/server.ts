import { instrument } from 'succinct-async'
import express, { Request, Response, NextFunction } from 'express'
import addWebsockets, { Application } from 'express-ws'
import rateLimit from 'express-rate-limit'
import { WebSocket } from 'ws'
import { appSigner } from './env.js'
import { render } from './templates.js'
import { Connection } from './relay.js'
import { confirmAlert, unsubscribe, ActionError } from './actions.js'

// Endpoints

export const server: Application = express() as unknown as Application

addWebsockets(server)

server.use(express.json())

server.use(express.static('web/dist'))

server.use(
  rateLimit({
    limit: 30,
    windowMs: 5 * 60 * 1000,
    validate: {xForwardedForHeader: false},
  })
)

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

addRoute('get', '/', async (req: Request, res: Response) => {
  if (req.get('Accept') !== 'application/nostr+json') {
    res.send(await render('../web/dist/index.html'))
  } else {
    res.set({ 'Content-Type': 'application/nostr+json; charset=utf-8' })

    res.json({
      name: 'Anchor',
      icon: 'https://pfp.nostr.build/2644089e06a950889fa4aa81f6152a51fba23497735cbba351aa6972460df6f5.jpg',
      description: 'A relay/notifier combo for email notifications',
      pubkey: await appSigner.getPubkey(),
      software: 'https://github.com/coracle-social/anchor',
    })
  }
})

addRoute('get', '/confirm', async (req: Request, res: Response) => {
  if (typeof req.query.token !== 'string') {
    return res.send(
      await render('pages/confirm-error.html', {
        message: 'No confirmation token was provided.',
      })
    )
  }

  try {
    await confirmAlert(req.query as any)

    res.send(await render('pages/confirm-success.html'))
  } catch (error) {
    const isActionError = error instanceof ActionError
    const message = isActionError ? String(error) : 'Oops, something went wrong on our end!'

    res.send(await render('pages/confirm-error.html', { message }))

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

let connectionsCount = 0

server.ws('/', (socket: WebSocket, request: Request) => {
  const connection = new Connection(socket, request)

  console.log(`Opening websocket connection; ${++connectionsCount} total`)

  socket.on('message', (msg) => connection.handle(msg))

  socket.on('error', () => {
    console.log(`Error on websocket connection; ${--connectionsCount} total`)
    connection.cleanup()
  })

  socket.on('close', () => {
    console.log(`Closing websocket connection; ${--connectionsCount} total`)
    connection.cleanup()
  })
})

server.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err) {
    if (err instanceof ActionError) {
      res.status(400).send({ error: err.message })
    } else {
      console.log('Unhandled error', err)
      res.status(500).send({ error: 'Internal server error' })
    }
  } else {
    next()
  }
})
