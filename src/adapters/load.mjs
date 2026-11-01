import { statSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import createNative from "./native.mjs"

const VALUE_FLAGS = new Set(["--runs", "--speckit", "--adapter", "--adapter-opt", "--port"])

/** Parse CLI args: value flags, repeatable --adapter-opt k=v, --no-open, one bare path. */
export function parseArgs(argv) {
  const out = { opts: {}, noOpen: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--no-open") out.noOpen = true
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
