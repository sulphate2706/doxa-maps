#!/usr/bin/env node
// check:poster-sections — the Poster Sections panel's choices reach the element unchanged.
//   For every choice the panel offers (type, one region or All regions, each language, collapsed or open, 1-5 per
//   row), the tags src/embed.js builds, read back through the ELEMENT's own attribute reader (posterSectionConfig),
//   give exactly those choices; "All regions" is one section per region, each once; the snippet's script and tags
//   are the same tags the page renders.
//   PRESETS: poster-sections.instances.json has, per poster type, exactly "<prefix>-all" + one preset per region its
//   adapter's scopes() returns, no more, no fewer. So a region the data no longer has (a stale "other") or a new one
//   cannot drift from the presets. A type whose file is NOT on the tree must have no presets at all (its pages would
//   only say "No posters"): 'upg100-list' is listed once its type file is on the tree.
//   PAGES: the built preset pages (public/<tree>/poster-sections/poster-sections/<id>/) are exactly the presets: the tree
//   generator writes a page per preset but never deletes one, so a dropped preset would leave a stale page behind.
// --self-test: a builder that drops `columns`, one that drops `collapsed`, one that repeats a region under All, and a
// presets file with a region the type does not have must each FAIL.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// the site's languages = the catalogue's locale folders (library/i18n/index.js needs Vite's import.meta.glob)
const LOC = join(dirname(fileURLToPath(import.meta.url)), '../../../library/i18n/locales')
const SUPPORTED_LOCALES = readdirSync(LOC).filter((d) => statSync(join(LOC, d)).isDirectory()).sort()
import { posterSectionConfig } from '../../../library/elements/posterSectionConfig.js'
import * as real from '../src/embed.js'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const PRESETS = JSON.parse(readFileSync(join(ROOT, 'plugin-designs/poster-sections/poster-sections.instances.json'), 'utf8'))
// poster type → [preset id prefix, the file that defines the type's adapter (its default export has scopes())]
const TYPES = { country: ['countries', 'library/components/poster/types/countryPosterType.js'], 'upg100-list': ['upg100', 'plugin-designs/my-upg-100-list/data/upg100-poster-type.js'] }

// Each type's scopes(), loaded through Vite (the adapters import through the @map alias).
async function loadScopes() {
  const { createServer } = await import('vite')
  const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@map': join(ROOT, 'library') } } })
  const out = {}
  try {
    for (const [type, [, file]] of Object.entries(TYPES)) {
      if (!existsSync(join(ROOT, file))) { out[type] = null; continue }
      const a = (await server.ssrLoadModule(join(ROOT, file))).default
      out[type] = a.scopes()
    }
  } finally { await server.close() }
  return out
}

function presetArm(presets, scopesByType) {
  const fails = []
  for (const [type, [prefix]] of Object.entries(TYPES)) {
    const scopes = scopesByType[type]
    const ids = presets.instances.filter((i) => i.props && i.props.type === type).map((i) => i.id)
    if (scopes == null) {   // the type's file is not on this tree: a preset of it could only say "No posters"
      if (ids.length) fails.push(`presets for "${type}" exist (${ids.join(', ')}) but its type is not on this tree, so their pages would show no posters`)
      continue
    }
    const want = [`${prefix}-all`, ...scopes.map((s) => `${prefix}-${s}`)].sort()
    const have = [...ids].sort()
    const extra = have.filter((x) => !want.includes(x)), missing = want.filter((x) => !have.includes(x))
    if (extra.length || missing.length) fails.push(`presets for "${type}" differ from its scopes(): extra ${extra.join(', ') || '-'}; missing ${missing.join(', ') || '-'}`)
    for (const i of presets.instances.filter((x) => x.props && x.props.type === type && x.id !== `${prefix}-all`)) {
      if (i.id !== `${prefix}-${i.props.scope}`) fails.push(`preset "${i.id}" shows scope "${i.props.scope}"`)
    }
  }
  if (!presets.instances.some((i) => i.id === 'configure' && i.props && i.props.configure === true)) fails.push('no "configure" preset')
  return fails
}

// The built preset pages, when a tree is built: every folder under poster-sections/poster-sections/ that holds a page.
function builtPages() {
  const pub = join(ROOT, 'public')
  if (!existsSync(pub)) return null
  for (const tree of readdirSync(pub)) {
    const dir = join(pub, tree, 'poster-sections', 'poster-sections')
    if (existsSync(dir)) return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'index.html')))
  }
  return null
}
function pagesArm(presets, pages) {
  if (pages == null) return []
  const ids = presets.instances.map((i) => i.id)
  const stale = pages.filter((p) => !ids.includes(p)), missing = ids.filter((i) => !pages.includes(i))
  return stale.length || missing.length ? [`built preset pages differ from the presets: stale ${stale.join(', ') || '-'}; missing ${missing.join(', ') || '-'} (delete a dropped preset's page; rebuild the tree for a new one)`] : []
}

