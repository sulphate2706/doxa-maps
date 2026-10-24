/**
 * internal/backend-dev-plugin.mjs — `bun run dev` starts the local plugin backends.
 *
 * WHY: some plugins ship to DESKTOP with a local backend (rudder-voice → backend/bin/rudder-engine,
 * run as a Tauri sidecar). In the Plugin Studio the same backend must be running, or the plugin can't
 * be tested in the browser. This plugin starts each built backend with the dev server, forwards its
 * /api/<name>/ routes, and stops it when the dev server stops. A backend that isn't built is skipped
 * with a hint: plugins without a backend never notice this file.
 *
 * ★ ONE BACKEND PER `bun run dev`, SURVIVING VITE RESTARTS. Vite restarts itself whenever vite.config.js
 * or anything it imports changes, and re-runs configureServer. Stopping the backend on every restart and
 * starting a new one at once raced the old process for its port: the new one died with "address already
 * in use" and Rudder showed "engine offline" until `bun run dev` was restarted by hand (measured
 * 2026-09-27, twice in one session). Each backend now lives in a process-wide registry (globalThis — the
 * config module itself is re-imported on a restart): a restart REUSES the running backend, it is stopped
 * only when the dev process exits, and it is restarted (up to 5 times) if it crashes.
 *
 * DEV ONLY (`apply: 'serve'`). A production build never starts or bundles a backend.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync, renameSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { inflateRawSync } from 'node:zlib'
import { resolve } from 'node:path'

// PocketBase, the backend for plugins that need one: the SAME pinned version as the cloud container
// (the repo-root Dockerfile), SHA-256 from the release's checksums.txt. Downloaded on the first
// `bun run dev` into backend/bin (gitignored); its data lives in .pb/dev (gitignored).
const PB_VERSION = '0.40.4'
const PB_SHA256 = {
  linux_amd64: '9042ec818570e79c3628dadcd0a756c1496d9e1173918ec409d133c02f82e5fa',
  linux_arm64: '86095bf8ed9345954f0d2bf0a5fb9b57584ae60b77ebf3b6cd23a8003a3fd418',
  darwin_amd64: '052906521f09f6f23405cd804c930d2b7a1f8eee06d39b85723b5054b2acb4e4',
  darwin_arm64: 'eeb619ea4f8a06421daedb946d133bed269fea334a760941d147f76befc25ebc',
}

// name → how to run it. `route` is proxied to `port` on 127.0.0.1, or to `remote` when that is set.
// `env` is vite's loadEnv (so .env.local counts), falling back to process.env.
export function devBackends(env = process.env) {
  const pbPort = Number(env.DX_PB_PORT || 8090)
  return [
  {
    name: 'rudder-engine',
    bin: 'backend/bin/rudder-engine',
    build: 'cd backend/rudder-engine && go build -o ../bin/rudder-engine .',
    // What a fresh clone is told at startup when this backend is not built: it is OPTIONAL (desktop voice).
    optional: 'optional: Rudder (desktop voice-to-text) is not built, which is fine for the maps. It needs Go 1.22+; see documentation/HOWTO-build-the-desktop-app.md.',
    route: '/api/rudder',
    port: Number(process.env.RUDDER_PORT || 5193),
    env: { RUDDER_PORT: String(process.env.RUDDER_PORT || 5193), RUDDER_NEMO_PORT: String(process.env.RUDDER_NEMO_PORT || 5194) },
    // This server is SUPPOSED to run the engine (a server deployment with the engine switched on): while it
    // is down, the plugin says "not running yet" instead of "runs on your own computer".
    expected: () => process.env.RUDDER_ENGINE === '1' || process.env.RUDDER_AUDIO === 'browser',
    // RUDDER_ENGINE=0 (a server where Rudder is laptop-only, 2026-09-27): never start it, even if a
    // binary built by an earlier engine-on deploy is still there — it would offer to record a server's mic.
    disabled: () => process.env.RUDDER_ENGINE === '0',
  },
  {
    // Hooks off (a hooks dir that never exists): only the migrations in git shape the schema, as in the cloud.
    // DX_PB_URL points this laptop at a shared PocketBase instead (e.g. the cloud pb-dev); none starts here.
    name: 'pocketbase',
    bin: 'backend/bin/pocketbase',
    args: ['serve', '--http', `127.0.0.1:${pbPort}`, '--dir', '.pb/dev', '--migrationsDir', 'backend/pocketbase/pb_migrations', '--hooksDir', '.pb/hooks-off'],
    build: 'it downloads on the next `bun run dev` (or set DX_PB_URL)',
    fetch: fetchPocketBase,
    portEnv: 'DX_PB_PORT',
    route: '/api/pb',
    rewrite: (p) => p.replace(/^\/api\/pb/, '') || '/',
    port: pbPort,
    remote: env.DX_PB_URL || '',
    offline: (res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 503, message: 'PocketBase is not running on this computer (yet). See the dev server log.' }))
    },
  },
  ]
}

async function fetchPocketBase(root, logger) {
  const plat = { 'linux-x64': 'linux_amd64', 'linux-arm64': 'linux_arm64', 'darwin-x64': 'darwin_amd64', 'darwin-arm64': 'darwin_arm64' }[`${process.platform}-${process.arch}`]
  if (!plat) {
    logger.warn(`[pocketbase] no pinned build for ${process.platform}-${process.arch}: put PocketBase ${PB_VERSION} at backend/bin/pocketbase, or set DX_PB_URL`)
    return false
  }
  const name = `pocketbase_${PB_VERSION}_${plat}.zip`
  const dir = resolve(root, 'backend/bin')
  const part = resolve(dir, `.pocketbase.part`)
  logger.info(`[pocketbase] downloading ${name} (first run only)`)
  try {
    mkdirSync(dir, { recursive: true })
    const r = await fetch(`https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${name}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    const sha = createHash('sha256').update(buf).digest('hex')
    if (sha !== PB_SHA256[plat]) throw new Error(`checksum mismatch (${sha}): refusing to use it`)
    writeFileSync(part, unzipOne(buf, 'pocketbase'))   // not every laptop has `unzip`
    chmodSync(part, 0o755)
    renameSync(part, resolve(dir, 'pocketbase'))
    return true
  } catch (e) {
    logger.warn(`[pocketbase] download failed (${e.message}); /api/pb answers 503 until the next \`bun run dev\``)
    return false
  } finally {
    rmSync(part, { force: true })
  }
}

// One file out of a (non-zip64) zip, via its central directory; the zip's SHA-256 was checked before this.
function unzipOne(buf, want) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('not a zip')
  for (let i = 0, p = buf.readUInt32LE(end + 16); i < buf.readUInt16LE(end + 10); i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42)
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === want) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      if (method === 8) return inflateRawSync(data)
      if (method === 0) return data
      throw new Error(`unsupported zip method ${method}`)
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  throw new Error(`${want} not in the zip`)
}

// Another `bun run dev` (another worktree) may already hold the port: say so once instead of crash-looping.
const portInUse = (port) => new Promise((ok) => {
  const s = connect({ host: '127.0.0.1', port }, () => { s.destroy(); ok(true) })
  s.on('error', () => ok(false))
})

// The proxy table for vite's `server.proxy`. SSE (`/events`) streams through unbuffered.
export function devBackendProxy(env = process.env) {
  // ws: a backend may take a WebSocket (rudder's /stream carries the browser's microphone on a server deployment).
  return Object.fromEntries(devBackends(env).map((b) => [b.route, {
    target: b.remote || `http://127.0.0.1:${b.port}`, changeOrigin: !!b.remote, ws: true,
    ...(b.rewrite ? { rewrite: b.rewrite } : {}),
  }]))
}

const REG = (globalThis.__dxDevBackends ||= { procs: new Map(), exitHooked: false, stopping: false })
const isAlive = (name) => { const e = REG.procs.get(name); return !!e && e.child.exitCode === null && e.child.signalCode === null }

function stopAll() {
  REG.stopping = true
  for (const { child } of REG.procs.values()) { try { child.kill('SIGTERM') } catch {} }
}

function start(root, b, logger, restarts = 0) {
  const tag = `[${b.name}]`
  const child = spawn(resolve(root, b.bin), b.args || [], { cwd: root, env: { ...process.env, ...b.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { child, restarts, logger }
  REG.procs.set(b.name, entry)
  // ★ THE FULL LOG GOES TO A FILE; THE TERMINAL GETS WHAT A PERSON MUST ACT ON. PocketBase prints about
  // 230 lines of startup SQL, which scrolled Vite's "➜ Local:" address out of view for a fresh reader of the
  // README. Every line still lands in .pb/logs/<name>.log (gitignored). Errors, warnings and "address already
  // in use" (the line the README and HOWTO tell a reader to watch for before setting DX_PB_PORT) are
  // forwarded exactly as before.
  const logDir = resolve(root, '.pb', 'logs')
  mkdirSync(logDir, { recursive: true })
  const sink = createWriteStream(resolve(logDir, `${b.name}.log`), { flags: 'a' })
  // The first-run "create your first superuser" link is forwarded too: it is a step a person must take,
  // and the HOWTO's admin screen at /api/pb/_/ is unusable on a fresh .pb without it.
  const LOUD = /\b(error|fail(ed|ure)?|panic|fatal|warn(ing)?|refused|denied|in use|cannot|unable|superuser|pbinstall?)\b/i
  const out = (d) => {
    sink.write(d)
    String(d).trim().split('\n').forEach((l) => l && LOUD.test(l) && entry.logger.info(`${tag} ${l}`))
  }
  child.stdout.on('data', out)
  child.stderr.on('data', out)
  child.on('exit', () => sink.end())
  child.on('exit', (code) => {
    if (REG.procs.get(b.name) !== entry) return
    REG.procs.delete(b.name)
    if (REG.stopping) return
    entry.logger.warn(`${tag} exited (${code})`)
    // Crashed on its own: restart it, after its port has had a moment to free up.
    if (entry.restarts < 5) {
      setTimeout(() => {
        if (REG.stopping || REG.procs.has(b.name)) return
        entry.logger.warn(`${tag} restarting (${entry.restarts + 1}/5)`)
        start(root, b, entry.logger, entry.restarts + 1)
      }, 2000)
    }
  })
  logger.info(`${tag} started → ${b.route} on 127.0.0.1:${b.port} (full log: .pb/logs/${b.name}.log)`)
}

export function backendDevPlugin(root, env = process.env) {
  const backends = devBackends(env)
  return {
    name: 'dx-backend-dev',
    apply: 'serve',
    configureServer(server) {
      // ENGINE NOT RUNNING, QUIETLY (R500): with no backend process the proxy answered
      // 500 ECONNREFUSED, which every page showed as console errors. While a backend is down its routes get
      // well-formed answers instead: /events streams ONE status event saying the engine is offline (the
      // plugin renders its own "engine not running" state from it), anything else returns an empty JSON
      // list. Registered here, so it runs before vite's proxy.
      for (const b of backends) {
        server.middlewares.use(b.route, (req, res, next) => {
          if (b.remote || isAlive(b.name)) return next()
          if (b.offline) return b.offline(res)
          const status = { engine: 'offline', expected: !!(b.expected && b.expected()), error: 'The desktop engine is not running.' }
          if ((req.url || '').startsWith('/events')) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
            res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
            return   // held open, so the EventSource does not reconnect in a loop
          }
          // /status answers the same, for a page whose event stream cannot get through (a proxy that buffers).
          if ((req.url || '').startsWith('/status')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(status))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('[]')
        })
      }
      const logger = server.config.logger
      if (!REG.exitHooked) {
        REG.exitHooked = true
        process.once('exit', stopAll)
        process.once('SIGINT', () => { stopAll(); process.exit(0) })
        process.once('SIGTERM', () => { stopAll(); process.exit(0) })
      }
      for (const b of backends) {
        if (b.remote) {
          logger.info(`[${b.name}] not started here: ${b.route} → ${b.remote}`)
          continue
        }
        if (isAlive(b.name)) {
          REG.procs.get(b.name).logger = logger   // log through the restarted server
          logger.info(`[${b.name}] still running → ${b.route} (kept across the dev-server restart)`)
          continue
        }
        if (b.disabled && b.disabled()) {
          logger.info(`[backend] ${b.name} switched off here (${b.name === 'rudder-engine' ? 'RUDDER_ENGINE=0' : 'disabled'})`)
          continue
        }
        const launch = async () => {
          if (b.portEnv && await portInUse(b.port)) {
            logger.warn(`[${b.name}] port ${b.port} is already in use (another \`bun run dev\`?): not started. Set ${b.portEnv} to use another port.`)
            return
          }
          if (!REG.stopping && !isAlive(b.name)) start(root, b, logger)
        }
        if (!existsSync(resolve(root, b.bin))) {
          if (b.fetch) {
            REG.fetching ||= new Set()
            if (REG.fetching.has(b.name)) continue   // a vite restart mid-download: the first one finishes it
            REG.fetching.add(b.name)
            b.fetch(root, logger).then((ok) => { REG.fetching.delete(b.name); if (ok) launch() })
            continue
          }
          // An OPTIONAL backend is a note, not a warning: a stranger's first `bun run dev` line said
          // "rudder-engine not built … go build …" with no word that it is optional or needs Go (upg100's
          // fresh-clone run). A backend without that note keeps the build instruction.
          if (b.optional) logger.info(`[backend] ${b.optional}`)
          else logger.warn(`[backend] ${b.name} not built — its plugin will show "engine offline". Build: ${b.build}`)
          continue
        }
        launch()
      }
    },
  }
}
