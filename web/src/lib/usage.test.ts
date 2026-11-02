import { describe, expect, it } from "vitest"
import { daysBetween, fillSeries, heatmapGrid, levelOf, rangeDates, shiftDay, todayIn, totalTokens, trendWindow } from "./usage"
import { usageUrl } from "./api"

const day = (d: string, tokens: number, cost = 0) => ({ day: d, in: tokens, out: 0, cacheRead: 0, cacheWrite: 0, cost, sessions: 1, byKey: {} })

describe("range math", () => {
  it("today is the viewer's calendar day, not the UTC one", () => {
    const now = new Date("2026-11-01T20:00:00Z") // 01:30 on Nov 2 in Kolkata
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-11-02")
    expect(todayIn("UTC", now)).toBe("2026-11-01")
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-11-01")
  })

  it("shiftDay crosses month, year and DST boundaries by whole days", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28")
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29")
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01")
    expect(shiftDay("2026-11-01", 1)).toBe("2026-11-02") // US DST ends that day
  })

  it("Day is today, Week the last 7 days, Month the last 30, All unbounded", () => {
    expect(rangeDates("day", "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-02" })
    expect(rangeDates("week", "2026-11-02")).toEqual({ from: "2026-10-27", to: "2026-11-02" })
    expect(rangeDates("month", "2026-11-02")).toEqual({ from: "2026-10-04", to: "2026-11-02" })
    expect(rangeDates("all", "2026-11-02")).toEqual({ to: "2026-11-02" })
    expect(daysBetween(rangeDates("week", "2026-11-02").from!, "2026-11-02")).toHaveLength(7)
    expect(daysBetween(rangeDates("month", "2026-11-02").from!, "2026-11-02")).toHaveLength(30)
  })

  it("daysBetween is inclusive and empty when from is after to", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"])
    expect(daysBetween("2026-03-02", "2026-03-01")).toEqual([])
  })

  it("trend window: Day widens to 14 days so there is a trend to read; All starts at the first day with data", () => {
    expect(trendWindow("day", "2026-11-02", [])).toEqual({ from: "2026-10-20", to: "2026-11-02" })
    expect(trendWindow("week", "2026-11-02", [])).toEqual({ from: "2026-10-27", to: "2026-11-02" })
    expect(trendWindow("all", "2026-11-02", [day("2026-09-30", 1), day("2026-10-02", 1)])).toEqual({ from: "2026-09-30", to: "2026-11-02" })
    expect(trendWindow("all", "2026-11-02", [])).toEqual({ from: "2026-11-02", to: "2026-11-02" })
  })

  it("fillSeries zero-fills missing days and drops days outside the window", () => {
    const out = fillSeries([day("2026-10-30", 5, 1.5), day("2026-11-03", 9)], "2026-10-29", "2026-11-01")
    expect(out.map((d) => [d.day, totalTokens(d), d.cost])).toEqual([
      ["2026-10-29", 0, 0],
      ["2026-10-30", 5, 1.5],
      ["2026-10-31", 0, 0],
      ["2026-11-01", 0, 0],
    ])
  })

  it("usageUrl sends the browser zone and omits an unbounded from", () => {
    expect(usageUrl({ by: "model", from: "2026-10-01", to: "2026-11-02" }, "Asia/Kolkata")).toBe(
      "/api/usage?from=2026-10-01&to=2026-11-02&by=model&tz=Asia%2FKolkata",
    )
    expect(usageUrl({ by: "worktree", to: "2026-11-02" }, "UTC")).toBe("/api/usage?to=2026-11-02&by=worktree&tz=UTC")
  })
})

describe("heatmap bucketing", () => {
  it("26 Sunday-first week columns ending in the week that holds today; future days are marked", () => {
    const g = heatmapGrid([], "2026-11-04") // a Wednesday
    expect(g.weeks).toHaveLength(26)
    expect(g.weeks.every((w) => w.length === 7)).toBe(true)
    expect(g.weeks[0][0].day).toBe("2026-05-10") // Sunday, 25 weeks before the Sunday of today's week
    expect(g.weeks[25][0].day).toBe("2026-11-01")
    expect(g.weeks[25][3]).toMatchObject({ day: "2026-11-04", future: false })
    expect(g.weeks[25][4]).toMatchObject({ day: "2026-11-05", future: true })
  })

  it("puts each day's tokens in its cell and ignores days outside the grid", () => {
    const g = heatmapGrid([day("2026-11-02", 40), day("2026-05-09", 999), day("2026-05-10", 7)], "2026-11-04")
    expect(g.weeks[25][1]).toMatchObject({ day: "2026-11-02", value: 40 })
    expect(g.weeks[0][0]).toMatchObject({ day: "2026-05-10", value: 7 })
    expect(g.total).toBe(47)
    expect(g.activeDays).toBe(2)
  })

  it("labels a month at the first column that starts in it", () => {
    const g = heatmapGrid([], "2026-11-04")
    expect(g.months[0]).toEqual({ col: 0, label: "May" })
    expect(g.months.map((m) => m.label)).toEqual(["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"])
    expect(g.months.find((m) => m.label === "Nov")!.col).toBe(25)
  })

  it("levels: 0 for no use, 1..4 by quartile of the active days so one huge day does not wash out the rest", () => {
    const vals = [10, 20, 30, 40, 50, 60, 70, 80, 10_000]
    const g = heatmapGrid(vals.map((v, i) => day(shiftDay("2026-10-20", i), v)), "2026-11-04")
    const lv = (d: string) => g.weeks.flat().find((c) => c.day === d)!.level
    expect(lv("2026-10-19")).toBe(0)
    expect(lv("2026-10-20")).toBe(1) // 10
    expect(lv("2026-10-28")).toBe(4) // 10,000
    const levels = vals.map((_, i) => lv(shiftDay("2026-10-20", i)))
    expect(new Set(levels)).toEqual(new Set([1, 2, 3, 4]))
    expect([...levels].sort()).toEqual(levels) // monotone in value
  })

  it("levelOf with a single active value is the top level", () => {
    expect(levelOf(0, [5])).toBe(0)
    expect(levelOf(5, [5])).toBe(4)
  })
})
