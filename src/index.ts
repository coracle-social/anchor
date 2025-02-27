import 'localstorage-polyfill'

import { setContext } from '@welshman/lib'
import { getDefaultNetContext, getDefaultAppContext } from '@welshman/app'
import { PORT } from './env.js'
import { server } from './server.js'
import { registerSubscription } from './worker.js'
import { migrate, getActiveSubscriptions } from './database.js'

setContext({
  app: getDefaultAppContext(),
  net: getDefaultNetContext(),
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

  for (const subscription of await getActiveSubscriptions()) {
    registerSubscription(subscription)
  }
})
