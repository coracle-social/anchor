import sanitizeHtml from 'sanitize-html'
import { remove } from '@welshman/lib'
import { subscribe, SubscriptionEvent, SubscribeRequestWithHandlers } from '@welshman/net'
import { SignedEvent } from '@welshman/util'
import { CronExpressionParser } from 'cron-parser'

export const removeUndefined = <T>(xs: (T | undefined)[]) => remove(undefined, xs) as T[]

export function load(request: SubscribeRequestWithHandlers) {
  return new Promise<SignedEvent[]>((resolve) => {
    const sub = subscribe({ closeOnEose: true, timeout: 10_000, ...request })
    const events: SignedEvent[] = []

    sub.on(SubscriptionEvent.Event, (url: string, e: SignedEvent) => events.push(e))
    sub.on(SubscriptionEvent.Complete, () => resolve(events))
  })
}

export function parseCronString(cronString: string): (n: number) => Date {
  const interval = CronExpressionParser.parse(cronString, { tz: 'UTC' })

  return (n: number): Date => {
    const now = new Date()
    let date: Date

    if (n >= 0) {
      date = interval.prev().toDate()
      for (let i = 0; i <= n; i++) {
        date = interval.next().toDate()
      }
    } else {
      date = interval.next().toDate()
      for (let i = 0; i < Math.abs(n); i++) {
        date = interval.prev().toDate()
      }
    }

    return date
  }
}

interface ElementAttributes {
  [key: string]: string
}

interface ElementChild {
  outerHTML: string
}

export interface CustomElement {
  tagName: string
  attributes: ElementAttributes
  children: ElementChild[]
  _innerText: string
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | undefined
  appendChild(child: ElementChild): void
  href: string
  target: string
  innerText: string
  outerHTML: string
}

export function createElement(tagName: string): CustomElement {
  const element: CustomElement = {
    tagName: tagName.toLowerCase(),
    attributes: {},
    children: [],
    _innerText: '',

    setAttribute(name: string, value: string): void {
      this.attributes[name] = value
    },

    getAttribute(name: string): string | undefined {
      return this.attributes[name]
    },

    appendChild(child: ElementChild): void {
      this.children.push(child)
    },

    get href(): string {
      return this.attributes.href || ''
    },

    set href(value: string) {
      this.attributes.href = value
    },

    get target(): string {
      return this.attributes.target || ''
    },

    set target(value: string) {
      this.attributes.target = value
    },

    get innerText(): string {
      return this._innerText
    },

    set innerText(value: string) {
      this._innerText = sanitizeHtml(value, {
        allowedTags: [],
        allowedAttributes: {},
      })
    },

    get outerHTML(): string {
      const attributesString = Object.entries(this.attributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ')

      return `<${this.tagName}${attributesString ? ' ' + attributesString : ''}>${this._innerText}</${this.tagName}>`
    },
  }

  return element
}

export const displayList = <T>(xs: T[], conj = "and", n = 6) => {
  // Convert all elements to strings for Intl.ListFormat
  const stringItems = xs.map(String)

  if (xs.length > n + 2) {
    return `${stringItems.slice(0, n).join(', ')}, ${conj} ${xs.length - n} others`
  }

  if (xs.length < 3) {
    return stringItems.join(` ${conj} `)
  }

  return `${stringItems.slice(0, -1).join(', ')}, ${conj} ${stringItems.slice(-1).join('')}`
}
