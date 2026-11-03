import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Two pages: the dashboard (index.html) and the phone page the remote listener serves (remote.html).
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, "index.html"),
        remote: path.resolve(import.meta.dirname, "remote.html"),
      },
    },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    proxy: { "/api": "http://127.0.0.1:4319" },
    // The trace view imports ../src/trace.mjs, shared with the server, from outside web/.
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
  },
})
