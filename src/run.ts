import { last } from '@welshman/lib'
import { isEmailAlert } from './alert.js'
import { getAlert } from './database.js'
import { runJob } from './worker/email.js'

const address = last(process.argv)

if (!address) {
  console.error('Please provide an alert address')
  process.exit(1)
}

getAlert(address)
  .then((alert) => {
    if (!alert) {
      console.error('Invalid alert address')

      return false
    }

    if (isEmailAlert(alert)) {
      return runJob(alert)
    }

    console.log('Invalid alert type', alert)

    return false
  })
  .then((success) => {
    process.exit(success ? 0 : 1)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
