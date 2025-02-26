import { PORT } from './env.js'
import { server } from './server.js'
import { registerSubscription } from './worker.js'
import { migrate, getAllSubscriptions } from './database.js'

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

  for (const subscription of await getAllSubscriptions()) {
    registerSubscription(subscription)
  }
})
