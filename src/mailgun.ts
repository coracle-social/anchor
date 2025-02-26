import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import {TrustedEvent} from '@welshman/util'
import {MAILGUN_API_KEY, MAILGUN_DOMAIN, ANCHOR_NAME, ANCHOR_URL} from './env.js'
import {EmailUser, Subscription} from './domain.js'
import {render} from './templates.js'

// @ts-expect-error Mailgun has no constructor signature
const mailgun = new Mailgun(FormData)

const mg = mailgun.client({username: 'api', key: MAILGUN_API_KEY})

const send = (data: Record<string, any>) => {
  if (MAILGUN_DOMAIN.startsWith('sandbox')) {
    console.log(data)
  } else {
    mg.messages.create(MAILGUN_DOMAIN, {...data})
  }
}

export const sendConfirmEmail = ({email}: EmailUser, {confirm_token}: Subscription) => {
  const href = `${ANCHOR_URL}/confirm?email=${encodeURIComponent(email)}&confirm_token=${confirm_token}`

  return send({
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

export const sendDigest = async ({email, access_token}: EmailUser, template: string, events: TrustedEvent[], context: TrustedEvent[]) => {
  return send({
    from: `${ANCHOR_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'New activity',
    html: await render('emails/digest.html', {
      name: email.split('@')[0],
      eventCount: events.length,
      events: events.map(e => ({content: e.content})),
      unsubscribeUrl: `${ANCHOR_URL}/unsubscribe?email=${encodeURIComponent(email)}&access_token=${access_token}`
    }),
  })
}
