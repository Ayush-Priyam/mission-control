import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { openStop, isWaiting } from "../src/status.mjs"

const stop = (rule) => ({ type: "stop", stage: "qa", rule, detail: "d" })

test("an owner stop waits until stage.start, human.input, run.resume or run.start", () => {
  assert.equal(isWaiting([{ type: "stage.start", stage: "qa" }, stop("human")]), true)
  for (const type of ["stage.start", "human.input", "run.resume", "run.start"]) {
    assert.equal(openStop([stop("human"), { type }]), null, type)
    assert.equal(isWaiting([stop("human"), { type }]), false, type)
  }
})

test("bookkeeping after a stop (run.end, published, progress) does not clear it", () => {
  for (const type of ["run.end", "published", "progress", "stage.end", "session"]) {
    assert.equal(isWaiting([stop("human"), { type, status: "stopped" }]), true, type)
  }
})

test("any other rule is stopped, not waiting; the last stop wins", () => {
  assert.equal(isWaiting([stop("budget")]), false)
  assert.equal(openStop([stop("budget")]).rule, "budget")
  assert.equal(isWaiting([stop("budget"), stop("human")]), true)
  assert.equal(isWaiting([stop("human"), stop("budget")]), false)
  assert.equal(isWaiting([stop(undefined)]), false)
})

test("empty, missing and junk events", () => {
  assert.equal(openStop(null), null)
  assert.equal(isWaiting([]), false)
  assert.equal(isWaiting([null, 7, "x", stop("human")]), true)
})

test("status.mjs has no node: imports", () => {
  assert.doesNotMatch(readFileSync(new URL("../src/status.mjs", import.meta.url), "utf8"), /(?:from\s+|import\s*\(?\s*)["']node:/)
})
