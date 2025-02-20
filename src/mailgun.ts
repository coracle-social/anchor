import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import {MAILGUN_API_KEY, MAILGUN_DOMAIN, ANCHOR_NAME} from './env.js'

// @ts-ignore
const mailgun = new Mailgun(FormData)

const mg = mailgun.client({username: 'api', key: MAILGUN_API_KEY})

const send = (data: Record<string, any>) => {
  if (MAILGUN_DOMAIN.startsWith('sandbox')) {
    console.log(data)
  } else {
    mg.messages.create(MAILGUN_DOMAIN, data)
  }
}

export const sendConfirmEmail = (domain: string, {email, confirm_token}: {email: string, confirm_token: string}) => {
  const href = `${domain}/confirm-email?email=${encodeURIComponent(email)}&confirm_token=${confirm_token}`

  send({
    from: `${ANCHOR_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'Confirm your email',
    html: `
      <h3>Welcome to ${ANCHOR_NAME}!</h3>
      <p>Please confirm your email address by clicking the link below:</p>
      <p><a href="${href}">Confirm Email</a></p>
    `,
    text: `Please confirm your email address by visiting: ${href}`
  })
}
