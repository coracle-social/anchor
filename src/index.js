import { PORT } from './env.js'
import { server } from './server.js'
import { migrate } from './database.js'

migrate().then(() => {
  server.listen(PORT, () => {
    console.log('Running on port', PORT)
  })
})
