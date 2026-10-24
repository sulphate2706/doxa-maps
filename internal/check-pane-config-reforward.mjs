#!/usr/bin/env node
/**
 * check-pane-config-reforward — a composite's panes keep following the outer config for the whole
 * session, and a locale change never rewrites a filter into a display name.
 *
 * ★ THE BUG THIS GUARDS, measured on development 92ca8b6e6 across FOUR composites
 * (regions-mfe, upg-100-mfe, country-posters-mfe, research-map-plus-grid). The outer element's
 * profile-config reached locale 'ar' by +1.5 s — attribute AND property, same node — while every
 * NESTED host carried NO locale key at boot and still none at +15 s. Text per composite at +15 s:
 * the chrome switched (3 Arabic / 0 Latin) and the panes did not (0/205, 0/190, 0/618, 0/43).
 * The cause is one line per composite: the pane's profile-config is written ONCE, in onMounted, so
 * the pane holds a JSON STRING and every later change stops at the composite. The leaf's own chain
 * is fully reactive and was never at fault.
 *
 * ★ IT RUNS THE SHIPPED HELPER WITH REAL VUE. usePaneConfig is imported, not re-typed, and driven
 * by real refs through a real watchEffect — the dependency-tracking hole this gate's case 3 covers
 * (a plain array leaves a LATER entry's getter untracked) is invisible to any test that fakes
 * reactivity, and it was found only because a test used real Vue.
 *
 * ★ AND IT ASSERTS THE DOM, NOT THE RETURN VALUE. Every case reads the attribute back off the
 * element, because "the helper decided to write" and "the pane was told" are different claims and
 * only the second one is the fix.
 *
 * Exit 0 pass · 1 fail.
 */
import { ref, reactive, nextTick } from 'vue'
import { usePaneConfig } from '../library/composables/usePaneConfig.js'

