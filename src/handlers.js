const fs = require('fs').promises
const path = require('path')
const {appSigner} = require('./env')
const {confirmEmail, authenticateEmail, removeEmail} = require('./database')

const _err = (res, status, error) => res.status(status).send({error})

const _ok = (res, status = 200) => res.status(status).send({ok: true})

const handleNip11 = async (req, res) => {
  res.set({'Content-Type': 'application/nostr+json'})

  res.json({
    name: "Anchor",
    icon: "https://pfp.nostr.build/2644089e06a950889fa4aa81f6152a51fba23497735cbba351aa6972460df6f5.jpg",
    description: "A relay/notifier combo for email notifications",
    pubkey: await appSigner.getPubkey(),
    software: "https://github.com/coracle-social/anchor",
  })
}

const handleEmailConfirm = async (req, res) => {
  const {email, confirm_token} = req.body

  const confirmed = await confirmEmail({email, confirm_token})

  if (confirmed) {
    return _ok(res)
  } else {
    return _err(res, 400, "It looks like that confirmation code is invalid or has expired.")
  }
}

const handleEmailRemove = async (req, res) => {
  const {email, access_token} = req.body

  const authenticated = await authenticateEmail({email, access_token})

  if (!authenticated) {
    return _err(res, 401, "Invalid access token")
  }

  await removeEmail({email})

  return _ok(res)
}

const handleUnsubscribe = async (req, res) => {
  const {email, token} = req.query

  const template = await fs.readFile(path.join(__dirname, 'templates/unsubscribe.html'), 'utf8')
  const html = template
    .replace('{{email}}', email)
    .replace('{{token}}', token)

  res.send(html)
}

module.exports = {handleNip11, handleEmailConfirm, handleEmailRemove, handleUnsubscribe}
