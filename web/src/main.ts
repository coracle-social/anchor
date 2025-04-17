import './style.css'

import m from "mithril"
import {writable} from 'svelte/store'
import {getJson, spec, parseJson, setJson, assoc} from '@welshman/lib'
import {withGetter} from '@welshman/store'
import type {TrustedEvent, StampedEvent} from '@welshman/util'
import {getAddress, normalizeRelayUrl, getTagValue, getTagValues} from '@welshman/util'
import type {Socket} from '@welshman/net'
import {load, defaultSocketPolicies, makeSocketPolicyAuth} from '@welshman/net'
import type {ISigner} from '@welshman/signer'
import {Nip07Signer, decrypt} from '@welshman/signer'

const displayList = <T>(xs: T[], conj = "and", n = 6, locale = "en-US") => {
  const stringItems = xs.map(String)

  if (xs.length > n + 2) {
    const formattedList = new Intl.ListFormat(locale, {style: "long", type: "unit"}).format(
      stringItems.slice(0, n),
    )

    return `${formattedList}, ${conj} ${xs.length - n} others`
  }

  return new Intl.ListFormat(locale, {style: "long", type: "conjunction"}).format(stringItems)
}

const NOTIFIER_PUBKEY = import.meta.env.VITE_NOTIFIER_PUBKEY

const RELAY_URL = normalizeRelayUrl(import.meta.env.VITE_RELAY_URL)

const ALERT = 32830

const ALERT_STATUS = 32831

type Alert = {
  event: TrustedEvent
  tags: string[][]
}

type AlertStatus = {
  event: TrustedEvent
  tags: string[][]
}

type State = {
  failedToLogin: boolean
  signer: ISigner
  pubkey: string | undefined
  alerts: Alert[]
  alertStatuses: AlertStatus[]
  alertsLoading: boolean
}

const state = withGetter(
  writable({
    failedToLogin: false,
    signer: new Nip07Signer(),
    pubkey: getJson('pubkey'),
    alerts: [],
    alertStatuses: [],
    alertsLoading: false,
  } as State)
)

const login = async () => {
  const {signer} = state.get()

  try {
    const pubkey = await signer.getPubkey()

    state.update(assoc('pubkey', pubkey))
    setJson('pubkey', pubkey)
  } catch (e) {
    state.update(assoc('failedToLogin', true))
  }
}

const loadAlerts = async () => {
  const {signer, pubkey} = state.get()

  state.update(assoc('alertsLoading', true))

  const events = await load({
    relays: [RELAY_URL],
    filters: [
      {kinds: [ALERT], authors: [pubkey!]},
      {kinds: [ALERT_STATUS], "#p": [pubkey!]},
    ],
  })

  const alerts = await Promise.all(
    events
      .filter(spec({kind: ALERT}))
      .map(async event => {
        const tags = parseJson(await decrypt(signer, NOTIFIER_PUBKEY, event.content))

        return {event, tags}
      })
  )

  const alertStatuses = await Promise.all(
    events
      .filter(spec({kind: ALERT_STATUS}))
      .map(async event => {
        const tags = parseJson(await decrypt(signer, NOTIFIER_PUBKEY, event.content))

        return {event, tags}
      })
  )

  state.update($state => ({...$state, alertsLoading: false, alerts, alertStatuses}))
}

const Loader = {
  view: () => m("div", { class: "flex justify-center py-4" }, [
    m("div", {
      class: "animate-spin rounded-full h-8 w-8 border-4 border-purple-200 border-t-purple-600"
    })
  ])
}

const Login = {
  view: () =>
    m("button", {
      onclick: login,
      class: "cursor-pointer w-full bg-purple-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-purple-700 transition-colors"
    }, "Connect with Nostr"),
}

