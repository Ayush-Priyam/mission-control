export type Tab = "chat" | "map" | "board" | "qa" | "diff" | "trace" | "docs"
export const TABS: Tab[] = ["chat", "map", "board", "qa", "diff", "trace", "docs"]

export type Route =
  | { view: "home" }
  | { view: "project"; repo: string }
  | { view: "run"; id: string; tab: Tab }
  | { view: "agent"; id: string; stage: string }

const dec = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(dec)
  const [view, a, b] = parts
  if (view === "project" && a) return { view: "project", repo: a }
  if (view === "run" && a) return { view: "run", id: a, tab: TABS.includes(b as Tab) ? (b as Tab) : "map" }
  if (view === "agent" && a && b) return { view: "agent", id: a, stage: b }
  return { view: "home" }
}

const enc = encodeURIComponent

export function toHash(r: Route): string {
  switch (r.view) {
    case "home":
      return "#/"
    case "project":
      return `#/project/${enc(r.repo)}`
    case "run":
      return `#/run/${enc(r.id)}/${r.tab}`
    case "agent":
      return `#/agent/${enc(r.id)}/${enc(r.stage)}`
  }
}
