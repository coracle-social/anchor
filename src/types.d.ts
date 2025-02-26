declare module 'succinct-async' {
  export function instrument<T extends (...args: any[]) => any>(n: string, f: T): T
  export const succinctAsyncConfig: any
}
