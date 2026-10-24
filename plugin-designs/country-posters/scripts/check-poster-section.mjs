#!/usr/bin/env node
// check:poster-section — the reusable poster section (<dxm-poster-section>) and the lift behind it.
//   A. the TYPE REGISTRY: 'country' is registered, an unknown type is null, a plugin can register its own.
//   B. SCOPES: DX Life's /regions slugs (africa … oceania) each resolve; every spelling of a region (its
//      slug, its API value, its English name) resolves to the same countries; the scopes cover all countries once.
//   C. India through the type, by default: its whole-country POSTER card shows the withheld sentence; its ROWS are
//      rejected with it, no records fetched.
//   D. the ELEMENT's attributes map to its config (collapsible on by default, collapsible="false", collapsed).
//   E. THE LIFT: every name PosterSection.vue's template uses is injected from the wall (a section never reads
//      something its wall does not provide).
// --self-test: a registry without 'country', a region key without "&" → "and", and a section template that uses a
// name it does not inject must each FAIL. Loaded through Vite (the @map alias), like check:poster-wall-host-seams.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// 'other' dropped: the region re-derive from live wagf_region emptied the "Other" bucket (every country now carries a
// real region), so the /regions/other scope resolves to zero countries and is no longer one of the covering scopes.
const DXL = ['africa', 'asia', 'europe', 'latin-america-and-caribbean', 'middle-east', 'north-america-and-non-spanish-caribbean', 'oceania']

