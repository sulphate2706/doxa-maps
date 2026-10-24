#!/usr/bin/env node
/**
 * check-wall-no-bg-photos — the Wall's store never downloads photos on its own. Headless.
 *
 * Until 2026-09-29 the store "tested" every photo after loading the list: 932 photos, 132 MB, on every
 * visit, whether or not anyone zoomed in (measured: 108–132 image requests in the first 60 s; 0
 * after the fix). The canvas loads only the photos in view, so the store must load none. This runs the
 * REAL store (through Vite, so @map resolves) against a trimmed copy of the live list
 * (fixtures/pray-list-sample.json), with fetch stubbed to serve it and Image stubbed to COUNT every
 * photo request, and asserts:
 *   - no photo is requested by the store, before or after its list has loaded;
 *   - a group with no photo URL gets none (not the stock "no image" photo, which answers 404);
 *   - a group with a photo URL keeps it.
 * Two-sided: the same run with a planted background photo test (the old behaviour, added through the
 * store's own $onAction hook) must fail.
 * EXIT 0 pass · 1 fail
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const LIST = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/pray-list-sample.json'), 'utf8'))
const WAIT_MS = 3500   // the old test's first batches: 3 photos at once, 3 more each second

// ── the stubs ──────────────────────────────────────────────────────────────────────────────────────
const photoRequests = []
globalThis.Image = class { constructor() { this._src = '' }
  set src(u) { this._src = u; if (u) { photoRequests.push(u); setTimeout(() => this.onload && this.onload(), 5) } }
  get src() { return this._src } }
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.fetch = async (url) => {
  if (/\/api\/people-groups\/list/.test(String(url))) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => LIST }
  return { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}), text: async () => '' }
}

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
const { createPinia } = await server.ssrLoadModule('pinia')
const { usePeopleGroupsStore } = await server.ssrLoadModule('/plugin-designs/wall-of-people-groups/src/stores/peopleGroupsStore.js')

/** One run of the real store. `plant` may add the old background test through $onAction. */
async function run(plant = false) {
  photoRequests.length = 0
  const store = usePeopleGroupsStore(createPinia())
  store.profileConfig = {}
  if (plant) {
    store.$onAction(({ name, after }) => {
      if (name === 'fetchFromPrayAPI') after(() => { for (const g of store.peopleGroups.slice(0, 3)) if (g.imageUrl) new Image().src = g.imageUrl })
    })
  }
  await store.fetchPeopleGroups()
  await new Promise((r) => setTimeout(r, WAIT_MS))
  const groups = store.peopleGroups
  const errs = []
  if (!groups.length) errs.push('the store loaded no groups (the stub or the fixture is wrong, so nothing else here means anything)')
  if (photoRequests.length) errs.push(`the store requested ${photoRequests.length} photo(s) on its own; the canvas loads only what is in view`)
  const noUrl = groups.filter((g) => !g.image_url)
  if (!noUrl.length) errs.push('the fixture has no group without a photo URL, so that arm cannot run')
  const bad = noUrl.filter((g) => g.imageUrl)
  if (bad.length) errs.push(`${bad.length} group(s) with no photo URL carry one (e.g. ${bad[0].imageUrl}), so the print shows a broken image instead of its grey box`)
  const lost = groups.filter((g) => g.image_url && g.imageUrl !== g.image_url)
  if (lost.length) errs.push(`${lost.length} group(s) with a photo lost their photo URL`)
  return { errs, groups: groups.length, noUrl: noUrl.length }
}

const fails = []
let real = null
try {
  real = await run(false)
  fails.push(...real.errs)
  const planted = await run(true)
  if (!planted.errs.some((e) => /requested \d+ photo/.test(e))) fails.push('SELF-TEST: a planted background photo test was not caught')
} catch (e) { fails.push('could not run the store: ' + e.message) }
await server.close()

if (fails.length) { console.log('WALL-NO-BG-PHOTOS: FAIL'); for (const f of fails) console.log('  - ' + f); process.exit(1) }
console.log(`WALL-NO-BG-PHOTOS: PASS — the real store loads ${real.groups} groups and requests 0 photos in ${WAIT_MS} ms; the ${real.noUrl} groups without a photo URL get none; a planted background photo test is caught.`)
process.exit(0)
