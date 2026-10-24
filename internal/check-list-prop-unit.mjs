#!/usr/bin/env node
/**
 * check-list-prop-unit — the people-group LIST prop (library/lists/), measured WITHOUT a browser.
 *
 * Runs the real library module in Node against a stand-in window/location/fetch:
 *   - the ladder: profile-config `list` > ?list= > window.MAP_LIST > 'doxa'; ids and aliases ('700');
 *     an unknown value falls back to the default;
 *   - the default list returns the SAME array, untouched, with no fetch at all;
 *   - a list keeps exactly the rows whose slug is in its membership file, fetched from the asset pool;
 *   - a membership that cannot load FAILS CLOSED: no rows, never the whole DOXA list;
 *   - every registry list with an imb filter has a membership file, and its counts match the slugs;
 *   - listLabel / listDefinition read the reader's catalogue (library/i18n/locales/<lc>/lists.json),
 *     fall back to the registry's English, the English catalogue equals the registry, and every
 *     locale carries a label and a definition for every list.
 * USAGE  node internal/check-list-prop-unit.mjs          EXIT 0 pass · 1 fail
 */
import { register } from 'node:module'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Vite imports JSON without an attribute; Node 20 does not. Teach this process the same thing.
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, ctx, next) { if (url.endsWith('.json')) return { format: 'json', shortCircuit: true, source: (await import('node:fs')).readFileSync(new URL(url)) }; return next(url, ctx) }"))

globalThis.window = globalThis
let search = ''
Object.defineProperty(globalThis, 'location', { configurable: true, get: () => ({ search, href: 'https://host.example/page' + search }) })
const fetched = []
let serve = () => ({ ok: false, status: 404 })
globalThis.fetch = async (url) => { fetched.push(String(url)); const r = serve(String(url)); return { ok: r.ok, status: r.status, json: async () => r.body } }

const L = await import('../library/lists/peopleGroupList.js')
const results = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(66)} ${JSON.stringify(got)}${ok ? '' : '  want ' + JSON.stringify(want)}`)
}
const reset = () => { search = ''; delete globalThis.MAP_LIST; fetched.length = 0 }

console.log('ladder')
reset(); check('nothing set -> the default', L.resolvePeopleGroupList(null), 'doxa')
reset(); check('profile-config list wins', (search = '?list=unreached', globalThis.MAP_LIST = 'frontier', L.resolvePeopleGroupList({ list: 'frontier-500k' })), 'frontier-500k')
reset(); check('?list= beats window.MAP_LIST', (search = '?list=frontier', globalThis.MAP_LIST = 'unreached', L.resolvePeopleGroupList({})), 'frontier')
reset(); check('window.MAP_LIST when nothing else', (globalThis.MAP_LIST = 'unreached', L.resolvePeopleGroupList(null)), 'unreached')
reset(); check('an alias: 700', L.resolvePeopleGroupList({ list: '700' }), 'frontier-500k')
reset(); check('an alias, any case: Project-7000', L.resolvePeopleGroupList({ list: 'Project-7000' }), 'unreached')
reset(); check('a JSON-string profile-config', L.resolvePeopleGroupList('{"list":"4700"}'), 'frontier')
reset(); check('a ref-shaped profile-config', L.resolvePeopleGroupList({ value: { list: '2000' } }), 'doxa')
reset(); check('unknown -> the default', L.resolvePeopleGroupList({ list: 'project-9999' }), 'doxa')

console.log('apply')
const rows = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]
reset(); { const out = await L.applyPeopleGroupList(rows, null); check('default: the same array, no fetch', [out === rows, fetched.length], [true, 0]) }
reset(); serve = (u) => (u.endsWith('/people-groups/lists/frontier.json') ? { ok: true, status: 200, body: { slugs: ['a', 'c'] } } : { ok: false, status: 404 })
{ const out = await L.applyPeopleGroupList(rows, { list: 'frontier', assetsBase: 'https://cdn.example/tree/assets' }); check('a list keeps exactly its members', out.map((r) => r.slug), ['a', 'c']) }
check('…fetched from the asset pool', fetched, ['https://cdn.example/tree/assets/people-groups/lists/frontier.json'])
reset(); serve = () => ({ ok: false, status: 404 })
{ const err = console.error; console.error = () => {}; const out = await L.applyPeopleGroupList(rows, { list: 'unreached', assetsBase: 'https://cdn.example/x/assets' }); console.error = err; check('an unloadable list FAILS CLOSED: no rows', out, []) }

console.log('membership files')
for (const l of L.peopleGroupLists().filter((x) => x.source === 'imb')) {
  const f = join(ROOT, 'data/people-groups/lists', `${l.id}.json`)
  if (!existsSync(f)) { check(`${l.id}: membership file exists`, false, true); continue }
  const d = JSON.parse(readFileSync(f, 'utf8'))
  check(`${l.id}: file matches its registry filter, counts match its slugs`, [JSON.stringify(d.filter) === JSON.stringify(l.filter), d.counts.doxa === d.slugs.length, d.counts.imb >= d.counts.doxa], [true, true, true])
}

console.log('labels in the reader\'s language')
const cat = (lc) => JSON.parse(readFileSync(join(ROOT, 'library/i18n/locales', lc, 'lists.json'), 'utf8'))
const tFrom = (lc) => (key) => key.split('.').slice(1).reduce((o, k) => (o == null ? o : o[k]), cat(lc)) ?? key
check('no translator -> the registry English', L.listLabel('700'), 'Project 700: frontier people groups of 500,000 or more')
check('a translator that returns the key -> English', L.listLabel('frontier', (k) => k), 'Project 4700: frontier people groups')
check('Arabic catalogue, by alias', L.listLabel('4700', tFrom('ar')), cat('ar').frontier.label)
check('definition, German catalogue', L.listDefinition('unreached', tFrom('de')), cat('de').unreached.definition)
check('an unknown list -> empty, not a crash', L.listLabel('project-9999', tFrom('en')), '')
{ const en = cat('en'), bad = []
  for (const l of L.peopleGroupLists()) {
    if (en[l.id]?.label !== l.label) bad.push(`${l.id}.label`)
    if ((en[l.id]?.definition || '') !== (l.definition || '')) bad.push(`${l.id}.definition`)
  }
  check('the English catalogue matches the registry, word for word', bad, []) }
{ const missing = []
  // Locale FOLDERS only: the folder also holds a README.md, which is not a locale.
  for (const lc of readdirSync(join(ROOT, 'library/i18n/locales'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const c = cat(lc)
    for (const l of L.peopleGroupLists()) for (const f of ['label', 'definition']) if (!c[l.id]?.[f]) missing.push(`${lc}:${l.id}.${f}`)
  }
  check('every locale has a label and a definition for every list', missing, []) }

const failed = results.filter((x) => !x).length
console.log(failed ? `LIST-PROP: FAIL — ${failed} case(s)` : `LIST-PROP: PASS — ${results.length} cases: the ladder, aliases, the untouched default, membership filtering, fail-closed, the membership files, and labels in every locale`)
process.exit(failed ? 1 : 0)