const AlertStatus: m.Component<{alert: Alert}> = {
  view: vnode => {
    const {alert} = vnode.attrs
    const {alertStatuses} = state.get()
    const address = getAddress(alert.event)
    const alertStatus = alertStatuses.find(s => getTagValue('d', s.event.tags) === address)
    const status = getTagValue('status', alertStatus?.tags || [])
    const message = getTagValue('message', alertStatus?.tags || [])

    const getStatusClasses = () => {
      const baseClasses = "rounded-full px-3 py-1 text-sm border"
      if (status === 'ok') return `${baseClasses} border-green-500 text-green-500`
      if (status === 'pending') return `${baseClasses} border-yellow-500 text-yellow-500`
      return `${baseClasses} border-red-500 text-red-500`
    }

    const getStatusDisplay = () => {
      if (!status) return 'Inactive'
      if (status === 'ok') return 'Active'
      if (status === 'pending') return 'Pending'
      return status.replace('-', ' ').replace(/^(.)/, x => x.toUpperCase())
    }

    return m("div", {class: getStatusClasses(), title: message}, getStatusDisplay())
  },
}

const AlertItem: m.Component<{alert: Alert}> = {
  view: vnode => {
    const {alert} = vnode.attrs
    const cron = getTagValue('cron', alert.tags)
    const channel = getTagValue('channel', alert.tags)
    const relays = getTagValues('relay', alert.tags)
    const filters = getTagValues('filter', alert.tags)
    const frequency = cron?.endsWith('* * *') ? 'Hourly' : 'Every minute'

    return m("div", { class: "flex items-center justify-between p-4" }, [
      m("div", { class: "space-y-2" }, [
        m("div", { class: "text-gray-600" }, [
          `${frequency} alert via ${channel} on `,
          m("span", { class: "text-purple-600" }, displayList(relays))
        ]),
        m("div", { class: "text-sm text-gray-500" }, ["Filters: ", filters.join(', ')])
      ]),
      m(AlertStatus, {alert}),
    ])
  }
}

const Alerts = {
  oninit: loadAlerts,
  view: () => {
    const {alerts, alertsLoading} = state.get()

    const content = alertsLoading
      ? m(Loader)
      : alerts.map(alert => m(AlertItem, {alert, key: alert.event.id}))

    return m("div", { class: "space-y-4" }, [
      m("h1", { class: "text-2xl font-bold text-gray-900 mb-6" }, "Your Nostr Alerts"),
      m("div", { class: "bg-white shadow rounded-lg p-6" }, content)
    ])
  }
}

const FailedToLogin = {
  view: () =>
    m("div", { class: "space-y-6 text-center" }, [
      m("div", { class: "bg-red-50 border border-red-200 rounded-lg p-6" }, [
        m("h2", { class: "text-red-800 font-semibold mb-2" }, "Unable to Connect"),
        m("p", { class: "text-red-600 mb-4" }, "To use Anchor Alerts, you need a Nostr signer extension installed in your browser."),
        m("div", { class: "space-y-3" }, [
          m("button", {
            onclick: () => window.location.reload(),
            class: "cursor-pointer w-full bg-red-100 text-red-700 font-medium py-2 px-4 rounded-lg hover:bg-red-200 transition-colors"
          }, "Try Again"),
          m("a", {
            href: "https://nostrapps.com/#signers",
            target: "_blank",
            class: "cursor-pointer block w-full bg-purple-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-purple-700 transition-colors"
          }, "Install a Nostr Signer")
        ])
      ])
    ])
}

const App = {
  view: () => {
    const {failedToLogin, pubkey} = state.get()

    if (failedToLogin) {
      return m(FailedToLogin)
    }

    if (pubkey) {
      return m(Alerts)
    }

    return m("div", { class: "text-center space-y-4" }, [
      m("h1", { class: "text-2xl font-bold text-gray-900 mb-2" }, "Welcome to Anchor Alerts"),
      m("p", { class: "text-gray-600 mb-6" }, "Connect your Nostr signer to get started"),
      m(Login)
    ])
  }
}

defaultSocketPolicies.push(
  makeSocketPolicyAuth({
    sign: (event: StampedEvent) => {
      return state.get().signer?.sign(event)
    },
  }),
)

m.mount(document.querySelector('#app')!, App)

state.subscribe(() => m.redraw())

Object.assign(window, {setJson, getJson})
