import './style.css'

import m from "mithril"
import {writable} from 'svelte/store'
import {getJson, removeNil, append, spec, parseJson, setJson, assoc, randomId, randomInt, TIMEZONE, replaceAt, removeAt} from '@welshman/lib'
import {withGetter} from '@welshman/store'
import {validateFeed, validateAuthorFeed, ValidationError, walkFeed, displayFeeds, Feed} from '@welshman/feeds'
import type {TrustedEvent, StampedEvent, Filter} from '@welshman/util'
import {getAddress, normalizeRelayUrl, getTagValue, getTagValues, createEvent, DELETE} from '@welshman/util'
import type {Socket} from '@welshman/net'
import {load, publish, defaultSocketPolicies, makeSocketPolicyAuth} from '@welshman/net'
import type {ISigner} from '@welshman/signer'
import {Nip07Signer, decrypt} from '@welshman/signer'

// Constants

const NOTIFIER_PUBKEY = import.meta.env.VITE_NOTIFIER_PUBKEY

const NOTIFIER_RELAY = normalizeRelayUrl(import.meta.env.VITE_NOTIFIER_RELAY)

const ALERT = 32830

const ALERT_STATUS = 32831

const CRON_MINUTE = randomInt(0, 59)

const CRON_HOUR = (17 - parseInt(TIMEZONE.slice(3)) / 100) % 24

const CRON_WEEKLY = `0 ${CRON_MINUTE} ${CRON_HOUR} * * 1`

const CRON_DAILY = `0 ${CRON_MINUTE} ${CRON_HOUR} * * *`

const CRON_DAILY_PATTERN = /^0 \d{1,2} \d{1,2} \* \* \*$/

const CRON_WEEKLY_PATTERN = /^0 \d{1,2} \d{1,2} \* \* 1$/

