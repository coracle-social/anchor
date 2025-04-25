import 'localstorage-polyfill'

import { PORT } from './env.js'
import { server } from './server.js'
import { registerAlert } from './worker.js'
import { migrate, getActiveAlerts } from './database.js'

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
    registerAlert(alert)
  }
})
