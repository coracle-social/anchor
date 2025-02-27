import 'localstorage-polyfill'

import { setContext } from '@welshman/lib'
import { getDefaultNetContext, getDefaultAppContext } from '@welshman/app'
import { PORT } from './env.js'
import { server } from './server.js'
import { registerAlert } from './worker.js'
import { migrate, getActiveAlerts } from './database.js'

setContext({
  net: getDefaultNetContext(),
  app: getDefaultAppContext({
    indexerRelays: ['wss://relay.damus.io/', 'wss://nos.lol/', 'wss://purplepag.es/'],
  }),
})

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
