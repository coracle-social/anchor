import './style.css'

import m from "mithril"
import {writable} from 'svelte/store'
import {getJson, spec, parseJson, setJson, assoc} from '@welshman/lib'
import {withGetter} from '@welshman/store'
import type {TrustedEvent, StampedEvent} from '@welshman/util'
import {normalizeRelayUrl} from '@welshman/util'
import type {Socket} from '@welshman/net'
import {load, defaultSocketPolicies, makeSocketPolicyAuth} from '@welshman/net'
import type {ISigner} from '@welshman/signer'
import {Nip07Signer, decrypt} from '@welshman/signer'

const NOTIFIER_PUBKEY = import.meta.env.VITE_RELAY_URL

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
  view: () => m('div')
}

const Login = {
  view: () =>
    m("button", {
      onclick: login,
      class: "cursor-pointer w-full bg-purple-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-purple-700 transition-colors"
    }, "Connect with Nostr"),
}

const AlertItem = {
  view: () => {
    // const {alert} = vnode.attrs

    // An alert looks like this:
    //
    //      {
    //          "event": {
    //              "kind": 32830,
    //              "content": "AtTuRG3JvheyKx9k1Psx9QySDkpcFDN5ojTCXoyVQ7BFLhOwU/gHUNYXjZUPX3pMnp8IiCIjRGkEn3BUaiI4bsQgs2eQgvob8zRZCHudUi8phrpCPX/L4oMeyyZ4ZVrm9L1qcwwWOFv5J9yeth66oHl0EiW7G2C9E67AJiIXjaAvc4Y4CDQECiiIMiSiFRqdwBf/rE3EN1O+EljummiKO6NpjL914dM8WLrGVY5ytlGbDdw9TlKFUrUegrWKY8doWhahz87SJ6E4ycpmXFiAFDvbetvx3B8eh7cOhQd3nZv1KJQuR5NSu5WouFikiedAi+Klc0UjdBR2dz/yY3tLf9a7a17Ydx3WUKWCrMO6UjkHfdLT4w+5j2Un5vqyTp9Pt9/b1Dj+BfI/U43xsbLPJyU4uQx7hH4Kg3CNiZafDe95QCdN1LP6z3VOdo9jB33FmDqLLPD3A793y1trZXCFh+ER8HHziKlQcEGQC6cK3mcjrcqBoGWiS28+iwSZxW/INJrXCG6I9PSgKZQzy/sjzyNIfAY1PjGCsp5YQRmts9ET+PhrxL6Ut+vh7TTr0QJ3A0kt9ZzxdcLeePGZqEaRH2ztsJL+Gktkn0AH1yt8TEFZtWhUbWJOzAL05e8iM0XBL4LstpXizVvsIYrrIfaxlhv4mVUPKjDejdeEWurVOLiRcKE=",
    //              "tags": [
    //                  [
    //                      "d",
    //                      "8801938986030935"
    //                  ],
    //                  [
    //                      "p",
    //                      "27b7c2ed89ef78322114225ea3ebf5f72c7767c2528d4d0c1854d039c00085df"
    //                  ]
    //              ],
    //              "created_at": 1742425814,
    //              "pubkey": "97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322",
    //              "id": "ec109abf54b961f89db3f7e71d66890d9bbb112b98f663abee9c40be693adcb4",
    //              "sig": "a4576c343455eb7d579ce57a1dc31839d3200a6cd2b07e41002c090e721e589294cb0cb3600a2024a59c47cf3bbec4415a33c816305d5416227ae2c2cb5c6831"
    //          },
    //          "tags": [
    //              [
    //                  "cron",
    //                  "0 * * * * *"
    //              ],
    //              [
    //                  "email",
    //                  "jstaab@protonmail.com"
    //              ],
    //              [
    //                  "relay",
    //                  "wss://bucket.coracle.social/"
    //              ],
    //              [
    //                  "channel",
    //                  "email"
    //              ],
    //              [
    //                  "handler",
    //                  "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1737058597050",
    //                  "wss://relay.nostr.band/",
    //                  "web"
    //              ],
    //              [
    //                  "filter",
    //                  "{\"kinds\":[11,31923]}"
    //              ],
    //              [
    //                  "filter",
    //                  "{\"kinds\":[1111],\"#k\":[\"11\",\"31923\"]}"
    //              ],
    //              [
    //                  "filter",
    //                  "{\"kinds\":[9],\"#h\":[\"_\",\"3742126588689967\"]}"
    //              ]
    //          ]
    //      }
    //
    // An alert status looks like this:
    //      {
    //          "event": {
    //              "kind": 32831,
    //              "content": "AlCryxH2Bt3YEc3TtkQV3gtzI2os5gsmXJ7XsS5RrHAViEiK/+ctmtN7n2fFwbBqenwYvT3DAJjXxJauSu2WWzo1cgsK8dFjOmSRMrHdNsRe3OY5EzyKcGHFaYRQ1LpRHcdTgKNJ9Gf9txzHGyrogKchj0L2r4iYqMiERCn/hnacmcc=",
    //              "tags": [
    //                  [
    //                      "d",
    //                      "32830:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:8801938986030935"
    //                  ],
    //                  [
    //                      "p",
    //                      "97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322"
    //                  ]
    //              ],
    //              "created_at": 1744921657,
    //              "pubkey": "27b7c2ed89ef78322114225ea3ebf5f72c7767c2528d4d0c1854d039c00085df",
    //              "id": "291a55fa73636e17505046920dfaee7a3516611680e4bcd87f59867957915b95",
    //              "sig": "36db3a07eef37334948773788af4dcdcfdb31d9013ac6edd5db1c2738e51a767e70aade0c843136a37cf3e25d02ecd057a8ec8a0291da1441cbc0a9bd206628a"
    //          },
    //          "tags": [
    //              [
    //                  "status",
    //                  "ok"
    //              ],
    //              [
    //                  "message",
    //                  "This alert is active"
    //              ]
    //          ]
    //      }

    return m('div')
  },
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
