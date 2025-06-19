import { ServerClient } from 'postmark'
import { POSTMARK_SENDER_ADDRESS, POSTMARK_API_KEY, ANCHOR_NAME, ANCHOR_URL } from './env.js'
import { EmailAlert } from './alert.js'
import { render } from './templates.js'

const client = new ServerClient(POSTMARK_API_KEY)

export const sendConfirm = ({ email, token }: EmailAlert) => {
  const href = `${ANCHOR_URL}/confirm?email=${encodeURIComponent(email)}&token=${token}`

  return client.sendEmail({
    From: POSTMARK_SENDER_ADDRESS,
    To: email,
    Subject: 'Confirm your alert',
    HtmlBody: `
      <h3>Welcome to ${ANCHOR_NAME}!</h3>
      <p>Please confirm that you would like to receive alerts by clicking the link below:</p>
      <p><a href="${href}">Confirm Alert</a></p>
    `,
    TextBody: `Please confirm that you would like to receive alerts by visiting: ${href}`,
  })
}

export const sendDigest = async ({ email, token }: EmailAlert, variables: Record<string, any>) => {
  return client.sendEmail({
    From: POSTMARK_SENDER_ADDRESS,
    To: email,
    Subject: 'New activity',
    HtmlBody: await render('emails/digest.mjml', {
      ...variables,
      name: email.split('@')[0],
      unsubscribeUrl: `${ANCHOR_URL}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`,
    }),
  })
}
