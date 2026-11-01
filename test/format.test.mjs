import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readJsonl, isRunId, isSessionName, capText } from "../src/format.mjs"

test("readJsonl skips bad lines and returns [] for a missing file", () => {
  const f = join(mkdtempSync(join(tmpdir(), "mc-")), "runs.jsonl")
  writeFileSync(f, '{"a":1}\n{"a":\n{"a":2}\n')
  assert.deepEqual(readJsonl(f), [{ a: 1 }, { a: 2 }])
  assert.deepEqual(readJsonl(f + ".nope"), [])
})

test("isRunId", () => {
  assert.equal(isRunId("20261101-2114"), true)
  for (const s of ["../x", "a/b", ""]) assert.equal(isRunId(s), false)
})

test("isSessionName", () => {
  assert.equal(isSessionName("backend-1.md"), true)
  assert.equal(isSessionName("s.jsonl"), true)
  for (const s of ["../a.md", "a.txt", "a.md/x"]) assert.equal(isSessionName(s), false)
})

test("capText truncates at 200000 and flags it", () => {
  const r = capText(Buffer.alloc(200_001, 97))
  assert.equal(r.text.length, 200000)
  assert.equal(r.truncated, true)
  assert.equal("truncated" in capText(Buffer.from("hi")), false)
})

test("trace.mjs and names.mjs have no node: imports", async () => {
  const { readFileSync } = await import("node:fs")
  for (const f of ["../src/trace.mjs", "../src/names.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8")
    assert.doesNotMatch(src, /(?:from\s+|import\s*\(?\s*)["']node:/, f)
  }
})
