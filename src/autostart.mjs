import { execFile } from "node:child_process"
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const run = (args) => new Promise((done) => execFile("launchctl", args, { timeout: 10_000 }, (err) => done(!err)))

/**
 * Start-at-login for one dashboard as a macOS LaunchAgent, labelled by port, so the work and personal
 * dashboards each get their own. `argv` is the CLI's own arguments; the agent re-runs them with --no-open.
 */
export function createAutostart({ port, argv, script, cwd = process.cwd(), home = homedir(), platform = process.platform, env = process.env }) {
  const label = `dev.mission-control.${port}`
  const plist = join(home, "Library", "LaunchAgents", `${label}.plist`)
  const log = join(home, ".mission-control", "logs", `${label}.log`)
  const supported = platform === "darwin"
  const managed = env.XPC_SERVICE_NAME === label
  const domain = `gui/${process.getuid?.() ?? 0}`

  function write() {
    const own = argv.filter((a) => a !== "--no-open")
    const args = [process.execPath, script, ...own, ...(own.includes("--port") ? [] : ["--port", String(port)]), "--no-open"]
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true })
    mkdirSync(join(home, ".mission-control", "logs"), { recursive: true, mode: 0o700 })
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin")}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`)
  }

  return {
    status: () => ({ supported, enabled: supported && existsSync(plist), managed, label }),
    /**
     * On: write the agent and load it. When this process was started by hand, the agent's copy cannot bind
     * the port until this one exits, so `restart` is true and the caller should exit (launchd retries).
     * Off: remove the agent so the next login does not start it; a running copy keeps running until logout.
     */
    async set(on) {
      if (!supported) throw { status: 501, message: "start at login needs macOS" }
      if (!on) {
        try { unlinkSync(plist) } catch { /* already gone */ }
        return { enabled: false, restart: false }
      }
      write()
      if (managed) return { enabled: true, restart: false }
      await run(["bootout", `${domain}/${label}`]) // a stale copy of the job from before; fine when absent
      if (!(await run(["bootstrap", domain, plist]))) throw { status: 500, message: "launchctl bootstrap failed" }
      return { enabled: true, restart: true }
    },
  }
}
