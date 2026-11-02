import { markOk } from "@/lib/freshness"

/**
 * Push from the server (GET /api/events, Server-Sent Events): "changed" when a hook line lands or a live
 * session file grows, "heartbeat" every 15 s. Every polling fetch listens and refetches at once on
 * "changed"; polling stays as the fallback (no EventSource, a proxy that buffers, the server restarting).
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function onServerChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Open the event stream (EventSource reconnects on its own); returns a closer. Heartbeats count for freshness. */
export function connectServerEvents(make?: (url: string) => EventSource): () => void {
  let es: EventSource
  try {
    if (!make && typeof EventSource === "undefined") return () => {} // no push here: polling only
    es = (make ?? ((u: string) => new EventSource(u)))("/api/events")
  } catch {
    return () => {}
  }
  es.addEventListener("heartbeat", () => markOk())
  es.addEventListener("changed", () => {
    markOk()
    for (const fn of [...listeners]) fn()
  })
  return () => es.close()
}