const SCOPES = ['africa', 'asia', 'europe', 'latin-america-and-caribbean', 'middle-east', 'north-america-and-non-spanish-caribbean', 'oceania', 'other']
const fake = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs })

function arms(embed) {
  const fails = []
  for (const scope of ['', ...SCOPES]) for (const locale of SUPPORTED_LOCALES) for (const collapsed of [false, true]) for (const columns of [1, 2, 3, 4, 5]) {
    const choices = { type: 'country', scope, scopes: SCOPES, locale, collapsed, columns, assetsBase: 'https://example.org/dx-maps/assets' }
    const tags = embed.sectionAttrs(choices)
    const want = scope ? [scope] : SCOPES
    if (tags.map((a) => a.scope).join() !== want.join()) { fails.push(`scope "${scope || 'All'}": sections ${tags.map((a) => a.scope).join()}`); continue }
    for (const a of tags) {
      const c = posterSectionConfig(fake(a))
      const bad = [c.type !== 'country' && 'type', c.locale !== locale && 'locale', c.collapsed !== collapsed && 'collapsed',
        c.columns !== columns && 'columns', c.assetsBase !== choices.assetsBase && 'assets-base', c.collapsible !== true && 'collapsible'].filter(Boolean)
      if (bad.length) { fails.push(`${a.scope}/${locale}/${collapsed ? 'shut' : 'open'}/${columns}: the element reads back a different ${bad.join(', ')}`); break }
    }
    if (fails.length > 3) return fails
  }
  const snip = embed.embedSnippet({ type: 'country', scope: '', scopes: SCOPES, locale: 'ar', collapsed: true, columns: 3 }, 'https://example.org/dx-maps/poster-sections/poster-sections.js')
  const lines = snip.split('\n')
  if (lines[0] !== '<script src="https://example.org/dx-maps/poster-sections/poster-sections.js"></script>') fails.push(`snippet: first line is not the bundle script: ${lines[0]}`)
  if (lines.length !== SCOPES.length + 1 || !lines.slice(1).every((l, i) => l === `<dxm-poster-section type="country" scope="${SCOPES[i]}" locale="ar" collapsed columns="3"></dxm-poster-section>`)) fails.push(`snippet: the tags are not one per region with the chosen attributes:\n${snip}`)
  return fails
}

const SCOPES_BY_TYPE = await loadScopes()

if (process.argv.includes('--self-test')) {
  const mutants = {
    'drops columns': { ...real, sectionAttrs: (c) => real.sectionAttrs(c).map(({ columns, ...a }) => a) },
    'drops collapsed': { ...real, sectionAttrs: (c) => real.sectionAttrs(c).map(({ collapsed, ...a }) => a) },
    'repeats a region under All': { ...real, sectionAttrs: (c) => { const r = real.sectionAttrs(c); return c.scope ? r : [...r, r[0]] } },
  }
  let ok = true
  const stale = { ...PRESETS, instances: [...PRESETS.instances, { id: 'countries-atlantis', props: { type: 'country', scope: 'atlantis' } }] }
  const pg = pagesArm(PRESETS, [...PRESETS.instances.map((i) => i.id), 'countries-atlantis'])
  console.log(`  mutant "a built page for a preset that no longer exists": ${pg.length ? 'FAILS (good)' : 'PASSES (bad)'}`)
  if (!pg.length) ok = false
  const pf = presetArm(stale, SCOPES_BY_TYPE)
  console.log(`  mutant "a preset for a region the type does not have": ${pf.length ? 'FAILS (good)' : 'PASSES (bad)'}`)
  if (!pf.length) ok = false
  for (const [name, m] of Object.entries(mutants)) {
    const f = arms(m)
    console.log(`  mutant "${name}": ${f.length ? 'FAILS (good)' : 'PASSES (bad)'}`)
    if (!f.length) ok = false
  }
  console.log(ok ? 'POSTER-SECTIONS SELF-TEST: PASS — every mutant fails the check.' : 'POSTER-SECTIONS SELF-TEST: FAIL')
  process.exit(ok ? 0 : 1)
}
const fails = [...arms(real), ...presetArm(PRESETS, SCOPES_BY_TYPE), ...pagesArm(PRESETS, builtPages())]
const measured = Object.entries(SCOPES_BY_TYPE).filter(([, v]) => v).map(([k, v]) => `${k} ${v.length}`).join(', ')
if (fails.length) { console.log(`POSTER-SECTIONS: FAIL (${fails.length})`); fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1) }
console.log(`POSTER-SECTIONS: PASS — every panel choice (${SCOPES.length + 1} region choices × ${SUPPORTED_LOCALES.length} languages × open/collapsed × 5 per row) reads back through the element unchanged; All regions = one section per region; the snippet is the script + those tags; presets = each type's scopes() + all (${measured}).`)
