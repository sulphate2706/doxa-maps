#!/usr/bin/env node
/**
 * check-map-props-unit — the engine and token props, decided in the library, measured WITHOUT a browser.
 *
 * resolveMapProvider ('auto' is ALWAYS MapLibre since 2026-09-28; a token no longer selects an engine; an explicit provider
 * wins), and the page-wide token (useSharedMapToken): publish, CLEAR, and a token-service URL. Runs the
 * real library modules in Node against a stand-in window/location, so it is fast and needs no browser.
 *
 * Each case names the defect it guards (U3 = Clear left the old token live, U1 = tokenUrl read by nothing,
 * U7 = mixed-case provider dropped).
 *
 * USAGE  node internal/check-map-props-unit.mjs          EXIT 0 pass · 1 fail
 */
const listeners = {}
globalThis.window = globalThis
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail } }
window.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f) }
window.removeEventListener = (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f) }
window.dispatchEvent = (e) => { for (const f of listeners[e.type] || []) f(e); return true }
let search = ''
Object.defineProperty(globalThis, 'location', { configurable: true, get: () => ({ search }) })

const { resolveMapProvider, hasMapToken, explicitMapProvider, DEFAULT_PROVIDER } = await import('../library/composables/useMapProvider.js')
const shared = await import('../library/composables/useSharedMapToken.js')

let bad = 0
const eq = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(64)} ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`) }
const reset = () => { search = ''; delete window.MAP_PROVIDER; shared.clearMapToken(); window.__doxaMapTokenPending = null }
const TK = ['pk', 'eyJ1IjoidGVzdCJ9', 'c2ln'].join('.')

console.log('MAP-PROPS: the library, in Node (no browser)')
eq('default is auto', DEFAULT_PROVIDER, 'auto')
reset(); eq('auto, no token anywhere → maplibre', resolveMapProvider({}), 'maplibre')
// ★ THESE FOUR ASSERTED THE OLD RULE, in which merely HOLDING a token chose Mapbox. They are
// inverted rather than deleted, because the point is not that a token is ignored — it is that a
// token is a CAPABILITY and the engine is a DECISION, and only the decision belongs here. Each of
// these is a host who pasted a real token into a published snippet and set no provider: that is
// the entire migration surface, and it is exactly what changes.
reset(); eq('auto, tk in profile-config → maplibre (was mapbox)', resolveMapProvider({ tk: TK }), 'maplibre')
reset(); eq('auto, placeholder tk YOUR_MAPBOX_TOKEN → maplibre', resolveMapProvider({ tk: 'YOUR_MAPBOX_TOKEN' }), 'maplibre')
reset(); window.MAP_TOKEN = TK; eq('auto, host window.MAP_TOKEN → maplibre (was mapbox)', resolveMapProvider({}), 'maplibre')
reset(); eq('auto, a token the caller holds (useMapInstance) → maplibre (was mapbox)', resolveMapProvider({}, { token: TK }), 'maplibre')
reset(); eq('auto, tokenUrl in profile-config → maplibre (was mapbox, U1)', resolveMapProvider({ tokenUrl: 'https://example.org/token' }), 'maplibre')
reset(); eq('explicit maplibre with a token → maplibre', resolveMapProvider({ provider: 'maplibre', tk: TK }), 'maplibre')
reset(); eq('explicit mapbox without a token → mapbox', resolveMapProvider({ provider: 'mapbox' }), 'mapbox')
// The opt-in still works WITH a token, which is the path a migrating host takes.
reset(); eq('explicit mapbox WITH a token → mapbox (the documented way to keep Mapbox)', resolveMapProvider({ provider: 'mapbox', tk: TK }), 'mapbox')
// And a token remains VISIBLE — it just does not vote. If this ever returned false the engine
// would still be right while authentication silently broke, so the two are asserted apart.
reset(); eq('a real token is still SEEN by hasMapToken (capability, not choice)', hasMapToken({ tk: TK }), true)
reset(); eq('mixed case "MapLibre" is honoured (U7)', resolveMapProvider({ provider: 'MapLibre', tk: TK }), 'maplibre')
reset(); search = '?provider=maplibre'; window.MAP_TOKEN = TK; eq('?provider=maplibre wins over a host token', resolveMapProvider({}), 'maplibre')
reset(); window.MAP_PROVIDER = 'mapbox'; eq('window.MAP_PROVIDER is explicit', explicitMapProvider({}), 'mapbox')
reset(); eq('"auto" is not explicit', explicitMapProvider({ provider: 'auto' }), '')

// ── the page-wide token ──
reset()
const tok = shared.useSharedMapToken()
shared.publishMapToken(TK)
eq('publish reaches window.MAP_TOKEN', window.MAP_TOKEN, TK)
eq('publish reaches a live element (ref)', tok.value, TK)
shared.clearMapToken()
eq('CLEAR empties window.MAP_TOKEN (U3)', window.MAP_TOKEN || '', '')
eq('CLEAR reaches a live element (U3)', tok.value, '')
eq('after CLEAR, auto → maplibre (U3)', resolveMapProvider({}), 'maplibre')
window.MAP_TOKEN = TK
eq('after CLEAR, a host assignment is adopted again (bridge intact, U3)', tok.value, TK)
eq('hasMapToken sees it', hasMapToken({}), true)

// The OLD Clear path: `delete window.MAP_TOKEN` + publishMapToken('') leaves the old token live (publishing
// '' is a no-op by design, which is why Clear needs clearMapToken). It also used to remove the bridge for
// good; the bridge now re-installs itself, so a later host token is adopted again.
reset(); shared.publishMapToken(TK)
delete window.MAP_TOKEN; shared.publishMapToken('')
eq('reproduction: the old Clear left the OLD token live on elements', tok.value, TK)
window.MAP_TOKEN = 'pk.other'
eq('self-heal: after that delete, a later host token reaches elements again', tok.value, 'pk.other')
window.__doxaMapToken = ''; window.MAP_TOKEN = ''

// ── token-service URL (U1) ──
reset()
globalThis.fetch = async (url) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ token: url.includes('good') ? TK : 'sk.secret' }) })
const got = await shared.fetchMapToken('https://example.org/good')
eq('tokenUrl answer is published page-wide (U1)', window.MAP_TOKEN, TK)
eq('fetchMapToken resolves with it', got, TK)
reset()
const secret = await shared.fetchMapToken('https://example.org/bad')
eq('a non-public (sk.) answer is refused', secret, '')
eq('…and nothing is published', window.MAP_TOKEN || '', '')

if (bad) { console.log(`MAP-PROPS: FAIL — ${bad} case(s).`); process.exit(1) }
console.log('MAP-PROPS: PASS — auto is ALWAYS MapLibre, a token is a capability and never a choice, explicit wins, Clear clears.')
