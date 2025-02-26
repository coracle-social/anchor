import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import { TrustedEvent } from '@welshman/util'
import { MAILGUN_API_KEY, MAILGUN_DOMAIN, ANCHOR_NAME, ANCHOR_URL } from './env.js'
import { Subscription } from './domain.js'
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

export const sendConfirm = ({ email, token }: Subscription) => {
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
  { email, token }: Subscription,
  template: string,
  events: TrustedEvent[],
  context: TrustedEvent[]
) => {
  return send({
    from: `${ANCHOR_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'New activity',
    html: await render('emails/digest.html', {
      name: email.split('@')[0],
      eventCount: events.length,
      events: events.map((e) => ({ content: e.content })),
      unsubscribeUrl: `${ANCHOR_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`,
    }),
  })
}
