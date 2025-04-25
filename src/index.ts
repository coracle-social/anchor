import 'localstorage-polyfill'

import {always} from '@welshman/lib'
import {routerContext} from '@welshman/router'
import { PORT, DEFAULT_RELAYS, INDEXER_RELAYS, SEARCH_RELAYS } from './env.js'
import { server } from './server.js'
import { registerAlert } from './worker.js'
import { migrate, getActiveAlerts } from './database.js'

routerContext.getDefaultRelays = always(DEFAULT_RELAYS)
routerContext.getIndexerRelays = always(INDEXER_RELAYS)
routerContext.getSearchRelays = always(SEARCH_RELAYS)

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
