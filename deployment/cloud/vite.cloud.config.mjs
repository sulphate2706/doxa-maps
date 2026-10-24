// Overlay for the cloud dev server: the repo's own vite.config.js plus what a shared, public
// host needs. Every value comes from the environment (see deployment/cloud/README.md).
import base from '/app/repo/vite.config.js'
import { mergeConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { GATED_PROFILES } from '/app/repo/internal/_tree-name.mjs'

const env = process.env
const SETUP_STATE = '/tmp/rudder-setup.state'   // written by entry.sh: running -> done | failed
const setupState = () => { try { return readFileSync(SETUP_STATE, 'utf8').trim() } catch { return '' } }

// Rudder's setup runs in the background (entry.sh), so the site serves before the engine exists. While it
// runs, /api/rudder answers "starting" (the widget shows "Loading speech model…"; /events is held open so it
// does not retry in a loop). When setup ends, the dev server restarts ONCE: the repo's backend plugin only
// looks for the engine binary at start, and the restart is what starts it. 'pre' puts this ahead of that
// plugin's own "engine offline" answer.
const rudderStarting = {
  name: 'cloud-rudder-starting',
  enforce: 'pre',
  apply: 'serve',
  configureServer(server) {
    if (setupState() !== 'running') return
    server.middlewares.use('/api/rudder', (req, res, next) => {
      if (setupState() !== 'running') return next()
      const status = { engine: 'starting', error: '', audio: 'browser' }
      if ((req.url || '').startsWith('/events')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(status))
    })
    const poll = setInterval(() => {
      if (setupState() === 'running') return
      clearInterval(poll)
      server.config.logger.info(`[rudder] setup ${setupState() || 'ended'}: restarting the dev server to start the engine`)
      server.restart()
    }, 2000)
    server.httpServer?.once('close', () => clearInterval(poll))
  },
}

// ACCESS=public (entry.sh sets DX_PUBLIC_STUDIO=1): Vite owns the public port with no sign-in in front of it.
// - The backend's paths go to admin.mjs, whose gates decide: /cdn/ and /api-prod/api/ public, /pb/ records
//   by PocketBase's own rules, and /pb/_/, _superusers and /admin/ for the admin password.
// - GATED bundles (gatedProfiles, e.g. key-cities) must never reach a public surface. The Studio already leaves
//   them out of its list; here their source and dev pages are refused too, so a typed URL can't load them. So is
//   /__plugin-gallery/registry.json, the raw discovery list for smoke tools: it still names the gated bundles and
//   their profiles, and the Studio itself reads only manifest.json.
// - /__open-in-editor (Vite's own) would start an editor process on this server for a visitor: refused.
const PUBLIC = env.DX_PUBLIC_STUDIO === '1'
const publicGuard = {
  name: 'cloud-public-guard',
  enforce: 'pre',
  apply: 'serve',
  configureServer(server) {
    if (!PUBLIC) return
    server.middlewares.use((req, res, next) => {
      let p = (req.url || '').split('?')[0]
      try { p = decodeURIComponent(p) } catch { /* keep it raw */ }
      const gated = GATED_PROFILES.some((g) => p.includes(`/plugin-designs/${g}/`) || p === `/__leaf/${g}` || p.startsWith(`/__leaf/${g}/`))
      if (!gated && !p.startsWith('/__open-in-editor') && p !== '/__plugin-gallery/registry.json') return next()
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('not found\n')
    })
  },
}

export default async (e) => {
  const b = typeof base === 'function' ? await base(e) : base
  const hmr = env.HMR_CLIENT_PORT
    ? { clientPort: Number(env.HMR_CLIENT_PORT), protocol: env.HMR_PROTOCOL || 'wss' }
    : undefined
  return mergeConfig(b, {
    plugins: [publicGuard, rudderStarting],
    cacheDir: '/tmp/vite-cache',
    server: {
      host: env.VITE_HOST || '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      allowedHosts: true,
      ...(hmr ? { hmr } : {}),
      ...(PUBLIC ? { proxy: { '^/(cdn|api-prod|pb|admin)/': { target: 'http://127.0.0.1:5175', ws: true } } } : {}),
      // Public: the checkout's git internals are not served either (the private history, .git/config). Vite's
      // defaults are restated because setting deny replaces them.
      ...(PUBLIC ? { fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'] } } : {}),
    },
  })
}
