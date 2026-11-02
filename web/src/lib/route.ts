/** v1 run tabs (the v1 Run page, kept reachable until the item page replaces it). */
export type Tab = "chat" | "map" | "board" | "qa" | "diff" | "trace" | "docs"
export const TABS: Tab[] = ["chat", "map", "board", "qa", "diff", "trace", "docs"]

/** Default tab of the v2 item page. Tabs are open-ended (extras add their own), so any simple name parses. */
export const ITEM_TAB = "lanes"
const TAB_NAME = /^[a-z][a-z0-9-]{0,31}$/

export type Route =
  | { view: "home" }
  | { view: "usage" }
  | { view: "project"; key: string }
  | { view: "worktree"; key: string; path: string }
  | { view: "item"; source: string; id: string; tab: string }
  // v1 pages
  | { view: "run"; id: string; tab: Tab }
  | { view: "agent"; id: string; stage: string }
  | { view: "repo"; repo: string }

const dec = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(dec)
  const [view, a, b, c] = parts
  if (view === "usage") return { view: "usage" }
  if (view === "project" && a) return { view: "project", key: a }
  if (view === "worktree" && a && b) return { view: "worktree", key: a, path: b }
  if (view === "item" && a && b) return { view: "item", source: a, id: b, tab: c && TAB_NAME.test(c) ? c : ITEM_TAB }
  if (view === "run" && a) return { view: "run", id: a, tab: TABS.includes(b as Tab) ? (b as Tab) : "map" }
  if (view === "agent" && a && b) return { view: "agent", id: a, stage: b }
  if (view === "repo" && a) return { view: "repo", repo: a }
  return { view: "home" }
}

const enc = encodeURIComponent

export function toHash(r: Route): string {
  switch (r.view) {
    case "home":
      return "#/"
    case "usage":
      return "#/usage"
    case "project":
      return `#/project/${enc(r.key)}`
    case "worktree":
      return `#/worktree/${enc(r.key)}/${enc(r.path)}`
    case "item":
      return `#/item/${enc(r.source)}/${enc(r.id)}/${r.tab}`
    case "run":
      return `#/run/${enc(r.id)}/${r.tab}`
    case "agent":
      return `#/agent/${enc(r.id)}/${enc(r.stage)}`
    case "repo":
      return `#/repo/${enc(r.repo)}`
  }
}
