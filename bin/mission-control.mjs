#!/usr/bin/env node
import { createServer } from "../src/server.mjs"

const i = process.argv.indexOf("--port")
const port = i > -1 ? Number(process.argv[i + 1]) : 4319
const adapter = { name: "native", listRuns: async () => [], getRun: async () => null, getSession: async () => null }
createServer(adapter, { port }).catch(() => process.exit(1))
