import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Request, Response } from 'express'
import { appSigner } from './env.js'
import { confirmEmail, authenticateEmail, removeEmail } from './database.js'

// Utils

const _err = (res: Response, status: number, error: string) => {
  res.status(status).send({error})
}

const _ok = (res: Response, status = 200) => {
  res.status(status).send({ok: true})
}

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const render = (template: string, data: Record<string, any>) => {
  let result = await fs.readFile(path.join(__dirname, `templates/${template}`), 'utf8')

  for (const [k, v] of Object.entries(data)) {
    result = result.replace(`{{${k}}}`, v)
  }

  return result
}

// Endpoints

const handleNip11 = async (_req: Request, res: Response) => {
  res.set({'Content-Type': 'application/nostr+json; charset=utf-8'})

  res.json({
    name: "Anchor",
    icon: "https://pfp.nostr.build/2644089e06a950889fa4aa81f6152a51fba23497735cbba351aa6972460df6f5.jpg",
    description: "A relay/notifier combo for email notifications",
    pubkey: await appSigner.getPubkey(),
    software: "https://github.com/coracle-social/anchor",
  })
}

const handleEmailConfirm = async (req: Request, res: Response) => {
  const {email, confirm_token} = req.body

  const confirmed = await confirmEmail({email, confirm_token})

  if (confirmed) {
    _ok(res)
  } else {
    _err(res, 400, "It looks like that confirmation code is invalid or has expired.")
  }
}

const handleEmailRemove = async (req: Request, res: Response) => {
  const {email, access_token} = req.body

  const authenticated = await authenticateEmail({email, access_token})

  if (authenticated) {
    await removeEmail({email})
    _ok(res)
  } else {
    _err(res, 401, "Invalid access token")
  }
}

const handleUnsubscribe = async (req: Request, res: Response) => {
  res.send(render('unsubscribe.html', req.query))
}

export { handleNip11, handleEmailConfirm, handleEmailRemove, handleUnsubscribe }
