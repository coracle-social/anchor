import './style.css'

import m from "mithril"
import QR from 'qrcode'
import {writable} from 'svelte/store'
import {getJson, insertAt, removeNil, spec, parseJson, setJson, assoc, randomId, randomInt, TIMEZONE, tryCatch, LOCALE} from '@welshman/lib'
import {withGetter} from '@welshman/store'
import {Router} from '@welshman/router'
import {validateFeed, ValidationError, displayFeeds, Feed} from '@welshman/feeds'
import {getAddress, getRelaysFromList, RelayMode, readList, asDecryptedEvent, normalizeRelayUrl, getTagValue, getTagValues, createEvent, DELETE, TrustedEvent, StampedEvent, FEED, Address, getIdFilters, fromNostrURI, RELAYS} from '@welshman/util'
import {load, publish, defaultSocketPolicies, makeSocketPolicyAuth} from '@welshman/net'
import type {ISigner} from '@welshman/signer'
import {Nip07Signer, Nip46Broker, Nip46ResponseWithResult, makeSecret, decrypt} from '@welshman/signer'

// Constants

const NOTIFIER_PUBKEY = import.meta.env.VITE_NOTIFIER_PUBKEY

const NOTIFIER_RELAY = normalizeRelayUrl(import.meta.env.VITE_NOTIFIER_RELAY)

const INDEXER_RELAYS = import.meta.env.VITE_INDEXER_RELAYS.split(',').map(normalizeRelayUrl)

const SIGNER_RELAYS = import.meta.env.VITE_SIGNER_RELAYS.split(',').map(normalizeRelayUrl)

const PLATFORM_URL = window.origin
const PLATFORM_NAME = "Anchor Alerts"
const PLATFORM_LOGO = ""

const ALERT = 32830

const ALERT_STATUS = 32831

const TZ_OFFSET = parseInt(TIMEZONE.split(':')[0]!)

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
  feedAddress: string
  freq: string
  time: string,
  email: string
  bunker: string
  secret: string
  controller?: BunkerConnectController
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

// Bunker connection

class BunkerConnectController {
  url = ""
  bunker = ""
  loading = false
  clientSecret = makeSecret()
  abortController = new AbortController()
  broker = new Nip46Broker({clientSecret: this.clientSecret, relays: SIGNER_RELAYS})
  onNostrConnect: (response: Nip46ResponseWithResult) => void

  constructor({onNostrConnect}: {onNostrConnect: (response: Nip46ResponseWithResult) => void}) {
    this.onNostrConnect = onNostrConnect
  }

  async start() {
    this.url = await this.broker.makeNostrconnectUrl({
      url: PLATFORM_URL,
      name: PLATFORM_NAME,
      image: PLATFORM_LOGO,
    })

    let response
    try {
      response = await this.broker.waitForNostrconnect(this.url, this.abortController.signal)
    } catch (errorResponse: any) {
      if (errorResponse?.error) {
        alert(`Received error from signer: ${errorResponse.error}`)
      } else if (errorResponse) {
        console.error(errorResponse)
      }
    }

    if (response) {
      this.loading = true
      this.onNostrConnect(response)
    }
  }

  stop() {
    this.broker.cleanup()
    this.abortController.abort()
  }
}

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
  feeds: Feed[]
  freq: string
  time: string
  email: string
  bunker: string
  secret: string
}

