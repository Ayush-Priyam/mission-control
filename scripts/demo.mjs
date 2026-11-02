// npm run demo [-- --live]: generate the synthetic examples at the real "now", then serve them.
// A node launcher (not shell syntax) so the hooks dir env var works on every platform.
import { spawn } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const live = process.argv.includes("--live")
const gen = spawn(process.execPath, [join(root, "scripts", "make-demo.mjs"), "--now", String(Date.now()), ...(live ? ["--live"] : [])], { cwd: root, stdio: ["ignore", "pipe", "inherit"] })

let started = false
gen.stdout.on("data", (d) => {
  process.stdout.write(d)
  if (started) return
  started = true
  const server = spawn(process.execPath, [join(root, "bin", "mission-control.mjs"), "--claude-dir", "examples/claude", "--runs", "examples/runs", "--port", "4319"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, MISSION_CONTROL_HOOKS_DIR: join(root, "examples", "hooks") },
  })
  server.on("exit", (code) => { gen.kill(); process.exit(code ?? 0) })
  process.on("SIGINT", () => { server.kill("SIGINT"); gen.kill() })
})
gen.on("exit", (code) => { if (!started) process.exit(code ?? 1) })
