// Does each app actually FETCH and PARSE its tables? The paint guard checks the
// data's shape on disk; the build checks the bundle compiles. Neither proves the
// running app can load a table — a renamed field or a moved file would pass both
// and leave an empty list view.
import { firefox } from 'playwright';
import { requireThisTree } from '../../../internal/_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { TREE_NAME } from '../../../internal/_tree-name.mjs'

// MUST be served over HTTP from THIS repo's public/. Two traps, both hit for real:
//  * file:// does not mount the bundles at all — zero custom elements, no error.
//  * a port that is ALREADY BOUND silently keeps serving the OTHER project. I spent
//    several rounds concluding "all three apps are broken" while actually reading
//    geo-steward's swap-proof page on a port my server never bound. VERIFY the page
//    you loaded is the one you meant before believing anything it tells you.
// DEFAULTS TO 4173, the port `bun run serve` binds, so this guard runs with the same server every
// other browser gate uses. It was 8917 — a port nothing in this repo has ever bound, so the guard
// could only ever fail unless someone happened to know the number. Override with APP_BASE.
const BASE = process.env.APP_BASE || 'http://127.0.0.1:4173';
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '../../..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(BASE, ROOT, 'APP-TABLES')
// ★ REWRITTEN 2026-09-23: these are LEAF PAGES from the manifest, not hash fragments on a shell.
//
// The previous list was ['key-city-posters', 'cities-with-internet', 'gospel-resources'] navigated
// as `index.html#<key>`, resolved against the PROFILES object in
// layouts/app-wrapper-material/index.html. That shell is no longer what `/` serves: as of
// 2026-09-22 the built root page mounts <plugin-studio> (title "doxa-maps plugin studio"), and
// MEASURED here, the root page contains ZERO of those three keys. So every navigation landed on a
// page that knew nothing about the fragment, and the guard could only fail.
//
// The failure was also silent in the worst way: this script is `browser: true` in verify-all.mjs,
// so it is SKIPPED unless --full is passed. The default `bun run verify` in the build chain never
// ran it, and nothing noticed the target had moved.
//
// Each entry below is a real profile path verified against public/doxa-maps/manifest.json. The
// data-tables profiles are the point of this guard — they are the ones that fetch and render
// tables. key-city-posters is gone entirely (no such profile ships), so it is dropped rather than
// renamed to something that merely looks similar.
const APPS = [
  `${TREE_NAME}/cities-internet/data-tables/index.html`,
  `${TREE_NAME}/gospel-resources/data-tables/index.html`,
  `${TREE_NAME}/gospel-resources/resources-list/index.html`,
];

