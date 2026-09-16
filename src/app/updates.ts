/**
 * The bridge between the service worker registration (which runs before React
 * exists, in main.tsx) and the strip that offers the update.
 *
 * It is deliberately not a reload. The previous setting swapped a new build in
 * the moment it finished downloading — `registerType: 'autoUpdate'` reloads
 * every open tab on `activated` — which on a deploy day meant the page
 * vanishing from under whoever was half way through entering a trip, on a
 * phone and on a desktop alike. A new build can wait for a tap.
 */

type Apply = () => void

let pending: Apply | null = null
let notify: ((apply: Apply) => void) | null = null

/** Called by the service worker registration when a new build is waiting. */
export function announceUpdate(apply: Apply): void {
  pending = apply
  notify?.(apply)
}

/** Subscribed to by the strip. Fires immediately if an update already waits. */
export function onUpdateReady(listener: (apply: Apply) => void): () => void {
  notify = listener
  if (pending) listener(pending)
  return () => {
    notify = null
  }
}
