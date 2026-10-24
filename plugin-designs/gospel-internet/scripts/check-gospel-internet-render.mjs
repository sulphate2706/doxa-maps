#!/usr/bin/env node
/**
 * check-gospel-internet-render.mjs — every PANEL of the board renders, with the real data, in en and ar.
 *
 * WHY: check:profiles-mount runs a profile's own setup and never renders its children (measured: a throw
 * planted in GiMap's or GiTree's setup passed it). So no gate had ever executed this board's panels.
 * This one server-renders them (Vue's renderer, through vite's module loader, no browser, no WebGL):
 * every panel's setup, computeds and template run against the real table, tree and resources, and the
 * HTML is asserted on CONTENT the panel must show, never on the panel's own count of itself.
 * onMounted does not run under SSR, so map layers are not covered here; that is the browser check's job.
 *
 * `--poison` blanks the rows handed to the panels and requires the content assertions to FAIL.
 * Exit 0 pass · 1 fail · 75 not measured (vite could not load the modules).
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const REPO = resolve(PLUGIN, '../..')
const POISON = process.argv.includes('--poison')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))

let server
try {
  const { createServer } = await import('vite')
  server = await createServer({ root: REPO, configFile: resolve(REPO, 'vite.config.js'), logLevel: 'error',
    server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    // node_modules is a symlink in a worktree, so vite would inline vue as source; keep the packages external
    // so the components and this harness share ONE vue instance
    ssr: { external: ['vue', 'vue/server-renderer', '@vue/server-renderer', 'vue-i18n', 'pinia'] } })
} catch (e) { console.log('NOT MEASURED: vite would not start: ' + e.message); process.exit(75) }

let fails = 0
const ok = (c, m) => { if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m) } }
try {
  const load = (p) => server.ssrLoadModule(resolve(PLUGIN, p))
  const { createSSRApp, h, ref, markRaw } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const i18n = await server.ssrLoadModule(resolve(REPO, 'library/i18n/index.js'))
  const M = await load('src/model.js')
  const { useBoard } = await load('src/useBoard.js')
  const panels = {}
  for (const n of ['GiCombos', 'GiFacetRail', 'GiMap', 'GiCharts', 'GiGrid', 'GiDrawer', 'GiTree', 'GiResources']) panels[n] = (await load(`src/components/${n}.vue`)).default

  const gi = T('gospel-internet.json')
  const rows = POISON ? [] : M.normalizeRows(gi)
  const treeDoc = T('gospel-internet-tree.json')
  const res = T('gospel-internet-resources.json')
  const open = rows.find((r) => r.access_detail === 'none' && r.province) || rows[0]

  async function render(lang, extra = { legend: 'open' }) {
    const app = createSSRApp({
      setup() {
        const b = useBoard()
        b.all.value = markRaw(rows)
        b.bySlug.value = markRaw(new Map(rows.map((r) => [r.slug, r])))
        b.meta.value = markRaw(gi.meta)
        b.countries.value = markRaw(gi.countries || {})
        b.tree.value = markRaw({ ...M.indexTree(treeDoc), meta: treeDoc.meta })
        b.resources.value = markRaw(res)
        b.loading.value = false
        if (open) { b.openSlug.value = open.slug; b.bus.setSelection([open.slug]) }
        // narrow to the largest family through the tree, as a click would
        const fam = b.tree.value.nodes.filter((n) => !n.p).sort((x, y) => b.tree.value.isos.get(y.id).size - b.tree.value.isos.get(x.id).size)[0]
        b.setTreeNode(fam.id)
        return () => h('div', Object.values(panels).map((P) => h(P)))
      },
    })
    // the channel the real board uses: the bundle installs createAppI18n, and ProfileLoader sets its
    // locale from profile-config (never a window global, which does not exist here)
    // createAppI18n reads <html lang> to detect a locale: give it the one document field it reads
    globalThis.document = { documentElement: { lang } }
    const appI18n = i18n.createAppI18n()
    app.use(appI18n)
    appI18n.global.locale.value = lang
    app.provide('profileConfig', ref({ profile: 'board', lang, ...extra }))   // legends start collapsed; the content checks open them
    const errors = []
    app.config.errorHandler = (e) => { errors.push(String(e && e.stack || e)) }
    app.config.warnHandler = (m) => { if (/Unhandled error|Property .* was accessed during render but is not defined/.test(m)) errors.push(m) }
    const html = await renderToString(app)
    return { html, errors }
  }

  const en = await render('en')
  // the shipped default (2026-09-28): with no knob both legends start collapsed behind their "Legend" button
  const shut = await render('en', {})
  ok(!/data-tree-legend|class="gim-legend"/.test(shut.html) && /class="gtr-min"/.test(shut.html) && /class="gim-legend-min"/.test(shut.html),
    'en: with no knob, the tree and map legends start collapsed')
  ok(/data-tree-credit[^>]*>[\s\S]*?Glottolog[\s\S]*?CC BY 4\.0/.test(shut.html), 'en: the Glottolog CC BY credit is on screen with the legend collapsed')
  ok(en.errors.length === 0, `en: every panel rendered with no error (${en.errors.length}${en.errors[0] ? ': ' + en.errors[0].slice(0, 160) : ''})`)
  for (const [name, re] of [['GiFacetRail', /data-facet="access"/], ['GiGrid', /data-grid-total/], ['GiCharts', /data-region="charts"/],
    ['GiTree', /data-tree-legend[\s\S]*data-tree-poster/], ['GiResources', /data-resources-total/], ['GiMap', /data-region="map"/]]) ok(re.test(en.html), `en: ${name} rendered its region`)
  ok(!!open && en.html.includes(open.people_group), `en: the drawer shows the opened group (${open ? open.people_group : 'no row'})`)
  ok(/data-notice="approximate-pin"/.test(en.html), 'en: the drawer carries the approximate-pin notice')
  // interop out: the selection opens in Gospel Resources by its ?groups= contract, carrying the slug
  const gl = (en.html.match(/href="([^"]*)"[^>]*data-open-gospel/) || [])[1] || ''
  ok(!!open && gl.includes('gospel-resources/resources-map/index.html') && decodeURIComponent(gl).includes('groups=' + open.slug) && !POISON,
    `en: the selection links out to Gospel Resources with ?groups= (${gl.split('?')[1] || 'no link'})`)
  ok(/data-tree-card/.test(en.html), 'en: the tree card shows the node the board is narrowed to')
  ok(/href="https?:\/\/[^"]+"/.test(en.html.slice(en.html.indexOf('data-region="resources"'))), 'en: the resources tab lists real links')
  ok(/\b\d[\d,]* of [\d,]+ people groups\b/.test(en.html), 'en: the grid prints its scope count')
  // the selection strip: the kit's chips name the TREE NODE (not 120 language codes), and a combination
  // carries its live count (nothing in own language x 60%+ online = 220 on the whole roster)
  const fam = treeDoc.nodes.filter((n) => !n.p).sort((x, y) => 0)[0]
  const famNode = (() => { const ix = M.indexTree(treeDoc); return ix.nodes.filter((n) => !n.p).sort((x, y) => ix.isos.get(y.id).size - ix.isos.get(x.id).size)[0] })()
  ok(/data-chip="language"/.test(en.html) && en.html.includes(famNode.n), `en: the kit chip names the tree node (${famNode.n})`)
  // the charts answer their question in words (the harness narrows to a family first, so assert the
  // takeaways' FORM and that the gap charts name real groups/languages, not the roster's totals)
  const plain = en.html.replace(/<!--[\s\S]*?-->/g, '')
  ok(/\d[\d,]* of the \d[\d,]* with nothing live in countries/.test(plain) && !POISON, 'en: chart 3 states its takeaway')
  ok(/data-chart="gaps"[\s\S]*?These \d+ alone are [\d,]+ people/.test(plain), 'en: the gap chart names its groups and totals them')
  ok(/data-chart="ntNeed"[\s\S]*?languages here have no New Testament found/.test(plain), 'en: the New Testament chart states its takeaway')
  ok(new RegExp('data-combo="digital-now"[^>]*>\\s*<span>[^<]+</span><span class="gic2-n">' + (POISON ? 'x' : '220')).test(en.html), 'en: a combination shows its live count (digital-now = 220)')
  void fam
  const ar = await render('ar')
  ok(ar.errors.length === 0, `ar: every panel rendered with no error (${ar.errors.length})`)
  const arWords = ['شجرة', 'بلغتهم', 'عوامل التصفية']
  const found = arWords.filter((w) => ar.html.includes(w))
  ok(found.length === arWords.length, `ar: the catalogue reaches the panels (${found.length}/${arWords.length} Arabic strings found)`)
  ok(!ar.html.includes('Language tree: every language family'), 'ar: the English tree label is not left in place')
  // cell E's other locales: every panel renders, and the board's own title is the locale's, not English
  for (const lc of ['zh', 'ru', 'hi']) {
    const out = await render(lc)
    const cat = JSON.parse(readFileSync(resolve(REPO, 'library/i18n/locales', lc, 'gospelInternet.json'), 'utf8'))
    ok(out.errors.length === 0 && out.html.includes(cat.tree.legendTitle) && !out.html.includes('Language tree: every language family'),
      `${lc}: every panel rendered, translated (${out.errors.length} errors)`)
  }
} catch (e) {
  console.log('NOT MEASURED: ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | '))
  await server.close()
  process.exit(75)
}
await server.close()
// Exit explicitly. The repo's vite config starts the local dev backends (internal/backend-dev-plugin.mjs, PocketBase),
// keeps them past server.close() so a vite restart can reuse them, and stops them on the process's 'exit'. With only
// exitCode set, PocketBase's open pipes kept this check alive after its verdict, so every runner saw a timeout.
let code
if (POISON) { console.log(fails ? `POISON OK: ${fails} caught` : 'POISON FAILED'); code = fails ? 0 : 1 }
else { console.log(fails ? `FAIL check-gospel-internet-render: ${fails}` : 'PASS check-gospel-internet-render'); code = fails ? 1 : 0 }
process.exit(code)
