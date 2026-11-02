import { createHash } from "node:crypto"
import { statSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import createNative from "./native.mjs"

const VALUE_FLAGS = new Set(["--runs", "--speckit", "--adapter", "--adapter-opt", "--port", "--claude-dir", "--codex-dir"])

/** Parse CLI args: value flags, repeatable --adapter-opt k=v, --no-open, --no-claude, --no-codex, one bare path. */
export function parseArgs(argv) {
  const out = { opts: {}, noOpen: false, noClaude: false, noCodex: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--no-open") out.noOpen = true
    else if (a === "--no-claude") out.noClaude = true
    else if (a === "--no-codex") out.noCodex = true
    else if (VALUE_FLAGS.has(a)) {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      if (a === "--adapter-opt") {
        const eq = v.indexOf("=")
        if (eq < 1) throw new Error("--adapter-opt needs k=v")
        out.opts[v.slice(0, eq)] = v.slice(eq + 1)
      } else out[a.slice(2)] = v
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`)
    else if (out.path === undefined) out.path = a
    else throw new Error(`unexpected argument ${a}`)
  }
  return out
}

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const isSpeckitRepo = (p) => isDir(join(p, "specs")) && isDir(join(p, "docs", "intents"))

const native = (runsDir) => createNative({ runsDir })
async function speckit(repo) {
  // Lazy: the spec-kit adapter is only loaded when chosen.
  return (await import("./speckit/index.mjs")).default({ repo })
}

/** Choose and create the adapter from CLI args (without node/script). */
export async function loadAdapter(argv, cwd = process.cwd()) {
  const a = parseArgs(argv)
  if (a.adapter) {
    const mod = await import(pathToFileURL(resolve(cwd, a.adapter)).href)
    const opts = { ...a.opts, createNative }
    opts.runsDir = resolve(cwd, a.runs ?? "runs")
    return mod.default(opts)
  }
  if (a.runs) return native(resolve(cwd, a.runs))
  if (a.speckit) return speckit(resolve(cwd, a.speckit))
  if (a.path) {
    const p = resolve(cwd, a.path)
    return isSpeckitRepo(p) ? speckit(p) : native(p)
  }
  return native(resolve(cwd, "runs"))
}

/**
 * Every adapter the CLI args ask for, as a list: --runs (native), --speckit and --adapter may each be
 * given and all become sources together. With --adapter, --runs is the runs dir handed to that
 * adapter (as loadAdapter does) rather than a separate native source. With none of them, a bare
 * path (spec-kit repo or runs dir) or ./runs.
 */
export async function loadSources(argv, cwd = process.cwd()) {
  const a = parseArgs(argv)
  if (!a.adapter && !a.runs && !a.speckit) return [await loadAdapter(argv, cwd)]
  const out = []
  if (a.adapter) out.push(await loadAdapter(argv, cwd))
  else if (a.runs) out.push(native(resolve(cwd, a.runs)))
  if (a.speckit) out.push(await speckit(resolve(cwd, a.speckit)))
  return out
}

/**
 * The Claude Code source, on by default: sessions under ~/.claude/projects, or --claude-dir <projects dir>.
 * null with --no-claude. Lazy import, so --no-claude never touches the module.
 */
/**
 * Where the usage scan of one Claude projects root persists: one file per root
 * (~/.mission-control/cache/usage-<sha1(root)[:12]>.json), so a second root (the demo, --claude-dir)
 * never overwrites or prunes another root's cache.
 */
export function usageCachePath(home, root) {
  return join(home, ".mission-control", "cache", `usage-${createHash("sha1").update(resolve(root)).digest("hex").slice(0, 12)}.json`)
}

export async function loadClaude(argv, cwd = process.cwd(), home = homedir()) {
  const a = parseArgs(argv)
  if (a.noClaude) return null
  const root = a["claude-dir"] ? resolve(cwd, a["claude-dir"]) : join(home, ".claude", "projects")
  const { create } = await import("../sources/claude-code/index.mjs")
  return create({ root, hooksDir: process.env.MISSION_CONTROL_HOOKS_DIR || join(home, ".mission-control", "hooks"), cachePath: usageCachePath(home, root) })
}

/**
 * The Codex CLI source: rollouts under ~/.codex/sessions, or --codex-dir <sessions dir>. On by default only
 * when that directory exists (most people have no Codex); --codex-dir always turns it on; null with --no-codex.
 */
export async function loadCodex(argv, cwd = process.cwd(), home = homedir()) {
  const a = parseArgs(argv)
  if (a.noCodex) return null
  const root = a["codex-dir"] ? resolve(cwd, a["codex-dir"]) : join(home, ".codex", "sessions")
  if (!a["codex-dir"] && !isDir(root)) return null
  const { create } = await import("../sources/codex/index.mjs")
  return create({ root, hooksDir: process.env.MISSION_CONTROL_HOOKS_DIR || join(home, ".mission-control", "hooks"), cachePath: usageCachePath(home, root) })
}
