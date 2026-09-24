import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite"

// Safe{Wallet} loads the app in an iframe and fetches `manifest.json` cross-origin, so the dev/preview servers need
// permissive CORS headers and must allow being framed by Safe{Wallet}.
const safeAppHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
  // Chrome's Private Network Access check: without this, a public origin (e.g. https://app.safe.global) fetching a
  // loopback address like localhost is blocked even with a permissive Access-Control-Allow-Origin.
  "Access-Control-Allow-Private-Network": "true",
  "Content-Security-Policy": "frame-ancestors 'self' https://app.safe.global",
}

// Vite's own CORS middleware and `server.headers` never reach OPTIONS preflights, so answer them here with every
// header set explicitly (paired with `cors: false` below).
function respondToPreflight(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204
      for (const [key, value] of Object.entries(safeAppHeaders)) {
        res.setHeader(key, value)
      }
      res.end()
      return
    }
    next()
  })
}

export default defineConfig({
  // Relative asset URLs, so the build works when served from any subpath.
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "private-network-access-preflight",
      configureServer: respondToPreflight,
      configurePreviewServer: respondToPreflight,
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    cors: false,
    headers: safeAppHeaders,
  },
  preview: {
    cors: false,
    headers: safeAppHeaders,
  },
})
