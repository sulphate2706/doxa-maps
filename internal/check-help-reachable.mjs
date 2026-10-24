#!/usr/bin/env node
/**
 * check-help-reachable — every Experimental map's "what is this" text stays one click away, from the
 * map's OWN "?" rather than a button floating over the top of the app.
 *
 * THE MOVE THIS GUARDS. The Doxa Maps app (doxa-maps-spa) used to show a "?" at the top centre of the
 * pane for every Experimental map with text in src/experimentalHelp.js. It read as a game piece, not
 * part of the map. The explainer now opens from the map's own "?": the library HelpButton (a map
 * control, beside zoom and fullscreen), or a small "?" in the map's own bar where it has no control
 * column (the Wall, the vision card, the PPLR hub). Each dispatches a bubbling, COMPOSED doxa:help
 * (library/composables/useHostedHelp.js); the app answers with the text. Removing the old button is
 * only safe while every map with text can still send that event, so that is what this asserts:
 *   1. the composable really dispatches doxa:help as bubbling + composed, and really finds a host
 *      across shadow roots (executed on a small fake DOM, not read as text);
 *   2. the app listens for doxa:help, marks panes that have text, and no longer has its own button;
 *   3. every bundle with text reaches it: a hosted HelpButton or useHostedHelp somewhere in its own
 *      folder, or an entry in OWN_HELP below naming the control that already explains the map.
 * Every arm is run against a planted defect first, so a green here is not a green by construction.
 *
 * Node only, no browser. Exit 0 pass · 1 fail.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const fails = []

// Maps whose own UI already explains them, so a second "?" would only duplicate it. Name the control;
// the check requires that marker to be present in the bundle, so the exemption dies with the control.
const OWN_HELP = {
  'upg-neighbor': { marker: "neighbor.about.button", why: 'its bar has an About button that opens the full explainer (why, the E-scale, the P-scale)' },
}

// ── 1. The composable, executed ──────────────────────────────────────────────────────────────────
const { underHelpHost, askForHelp } = await import(join(ROOT, 'library/composables/useHostedHelp.js'))
function el(attrs = {}) { return { nodeType: 1, parentNode: null, hasAttribute: (a) => a in attrs } }
function shadow(host) { return { nodeType: 11, parentNode: null, host } }
function composableFails(under, ask) {
  const out = []
  // a button inside a map's shadow root, inside the app's pane (which carries data-doxa-help)
  const pane = el({ 'data-doxa-help': '' }); const mapHost = el(); mapHost.parentNode = pane
  const root = shadow(mapHost); const btn = el(); btn.parentNode = root
  if (!under(btn)) out.push('underHelpHost did not find data-doxa-help across a shadow root')
  const lone = el(); const loneRoot = shadow(el()); lone.parentNode = loneRoot
  if (under(lone)) out.push('underHelpHost reported a host where there is none (a dead "?" would show)')
  let got = null; ask({ dispatchEvent: (e) => { got = e } })
  if (!got || got.type !== 'doxa:help') out.push('askForHelp did not dispatch doxa:help')
  else {
    if (!got.bubbles) out.push('doxa:help does not bubble, so it never leaves the button')
    if (!got.composed) out.push('doxa:help is not composed, so it stops at the map\'s shadow root')
  }
  return out
}
fails.push(...composableFails(underHelpHost, askForHelp))
// planted: a dispatcher that is not composed, and a host finder that stops at a shadow root
const notComposed = (e) => e && e.dispatchEvent && e.dispatchEvent(new CustomEvent('doxa:help', { bubbles: true }))
const stopsAtShadow = (n) => { for (; n; n = n.parentNode) if (n.nodeType === 1 && n.hasAttribute('data-doxa-help')) return true; return false }
if (!composableFails(underHelpHost, notComposed).some((f) => /not composed/.test(f))) fails.push('SELF-TEST: a non-composed doxa:help was not caught')
if (!composableFails(stopsAtShadow, askForHelp).some((f) => /across a shadow root/.test(f))) fails.push('SELF-TEST: a host finder that stops at the shadow root was not caught')

// ── 2. The app ───────────────────────────────────────────────────────────────────────────────────
function appFails(src) {
  const out = []
  if (!/addEventListener\(\s*'doxa:help'/.test(src)) out.push('doxa-maps-spa does not listen for doxa:help, so no map\'s "?" can open the explainer')
  if (!/:data-doxa-help=/.test(src)) out.push('doxa-maps-spa does not mark panes with data-doxa-help, so every hosted "?" stays hidden')
  if (/dms-help-btn/.test(src)) out.push('doxa-maps-spa still has its own top-centre "?" (dms-help-btn)')
  return out
}
const app = read('plugin-designs/doxa-maps-spa/doxa-maps-spa.vue')
fails.push(...appFails(app))
if (!appFails(app.replace(/addEventListener\(\s*'doxa:help'/g, "addEventListener('doxa-help'")).length) fails.push('SELF-TEST: an app that stopped listening was not caught')
if (!appFails(app + '\n<button class="dms-help-btn">?</button>').length) fails.push('SELF-TEST: the old top-centre button coming back was not caught')

// ── 3. Every bundle with text reaches it ─────────────────────────────────────────────────────────
const { EXPERIMENTAL_HELP } = await import(join(ROOT, 'plugin-designs/doxa-maps-spa/src/experimentalHelp.js'))
function filesUnder(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== 'data') out.push(...filesUnder(p)) }
    else if (/\.(vue|js|mjs)$/.test(f)) out.push(p)
  }
  return out
}
const HOSTED = /<HelpButton\b[^>]*\bhosted\b|useHostedHelp\(/
function reachFails(id, sources, ownHelp = OWN_HELP) {
  if (sources.some((s) => HOSTED.test(s))) return []
  const own = ownHelp[id]
  if (own && sources.some((s) => s.includes(own.marker))) return []
  if (own) return [`${id}: exempt as having its own help (${own.why}), but "${own.marker}" is gone from it`]
  return [`${id}: has explainer text in experimentalHelp.js but no hosted "?" (HelpButton hosted, or useHostedHelp) anywhere in its folder, so the text is unreachable`]
}
// The population is every map WITH TEXT in experimentalHelp.js AND every map exempted in OWN_HELP. A map
// whose own control is its explainer carries no entry in the help file (one source of truth per map), and
// deriving the population from that file alone would drop it from this check without a word: removing
// UPG Neighbor's redundant entry took the count from 8 to 7 and stopped checking its About button.
const ids = [...new Set([...Object.keys(EXPERIMENTAL_HELP.en || {}), ...Object.keys(OWN_HELP)])]
const reached = []
for (const id of ids) {
  const srcs = filesUnder(join(ROOT, 'plugin-designs', id)).map((p) => readFileSync(p, 'utf8'))
  const f = reachFails(id, srcs)
  fails.push(...f)
  if (!f.length) reached.push(id)
}
if (!ids.length) fails.push('experimentalHelp.js has no English entries, so there is nothing to check (wrong file?)')
// planted: a bundle whose "?" is not hosted, and an exemption whose control was removed
if (!reachFails('x', ['<HelpButton :is-dark="isDark" />']).length) fails.push('SELF-TEST: an unhosted HelpButton was accepted as reachable')
if (!reachFails('upg-neighbor', ['<div>no about here</div>']).length) fails.push('SELF-TEST: an exemption without its control was accepted')

if (fails.length) {
  console.error(`HELP-REACHABLE: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`HELP-REACHABLE: PASS — ${reached.length} of ${ids.length} Experimental maps reach their explainer from their own "?"`
  + ` (${Object.keys(OWN_HELP).length} through their own help control); doxa:help is bubbling + composed and crosses a shadow root;`
  + ' the app listens, marks its panes and has no top-centre button. 6 planted defects each caught.')
