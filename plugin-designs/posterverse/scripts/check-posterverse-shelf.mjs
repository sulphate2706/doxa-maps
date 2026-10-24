#!/usr/bin/env node
/**
 * check-posterverse-shelf.mjs — Posterverse shows exactly its allow-list, never a gated plugin, and its
 * declared `composes` stays in step with its rail.
 *
 * WHY. The Research Gallery's Experimental folder is a deny-list catch-all ("every bundle nobody
 * placed"). Posterverse deliberately is not: copied here, that rule would expose key-cities, which is
 * GATED. The allow-list lives in src/tabs.js; this gate is what keeps it one.
 *
 * WHAT IT ASSERTS (each arm is poisoned by --self-test before a pass is trusted):
 *   A. the Experimental folder starts open, and the rail's rows are exactly the named sets: Posters = upg-100, country-posters, poster-design;
 *      Experimental = wall-of-people-groups, bible-posters, bless-india-posters (poster plugins only). Ids unique,
 *      every row in a declared section.
 *   B. no row names a NEVER bundle (key-cities, the shells themselves), and resolving the built
 *      manifest WITH a key-cities bundle planted in it yields no key-cities row (the real manifest
 *      withholds gated profiles, so without the plant the exclusion would never be exercised).
 *   C. every non-provisional row resolves on the built manifest to the profile it names (a silent
 *      fallback to a leaf is the "composite shown as a flat list" defect), and a row whose bundle is
 *      absent is pruned.
 *   D. posterverse.meta.json `composes` == the bundle/profile of every row whose bundle exists in
 *      plugin-designs/ (two-sided: nothing declared that the rail cannot show, nothing shown undeclared).
 *   E. strings: every locale carries every English key, and every key the shell reads exists in English.
 *   F. a rail label named in LABEL_FOLLOWS equals that plugin's own catalogue title, in every locale.
 *
 * Headless, no browser. Exit 0 pass · 1 fail · 75 not measured (no built manifest).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TAG = 'POSTERVERSE-SHELF'
const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const ROOT = resolve(PLUGIN, '../..')

const EXPECT = {
  posters: ['upg-100', 'country-posters', 'poster-design'],
  experimental: ['wall-of-people-groups', 'bible-posters', 'bless-india-posters'],
}
const GATED = 'key-cities'
// Rows whose plugin is a natural-height page: mounted unpinned so the pane scrolls them. Named, because a
// pinned scroll page traps its own content and nothing else would notice.
const EXPECT_SCROLL = ['bless-india-posters']
// Rail labels that must EQUAL the plugin's own title (vocabulary follows the plugin), per locale:
// row id -> [catalogue area file under library/i18n/locales/<locale>/, key inside it]. Copied, not read at
// runtime: naming the area from the shell would ship the plugin's whole catalogue inside posterverse.js.
const LABEL_FOLLOWS = { 'bless-india-posters': ['blessIndiaPosters.json', 'title'] }

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

export function checkShelf({ SECTIONS, TABS, NEVER, resolveTabs, manifest, meta, bundleExists, STRINGS, pluginTitles = {} }) {
  const errs = []
  const notes = []
  // A. exact membership, per section, in order
  const ids = TABS.map((t) => t.id)
  if (new Set(ids).size !== ids.length) errs.push(`A: duplicate row id in TABS: ${ids.join(', ')}`)
  const sectionKeys = new Set(SECTIONS.map((s) => s.key))
  for (const t of TABS) if (!sectionKeys.has(t.section)) errs.push(`A: row ${t.id} is in undeclared section "${t.section}"`)
  for (const [sec, want] of Object.entries(EXPECT)) {
    const got = TABS.filter((t) => t.section === sec).map((t) => t.id)
    if (!sameList(got, want)) errs.push(`A: section ${sec} rows are [${got.join(', ')}], expected [${want.join(', ')}]`)
  }
  // The Experimental folder starts OPEN: closed, under one short section, it read as an empty caption.
  const exp = SECTIONS.find((g) => g.key === 'experimental')
  if (!exp || !exp.folder || exp.open !== true) errs.push('A: the Experimental folder must be declared folder:true, open:true (closed, it is easy to miss)')
  const scrollRows = TABS.filter((t) => t.scroll).map((t) => t.id)
  if (!sameList(scrollRows, EXPECT_SCROLL)) errs.push(`A: scroll (unpinned) rows are [${scrollRows.join(', ')}], expected [${EXPECT_SCROLL.join(', ')}]`)
  const extra = TABS.filter((t) => !EXPECT[t.section]).map((t) => t.id)
  if (extra.length) errs.push(`A: rows outside the allow-listed sections: ${extra.join(', ')}`)
  // B. never a gated bundle — by declaration and by resolution over the real manifest
  if (!NEVER.has(GATED)) errs.push(`B: NEVER no longer lists ${GATED}`)
  for (const t of TABS) if (NEVER.has(t.bundle) || t.bundle === GATED) errs.push(`B: row ${t.id} names never-shown bundle ${t.bundle}`)
  // The built manifest WITHHOLDS gated profiles (generate-tree), so a real tree never offers key-cities
  // to the resolver. Plant it (shaped like a real row) so the exclusion is exercised on every run: the
  // question is whether Posterverse would show it if the tree ever did carry it.
  const planted = { ...manifest, bundles: [...(manifest.bundles || []).filter((b) => b.bundle !== GATED),
    { bundle: GATED, scriptUrl: `./${GATED}/${GATED}.js`, elements: [`${GATED}-map`], profiles: [{ profile: GATED, element: `${GATED}-map`, isMap: true }] }] }
  for (const r of resolveTabs(planted, () => {})) if (r.bundle === GATED || NEVER.has(r.bundle)) errs.push(`B: resolution produced a ${r.bundle} row`)
  const resolved = resolveTabs(manifest, () => {})
  const inManifest = new Set((manifest.bundles || []).map((b) => b.bundle))
  // C. rows resolve to the profile they name; absent bundles are pruned
  const resolvedIds = new Set(resolved.map((r) => r.id))
  for (const t of TABS) {
    const present = inManifest.has(t.bundle)
    if (!present && resolvedIds.has(t.id)) errs.push(`C: row ${t.id} resolved although ${t.bundle} is not in the manifest`)
    if (present && !t.provisional) {
      const r = resolved.find((x) => x.id === t.id)
      if (!r) errs.push(`C: row ${t.id} did not resolve although ${t.bundle} is in the manifest`)
      else if (r.profile !== t.profile) errs.push(`C: row ${t.id} opens "${r.profile}", not its named profile "${t.profile}"`)
      else if (!r.tag || !r.scriptUrl) errs.push(`C: row ${t.id} resolved without a tag or scriptUrl`)
    }
  }
  // D. composes == the rows whose bundle exists in source
  const composes = Array.isArray(meta.composes) ? meta.composes : []
  const want = TABS.filter((t) => bundleExists(t.bundle, t.profile)).map((t) => `${t.bundle}/${t.profile}`)
  for (const c of composes) if (!want.includes(c)) errs.push(`D: meta composes "${c}", which no existing rail row shows`)
  for (const w of want) if (!composes.includes(w)) errs.push(`D: the rail shows "${w}" but meta.composes does not declare it`)
  if (meta.type !== 'nested-mfe-spa') errs.push(`D: meta type is ${JSON.stringify(meta.type)}, expected "nested-mfe-spa"`)
  // E. strings
  const en = STRINGS.en || {}
  const used = ['lab', 'experimentalSub', 'loading', 'loadFailed', 'manifestHint', 'backToTop',
    'toggleList', 'openViews', 'expandList', 'collapseList', 'collapse', 'home',
    ...SECTIONS.map((s) => s.i18n), ...TABS.map((t) => 'tab.' + t.id),
    ...TABS.filter((t) => t.section !== 'experimental').map((t) => 'sub.' + t.id)]
  for (const k of used) if (!(k in en)) errs.push(`E: the shell reads "${k}", which English does not define`)
  const locales = Object.keys(STRINGS)
  if (locales.length !== 11) errs.push(`E: ${locales.length} locales, expected 11`)
  for (const l of locales) for (const k of Object.keys(en)) {
    const v = STRINGS[l][k]
    if (typeof v !== 'string' || !v.trim()) errs.push(`E: ${l} is missing "${k}"`)
  }
  // F. labels that follow a plugin's own title, per locale
  for (const [id, byLocale] of Object.entries(pluginTitles)) {
    for (const [l, want] of Object.entries(byLocale)) {
      const got = (STRINGS[l] || {})['tab.' + id]
      if (want === undefined) errs.push(`F: ${l}: the plugin's own title for ${id} is missing from its catalogue`)
      else if (got !== want) errs.push(`F: ${l}: tab.${id} is ${JSON.stringify(got)}, the plugin's own title is ${JSON.stringify(want)}`)
    }
  }
  return { errs, notes, counts: { rows: TABS.length, resolved: resolved.length, composes: composes.length, locales: locales.length, keys: Object.keys(en).length } }
}

async function load() {
  const tabs = await import(pathToFileURL(join(PLUGIN, 'src/tabs.js')).href)
  const { STRINGS } = await import(pathToFileURL(join(PLUGIN, 'src/strings.js')).href)
  const meta = JSON.parse(readFileSync(join(PLUGIN, 'posterverse.meta.json'), 'utf8'))
  const { TREE_NAME } = await import(pathToFileURL(join(ROOT, 'internal/_tree-name.mjs')).href)
  const mf = join(ROOT, 'public', TREE_NAME, 'manifest.json')
  const manifest = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : null
  const bundleExists = (b, p) => existsSync(join(ROOT, 'plugin-designs', b, `${p}.vue`))
  const pluginTitles = {}
  for (const [id, [file, key]] of Object.entries(LABEL_FOLLOWS)) {
    pluginTitles[id] = {}
    for (const l of Object.keys(STRINGS)) {
      const f = join(ROOT, 'library/i18n/locales', l, file)
      let v
      try { const j = JSON.parse(readFileSync(f, 'utf8')); v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), j) } catch { v = undefined }
      pluginTitles[id][l] = v
    }
  }
  return { ...tabs, STRINGS, meta, manifest, bundleExists, pluginTitles }
}

function selfTest(base) {
  const clone = (o) => JSON.parse(JSON.stringify(o))
  const cases = [
    ['A: key-cities added to Experimental', (c) => { c.TABS = [...c.TABS, { id: 'key-cities', section: 'experimental', bundle: 'key-cities', profile: 'key-cities' }] }, /^A: section experimental|^B: row key-cities/],
    ['A: the Experimental folder closed again', (c) => { c.SECTIONS = c.SECTIONS.map((g) => g.key === 'experimental' ? { ...g, open: false } : g) }, /^A: the Experimental folder must be/],
    ['A: Bless India Posters dropped', (c) => { c.TABS = c.TABS.filter((t) => t.id !== 'bless-india-posters') }, /^A: section experimental/],
    ['A: Bless India Posters pinned (scroll flag lost)', (c) => { c.TABS = c.TABS.map((t) => t.id === 'bless-india-posters' ? { ...t, scroll: false } : t) }, /^A: scroll \(unpinned\) rows/],
    ['A: a row dropped', (c) => { c.TABS = c.TABS.filter((t) => t.id !== 'wall-of-people-groups') }, /^A: section experimental/],
    ['B: resolver that shows whatever the manifest carries', (c) => { c.resolveTabs = (m) => (m.bundles || []).map((b) => ({ id: b.bundle, bundle: b.bundle, profile: b.bundle, tag: b.bundle, scriptUrl: b.scriptUrl })) }, /^B: resolution produced a key-cities row/],
    ['C: a composite row falls back to a leaf', (c) => { c.manifest = clone(c.manifest); const b = c.manifest.bundles.find((x) => x.bundle === 'my-upg-100-list'); b.profiles = b.profiles.filter((p) => p.profile !== 'upg-100-mfe') }, /^C: row upg-100 opens/],
    ['D: composes drift', (c) => { c.meta = { ...c.meta, composes: c.meta.composes.slice(1) } }, /^D: the rail shows/],
    ['D: composes a ref the rail cannot show', (c) => { c.meta = { ...c.meta, composes: [...c.meta.composes, 'key-cities/key-cities'] } }, /^D: meta composes/],
    ['F: a rail label drifts from the plugin title', (c) => { c.STRINGS = clone(c.STRINGS); c.STRINGS.ar['tab.bless-india-posters'] = 'باركوا الهند: ملصقات' }, /^F: ar: tab\.bless-india-posters is/],
    ['E: a locale loses a key', (c) => { c.STRINGS = clone(c.STRINGS); delete c.STRINGS.ar['tab.upg-100'] }, /^E: ar is missing "tab.upg-100"/],
    ['E: a row without an English label', (c) => { c.STRINGS = clone(c.STRINGS); delete c.STRINGS.en['tab.bible-posters'] }, /^E: the shell reads "tab.bible-posters"/],
  ]
  let bad = 0
  for (const [name, mutate, expect] of cases) {
    const c = { ...base, TABS: [...base.TABS] }
    mutate(c)
    const { errs } = checkShelf(c)
    const hit = errs.some((e) => expect.test(e))
    console.log(`${hit ? 'ok  ' : 'MISS'} self-test: ${name}${hit ? '' : ' — errors were: ' + (errs.join(' | ') || 'none')}`)
    if (!hit) bad++
  }
  const clean = checkShelf(base).errs
  if (clean.length) { console.log(`MISS self-test: the unmutated inputs are not clean: ${clean.join(' | ')}`); bad++ }
  return bad
}

const base = await load()
if (!base.manifest) {
  console.log(`${TAG}: NOT MEASURED — no built manifest (run bun run tree first)`)
  process.exitCode = 75
} else if (process.argv.includes('--self-test')) {
  const bad = selfTest(base)
  console.log(bad ? `${TAG} self-test: FAIL (${bad} arm(s) could not fail)` : `${TAG} self-test: PASS (every arm fails on its planted defect)`)
  process.exitCode = bad ? 1 : 0
} else {
  const { errs, notes, counts } = checkShelf(base)
  for (const n of notes) console.log(n)
  for (const e of errs) console.log('FAIL ' + e)
  const summary = `${counts.rows} rows declared, ${counts.resolved} resolved on the built manifest, ${counts.composes} composes refs, ${counts.keys} keys x ${counts.locales} locales`
  if (errs.length) { console.log(`${TAG}: FAIL (${errs.length}) — ${summary}`); process.exitCode = 1 }
  else if (notes.length) { console.log(`${TAG}: NOT MEASURED — ${summary}`); process.exitCode = 75 }
  else console.log(`${TAG}: PASS — ${summary}`)
}
