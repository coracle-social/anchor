import { last } from '@welshman/lib'
import { getAlert } from './database.js'
import { runJob } from './worker.js'

const address = last(process.argv)

if (!address) {
  console.error('Please provide an alert address')
  process.exit(1)
}

getAlert(address)
  .then((alert) => {
    if (!alert) {
      console.error('Invalid alert address')
      process.exit(1)
    }

    return runJob(alert)
  })
  .then((success) => {
    process.exit(success ? 0 : 1)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
