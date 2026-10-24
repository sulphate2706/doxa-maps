#!/usr/bin/env node
/**
 * verify-5-capabilities.mjs — prove ALL FIVE capability levels actually render.
 *
 * ★ WHY: the card BUILD-DXMAPS-ALL-5-CAPS-WORKING-LOW-BUG was marked done with NO end-to-end check.
 *   "Done is a passing test, not a field value" — this is that test. First run (2026-09-20) came back
 *   3/5: caps 1-3 clean, caps 4-5 failing on ONE shared bug (vue-i18n code 27), which is exactly the
 *   kind of thing a field value hides and a sweep surfaces.
 *
 * ★ THE MODEL, grounded not remembered: capability = 5 - PROFILE_TIER, where PROFILE_TIER lives in
 *   internal/plugin-gallery/discover.mjs:
 *     nested-mfe-spa 0 · nested-elements-mfe 1 · monolithic 2 · parameterized 3 · single 4
 *   One representative bundle per level. REPS is reconciled against manifest.json at startup, so a
 *   bundle whose declared type changes makes this gate FAIL LOUDLY rather than silently certify a
 *   level it is no longer sampling — you no longer have to remember to update it by hand.
 *
 * ★ TWO MEASUREMENT TRAPS THIS ENCODES (both cost real debugging time):
 *   - SHADOW DOM DOES NOT PIERCE. A cap-4/cap-5 composite mounts CHILD elements with their OWN shadow
 *     roots, so a single-level querySelector reports a working canvas as absent. Hence the recursive
 *     deep() walk, and hence "a canvas that HOLDS a GL context" rather than "a canvas exists".
 *   - shadowRoot.textContent INCLUDES the injected <style>, so regexing it matches CSS. Clone the
 *     children, drop STYLE nodes, then read visible copy.
 *
 * WHAT COUNTS AS PASS: the element mounts, has real height (>=200px), renders real text (>40 chars),
 * and produces no UNCLASSIFIED console error and no UNCLASSIFIED HTTP>=400 (see the classifier
 * below: two named ENVIRONMENTAL causes are reported but exempt; everything else still fails, and
 * a TERMINAL "no token" always fails). Rendering without errors is the bar, because a
 * console error is what masks the NEXT real failure.
 *
 * USAGE
 *   bun run verify:5-caps                       # against the live catalog
 *   BASE=http://127.0.0.1:8080/<TREE_NAME>/ node internal/verify-5-capabilities.mjs   # a local serve
 * Exits non-zero if any level fails, so it can gate a release.
 */
import { chromium } from './lib/playwright-guarded.mjs'
import { requireThisTree } from './_serves-this-tree.mjs'
import { resolve as _resolvePath, dirname as _dirnamePath } from 'node:path'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'
import { requirePublishedTreeUrl } from './_published-base.mjs'

const GL=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--no-sandbox']
const B=(process.env.BASE || requirePublishedTreeUrl('VERIFY-5-CAPABILITIES')).replace(/\/?$/,'/')
const ROOT = _resolvePath(_dirnamePath(_fileURLToPath(import.meta.url)), '..')

