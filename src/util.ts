import sanitizeHtml from 'sanitize-html'
import { remove, cached, uniq, indexBy, nth, batcher } from '@welshman/lib'
import {
  SignedEvent,
  PROFILE,
  readProfile,
  readList,
  asDecryptedEvent,
  RELAYS,
} from '@welshman/util'
import { Router } from '@welshman/router'
import { load } from '@welshman/net'
import { CronExpressionParser } from 'cron-parser'

export function getCronDate(cronString: string, n: number) {
  const interval = CronExpressionParser.parse(cronString, { tz: 'UTC' })
  const now = new Date()

  let date = interval.next().toDate()

  for (let i = 0; i < Math.abs(n); i++) {
    if (n > 0) {
      date = interval.next().toDate()
    } else {
      date = interval.prev().toDate()
    }
  }

  return date
}

export function displayDuration(seconds: number) {
  const minute = 60
  const hour = minute * 60
  const day = hour * 24
  const week = day * 7
  const month = day * 30
  const year = day * 365

  if (seconds < minute) {
    return `${Math.round(seconds)} seconds`
  } else if (seconds < hour) {
    const minutes = Math.round(seconds / minute)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  } else if (seconds < day) {
    const hours = Math.round(seconds / hour)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  } else if (seconds < week) {
    const days = Math.round(seconds / day)
    return `${days} ${days === 1 ? 'day' : 'days'}`
  } else if (seconds < month) {
    const weeks = Math.round(seconds / week)
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
  } else if (seconds < year) {
    const months = Math.round(seconds / month)
    return `${months} ${months === 1 ? 'month' : 'months'}`
  } else {
    const years = Math.round(seconds / year)
    return `${years} ${years === 1 ? 'year' : 'years'}`
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
  innerHTML: string
  outerHTML: string
}

export function createElement(tagName: string) {
  const element: CustomElement = {
    tagName: tagName.toLowerCase(),
    attributes: {},
    children: [],
    _innerText: '',

    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },

    getAttribute(name: string): string | undefined {
      return this.attributes[name]
    },

    appendChild(child: ElementChild) {
      this.children.push(child)
    },

    get href() {
      return this.attributes.href || ''
    },

    set href(value: string) {
      this.attributes.href = value
    },

    get target() {
      return this.attributes.target || ''
    },

    set target(value: string) {
      this.attributes.target = value
    },

    get innerText() {
      return this._innerText
    },

    set innerText(value: string) {
      this._innerText = sanitizeHtml(value, {
        allowedTags: [],
        allowedAttributes: {},
      })
    },

    get innerHTML() {
      return this._innerText
    },

    set innerHTML(value: string) {
      this._innerText = value
    },

    get outerHTML() {
      const attributesString = Object.entries(this.attributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ')

      return `<${this.tagName}${attributesString ? ' ' + attributesString : ''}>${this._innerText}</${this.tagName}>`
    },
  }

  return element
}
