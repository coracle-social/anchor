import 'localstorage-polyfill'

import { PORT } from './env.js'
import { server } from './server.js'
import { getAlertError } from './alert.js'
import { migrate, getActiveAlerts } from './database.js'
import { registerAlert } from './worker/index.js'

process.on('unhandledRejection', (error: Error) => {
  console.log(error.stack)
})

process.on('uncaughtException', (error: Error) => {
  console.log(error.stack)
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