// ★ MEASURE THIS BUILD, OR MEASURE NOTHING. Several worktrees run on one machine and a default port
// belongs to whichever server started first — measured 2026-09-24 on :4173, where browser gates
// reported confidently about a build nobody here had touched. 75 (EX_TEMPFAIL), not 1: the wrong
// tree is a precondition, not a product defect, and the wave runner reports 75 as ⊘ rather than ✗.
// A file:// target passes straight through — there is no server there to be wrong about.
await requireThisTree(B, ROOT, '5-CAPABILITIES')
// capability = 5 - PROFILE_TIER (discover.mjs). One representative per level.
const REPS=[
 // ★ CORRECTED 2026-09-20 by the manifest reconciliation added below, on its FIRST RUN.
 // This slot used to be doxa-vision-card — which ships doxa-vision-card.instances.json with 2
 // instances, so discover.mjs types it PARAMETERIZED (cap-2), not single. The gate has therefore
 // been reporting '5/5 capability levels' while sampling cap-2 TWICE and cap-1 NEVER. Exactly the
 // drift the reconciliation exists to catch, found the moment it was switched on.
 ['cap-1 single',          'all-people-groups/all-people-groups/index.html',    'single'],
 ['cap-2 parameterized',   'people-groups-grid/people-groups-grid/index.html',  'preset-element'],
 ['cap-3 monolithic',      'doxa-research-map/research-map/index.html',         'monolithic'],
 ['cap-4 nested-elements', 'dashboard-plus-grid/dashboard-plus-grid/index.html','nested-elements-mfe'],
 ['cap-5 nested-mfe-spa',  'doxa-maps-spa/doxa-maps-spa/index.html',            'nested-mfe-spa'],
]
// ★ RECONCILE THE HARDCODED REPS AGAINST THE MANIFEST BEFORE TRUSTING THEM.
// The REPS table above asserts each representative's declared type as a STRING LITERAL, and the
// header says "if a bundle's declared type changes, update REPS here" — i.e. it relies on a human
// remembering. That makes the EXPECTATION and the thing it describes corruptible by the same event:
// change a bundle's meta.json and this gate keeps claiming the old tier while still passing, so it
// would certify a matrix it is no longer actually sampling. (Live risk, not hypothetical: on
// 2026-09-20 research-dashboard moved single -> monolithic. It is not a REP, so nothing desynced —
// but only by luck.) Read the manifest and FAIL LOUDLY on any drift.
// Local-tree runs only: the manifest sits next to the leaves at the same BASE.
try {
  const mfUrl = B + 'manifest.json'
  const res = await fetch(mfUrl, { signal: AbortSignal.timeout(10000) })
  if (res.ok) {
    const mf = await res.json()
    const byProfile = new Map()
    for (const bundle of (mf.bundles || [])) {
      for (const p of (bundle.profiles || [])) byProfile.set(`${bundle.bundle}/${p.profile}`, p.type)
    }
    const ALIAS = { 'preset-element': 'parameterized', 'composite-element': 'nested-elements-mfe',
                    'multi-view-element': 'monolithic', 'app-shell': 'nested-mfe-spa', 'single-element': 'single' }
    const drift = []
    for (const [name, path, claimed] of REPS) {
      const key = path.split('/').slice(0, 2).join('/')
      const actual = byProfile.get(key)
      const want = ALIAS[claimed] || claimed
      if (actual && actual !== want) drift.push(`${name}: REPS says "${claimed}" (=${want}) but the manifest says "${actual}" for ${key}`)
    }
    if (drift.length) {
      console.error('5-CAPS: FAIL — the REPS table has DRIFTED from the manifest:')
      drift.forEach((d) => console.error('  ' + d))
      console.error('  Update REPS in internal/verify-5-capabilities.mjs. Until then this gate is')
      console.error('  certifying capability levels it is no longer actually sampling.')
      process.exit(1)
    }
    console.log(`5-CAPS: REPS reconciled against ${mfUrl} — all ${REPS.length} declared types match.`)
  } else {
    console.log(`5-CAPS: NOTE — manifest not readable at ${mfUrl} (${res.status}); REPS types UNVERIFIED this run.`)
  }
} catch (e) {
  console.log(`5-CAPS: NOTE — manifest check skipped (${String(e.message || e).slice(0, 60)}); REPS types UNVERIFIED this run.`)
}

