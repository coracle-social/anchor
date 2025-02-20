import type {SignedEvent} from '@welshman/util'

export type Subscription = {
  address: string
  pubkey: string
  event: SignedEvent
  tags: string[][]
}
