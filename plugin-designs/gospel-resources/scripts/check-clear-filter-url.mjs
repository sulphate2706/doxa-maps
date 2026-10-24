#!/usr/bin/env node
/**
 * check-clear-filter-url.mjs — "Show all" on the gospel tables drops ONLY the filter's own keys.
 *
 * WHY: clearFilter used to replaceState({}, '', pathname), which wiped the whole query and the hash —
 * the page's own ?tab=, and any key a host or a partner had put on the address — and the history
 * state with them. The address after "Show all" must differ from the one before by the filter keys
 * alone.
 *
 * Proves it two ways: the pure helper (filter-url.js) on real-shaped addresses, and the component —
 * data-tables.vue's clearFilter writes through commitUrl (the one history writer, which keeps the hash and the
 * state) only on a page it owns, with no direct history write left.
 * `--poison` runs the old behaviour through the same assertions and requires them to FAIL.
 * Exit 0 pass · 1 fail.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchWithout, FILTER_KEYS } from '../filter-url.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const POISON = process.argv.includes('--poison')
// The address after "Show all", as commitUrl writes it ({ search } given, the current hash kept). Poison: the old wipe.
const strip = POISON ? (href) => new URL(href).pathname : (href) => { const u = new URL(href); return u.pathname + searchWithout(u.search, FILTER_KEYS) + u.hash }

let fails = 0
const ok = (c, m) => { if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m) } }
const base = 'https://example.org/dx-maps/gospel-resources/data-tables/index.html'

const a = strip(`${base}?tab=links&iso=hin&country=IND&label=Hindi&province=Bihar&partner=abc#tables`)
ok(!/[?&](iso|country|label|province)=/.test(a), `the filter keys are gone (${a})`)
ok(/[?&]tab=links\b/.test(a), 'the page\'s own ?tab= stays')
ok(/[?&]partner=abc\b/.test(a), 'a host\'s or partner\'s key stays')
ok(a.endsWith('#tables'), 'the #hash stays')
const b = strip(`${base}?iso=hin`)
ok(b === new URL(base).pathname, `only filter keys: no dangling "?" (${b})`)
const c = strip(`${base}?tab=countries`)
ok(c === new URL(base).pathname + '?tab=countries', 'no filter: the address is unchanged')
const d = strip(`${base}?tab=links&q=a%20b+c&iso=hin`)
ok(d.endsWith('?tab=links&q=a%20b+c'), `other parameters are kept as written, byte for byte (${d})`)

if (!POISON) {
  const vue = readFileSync(resolve(HERE, '../data-tables.vue'), 'utf8')
  const fn = (vue.match(/function clearFilter\(\)\s*\{[\s\S]*?\n\}/) || [''])[0]
  ok(/import \{[^}]*\bcommitUrl\b[^}]*\burlOwnerOf\b[^}]*\} from '@map\/composables\/useViewAddress\.js'/.test(vue), 'data-tables.vue imports the one history writer (commitUrl) and urlOwnerOf')
  ok(/commitUrl\(\{\s*search:\s*searchWithout\(window\.location\.search,\s*FILTER_KEYS\)\s*\}\)/.test(fn), 'clearFilter writes through commitUrl with only the filter keys dropped (the hash and state kept by commitUrl)')
  ok(/urlOwnerOf\(profileConfig\.value\)\s*===\s*'app'/.test(fn), 'and only on a page it owns (urlOwner app): a partner\'s address is never written')
  ok(!/\.(push|replace)State\s*\(/.test(vue), 'no direct history write is left in data-tables.vue')
}

if (POISON) { console.log(fails ? `POISON OK: ${fails} caught` : 'POISON FAILED'); process.exit(fails ? 0 : 1) }
console.log(fails ? `FAIL check-clear-filter-url: ${fails}` : 'PASS check-clear-filter-url')
process.exit(fails ? 1 : 0)