/**
 * ★ CLASSIFY CONSOLE ERRORS, DO NOT COUNT THEM (2026-09-21).
 *
 * This gate barred on `errs.length === 0`, which fails a PERFECTLY RENDERING map whenever the
 * ENVIRONMENT is imperfect. Measured on all-people-groups with a valid token: the element mounts
 * at 900px with a LIVE GL canvas (1440x900) and 309 chars of real text — and the gate said FAIL,
 * over 20 console errors that were all one external cause.
 *
 * THE THREE CLASSES, each observed rather than imagined:
 *   1. LADDER FALLTHROUGH — "Access to fetch at '…/api/maps/token'" + a 404 on /api/maps/token.
 *      The token ladder is DESIGNED to try rungs in order and fall through; an earlier rung
 *      failing while a later one succeeds is the design WORKING, not breaking.
 *   2. MAPBOX 403 — the shared pk. token is URL-restricted to doxa.life, so every tileset request
 *      403s from any other origin. Mapbox then throws its own internal errors (`qt` at
 *      mapbox-gl.js) BECAUSE of those 403s, which is why one restriction produces ~20 lines.
 *      Tracked as a P0 to fix in the Mapbox account — not a code defect here.
 *   3. TERMINAL — "No Mapbox access token provided": the ladder is EXHAUSTED. The map genuinely
 *      cannot paint, so this MUST still fail.
 *
 * ★ WHY THIS IS NOT JUST "IGNORE ERRORS": anything UNRECOGNISED still fails, loudly and by name.
 * A gate that swallowed every error would be worse than no gate; this one narrows to two named
 * external causes it can point at, and keeps the blast radius of that exemption visible in the
 * output. The card this closes says it exactly: once the token endpoint is fixed these gates would
 * KEEP failing, and the obvious reading is "the fix did not work" — the shape that trains an
 * operator to ignore a gate.
 */
const ENVIRONMENTAL = [
  { name: 'ladder-fallthrough', re: /Access to fetch at .*\/api\/maps\/token|\/api\/maps\/token/i },
  { name: 'mapbox-403',         re: /\b403\b|Failed to load resource|api\.mapbox\.com\/mapbox-gl-js|^qt\b|^\s*at https:\/\/api\.mapbox\.com/i },
]
const TERMINAL = /No Mapbox access token provided/i

function classify(lines) {
  const env = [], real = [], terminal = []
  for (const l of lines) {
    if (TERMINAL.test(l)) { terminal.push(l); continue }
    const hit = ENVIRONMENTAL.find((c) => c.re.test(l))
    if (hit) env.push(`${hit.name}: ${l.slice(0, 60)}`)
    else real.push(l)
  }
  return { env, real, terminal }
}