async function arms({ types, country, element, sectionSrc, viewSrc, cs }) {
  const fails = []
  // A
  if (!types.posterTypeNames().includes('country')) fails.push("A: the registry has no 'country' type")
  if (await types.posterType('no-such-type') !== null) fails.push('A: an unknown type is not null')
  types.registerPosterType('gate-fixture', { items: () => [{ id: 'x' }], title: () => 'X', actions: () => ({}) })
  if (!(await types.posterType('gate-fixture'))) fails.push('A: a registered type cannot be found')
  // B
  const data = JSON.parse(readFileSync(join(ROOT, 'library/data/country-posters.json'), 'utf8')).countries
  const seen = new Map()
  for (const k of DXL) {
    const ids = country.items(k, 'en').map((c) => c.id)
    if (!ids.length) fails.push(`B: scope "${k}" (a DX Life /regions slug) shows no countries`)
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1)
  }
  const once = data.filter((c) => seen.get(c.id) === 1).length
  if (once !== data.length) fails.push(`B: the scopes cover ${once} of ${data.length} countries exactly once`)
  for (const [a, b, c] of [['latin-america-and-caribbean', 'latin_america_&_caribbean', 'Latin America & Caribbean'], ['middle-east', 'middle_east', 'Middle East']]) {
    const s = (x) => country.items(x, 'en').map((r) => r.id).join()
    if (!(s(a) && s(a) === s(b) && s(b) === s(c))) fails.push(`B: "${a}" / "${b}" / "${c}" do not resolve to the same countries`)
  }
  // C
  const ind = country.items('asia', 'en').find((c) => c.iso3 === 'IND')
  if (!ind) fails.push('C: India is not in the asia scope')
  else {
    let fetched = 0
    const act = country.actions({ assetsBase: () => '', apiBase: () => { fetched++; return '' }, lang: () => 'en', profileConfig: null, t: (k) => k })
    if (act.unsupported(ind) !== 'messages.countryPosterTooMany') fails.push("C: India's whole-country poster card does not show the withheld sentence by default (it is not released)")
    let why = ''
    try { await act.records(ind); why = 'resolved' } catch (e) { why = e && (e.i18nKey || e.message) }
    if (!/countryPosterTooMany/.test(String(why))) fails.push(`C: withheld India's rows are not withheld (${why})`)
    if (fetched) fails.push('C: withheld India fetched records')
  }
  // C2. THE PREVIEW, under Vite (import.meta.env.DEV is true here, as on the pilot's dev server): DEV MODE ALONE (the
  //     global set by the dev bootstrap) does NOT open India: the pilot shows what the release shows. Only with the
  //     explicit opt-in too (?preview=india, or localStorage 'dxm-preview') does the poster open, at 60x96; its rows
  //     stay withheld; without the global, withheld.
  const was = globalThis.DXM_PREVIEW_UNRELEASED
  const loc = Object.getOwnPropertyDescriptor(globalThis, 'location'), ls = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const setLoc = (search) => Object.defineProperty(globalThis, 'location', { value: { search }, configurable: true, writable: true })
  const setLs = (v) => Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (k === 'dxm-preview' ? v : null) }, configurable: true, writable: true })
  try {
    globalThis.DXM_PREVIEW_UNRELEASED = true
    setLoc(''); setLs(null)
    if (!cs.posterWithheld({ iso3: 'IND' }) || cs.largeSheet({ iso3: 'IND' })) fails.push('C2: dev mode ALONE (no opt-in) opens India: the pilot would show the withheld poster')
    setLs('india')
    if (cs.posterWithheld({ iso3: 'IND' })) fails.push("C2: localStorage 'dxm-preview'='india' does not open the preview")
    setLs(null); setLoc('?lang=en&preview=india')
    const big = cs.largeSheet({ iso3: 'IND' })
    if (cs.posterWithheld({ iso3: 'IND' }) || !big || big.format !== '60x96') fails.push(`C2: in a DEV preview India's poster does not open at 60x96 (${big && big.format})`)
    if (!cs.rowsWithheld({ iso3: 'IND' })) fails.push("C2: the preview also released India's rows")
    delete globalThis.DXM_PREVIEW_UNRELEASED
    if (!cs.posterWithheld({ iso3: 'IND' })) fails.push('C2: without the preview global India is not withheld')
  } finally {
    if (was === undefined) delete globalThis.DXM_PREVIEW_UNRELEASED; else globalThis.DXM_PREVIEW_UNRELEASED = was
    if (loc) Object.defineProperty(globalThis, 'location', loc); else delete globalThis.location
    if (ls) Object.defineProperty(globalThis, 'localStorage', ls); else delete globalThis.localStorage
  }
  // D
  const fake = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs })
  const d0 = element.posterSectionConfig(fake({ scope: 'africa' }))
  if (!(d0.type === 'country' && d0.scope === 'africa' && d0.collapsible === true && d0.collapsed === false)) fails.push(`D: defaults wrong ${JSON.stringify(d0)}`)
  if (element.posterSectionConfig(fake({ collapsible: 'false' })).collapsible !== false) fails.push('D: collapsible="false" does not turn collapsing off')
  if (element.posterSectionConfig(fake({ collapsed: '' })).collapsed !== true) fails.push('D: collapsed does not start the section shut')
  // min-card-px: absent = no key (the wall's own default); an integer 80..600 is kept; anything else is dropped.
  if ('minCardPx' in d0) fails.push('D: no min-card-px still sets minCardPx')
  if (element.posterSectionConfig(fake({ 'min-card-px': '150' })).minCardPx !== 150) fails.push('D: min-card-px="150" is not kept')
  if ('minCardPx' in element.posterSectionConfig(fake({ 'min-card-px': '50' }))) fails.push('D: min-card-px="50" (below 80) is kept')
  // show-header: absent = no key (shown, every current host unchanged); "false" = showHeader false; any other value = shown.
  if ('showHeader' in d0) fails.push('D: no show-header still sets showHeader')
  if (element.posterSectionConfig(fake({ 'show-header': 'false' })).showHeader !== false) fails.push('D: show-header="false" does not hide the head')
  if ('showHeader' in element.posterSectionConfig(fake({ 'show-header': '' }))) fails.push('D: show-header="" hides the head')
  // card-action: absent or an unknown value = no key ("Show on map"); "dashboard" = cardAction 'dashboard'.
  if ('cardAction' in d0) fails.push('D: no card-action still sets cardAction')
  if (element.posterSectionConfig(fake({ 'card-action': 'dashboard' })).cardAction !== 'dashboard') fails.push('D: card-action="dashboard" is not kept')
  if ('cardAction' in element.posterSectionConfig(fake({ 'card-action': 'map' }))) fails.push('D: an unknown card-action is kept')
  // F: the view passes show-header to the wall, and a headless section can neither collapse nor start shut.
  const view = String(viewSrc || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '')
  if (!/:section-heads="showHeader"/.test(view)) fails.push('F: PosterSectionView does not pass showHeader to the wall (section-heads)')
  if (!/const collapsible\s*=\s*computed\([^\n]*showHeader/.test(view)) fails.push('F: a headless section can still collapse')
  if (!/const startCollapsed\s*=\s*computed\([^\n]*showHeader/.test(view)) fails.push('F: a headless section can still start shut')
  // F: card-action reaches the wall's headerAction seam, and the click leaves the element as a bubbling, composed,
  // cancelable dxm-poster-dashboard (the host's PosterSlot listens on an ancestor, outside the shadow root).
  if (!/:header-action="headerAction"/.test(view) || !/@header-action="onHeaderAction"/.test(view)) fails.push('F: card-action does not reach the wall (header-action)')
  if (!/DASHBOARD_EVENT\s*=\s*'dxm-poster-dashboard'/.test(view)) fails.push('F: the dashboard event is not named dxm-poster-dashboard')
  if (!/new CustomEvent\(DASHBOARD_EVENT,\s*\{\s*bubbles:\s*true,\s*composed:\s*true,\s*cancelable:\s*true/.test(view)) fails.push('F: dxm-poster-dashboard is not bubbling + composed + cancelable')
  // E
  const tpl = (sectionSrc.match(/<template>([\s\S]*)<\/template>\s*$/) || ['', ''])[1].replace(/<!--[\s\S]*?-->/g, '')
  const injected = new Set(((sectionSrc.match(/const \{([\s\S]*?)\} = inject\(POSTER_WALL_CTX\)/) || ['', ''])[1]).split(/[\s,]+/).filter(Boolean))
  const used = new Set()
  for (const m of tpl.matchAll(/(?:[:@]|v-[a-z.-]+)[\w.-]*="([^"]*)"|\{\{([^}]*)\}\}/g)) {
    for (const e of [m[1], m[2]]) { if (!e) continue
      for (const id of e.replace(/'[^']*'|`[^`]*`/g, '').matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)/g)) used.add(id[1]) }
  }
  const local = new Set(['sec', 'z', 'item', 'n', 's', 'v', 'el', 'true', 'false', 'null', 'String', 'Number', '$event', 'in', 'label', 'zIndex'])
  const missing = [...used].filter((x) => !local.has(x) && !injected.has(x))
  if (missing.length) fails.push(`E: PosterSection.vue uses names it does not inject: ${missing.join(', ')}`)
  return fails
}

const { createServer } = await import('vite')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@map': join(ROOT, 'library') } } })
let code = 0
try {
  const load = (p) => server.ssrLoadModule(join(ROOT, p))
  const types = await load('library/components/poster/posterTypes.js')
  const country = (await load('library/components/poster/types/countryPosterType.js')).default
  const element = await load('library/elements/posterSectionConfig.js')
  const sectionSrc = readFileSync(join(ROOT, 'library/components/poster/PosterSection.vue'), 'utf8')
  const viewSrc = readFileSync(join(ROOT, 'library/components/poster/PosterSectionView.vue'), 'utf8')
  const cs = await load('library/packet/countrySheet.js')
  const real = { types, country, element, sectionSrc, viewSrc, cs }
  if (process.argv.includes('--self-test')) {
    const poisons = [
      ["a registry without 'country'", { ...real, types: { ...types, posterTypeNames: () => [] } }, /^A:/],
      ['a region key without "&" → "and"', { ...real, country: { ...country, items: (s, l) => (/-and-/.test(String(s)) ? [] : country.items(s, l)) } }, /^B:/],
      ['the preview ignored under DEV', { ...real, cs: { ...cs, posterWithheld: () => true, largeSheet: () => null } }, /^C2:/],
      ['dev mode alone opens India (no opt-in)', { ...real, cs: { ...cs, posterWithheld: () => false, largeSheet: () => ({ format: '60x96', formats: ['60x96'] }) } }, /^C2: dev mode ALONE/],
      ['a section that uses a name it does not inject', { ...real, sectionSrc: sectionSrc.replace('</template>', '{{ notProvided }}</template>') }, /^E:/],
      ['an element config that drops show-header', { ...real, element: { posterSectionConfig: (el) => { const c = element.posterSectionConfig(el); delete c.showHeader; return c } } }, /^D: show-header="false"/],
      ['a view that does not pass show-header to the wall', { ...real, viewSrc: viewSrc.replace(':section-heads="showHeader"', '') }, /^F:/],
      ['an element config that ignores card-action', { ...real, element: { posterSectionConfig: (el) => { const c = element.posterSectionConfig(el); delete c.cardAction; return c } } }, /^D: card-action="dashboard"/],
      ['a dashboard event that cannot leave the shadow root', { ...real, viewSrc: viewSrc.replace('composed: true, cancelable', 'composed: false, cancelable') }, /^F: dxm-poster-dashboard is not/],
      ['a headless section that can still start shut', { ...real, viewSrc: viewSrc.replace(/(const startCollapsed = computed\(\(\) => cfg\.value\.collapsed === true)[^\n]*/, '$1)') }, /^F: a headless section can still start shut/],
    ]
    for (const [name, inp, rx] of poisons) {
      const f = await arms(inp); const ok = f.some((x) => rx.test(x))
      console.log(ok ? `✓ caught: ${name} -> ${f.find((x) => rx.test(x))}` : `✗ MISSED: ${name}`)
      if (!ok) code = 1
    }
  } else {
    const f = await arms(real)
    if (f.length) { f.forEach((x) => console.log('FAIL ' + x)); code = 1 }
    else console.log(`PASS check:poster-section — the 'country' type; ${DXL.length} DX Life scopes cover every country once (and their other spellings); India withheld by default; the element's attributes; PosterSection injects every name it uses`)
  }
} finally { await server.close() }
process.exit(code)
