import {remove} from '@welshman/lib'
import {subscribe, SubscriptionEvent, SubscribeRequestWithHandlers} from '@welshman/net'
import {SignedEvent} from '@welshman/util'
import { CronExpressionParser } from 'cron-parser';

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
  const interval = CronExpressionParser.parse(cronString, { tz: 'UTC' });

  return (n: number): Date => {
    const now = new Date();
    let date: Date;

    if (n >= 0) {
      date = interval.prev().toDate();
      for (let i = 0; i <= n; i++) {
        date = interval.next().toDate();
      }
    } else {
      date = interval.next().toDate();
      for (let i = 0; i < Math.abs(n); i++) {
        date = interval.prev().toDate();
      }
    }

    return date;
  };
}
