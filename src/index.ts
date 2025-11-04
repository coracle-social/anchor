import 'localstorage-polyfill'

import { PORT } from './env.js'
import { server } from './server.js'
import { getAlertError } from './alert.js'
import { migrate, getActiveAlerts } from './database.js'
import { registerAlert } from './worker/index.js'

process.on('unhandledRejection', (error: Error) => {
  console.error('Unhandled rejection:', error.stack)
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error.stack)
  process.exit(1)
})

migrate().then(async () => {
  server.listen(PORT, () => {
    console.log('Running on port', PORT)
  })

  for (const alert of await getActiveAlerts()) {
    const error = await getAlertError(alert)

    if (error) {
      console.log('did not register job', alert.address, error)
    } else {
      registerAlert(alert)
    }
  }
})
