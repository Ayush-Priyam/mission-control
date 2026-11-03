#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)

// Hook entry points load only src/hooks.mjs: they run inside Claude Code and must stay fast and silent.
if (argv[0] === "hook") {
  try {
    const { recordHook, recordCodexHook, defaultHooksDir } = await import("../src/hooks.mjs")
    let raw = ""
    for (let i = 0; i < 5; i++) {
      try { raw = readFileSync(0, "utf8"); break } catch (e) {
        if (e?.code !== "EAGAIN") break // EAGAIN: stdin pipe not ready yet, try again shortly
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    const hooksDir = process.env.MISSION_CONTROL_HOOKS_DIR || defaultHooksDir()
    if (argv[1] === "codex") recordCodexHook({ raw, hooksDir }) // Codex names the event in its JSON
    else recordHook({ raw, event: argv[1], hooksDir })
  } catch { /* never disturb the session */ }
  process.exit(0)
}
if (argv[0] === "hooks" && argv[1] === "install") {
  const { settingsBlock, codexHooksBlock } = await import("../src/hooks.mjs")
  const block = argv[2] === "codex" ? codexHooksBlock : settingsBlock // `hooks install codex`: the ~/.codex/hooks.json block
  console.log(JSON.stringify(block({ script: fileURLToPath(import.meta.url) }), null, 2))
  process.exit(0)
}

const { spawn } = await import("node:child_process")
const { createServer } = await import("../src/server.mjs")
const { defaultConfigPath } = await import("../src/hidden.mjs")
const { loadClaude, loadCodex, loadSources, parseArgs } = await import("../src/adapters/load.mjs")
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
  const codex = await loadCodex(argv, process.cwd())
  if (codex) adapters = [...adapters, codex]
} catch (e) {
  console.error(`mission control: ${e.message}`)
  process.exit(1)
}

let srv
const { homedir } = await import("node:os")
const { join: joinPath, resolve: resolvePath } = await import("node:path")
// MISSION_CONTROL_HOME: a stand-in home for config.json and the config readers (the demo uses a synthetic one).
const altHome = process.env.MISSION_CONTROL_HOME ? resolvePath(process.env.MISSION_CONTROL_HOME) : null
const home = altHome ?? homedir()
const codexHome = !altHome && process.env.CODEX_HOME ? resolvePath(process.env.CODEX_HOME) : joinPath(home, ".codex")
const { createPrReader } = await import("../src/prs.mjs")
// MISSION_CONTROL_DEMO_PRS: a JSON file standing in for `gh pr list` output (demo only).
const demoPrs = process.env.MISSION_CONTROL_DEMO_PRS
const prs = demoPrs ? createPrReader({ exec: async () => { try { return readFileSync(demoPrs, "utf8") } catch { return null } } }) : createPrReader()
const config = altHome ? joinPath(altHome, ".mission-control", "config.json") : defaultConfigPath()
// The dashboard's own state (renames, pins and the like) sits next to config.json, under the same home.
const stateFile = (name) => joinPath(home, ".mission-control", name)
try {
  srv = await createServer(adapters, {
    port, config, claudeHome: home, codexHome, prs,
    titlesPath: stateFile("titles.json"), marksPath: stateFile("marks.json"), settingsPath: stateFile("settings.json"),
    notifier: process.platform === "darwin",
  })
} catch { process.exit(1) }

if (!args.noOpen && process.platform === "darwin") {
  spawn("open", [`http://localhost:${srv.port}`], { stdio: "ignore", detached: true }).on("error", () => {}).unref()
}
