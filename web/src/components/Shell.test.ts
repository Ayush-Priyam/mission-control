import { describe, expect, it } from "vitest"
import type { ProjectNode } from "@/lib/api"
import { crumbs, footerNote } from "./Shell"
import { chipCounts } from "./StatusChips"

describe("shell footer (M5)", () => {
  it("is read-only with no actions, else read-only except your actions", () => {
    expect(footerNote([])).toBe("read-only · local · 127.0.0.1")
    expect(footerNote(undefined)).toBe("read-only · local · 127.0.0.1")
    expect(footerNote(["sign", "say"])).toBe("read-only except your actions · local · 127.0.0.1")
  })
})

const projects = [
  {
    key: "app-1",
    name: "app",
    path: "/w/app",
    worktrees: [{ path: "/w/app-feat", branch: "feat/x", live: false, waiting: false, items: [{ source: "claude-code", id: "s1", title: "Fix login" }] }],
  },
] as unknown as ProjectNode[]

describe("crumbs", () => {
  it("names an item by project, worktree and title, with links up the tree", () => {
    expect(crumbs({ view: "item", source: "claude-code", id: "s1", tab: "lanes" }, projects)).toEqual([
      { label: "home", href: "#/" },
      { label: "app", href: "#/project/app-1" },
      { label: "feat/x", href: `#/worktree/app-1/${encodeURIComponent("/w/app-feat")}` },
      { label: "Fix login" },
    ])
  })
  it("falls back to raw keys before the tree loads", () => {
    expect(crumbs({ view: "project", key: "app-1" }, [])).toEqual([{ label: "home", href: "#/" }, { label: "app-1" }])
    expect(crumbs({ view: "item", source: "native", id: "r1", tab: "lanes" }, []).at(-1)).toEqual({ label: "native · r1" })
  })
})

describe("chipCounts", () => {
  it("shows a dash until the overview loads; done is today's count", () => {
    expect(chipCounts(null, 2)).toEqual({ waiting: null, working: null, stopped: null, done: 2 })
    expect(chipCounts({ counts: { waiting: 1, working: 2, stopped: 3, done: 40 }, needsYou: [] }, 0)).toEqual({ waiting: 1, working: 2, stopped: 3, done: 0 })
  })
})