const PLUS_ICON = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const TRASH_ICON = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M20.5 6H3.49991" stroke="#1C274C" stroke-width="1.5" stroke-linecap="round"/>
<path d="M18.8333 8.5L18.3734 15.3991C18.1964 18.054 18.1079 19.3815 17.2429 20.1907C16.3779 21 15.0475 21 12.3867 21H11.6133C8.95252 21 7.62212 21 6.75711 20.1907C5.8921 19.3815 5.80361 18.054 5.62661 15.3991L5.16667 8.5" stroke="#1C274C" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="#1C274C" stroke-width="1.5"/>
</svg>`

const ARROW_LEFT_ICON = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

// Utilities

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

// Types and state

type Alert = {
  event: TrustedEvent
  tags: string[][]
}

type AlertStatus = {
  event: TrustedEvent
  tags: string[][]
}

type AlertValues = {
  feeds: string[]
  cron: string
  email: string
}

type State = {
  failedToLogin: boolean
  signer: ISigner
  pubkey: string | undefined
  alerts: Alert[]
  alertDraft?: AlertValues,
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

// Actions

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
    relays: [NOTIFIER_RELAY],
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

const deleteAlert = async (alert: Alert) => {
  if (confirm("Are you sure you want to delete this alert?")) {
    state.update(assoc('alertsLoading', true))

    await publish({
      relays: [NOTIFIER_RELAY],
      event: await state.get().signer!.sign(
        createEvent(DELETE, {
          tags: [
            ["k", String(alert.event.kind)],
            ["a", getAddress(alert.event)]
          ],
        })
      ),
    })

    await loadAlerts()
  }
}

export type AlertParams = {
  feeds: string[]
  cron: string
  email: string
  bunker: string
  secret: string
}

export const makeAlert = async ({cron, email, feeds, bunker, secret}: AlertParams) => {
  const {signer} = state.get()

  const tags = [
    ["cron", cron],
    ["email", email],
    ["channel", "email"],
    [
      "handler",
      "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1685968093690",
      "wss://relay.nostr.band/",
      "web",
    ],
  ]

  for (const feed of feeds) {
    tags.push(["feed", feed])
  }

  if (bunker) {
    tags.push(["nip46", secret, bunker])
  }

  return signer.sign(
    createEvent(ALERT, {
      content: await signer.nip44.encrypt(NOTIFIER_PUBKEY, JSON.stringify(tags)),
      tags: [
        ["d", randomId()],
        ["p", NOTIFIER_PUBKEY],
      ],
    })
  )
}

export const publishAlert = async (params: AlertParams) =>
  publish({event: await makeAlert(params), relays: [NOTIFIER_RELAY]})

// Components

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
      class: "w-full bg-purple-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-purple-700 transition-colors"
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

    return m("div", {class: getStatusClasses(), tooltip: message}, getStatusDisplay())
  },
}

const AlertListItem: m.Component<{alert: Alert}> = {
  view: vnode => {
    const {alert} = vnode.attrs
    const cron = getTagValue('cron', alert.tags)
    const feeds = getTagValues('feeds', alert.tags)
    const channel = getTagValue('channel', alert.tags)
    const description = displayFeeds(feeds.map(feed => parseJson(feed))) || "[invalid feed]"
    console.log(feeds)

    let frequency = cron || "Unknown"
    if (cron) {
      if (CRON_DAILY_PATTERN.test(cron)) {
        frequency = 'Daily'
      } else if (CRON_WEEKLY_PATTERN.test(cron)) {
        frequency = 'Weekly'
      }
    }

    return m("div", { class: "flex items-start justify-between p-4" }, [
      m("button", {
        onclick: () => deleteAlert(alert),
        class: "mr-4 mt-1",
        tooltip: "Delete alert"
      }, [m.trust(TRASH_ICON)]),
      m("div", { class: "space-y-2 flex-grow" }, [
        m("div", { class: "text-gray-600" }, `${frequency} alert via ${channel}`),
        m("div", { class: "text-sm text-gray-500" }, description)
      ]),
      m(AlertStatus, {alert}),
    ])
  }
}

const AlertList = {
  oninit: loadAlerts,
  view: () => {
    const {alerts, alertsLoading} = state.get()

    const content = alertsLoading
      ? m(Loader)
      : alerts.length > 0
        ? alerts.map(alert => m(AlertListItem, {alert, key: alert.event.id}))
        : m("div", { class: "text-center text-gray-500 py-8" }, [
            "You don't have any alerts set up.",
          ])

    return m("div", { class: "space-y-4" }, [
      m("div", { class: "flex items-center justify-between mb-6" }, [
        m("h1", { class: "text-2xl font-bold text-gray-900" }, "Your Nostr Alerts"),
        m("a", {
          href: "#!/alerts/new",
          class: "flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors",
        }, [
          m.trust(PLUS_ICON),
          "Add Alert"
        ])
      ]),
      m("div", { class: "bg-white shadow rounded-lg p-6" }, content)
    ])
  }
}

const AlertCreate = {
  oninit: () => {
    state.update(assoc('alertDraft', {
      email: getTagValue('email', state.get().alerts[0]?.tags || []) || "",
      cron: CRON_DAILY,
      feeds: [],
    }))
  },
  view: () => {
    const {alertDraft, alertsLoading} = state.get()
    const {email, feeds, cron} = alertDraft!

    const update = (newValues: Partial<AlertValues>) => {
      state.update(assoc('alertDraft', {...alertDraft, ...newValues}))
    }

    const submit = async (e: Event) => {
      e.preventDefault()

      const parsedFeeds = removeNil(feeds.map(parseJson))
      const feedError = parsedFeeds.map(validateFeed).find(e => e instanceof ValidationError)

      if (!email.includes("@")) {
        alert("Please provide a valid email address")
      } else if (feeds.length === 0) {
        alert("Please add at least one feed")
      } else if (parsedFeeds.length < feeds.length) {
        alert("At least on feed is invalid (must be valid JSON)")
      } else if (feedError) {
        alert(`At least one feed is invalid (${feedError.data.toLowerCase()}).`)
      } else {
        state.update(assoc('alertsLoading', true))

        try {
          await publishAlert({cron, email, feeds, bunker: '', secret: ''})

          m.route.set("/alerts")
        } catch (error) {
          alert("Failed to create alert. Please try again.")
          console.error('Error creating alert:', error)
        } finally {
          state.update(assoc('alertsLoading', false))
        }
      }
    }

    return m("div", { class: "space-y-4" }, [
      m("div", { class: "flex items-center gap-4 mb-6" }, [
        m("button", {
          onclick: () => m.route.set("/alerts"),
          class: "text-gray-600 hover:text-gray-900 cursor-pointer",
          tooltip: "Back to alerts"
        }, m.trust(ARROW_LEFT_ICON)),
        m("h1", { class: "text-2xl font-bold text-gray-900" }, "Create Alert")
      ]),
      m("div", { class: "bg-white shadow rounded-lg p-6" }, [
        m("form", { class: "space-y-6", onsubmit: submit }, [
          m("div", [
            m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Email"),
            m("input", {
              type: "email",
              placeholder: "Enter your email address",
              value: email,
              oninput: (e: InputEvent) => update({email: (e.target as HTMLInputElement).value}),
              class: "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            })
          ]),
          m("div", [
            m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Frequency"),
            m("select", {
              value: cron,
              onchange: (e: Event) => update({cron: (e.target as HTMLSelectElement).value}),
              class: "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            }, [
              m("option", { value: CRON_DAILY }, "Daily"),
              m("option", { value: CRON_WEEKLY }, "Weekly (Mondays)")
            ])
          ]),
          m("div", [
            m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Feeds"),
            m("div", { class: "space-y-2" }, [
              feeds.map((feed, index) =>
                m("div", { class: "flex items-center gap-2" }, [
                  m("button", {
                    onclick: () => update({feeds: removeAt(index, feeds)}),
                    type: "button",
                    tooltip: "Remove feed",
                    class: "text-gray-400 hover:text-gray-600"
                  }, m.trust(TRASH_ICON)),
                  m("input", {
                    type: "text",
                    value: feed,
                    oninput: (e: InputEvent) => update({feeds: replaceAt(index, (e.target as HTMLInputElement).value, feeds)}),
                    class: "flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                  })
                ])
              ),
              m("button", {
                onclick: () => update({feeds: append("", feeds)}),
                type: "button",
                class: "text-sm text-purple-600 hover:text-purple-800"
              }, "+ Add Feed")
            ])
          ]),
          m("div", { class: "flex justify-end" }, [
            m("button", {
              type: "submit",
              disabled: alertsLoading,
              class: "bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            }, alertsLoading ? "Creating..." : "Create Alert")
          ])
        ])
      ])
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
            class: "w-full bg-red-100 text-red-700 font-medium py-2 px-4 rounded-lg hover:bg-red-200 transition-colors"
          }, "Try Again"),
          m("a", {
            href: "https://nostrapps.com/#signers",
            target: "_blank",
            class: "block w-full bg-purple-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-purple-700 transition-colors"
          }, "Install a Nostr Signer")
        ])
      ])
    ])
}

const Layout: m.Component<{children: m.Children}> = {
  view: vnode => {
    const {children} = vnode.attrs
    const {failedToLogin, pubkey} = state.get()

    if (failedToLogin) {
      return m(FailedToLogin)
    }

    if (!pubkey) {
      return m("div", { class: "text-center space-y-4" }, [
        m("h1", { class: "text-2xl font-bold text-gray-900 mb-2" }, "Welcome to Anchor Alerts"),
        m("p", { class: "text-gray-600 mb-6" }, "Connect your Nostr signer to get started"),
        m(Login)
      ])
    }

    return children
  }
}

m.route(document.querySelector('#app')!, "/alerts", {
  "/alerts": {
    view: () => {
      return m(Layout, {children: [m(AlertList)]})
    },
  },
  "/alerts/new": {
    view: () => {
      return m(Layout, {children: [m(AlertCreate)]})
    }
  },
})

state.subscribe(() => m.redraw())

defaultSocketPolicies.push(
  makeSocketPolicyAuth({
    sign: (event: StampedEvent) => {
      return state.get().signer?.sign(event)
    },
  }),
)

Object.assign(window, {setJson, getJson})
