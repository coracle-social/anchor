import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Mustache from 'mustache'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cache templates to avoid reading from disk on every render
const templateCache = new Map<string, string>()

const loadTemplate = async (name: string) => {
  if (!templateCache.has(name)) {
    const templatePath = path.join(__dirname, name)
    const template = await fs.promises.readFile(templatePath, 'utf8')

    templateCache.set(name, template)
  }

  return templateCache.get(name)!
}

export const render = async (name: string, view: Record<string, any> = {}) =>
  Mustache.render(await loadTemplate(name), view)
