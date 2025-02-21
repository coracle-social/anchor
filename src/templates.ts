import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

export const render = async (template: string, data: Record<string, any>) => {
  let result = await fs.readFile(path.join(__dirname, template), 'utf8')

  for (const [k, v] of Object.entries(data)) {
    result = result.replace(`{{${k}}}`, v)
  }

  return result
}
