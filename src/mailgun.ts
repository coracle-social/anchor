import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import { TrustedEvent } from '@welshman/util'
import { MAILGUN_API_KEY, MAILGUN_DOMAIN, ANCHOR_NAME, ANCHOR_URL } from './env.js'
import { Alert } from './alert.js'
import { render } from './templates.js'

// @ts-expect-error Mailgun has no constructor signature
const mailgun = new Mailgun(FormData)

const mg = mailgun.client({ username: 'api', key: MAILGUN_API_KEY })

const send = (data: Record<string, any>) => {
  if (MAILGUN_DOMAIN.startsWith('sandbox')) {
    console.log(data)
  } else {
    mg.messages.create(MAILGUN_DOMAIN, { ...data })
  }
}

export const sendConfirm = ({ email, token }: Alert) => {
  const href = `${ANCHOR_URL}/confirm?email=${encodeURIComponent(email)}&token=${token}`

  return send({
    from: `${ANCHOR_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'Confirm your alert',
    html: `
      <h3>Welcome to ${ANCHOR_NAME}!</h3>
      <p>Please confirm that you would like to receive alerts by clicking the link below:</p>
      <p><a href="${href}">Confirm Alert</a></p>
    `,
    text: `Please confirm that you would like to receive alerts by visiting: ${href}`,
  })
}

export const sendDigest = async (
  { email, token }: Alert,
  template: string,
  variables: Record<string, any>
) => {
  return send({
    from: `${ANCHOR_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'New activity',
    html: await render('emails/digest.html', {
      ...variables,
      name: email.split('@')[0],
      unsubscribeUrl: `${ANCHOR_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`,
    }),
  })
}
