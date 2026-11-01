#!/usr/bin/env node
import { spawn } from "node:child_process"
import { createServer } from "../src/server.mjs"
import { loadAdapter, parseArgs } from "../src/adapters/load.mjs"

const argv = process.argv.slice(2)
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

let adapter
try { adapter = await loadAdapter(argv, process.cwd()) } catch (e) {
  console.error(`mission control: ${e.message}`)
  process.exit(1)
}

let srv
try { srv = await createServer(adapter, { port }) } catch { process.exit(1) }

if (!args.noOpen && process.platform === "darwin") {
  spawn("open", [`http://localhost:${srv.port}`], { stdio: "ignore", detached: true }).on("error", () => {}).unref()
}
