import { describe, expect, it } from "vitest"
import type { ItemSummary, ProjectNode } from "./api"
import { doneToday, filterTree, matchesFilter, paletteResults, rollup, worktreeLabel } from "./tree"

const item = (id: string, status: ItemSummary["status"], extra: Partial<ItemSummary> = {}): ItemSummary => ({
  source: "claude-code",
  id,
  kind: "session",
  title: `title ${id}`,
  harness: "claude-code",
  cwd: "/w/app",
  branch: "main",
  live: status === "working",
  status,
  waiting: status === "waiting",
  startedAt: null,
  updatedAt: "2026-11-02T10:00:00.000Z",
  counts: { lanes: 1, calls: 0, errors: 0 },
  tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  ...extra,
})

const tree = (): ProjectNode[] => [
  {
    key: "app-1",
    name: "app",
    path: "/w/app",
    worktrees: [
      { path: "/w/app", branch: "main", items: [item("a", "working"), item("b", "done")], live: true, waiting: false },
      { path: "/w/app-feat", branch: "feat/login", items: [item("c", "waiting")], live: false, waiting: true },
      { path: "/w/app-old", branch: null, items: [], live: false, waiting: false },
    ],
  },
  {
    key: "shop-2",
    name: "shop",
    path: "/w/shop",
    worktrees: [{ path: "/w/shop", branch: "main", items: [item("d", "failed", { title: "Checkout flow" }), item("e", "stopped")], live: false, waiting: false }],
  },
]

describe("rollup", () => {
  it("needs-you beats working beats failed beats stopped beats done beats idle", () => {
    expect(rollup([item("a", "done"), item("b", "waiting"), item("c", "working")])).toBe("waiting")
    expect(rollup([item("a", "done"), item("c", "working")])).toBe("working")
    expect(rollup([item("a", "stopped"), item("c", "failed")])).toBe("failed")
    expect(rollup([item("a", "stopped"), item("c", "done")])).toBe("stopped")
    expect(rollup([item("a", "idle"), item("c", "done")])).toBe("done")
    expect(rollup([])).toBe("idle")
  })
})

describe("matchesFilter", () => {
  const now = new Date("2026-11-02T18:00:00.000Z")
  it("stopped includes failed; done means done today in local time", () => {
    expect(matchesFilter(item("x", "failed"), "stopped", now)).toBe(true)
    expect(matchesFilter(item("x", "done"), "done", now)).toBe(true)
    expect(matchesFilter(item("x", "done", { updatedAt: "2026-10-20T10:00:00.000Z" }), "done", now)).toBe(false)
    expect(matchesFilter(item("x", "working"), null, now)).toBe(true)
  })
})

describe("doneToday", () => {
  it("counts items finished on the viewer's day", () => {
    const now = new Date("2026-11-02T18:00:00.000Z")
    expect(doneToday(tree(), now)).toBe(1)
    expect(doneToday(tree(), new Date("2026-11-20T12:00:00.000Z"))).toBe(0)
  })
})

describe("filterTree", () => {
  const now = new Date("2026-11-02T18:00:00.000Z")
  it("no query and no filter keeps everything", () => {
    expect(filterTree(tree(), "", null, now)).toHaveLength(2)
  })
  it("a status filter keeps only worktrees with matching items, items narrowed", () => {
    const t = filterTree(tree(), "", "waiting", now)
    expect(t.map((p) => p.key)).toEqual(["app-1"])
    expect(t[0].worktrees.map((w) => w.path)).toEqual(["/w/app-feat"])
  })
  it("the query matches project name, branch or path, case-insensitive", () => {
    expect(filterTree(tree(), "SHOP", null, now).map((p) => p.key)).toEqual(["shop-2"])
    const t = filterTree(tree(), "login", null, now)
    expect(t.map((p) => p.key)).toEqual(["app-1"])
    expect(t[0].worktrees.map((w) => w.branch)).toEqual(["feat/login"])
  })
  it("a project-name hit keeps all its worktrees", () => {
    expect(filterTree(tree(), "app", null, now)[0].worktrees).toHaveLength(3)
  })
})

describe("worktreeLabel", () => {
  it("is the branch, else the folder name", () => {
    expect(worktreeLabel({ path: "/w/app-old", branch: null })).toBe("app-old")
    expect(worktreeLabel({ path: "/w/app", branch: "main" })).toBe("main")
    expect(worktreeLabel({ path: "", branch: null })).toBe("(no folder)")
  })
})

describe("paletteResults", () => {
  it("empty query lists pages, then projects, then needs-you and live items first", () => {
    const r = paletteResults(tree(), "")
    expect(r.slice(0, 2).map((x) => x.label)).toEqual(["Home", "Usage"])
    expect(r.filter((x) => x.kind === "project").map((x) => x.label)).toEqual(["app", "shop"])
    const items = r.filter((x) => x.kind === "item")
    expect(items[0].id).toBe("item:claude-code/c")
    expect(items[1].id).toBe("item:claude-code/a")
  })
  it("matches item titles and ids, and links items to their route", () => {
    const r = paletteResults(tree(), "checkout")
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: "item", label: "Checkout flow", hint: "shop · main", href: "#/item/claude-code/d/lanes", status: "failed" })
  })
  it("keeps each kind together so group headers show once", () => {
    const kinds = paletteResults(tree(), "w").map((x) => x.kind)
    expect(kinds).toContain("worktree")
    const runs = kinds.filter((k, i) => k !== kinds[i - 1])
    expect(runs).toEqual([...new Set(runs)])
  })
  it("caps the list", () => {
    const many: ProjectNode[] = [{ ...tree()[0], worktrees: [{ ...tree()[0].worktrees[0], items: Array.from({ length: 300 }, (_, i) => item(`n${i}`, "done")) }] }]
    expect(paletteResults(many, "title").length).toBeLessThanOrEqual(50)
  })
})