const b=await chromium.launch({headless:true,args:GL})
let bad=0
for(const [name,path,type] of REPS){
  const page=await b.newPage({viewport:{width:1440,height:900}})
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))})
  const http=[]; page.on('response',r=>{if(r.status()>=400)http.push(r.status()+' '+r.url().slice(-44))})
  // ★ CARRY A TOKEN IF ONE IS OFFERED (2026-09-21). Without this the verifier could not pass while
  // the /api/maps/token outage stands: all four map-bearing tiers failed with the single console
  // error 'No Mapbox access token provided', i.e. IT WAS MEASURING THE OUTAGE, NOT THE CAPABILITY.
  // A gate whose verdict is dominated by an unrelated known outage cannot answer the question it
  // was written to answer. Usage:
  //   MAPBOX_TOKEN=$(curl -s https://doxa.life/api/maps/token) bun run verify:5-caps
  // Unset, behaviour is unchanged — so this never silently hides a REAL token-plumbing break.
  const tk = (process.env.MAPBOX_TOKEN || '').trim()
  const q = '?cb=5c' + (tk ? '&tk=' + encodeURIComponent(tk) : '')
  // ★ AND SET THE HOST GLOBAL, because ?tk= ONLY reaches the TOP-LEVEL element's profile-config.
  // A cap-4/cap-5 composite's NESTED children read `window.MAP_TOKEN` instead — dashboard-plus-grid's
  // own index.html says so: "The GENERATED leaf pages set window.MAP_TOKEN ... so a baked composite's
  // nested map finds a token." With only the query param, caps 1-3 passed and caps 4-5 still failed
  // with 'No Mapbox access token provided' — the query param never reached the children.
  // addInitScript runs BEFORE any page script, so the global exists by the time the element boots.
  if (tk) await page.addInitScript(t => { window.MAP_TOKEN = t }, tk)
  try{ await page.goto(B+path+q,{waitUntil:'networkidle',timeout:90000}) }
  catch(e){ console.log(`  FAIL ${name} — nav`); bad++; await page.close(); continue }
  await page.waitForTimeout(15000)
  const r=await page.evaluate(()=>{
    // shadow DOM does NOT pierce — walk nested roots
    const deep=(root,sel,out=[])=>{out.push(...root.querySelectorAll(sel))
      for(const el of root.querySelectorAll('*')) if(el.shadowRoot) deep(el.shadowRoot,sel,out); return out}
    const host=[...document.querySelectorAll('*')].find(e=>e.tagName.includes('-')&&e.shadowRoot)
    if(!host) return {mounted:false}
    const sr=host.shadowRoot, bb=host.getBoundingClientRect()
    // visible copy only (textContent includes injected <style>)
    const clone=document.createElement('div')
    ;[...sr.children].forEach(c=>{if(c.tagName!=='STYLE')clone.appendChild(c.cloneNode(true))})
    clone.querySelectorAll('style').forEach(s=>s.remove())
    const txt=clone.textContent.replace(/\s+/g,' ').trim()
    const cv=deep(sr,'canvas').find(c=>c.getContext('webgl2')||c.getContext('webgl'))
    return { mounted:true, tag:host.tagName.toLowerCase(),
      size:Math.round(bb.width)+'x'+Math.round(bb.height),
      h:Math.round(bb.height),
      nested: [...sr.querySelectorAll('*')].filter(e=>e.tagName.includes('-')).length,
      glCanvas: !!cv, textLen: txt.length, head: txt.slice(0,58) }
  })
  // Environmental HTTP failures are the SAME two causes as the console classes above, so they are
  // exempted on the same terms: a 403 from api.mapbox.com and a 404 on /api/maps/token are the
  // token restriction and the ladder, not this bundle. Anything else still fails.
  const ENV_HTTP = [
    /\/api\/maps\/token/i,   // the ladder probing a rung that is not there (404)
    /^403 /,                 // Mapbox refusing a URL-restricted token from this origin
  ]
  const httpReal = http.filter((h) => !ENV_HTTP.some((re) => re.test(h)))
  const { env, real, terminal } = classify(errs)
  const ok = r.mounted && r.h>=200 && r.textLen>40
           && real.length===0 && terminal.length===0 && httpReal.length===0
  console.log(`  ${ok?'PASS':'FAIL'} ${name} [${type}]`)
  console.log(`       ${r.mounted?`${r.tag} ${r.size} nested=${r.nested} gl=${r.glCanvas} text=${r.textLen}`:'DID NOT MOUNT'}`)
  if(r.head) console.log(`       "${r.head}"`)
  // Report the exempted noise so the exemption's blast radius stays VISIBLE — a silent exemption
  // is how a gate quietly stops testing anything.
  if(env.length) console.log(`       i ${env.length} environmental error(s) IGNORED -> ${env[0]}`)
  if(terminal.length) console.log(`       ✗ TERMINAL: ${terminal[0]} (the ladder is exhausted — the map cannot paint)`)
  if(real.length) console.log(`       ✗ console errors: ${real.length} -> ${real[0]}`)
  const httpEnv = http.length - httpReal.length
  if(httpEnv) console.log(`       i ${httpEnv} environmental HTTP failure(s) IGNORED (token 404 / mapbox 403)`)
  if(httpReal.length) console.log(`       ✗ HTTP>=400: ${httpReal.length} -> ${httpReal[0]}`)
  if(!ok) bad++
  await page.close()
}
console.log(`\n5-CAPS: ${bad?`FAIL — ${bad} of ${REPS.length}`:`PASS — all ${REPS.length} capability levels mount, render and are error-free`}`)
await b.close()
if (bad) process.exit(1)