let bad = 0
const ok = (cond, what) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`) }

/**
 * The smallest element that can hold attributes and answer contains(). Not a DOM shim in general —
 * only the surface the helper actually touches, so a change in what it touches breaks loudly here
 * rather than passing against a stub that pretends to be a browser.
 */
function makeEl(name = 'pane') {
  const attrs = new Map()
  return {
    name,
    isConnected: true,
    writes: 0,
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute(k, v) { attrs.set(k, String(v)); this.writes++ },
  }
}
const makeHost = (children) => ({ contains: (el) => children.includes(el) })

// ★ NULL-SAFE DELIBERATELY. When the re-forward is broken the attribute is absent, and a gate that
// CRASHES on that reports "something went wrong somewhere" instead of naming the pane that stopped
// following. Verified against the plain-array mutation: it turns a TypeError into a named FAIL.
const cfgOf = (el) => {
  const raw = el.getAttribute('profile-config')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// ── 1. THE MEASURED DEFECT. A locale change after mount must reach the pane.
{
  const outer = ref({ locale: 'en', apiBaseUrl: '/api' })
  const el = makeEl()
  const host = makeHost([el])
  const paneConfig = usePaneConfig(() => host)
  // Mount-time write, exactly as the composite does it before registering.
  el.setAttribute('profile-config', JSON.stringify({ ...outer.value, profile: 'regions-list' }))
  paneConfig.register(el, () => ({ ...outer.value, profile: 'regions-list' }))
  await nextTick()
  const atMount = el.writes
  ok(cfgOf(el).locale === 'en', 'at mount the pane has the outer locale')

  outer.value = { locale: 'ar', apiBaseUrl: '/api' }
  await nextTick()
  ok(cfgOf(el).locale === 'ar', 'after a live locale switch the pane has been told (this is the bug: it used to stay en)')
  ok(el.writes === atMount + 1, `exactly one re-write, not a loop (${el.writes - atMount})`)
  ok(cfgOf(el).profile === 'regions-list', "the pane's own keys survive the re-forward")
  paneConfig.dispose()
}

// ── 1b. NO LOCALE KEY AT BOOT IS THE REAL BEFORE-STATE, not a stale one. A browser check measured the nested
// hosts carrying no locale key at all, so the first re-forward is absent -> 'ar'.
{
  const outer = ref({ apiBaseUrl: '/api' })
  const el = makeEl()
  const paneConfig = usePaneConfig(() => makeHost([el]))
  el.setAttribute('profile-config', JSON.stringify({ ...outer.value }))
  paneConfig.register(el, () => ({ ...outer.value }))
  await nextTick()
  ok(cfgOf(el).locale === undefined, 'the measured boot state: no locale key on the nested host')
  outer.value = { apiBaseUrl: '/api', locale: 'ar' }
  await nextTick()
  ok(cfgOf(el).locale === 'ar', 'an ABSENT locale key is still a change, so the write fires')
  paneConfig.dispose()
}

// ── 2. NO WRITE WHEN NOTHING CHANGED. Setting profile-config re-parses it in the child and can
// remount what it drives, so an unconditional write on every reactive tick is a rerender loop.
{
  const outer = ref({ locale: 'en' })
  const unrelated = ref(0)
  const el = makeEl()
  const paneConfig = usePaneConfig(() => makeHost([el]))
  el.setAttribute('profile-config', JSON.stringify(outer.value))
  paneConfig.register(el, () => ({ ...outer.value, tick: unrelated.value && 0 }))
  await nextTick()
  const before = el.writes
  unrelated.value = 7                       // reactive churn that does not change the config
  await nextTick()
  ok(el.writes === before, `an unchanged config writes nothing (${el.writes - before} writes)`)
  paneConfig.dispose()
}

// ── 3. EVERY PANE FOLLOWS, NOT ONLY THE FIRST. ★ THE REGRESSION STUDIO FOUND. With a plain array
// the watchEffect tracks only the getters reachable on its FIRST run, so pane 2's source is never a
// dependency: changing it produced ZERO writes. That is this very bug, reappearing inside its own
// fix, for any adopter whose panes read different sources.
// It is also plugin-studio's load-bearing property, recorded at plugin-studio.vue:897: "EVERY
// mounted pane, not only the one on screen: a kept-alive pane showed the old language when the
// reader came back to it."
{
  const a = ref('en')
  const b = ref('en')
  const elA = makeEl('a')
  const elB = makeEl('b')
  const paneConfig = usePaneConfig(() => makeHost([elA, elB]))
  paneConfig.register(elA, () => ({ locale: a.value }))
  paneConfig.register(elB, () => ({ locale: b.value }))
  await nextTick()
  b.value = 'ar'                            // ONLY the second pane's source
  await nextTick()
  ok(cfgOf(elB).locale === 'ar', 'the SECOND registered pane follows its own source (a plain array left this untracked)')
  ok(cfgOf(elA).locale === 'en', 'and the first pane is not disturbed by it')
  a.value = 'ro'
  await nextTick()
  ok(cfgOf(elA).locale === 'ro', 'the first pane still follows after the second has fired')
  paneConfig.dispose()
}

// ── 4. A DETACHED PANE IS DROPPED, not written to. A pane column rebuild replaces the elements.
{
  const outer = ref({ locale: 'en' })
  const kept = makeEl('kept')
  const gone = makeEl('gone')
  let children = [kept, gone]
  const paneConfig = usePaneConfig(() => makeHost(children))
  paneConfig.register(kept, () => ({ ...outer.value }))
  paneConfig.register(gone, () => ({ ...outer.value }))
  await nextTick()
  ok(paneConfig.count() === 2, 'both panes registered')
  children = [kept]                          // the column was rebuilt; `gone` is no longer under it
  gone.isConnected = false
  const goneWrites = gone.writes
  outer.value = { locale: 'ar' }
  await nextTick()
  ok(gone.writes === goneWrites, 'a detached pane is not written to')
  ok(paneConfig.count() === 1, `and it is PRUNED rather than re-tested forever (count ${paneConfig.count()})`)
  ok(cfgOf(kept).locale === 'ar', 'the surviving pane still follows')
  paneConfig.dispose()
}

// ── 5. ONE PANE'S THROWING GETTER DOES NOT TAKE THE OTHERS DOWN. Inside a watchEffect an exception
// stops every LATER entry in the same pass — which would silently freeze panes that are fine.
{
  const outer = ref({ locale: 'en' })
  const boom = makeEl('boom')
  const fine = makeEl('fine')
  const paneConfig = usePaneConfig(() => makeHost([boom, fine]))
  const realError = console.error
  let errors = 0
  console.error = () => { errors++ }
  paneConfig.register(boom, () => { throw new Error('pane getter exploded') })
  paneConfig.register(fine, () => ({ ...outer.value }))
  await nextTick()
  outer.value = { locale: 'ar' }
  await nextTick()
  console.error = realError
  ok(cfgOf(fine).locale === 'ar', 'a pane registered AFTER a throwing one still follows the outer config')
  ok(errors >= 1, `and the throw is reported rather than swallowed (${errors})`)
  ok(errors <= 2, `but not once per reactive tick forever (${errors})`)
  paneConfig.dispose()
}

// ── 6. registerAttrs: THE SECOND PANE SHAPE. people-groups-grid takes three separate attributes
// rather than one JSON blob (research-map-plus-grid.vue:430-435). Same list, same effect, same
// write-on-change — the point of generalising rather than letting the second adopter fork.
{
  const linked = reactive({ region: '', religion: '', language: 'arb' })
  const grid = makeEl('grid')
  const paneConfig = usePaneConfig(() => makeHost([grid]))
  paneConfig.registerAttrs(grid, () => ({
    'wagf-region': linked.region,
    'religion-family': linked.religion,
    'primary-language': linked.language,
  }))
  await nextTick()
  ok(grid.getAttribute('primary-language') === 'arb', 'an attribute-configured pane is written at registration')
  const before = grid.writes
  linked.region = 'africa'
  await nextTick()
  ok(grid.getAttribute('wagf-region') === 'africa', 'a changed attribute is written')
  ok(grid.writes === before + 1, `ONLY the changed attribute is written, not all three (${grid.writes - before})`)
  ok(grid.getAttribute('religion-family') === '', 'an empty value is written as empty, never the string "undefined"')
  paneConfig.dispose()
}

// ── 6b. A KEY THE GETTER LATER OMITS IS CLEARED, not left applied. A stale filter silently
// narrowing the grid is the same class of lie as the frozen config this helper exists to fix.
{
  const linked = reactive({ region: 'africa', present: true })
  const grid = makeEl('grid')
  const paneConfig = usePaneConfig(() => makeHost([grid]))
  paneConfig.registerAttrs(grid, () => (linked.present
    ? { 'wagf-region': linked.region, 'religion-family': 'islam' }
    : { 'religion-family': 'islam' }))
  await nextTick()
  ok(grid.getAttribute('wagf-region') === 'africa', 'the filter is applied')
  linked.present = false
  await nextTick()
  ok(grid.getAttribute('wagf-region') === '', 'an omitted key CLEARS its attribute rather than leaving a stale filter')
  paneConfig.dispose()
}

// ── 7. ★ LOCALE-INVARIANCE OF A FILTER VALUE (sr's property, SR-ADOPT-ANSWERS). A re-forward
// triggered by a LOCALE change must produce the SAME primary-language string it produced before.
// The hazard is real and general even though it does not bite today: research-map-plus-grid's
// gridLanguage() falls back to `linked.language.value || linked.language.label`, and `label` is a
// DISPLAY NAME. The grid's valueMatches() compares whole normalised values, so a name fetched in
// one language matches no row in another — the failure that took the grid 2,107 -> 0 and read as
// "no results" (measured 2026-09-26). This asserts the CLASS, not today's instance.
{
  const locale = ref('en')
  // A language whose display label follows the locale, as the API returns it, but whose code does not.
  const NAMES = { en: 'Arabic, Sudanese', ar: 'العربية السودانية' }
  const linkedLanguage = () => ({ codes: ['apd'], value: 'apd', label: NAMES[locale.value] })
  const gridLanguage = () => {
    const l = linkedLanguage()
    const codes = Array.isArray(l.codes) ? l.codes : []
    if (codes.length > 1) return codes.join('|')
    return l.value || l.label
  }
  const grid = makeEl('grid')
  const paneConfig = usePaneConfig(() => makeHost([grid]))
  paneConfig.registerAttrs(grid, () => ({ 'primary-language': gridLanguage(), 'wagf-region': `r-${locale.value === 'x' ? 1 : 0}` }))
  await nextTick()
  const beforeSwitch = grid.getAttribute('primary-language')
  locale.value = 'ar'
  await nextTick()
  ok(grid.getAttribute('primary-language') === beforeSwitch,
    `a locale change leaves primary-language unchanged ('${beforeSwitch}' -> '${grid.getAttribute('primary-language')}')`)
  ok(!/[؀-ۿ]/.test(grid.getAttribute('primary-language')),
    'the filter is a CODE, never a localised display name')
  paneConfig.dispose()
}

// ── 8. DISPOSE STOPS THE EFFECT. A composite unmounted and left watching is a leak that keeps
// writing to detached elements.
{
  const outer = ref({ locale: 'en' })
  const el = makeEl()
  const paneConfig = usePaneConfig(() => makeHost([el]))
  paneConfig.register(el, () => ({ ...outer.value }))
  await nextTick()
  paneConfig.dispose()
  const after = el.writes
  outer.value = { locale: 'ar' }
  await nextTick()
  ok(el.writes === after, 'after dispose() the outer config is no longer followed')
  ok(paneConfig.count() === 0, 'and the entry list is emptied')
}

// ── 9. IT DOES NOT THROW OUTSIDE setup(). Every case above runs outside a component instance, which
// is the un-guarded onBeforeUnmount hazard studio raised — if that guard regressed, this file would
// have failed at the first register() rather than here. Stated so the reason is on the record.
ok(true, 'the whole file ran outside setup(): the getCurrentInstance() guard holds')

if (bad) {
  console.error(`\nPANE-CONFIG-REFORWARD: FAIL — ${bad} case(s). A composite's panes no longer follow the`)
  console.error('outer profile-config, so a live locale switch leaves every nested pane in the old language.')
  process.exit(1)
}
console.log('\nPANE-CONFIG-REFORWARD: PASS — panes follow the outer config for the session, and a locale change never rewrites a filter value.')
