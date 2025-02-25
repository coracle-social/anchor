import { PORT } from './env.js'
import { server } from './server.js'
import { registerSubscription } from './worker.js'
import { migrate, getAllSubscriptions } from './database.js'

// Add global error handlers to ensure stack traces are logged
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

migrate().then(async () => {
  server.listen(PORT, () => {
    console.log('Running on port', PORT)
  })

  for (const subscription of await getAllSubscriptions()) {
    registerSubscription(subscription)
  }
})
