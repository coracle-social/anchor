import mailgun from 'mailgun-js'
import {MAILGUN_API_KEY, MAILGUN_DOMAIN, ANCHOR_NAME, CLIENT_DOMAIN} from './env'

const mg = mailgun({apiKey: MAILGUN_API_KEY, domain: MAILGUN_DOMAIN})

const send = (data) => {
  if (MAILGUN_DOMAIN.startsWith('sandbox')) {
    console.log(data)
  } else {
    mg.messages().send(data)
  }
}

export const sendConfirmEmail = ({email, confirm_token}) => {
  const href = `${CLIENT_DOMAIN}/confirm-email?email=${encodeURIComponent(email)}&confirm_token=${confirm_token}`

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
