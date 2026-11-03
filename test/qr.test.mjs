import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { byteCapacity, encode, toTerminal } from "../src/qr.mjs"

// Reference matrices from segno (ISO/IEC 18004), see test/fixtures/qr-reference.gen.py for provenance.
const ref = JSON.parse(readFileSync(new URL("./fixtures/qr-reference.json", import.meta.url), "utf8"))
const bits = (m) => m.map((r) => r.map((x) => (x ? "1" : "0")).join(""))

test("qr: every reference vector matches bit for bit (versions 1–10, all eight masks, auto mask choice)", () => {
  assert.ok(ref.length >= 28)
  const seenVersions = new Set(), seenMasks = new Set()
  for (const c of ref) {
    const opt = {}
    if (c.version) opt.version = c.version
    if (c.forcedMask !== null) opt.mask = c.forcedMask
    const q = encode(c.text, opt)
    assert.equal(q.version, c.gotVersion, c.text)
    assert.equal(q.mask, c.mask, `mask for ${c.text}`)
    assert.equal(q.size, c.version ? c.version * 4 + 17 : q.size)
    assert.deepEqual(bits(q.modules), c.rows, c.text)
    seenVersions.add(q.version)
    seenMasks.add(q.mask)
  }
  assert.deepEqual([...seenVersions].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(seenMasks.size, 8)
})

test("qr: smallest version that fits; a pairing URL fits; over version 10 throws", () => {
  assert.deepEqual([1, 2, 5, 9, 10].map(byteCapacity), [14, 26, 84, 180, 213])
  assert.equal(encode("x".repeat(14)).version, 1)
  assert.equal(encode("x".repeat(15)).version, 2)
  const url = `https://${"a".repeat(60)}.tail1234.ts.net/pair#t=${"T".repeat(43)}`
  assert.ok(encode(url).version <= 10)
  assert.throws(() => encode("x".repeat(214)), RangeError)
  assert.throws(() => encode("hello", { version: 1, mask: 8 }), RangeError)
})

test("qr: module is pure (no node: imports)", () => {
  const src = readFileSync(new URL("../src/qr.mjs", import.meta.url), "utf8")
  assert.ok(!/from\s+["']node:/.test(src) && !/import\(["']node:/.test(src))
})

test("qr: toTerminal draws two module rows per line with a quiet zone", () => {
  const q = encode("hello")
  const lines = toTerminal(q.modules, { quiet: 2 }).split("\n")
  assert.equal(lines.length, Math.ceil((21 + 4) / 2))
  assert.ok(lines.every((l) => [...l].length === 25))
  assert.ok(lines[0].split("").every((ch) => ch === "█"), "quiet zone is all light")
  // Top-left finder corner is dark: row 2 of the drawing (modules 0..1 at quiet 2) begins after 2 light columns.
  assert.equal([...lines[1]][2], " ")
})
