import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAutostart } from "../src/autostart.mjs"

test("autostart: a per-port LaunchAgent re-running the CLI args with --port and --no-open; off removes it", async () => {
  const home = mkdtempSync(join(tmpdir(), "mc-home-"))
  const label = "dev.mission-control.4359"
  // Running as that agent already: set(true) only rewrites the plist, no launchctl.
  const a = createAutostart({ port: 4359, argv: ["--claude-dir", "/x y/projects"], script: "/mc/bin/mission-control.mjs", home, platform: "darwin", env: { XPC_SERVICE_NAME: label, PATH: "/bin" } })
  assert.deepEqual(await a.set(true), { enabled: true, restart: false })
  const plist = join(home, "Library", "LaunchAgents", `${label}.plist`)
  const text = readFileSync(plist, "utf8")
  for (const s of ["/mc/bin/mission-control.mjs", "<string>--claude-dir</string>", "<string>/x y/projects</string>", "<string>--port</string>", "<string>4359</string>", "<string>--no-open</string>", "<key>SuccessfulExit</key><false/>"]) assert.ok(text.includes(s), s)
  assert.equal(a.status().enabled, true)
  await a.set(false)
  assert.equal(existsSync(plist), false)
  await assert.rejects(createAutostart({ port: 1, argv: [], script: "s", home, platform: "linux" }).set(true))
  // Started by hand: set(true) only writes the agent and asks for the hand-over (no launchctl yet).
  const byHand = createAutostart({ port: 4360, argv: [], script: "/mc/bin/mission-control.mjs", home, platform: "darwin", env: { PATH: "/bin" } })
  assert.deepEqual(await byHand.set(true), { enabled: true, restart: true })
})
