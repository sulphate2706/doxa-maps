#!/usr/bin/env node
/**
 * check-pinned-umd — library/utils/loadPinnedUmd.js loads a pinned UMD library WITHOUT touching the host
 * page's global of the same name, and sets integrity + crossorigin. Headless: a stand-in document whose
 * <script> "executes" a d3-style UMD body (`(t = globalThis).d3 = t.d3 || {}; t.d3.x = …`).
 * CASES  host has no d3 · host owns an object d3 (must gain NO keys) · host has a non-configurable var d3
 *        · a failed load rejects and leaves the host's d3 as it was · the tag carries the pinned SRI.
 * EXIT 0 pass · 1 fail
 */
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ' — ' + JSON.stringify(got)}`) }
const PIN = { url: 'https://cdn.example/d3.min.js', integrity: 'sha384-TEST' }
let fail = false, lastTag = null
function page() {
  const doc = { currentScript: null, head: { appendChild(s) {
    lastTag = s
    setTimeout(() => {
      if (fail) return s.onerror && s.onerror()
      doc.currentScript = s
      const t = globalThis; t.d3 = t.d3 || {}; t.d3.version = '7.9.0'; t.d3.select = () => 'ours'   // the UMD body
      doc.currentScript = null
      s.onload && s.onload()
    }, 0)
  } }, createElement: () => ({}) }
  globalThis.window = globalThis
  globalThis.document = doc
}
const fresh = async () => (await import(`../library/utils/loadPinnedUmd.js?${Math.random()}`)).loadPinnedUmd

page(); delete globalThis.d3
let lib = await (await fresh())(PIN, 'd3')
check('no host d3: returns the library', lib && lib.select() === 'ours', lib)
check('no host d3: leaves no d3 on the page', globalThis.d3 === undefined, globalThis.d3)
check('the tag carries integrity + crossorigin', lastTag.integrity === PIN.integrity && lastTag.crossOrigin === 'anonymous', lastTag)

page(); const host = { version: '6.0.0', mine: true }; globalThis.d3 = host
lib = await (await fresh())(PIN, 'd3')
check('host owns a d3: gets our library', lib && lib.version === '7.9.0', lib)
check('host owns a d3: its object gained NO keys', Object.keys(host).join() === 'version,mine' && host.version === '6.0.0', host)
check('host owns a d3: window.d3 is still the host\'s', globalThis.d3 === host, globalThis.d3)

page(); delete globalThis.d3; fail = true; globalThis.d3 = host
let rejected = false
try { await (await fresh())(PIN, 'd3') } catch { rejected = true }
check('failed load rejects', rejected, rejected)
check('failed load leaves the host d3 in place', globalThis.d3 === host, globalThis.d3)
fail = false

if (bad) { console.log(`PINNED-UMD: FAIL — ${bad} case(s).`); process.exit(1) }
console.log("PINNED-UMD: PASS — a pinned UMD loads with SRI and never touches the host page's global.")