const browser = await firefox.launch();
let failed = 0;
for (const app of APPS) {
  const page = await browser.newPage();
  // ★ NAME THE APP FIRST. The header used to print near the END of the loop body, AFTER the
  // mounted/rendered checks, so every ✓ and ✗ appeared ABOVE the app it described and the whole
  // report read offset by one. Measured 2026-09-23: that made a PASSING app
  // (gospel-resources/data-tables, 40 rows) look like the failure, and the real failure
  // (resources-list, 0 fetches) look like it had rendered rows. A report that is correct but
  // misordered is worse than a terse one — it costs the reader a wrong diagnosis, not just time.
  console.log(`\n${app}`);
  const fetched = [], errors = [], thirdParty = [];
  page.on('response', (r) => { if (/\/tables\/.*\.json/.test(r.url())) fetched.push([r.url().split('/').pop(), r.status()]); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  // THIRD-PARTY REQUESTS ARE A PERSECUTION RISK, not a performance note. Every
  // external request tells that host who is viewing a people-group map. The repo's
  // own law is self-host everything; this asserts it at RUNTIME rather than trusting
  // that no one added a CDN tag.
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:\/\//.test(u) && !/^https?:\/\/(localhost|127\.)/.test(u)) thirdParty.push(u);
  });
  // EXPLICIT index.html, never a directory url: `bun run serve` is serve-strict.mjs, which 404s a
  // directory because the live static layer does. A 404 page has no custom elements, so a missing
  // PAGE would be reported as a missing FEATURE.
  const res = await page.goto(`${BASE}/${app}`, { waitUntil: 'load' });
  // ASSERT THE RESPONSE BEFORE ASSERTING THE CONTENT. Without this, every later check reports the
  // absence of something on an error page and names the wrong cause.
  if (!res || res.status() !== 200) {
    console.log(`  ✗ ${app} — HTTP ${res ? res.status() : 'no response'}; nothing below this means anything`);
    failed++; await page.close(); continue;
  }
  await page.waitForTimeout(6000);
  // Assert we are on a page from THIS repo, not whatever else answers on this port. The old check
  // matched the shell's "Doxa Maps" title; a leaf page titles itself after its own profile, so the
  // stable marker is the manifest-era path the bundle loads its own script from.
  // MATCH THE SRI ATTRIBUTE, NOT THE PATH. A leaf references its bundle RELATIVELY
  // (src="../gospel-resources.js"), so a check requiring "/doxa-maps/..." in the src fails on a
  // perfectly good page — measured, on the first version of this line. Title-matching, which this
  // replaced, is equally incidental: a leaf titles itself "<profile> · <bundle>". The integrity
  // attribute is the one marker this build guarantees by construction and no other server emits.
  const ours = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].some(s => (s.getAttribute('integrity') || '').startsWith('sha384-')));
  if (!ours) {
    console.log(`  ✗ ${app} — served page loads no ${TREE_NAME} bundle script. Wrong port or wrong tree?`);
    failed++; await page.close(); continue;
  }
  const mounted = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((e) => e.tagName.includes('-')).length);
  if (!mounted) { console.log('  ✗ NO custom element mounted'); failed++; }

  // A 200 FETCH IS NOT A RENDERED ROW. Every earlier version of this guard proved
  // only that the table JSON came back — a renamed field, a failed parse, or a
  // component that never mounts its grid would all still show 200s and an EMPTY
  // list view. So count actual .tabulator-row elements, which live inside SHADOW
  // ROOTS (the apps are custom elements), hence the recursive walk: a light-DOM
  // querySelectorAll returns nothing here and would read as "no data" forever.
  // ★ COUNT AT EVERY DEPTH, INCLUDING THE LIGHT DOM (fixed 2026-09-23).
  // The previous walk only counted rows ONE level inside a shadow host —
  // `if (e.shadowRoot) { n += e.shadowRoot.querySelectorAll('.tabulator-row').length; walk(...) }`
  // — so a row in the light DOM, or nested one shadow level deeper than its host, counted ZERO.
  // It also had no `seen` set, so a re-entered root could double-count. MEASURED: this reported
  // "tables fetched but NO rows RENDERED — empty list view" for gospel-resources/data-tables while
  // an every-depth walk found 50 rows in Chromium and 40 in Firefox, stable at 6s, 12s and 20s.
  // A false NEGATIVE from a gate is the expensive direction: it accuses working code.
  const rendered = await page.evaluate(() => {
    let n = 0;
    const seen = new Set();
    const walk = (root) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      for (const e of root.querySelectorAll('*')) {
        if (e.classList && e.classList.contains('tabulator-row')) n++;
        if (e.shadowRoot) walk(e.shadowRoot);
      }
    };
    walk(document);
    return n;
  });
  if (!rendered) { console.log('  ✗ tables fetched but NO rows RENDERED — empty list view'); failed++; }
  else console.log(`  ✓ ${rendered} table rows rendered (Tabulator paginates; one page, not the whole corpus)`);
  const bad = fetched.filter(([, s]) => s >= 400);
  console.log(`  tables fetched: ${fetched.length}${fetched.length ? ' — ' + fetched.slice(0,4).map(f=>f[0]).join(', ') : ''}`);
  if (bad.length) { console.log(`  ✗ ${bad.length} failed: ${bad.slice(0,3).map(b=>b.join(' ')).join(', ')}`); failed++; }
  // ZERO FETCHES IS A FAILURE, NOT A NOTE. The first version printed a soft "…"
  // here and still exited 0 — so all three apps fetching NOTHING reported as
  // "NO FETCH FAILURES", which is the fail-open shape this whole session has been
  // catching elsewhere. An app whose list view loads no data is broken whether the
  // cause is the route, a moved file, or a renamed field.
  else if (!fetched.length) { console.log('  ✗ NO table fetched — the list view has no data'); failed++; }
  else console.log('  ✓ all table fetches OK');
  if (errors.length) { console.log(`  ✗ page error: ${errors[0]}`); failed++; }
  if (thirdParty.length) {
    const hosts = [...new Set(thirdParty.map((u) => new URL(u).host))];
    console.log(`  ✗ ${thirdParty.length} THIRD-PARTY request(s) to ${hosts.join(', ')} — leaks the viewer's IP`);
    failed++;
  }
  await page.close();
}
await browser.close();
console.log(`\n${failed ? `FAILED — ${failed}` : 'NO FETCH FAILURES / NO PAGE ERRORS'}`);
process.exit(failed ? 1 : 0);
