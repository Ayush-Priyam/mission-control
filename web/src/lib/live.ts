import type { LiveLane } from "@/lib/api"

export type LiveGroup = { key: string; source: string; id: string; first: LiveLane; latest: string; lanes: LiveLane[] }

const tsOf = (l: LiveLane) => l.nowDoing?.ts ?? l.startedAt ?? l.updatedAt ?? ""

/** Live lanes grouped by item: newest activity first, each item's lanes newest first. */
export function groupLive(lanes: LiveLane[]): LiveGroup[] {
  const m = new Map<string, LiveLane[]>()
  for (const l of lanes) {
    const k = `${l.source}/${l.id}`
    m.set(k, [...(m.get(k) ?? []), l])
  }
  return [...m.entries()]
    .map(([key, ls]) => {
      const sorted = [...ls].sort((a, b) => tsOf(b).localeCompare(tsOf(a)))
      return { key, source: sorted[0].source, id: sorted[0].id, first: sorted[0], latest: tsOf(sorted[0]), lanes: sorted }
    })
    .sort((a, b) => b.latest.localeCompare(a.latest))
}

/**
 * A command or call summary, short enough to scan: no `cd …;` / `cd … &&` prefixes, absolute paths
 * cut to their last two parts, 40-character hashes to 7, whitespace collapsed, at most 60 characters.
 */
export function shortCommand(s: string, max = 60): string {
  let t = s.replace(/\s+/g, " ").trim()
  for (;;) {
    const n = t.replace(/^cd\s+\S+\s*(&&|;)\s*/, "")
    if (n === t) break
    t = n
  }
  t = t.replace(/(^|[\s"'=:(])(\/[^\s"'/]+){3,}\/?/g, (whole, lead: string) => {
    const parts = whole.slice(lead.length).split("/").filter(Boolean)
    return `${lead}…/${parts.slice(-2).join("/")}`
  })
  t = t.replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, "$1")
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INJECTED = /^(<[a-z-]+>|caveat:|\[request interrupted)/i

/** An item's title for a list; a UUID, its own id, empty or harness-injected text becomes "Untitled session · <project> · <HH:MM>". */
export function itemTitle({ title, id, project, ts }: { title: string | null | undefined; id: string; project: string | null | undefined; ts: string | null | undefined }): string {
  const t = (title ?? "").trim()
  if (t && t !== id && !UUID.test(t) && !INJECTED.test(t)) return t
  const d = ts ? new Date(ts) : null
  const time = d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" }) : ""
  return ["Untitled session", project, time].filter(Boolean).join(" · ")
}
