#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)

// Hook entry points load only src/hooks.mjs: they run inside Claude Code and must stay fast and silent.
if (argv[0] === "hook") {
  try {
    const { recordHook, defaultHooksDir } = await import("../src/hooks.mjs")
    let raw = ""
    try { raw = readFileSync(0, "utf8") } catch { /* no stdin */ }
    recordHook({ raw, event: argv[1], hooksDir: process.env.MISSION_CONTROL_HOOKS_DIR || defaultHooksDir() })
  } catch { /* never disturb the session */ }
  process.exit(0)
}
if (argv[0] === "hooks" && argv[1] === "install") {
  const { settingsBlock } = await import("../src/hooks.mjs")
  console.log(JSON.stringify(settingsBlock({ script: fileURLToPath(import.meta.url) }), null, 2))
  process.exit(0)
}

const { spawn } = await import("node:child_process")
const { createServer } = await import("../src/server.mjs")
const { loadClaude, loadSources, parseArgs } = await import("../src/adapters/load.mjs")
let args
try { args = parseArgs(argv) } catch (e) {
  console.error(`mission control: ${e.message}`)
  process.exit(2)
}

const rawPort = args.port ?? process.env.MISSION_CONTROL_PORT ?? "4319"
const port = /^\d+$/.test(String(rawPort)) ? Number(rawPort) : NaN
if (!(port >= 0 && port <= 65535)) {
  console.error("mission control: --port needs a number")
  process.exit(2)
}

let adapters
try {
  adapters = await loadSources(argv, process.cwd())
  const claude = await loadClaude(argv, process.cwd())
  if (claude) adapters = [...adapters, claude]
} catch (e) {
  console.error(`mission control: ${e.message}`)
  process.exit(1)
}

let srv
try { srv = await createServer(adapters, { port }) } catch { process.exit(1) }

if (!args.noOpen && process.platform === "darwin") {
  spawn("open", [`http://localhost:${srv.port}`], { stdio: "ignore", detached: true }).on("error", () => {}).unref()
}