export const makeAlert = async ({freq, time, email, feeds, bunker, secret}: AlertParams) => {
  const {signer} = state.get()
  const [hour, minute] = time.split(':')
  const utcHour = (parseInt(hour) - TZ_OFFSET) % 24
  const dow = freq === 'daily' ? '*' : freq
  const cron = `0 ${minute} ${utcHour} * * ${dow}`

  const tags = [
    ["cron", cron],
    ["email", email],
    ["channel", "email"],
    ["locale", LOCALE],
    ["timezone", TIMEZONE],
    [
      "handler",
      "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1685968093690",
      "wss://relay.nostr.band/",
      "web",
    ],
  ]

  for (const feed of feeds) {
    tags.push(["feed", JSON.stringify(feed)])
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
    const feeds = getTagValues('feed', alert.tags)
    const channel = getTagValue('channel', alert.tags)
    const description = displayFeeds(feeds.map(feed => parseJson(feed))) || "[invalid feed]"

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
        m("div", { class: "text-sm text-gray-500" }, `Events ${description}`)
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

const QRCode = () => {
  let canvas = null as HTMLCanvasElement | null
  let wrapper = null as HTMLElement | null
  let scale = 0.1
  let height = 0

  return {
    oncreate: (vnode: m.VnodeDOM<{code: string}>) => {
      canvas = vnode.dom.querySelector('canvas') as HTMLCanvasElement
      wrapper = vnode.dom.querySelector('.qr-wrapper') as HTMLElement

      if (canvas && wrapper) {
        QR.toCanvas(canvas, vnode.attrs.code).then(() => {
          const wrapperRect = wrapper!.getBoundingClientRect()
          const canvasRect = canvas!.getBoundingClientRect()

          scale = wrapperRect.width / (canvasRect.width * 10)
          height = canvasRect.width * 10 * scale

          wrapper!.style.height = `${height}px`

          m.redraw()
        })
      }
    },
    view: (vnode: m.VnodeDOM<{code: string}>) => {
      const copy = (e: Event) => {
        e.preventDefault()
        navigator.clipboard.writeText(vnode.attrs.code)
        alert("URL copied to clipboard!")
      }

      return m("button", {
        class: "max-w-full",
        onclick: copy,
      }, [
        m("div", {
          class: "qr-wrapper"
        }, [
          m("canvas", {
            class: "rounded-box"
          })
        ])
      ])
    }
  }
}

const BunkerConnect = {
  view: () => {
    const {url, stop} = state.get().alertDraft!.controller!

    return m("div", { class: "card2 flex flex-col items-center gap-4 bg-base-300" }, [
      m("p", "Scan using a nostr signer, or click to copy."),
      m("div", { class: "flex justify-center" }, [
        m(QRCode, { code: url })
      ]),
      m("button", {
        class: "btn btn-neutral btn-sm",
        onclick: stop
      }, "Cancel")
    ])
  }
}

const AlertCreate = {
  oninit: () => {
    state.update(assoc('alertDraft', {
      email: getTagValue('email', state.get().alerts[0]?.tags || []) || "",
      freq: 'daily',
      time: '17:00',
      feedAddress: "",
      bunker: "",
      secret: "",
    }))
  },
  view: () => {
    const {pubkey, alertDraft, alertsLoading} = state.get()
    const {email, feedAddress, freq, time, bunker, secret, controller} = alertDraft!

    const update = (newValues: Partial<AlertValues>) => {
      state.update(assoc('alertDraft', {...alertDraft, ...newValues}))
    }

    const showBunker = (e: Event) => {
      e.preventDefault()

      const controller = new BunkerConnectController({
        onNostrConnect: (response: Nip46ResponseWithResult) => {
          update({
            controller: undefined,
            bunker: controller.broker.getBunkerUrl(),
            secret: controller.broker.params.clientSecret,
          })
        },
      })

      controller.start()

      update({controller})
    }

    const clearBunker = (e: Event) => {
      e.preventDefault()
      update({ bunker: "", secret: "" })
    }

    const submit = async (e: Event) => {
      e.preventDefault()

      state.update(assoc('alertsLoading', true))

      try {
        if (!email.includes("@")) return alert("Please provide a valid email address")

        const address = tryCatch(() => Address.fromNaddr(fromNostrURI(feedAddress)))

        if (!address) return alert("Please provide a valid feed address")
        if (address.kind !== FEED) return alert(`Please provide a valid feed address (kind ${FEED})`)

        const selections = await load({
          relays: INDEXER_RELAYS,
          filters: [{kinds: [RELAYS], authors: [pubkey!, address.pubkey]}],
        })

        const router = Router.get()
        const filters = getIdFilters([address.toString()])
        const scenario = router.merge([
          router.FromRelays(selections.flatMap(e => getRelaysFromList(readList(asDecryptedEvent(e)), RelayMode.Write))),
          router.FromRelays(address.relays),
          router.FromRelays(INDEXER_RELAYS),
        ])
        const relays = scenario.limit(10).getUrls()

        const [event] = await load({relays, filters})

        if (!event) return alert("Sorry, we weren't able to find that feed")

        const feedStrings = getTagValues('feed', event.tags)

        if (feedStrings.length === 0) return alert('At least one feed is required')

        const feeds = removeNil(feedStrings.map(parseJson))

        if (feeds.length < feedStrings.length) return alert("At least one feed is invalid (must be valid JSON)")

        const feedError = feeds.map(validateFeed).find(e => e instanceof ValidationError)

        if (feedError) return alert(`At least one feed is invalid (${feedError.data.toLowerCase()}).`)

        await publishAlert({freq, time, email, feeds, bunker, secret})

        m.route.set("/alerts")
      } catch (error) {
        alert("Failed to create alert. Please try again.")
        console.error('Error creating alert:', error)
      } finally {
        state.update(assoc('alertsLoading', false))
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
          m("div", {class: "w-full flex gap-2"}, [
            m("div", {class: "flex-grow"}, [
              m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Frequency"),
              m("select", {
                value: freq,
                onchange: (e: Event) => update({freq: (e.target as HTMLSelectElement).value}),
                class: "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
              }, [
                m("option", { value: 'daily' }, "Daily"),
                m("option", { value: '0' }, "Weekly on Sunday"),
                m("option", { value: '1' }, "Weekly on Monday"),
                m("option", { value: '2' }, "Weekly on Tuesday"),
                m("option", { value: '3' }, "Weekly on Wednesday"),
                m("option", { value: '4' }, "Weekly on Thursday"),
                m("option", { value: '5' }, "Weekly on Friday"),
                m("option", { value: '6' }, "Weekly on Saturday"),
              ])
            ]),
            m("div", [
              m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Time"),
              m("input", {
                value: time,
                onchange: (e: Event) => update({time: (e.target as HTMLSelectElement).value}),
                type: "time",
                class: "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
              })
            ]),
          ]),
          m("div", [
            m("label", { class: "block text-sm font-medium text-gray-700 mb-1" }, "Feed Address"),
            m("div", { class: "space-y-2" }, [
              m("input", {
                type: "text",
                placeholder: "naddr1...",
                value: feedAddress,
                oninput: (e: InputEvent) => update({feedAddress: (e.target as HTMLInputElement).value}),
                class: "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
              }),
              m("p", { class: "text-sm text-gray-500" }, [
                "Visit ",
                m("a", {
                  href: "https://coracle.social/feeds",
                  target: "_blank",
                  class: "text-purple-600 hover:text-purple-800"
                }, "coracle.social/feeds"),
                " to search for existing feeds or create a new one. Copy the feed address (starts with 'naddr1') and paste it here."
              ])
            ])
          ]),
          controller ?
          m("div", { class: "bg-gray-100 border border-gray-200 rounded-lg p-4 space-y-3" }, [
              m(BunkerConnect)
          ]) :
          m("div", { class: "bg-gray-100 border border-gray-200 rounded-lg p-4 space-y-3" }, [
            m("div", { class: "flex items-center justify-between" }, [
              m("strong", "Connect a Bunker"),
              m("span", {
                class: `flex items-center gap-2 text-sm ${bunker ? 'text-purple-600' : 'text-gray-500'}`
              }, [
                bunker ? "Connected" : "Not Connected"
              ])
            ]),
            m("p", { class: "text-sm text-gray-500" }, [
              "Required for receiving alerts about spaces with access controls. You can get one from your ",
              m("a", {
                class: "text-purple-600 hover:text-purple-800",
                href: 'https://nostrapps.com/#signers',
                target: "_blank",
              }, "remote signer app"),
              "."
            ]),
            bunker ?
              m("button", {
                onclick: clearBunker,
                class: "w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm"
              }, "Disconnect") :
              m("button", {
                onclick: showBunker,
                class: "w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors text-sm"
              }, "Connect")
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
