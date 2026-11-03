// Review finding (run 458): the manifest and service worker named icons that did not exist, so the PWA
// could not install and sw.js's precache (cache.addAll) failed. Every file they name must ship.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const pub = (p) => fileURLToPath(new URL(`../web/public${p}`, import.meta.url))

test("every manifest icon exists, at its stated size", () => {
  const m = JSON.parse(readFileSync(pub("/manifest.webmanifest"), "utf8"))
  assert.ok(m.icons.some((i) => i.purpose === "maskable"))
  for (const i of m.icons) {
    assert.ok(existsSync(pub(i.src)), i.src)
    const png = readFileSync(pub(i.src))
    const [w, h] = i.sizes.split("x").map(Number)
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [w, h], i.src)
  }
})

test("every static file the service worker precaches exists", () => {
  const shell = JSON.parse(readFileSync(pub("/sw.js"), "utf8").match(/const SHELL = (\[[^\]]*\])/)[1])
  for (const p of shell.filter((p) => p !== "/")) assert.ok(existsSync(pub(p)), p)
})
