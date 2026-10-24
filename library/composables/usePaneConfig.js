/**
 * usePaneConfig — keep a composite's panes' profile-config in step with the outer element's.
 *
 * ★ THE BUG THIS EXISTS FOR. A composite builds each pane by creating the child custom element and
 * writing its profile-config ONCE, inside onMounted:
 *
 *     el.setAttribute('profile-config', JSON.stringify(pcfg))   // and never again
 *
 * That is correct at mount and wrong for the rest of the session. The pane is handed a JSON STRING,
 * not a reactive object, so a later change to the OUTER element's profile-config updates the
 * composite's own `cfg` and reaches nothing below it. MEASURED on Regions: a live locale switch
 * en -> ar left the panes in English for the whole session, because regions-dashboard is kept alive
 * by v-show rather than remounted — the one code path that would have rewritten the attribute never
 * runs again. The leaf's own chain is fully reactive and was never at fault: it is reactive to its
 * own prop, and its prop is frozen.
 *
 * ★ WHY A HELPER RATHER THAN THREE FIXES. regions-mfe, upg-100-mfe and country-posters-mfe all build
 * their panes the same way — assemble a config object, stringify it, set the attribute once. They
 * differ only in WHICH keys they inherit. So the composite keeps its own INHERITED_PAGE_KEYS and its
 * own assembly, and hands the result here; this owns the part that was missing everywhere.
 *
 * ★ IT WRITES ONLY WHEN THE STRING CHANGES. Setting profile-config re-parses it in the child and can
 * remount what it drives, so an unconditional write on every reactive tick would be a rerender loop.
 * The previous value is remembered per element and compared before touching the DOM.
 *
 *     const panes = usePaneConfig(() => stage.value, TAG)
 *     panes.register(el, () => paneConfigFor(pane))   // at mount, after appendChild
 *
 * Re-forwarding happens inside a watchEffect, so any reactive source the getter reads — the outer
 * config, a computed spec, the pane's own config — triggers it.
 *
 * ★ NOT EVERY PANE IS CONFIGURED BY profile-config. people-groups-grid takes its filters as THREE
 * separate attributes (wagf-region, religion-family, primary-language) rather than one JSON blob, so
 * research-map-plus-grid has one pane of each kind. registerAttrs covers that second shape:
 *
 *     panes.registerAttrs(grid, () => ({ 'wagf-region': region.value, 'religion-family': fam.value }))
 *
 * It shares this list, this watchEffect, this prune and this write-only-on-change — deliberately, so
 * the second adopter rides ONE mechanism instead of forking a second. A helper with a single caller
 * has not been shown to generalise at all; this is the shape that showed it.
 */
import { watchEffect, onBeforeUnmount, shallowReactive, getCurrentInstance } from 'vue'

/**
 * @param {() => (Element|null|undefined)} hostGetter  the element the panes were appended under; used
 *        only to drop registrations whose element has left the DOM (a pane column can be rebuilt).
 *        ★ IT MUST BE IN THE SAME TREE AS THE PANES. Element.contains() does NOT cross a shadow
 *        boundary, so passing the custom element while its panes live in its shadow root would make
 *        every pane look detached and skip every write, silently.
 * @returns {{ register: (el: Element, configGetter: () => object) => void,
 *             registerAttrs: (el: Element, attrsGetter: () => Record<string,unknown>) => void,
 *             dispose: () => void, count: () => number }}
 */
export function usePaneConfig(hostGetter) {
  // ★ shallowReactive, NOT a plain array. The watchEffect below runs once, at the FIRST register();
  // with a plain array a LATER entry's getter is never tracked, so its pane stays frozen until
  // something the first entry reads happens to change. MEASURED with real Vue by studio: two panes
  // reading different refs, changing only pane 2's source produced ZERO writes. That is the very bug
  // this helper exists to fix, reappearing for any adopter whose panes read different sources.
  // Making the list reactive re-runs the effect on register() and re-tracks every getter.
  /**
   * One entry per registered pane. `attrs` is the ATTRIBUTE NAMES this entry owns: the single-key
   * ['profile-config'] for a JSON-configured pane, or the caller's list for an attribute-configured
   * one. `last` holds the previously written value PER ATTRIBUTE, so a getter that changes one of
   * three attributes writes one of three.
   * @type {Array<{el: Element, get: () => object, attrs: string[]|null, last: Record<string,string|null>, warned: boolean}>}
   */
  const entries = shallowReactive([])
  let stop = null

  const alive = (el) => {
    if (!el || !el.isConnected) return false
    const host = typeof hostGetter === 'function' ? hostGetter() : hostGetter
    // A pane column rebuild replaces the elements; an entry whose element is no longer under the
    // current host is stale and must not be written to.
    return !host || host.contains(el)
  }

  /** Add an entry and make sure the one shared effect is running. */
  function add(entry) {
    entries.push(entry)
    if (stop) return
    stop = watchEffect(() => {
      // PRUNE rather than skip: an adopter that rebuilds its pane column would otherwise keep
      // detached elements in the list and re-run their getters on every pass, forever.
      for (let i = entries.length - 1; i >= 0; i--) if (!alive(entries[i].el)) entries.splice(i, 1)
      for (const e of entries) forward(e)
    })
  }

  /** Re-evaluate one entry's getter and write only what changed. */
  function forward(entry) {
    let value
    // A getter that throws must not take the other panes down with it: this runs inside a
    // watchEffect, where an exception would stop every later entry in the same pass. It is
    // reported ONCE per entry -- silence here would recreate the symptom this helper fixes.
    try { value = entry.get() } catch (e) {
      if (!entry.warned) { entry.warned = true; console.error('[usePaneConfig] pane config getter threw; this pane will not follow the outer config:', e) }
      return
    }
    if (!entry.attrs) {
      // JSON pane: the whole config is one attribute.
      let next
      try { next = JSON.stringify(value) } catch (e) {
        if (!entry.warned) { entry.warned = true; console.error('[usePaneConfig] pane config did not stringify; this pane will not follow the outer config:', e) }
        return
      }
      if (next === entry.last['profile-config']) return
      entry.last['profile-config'] = next
      entry.el.setAttribute('profile-config', next)
      return
    }
    // Attribute pane: each named attribute is compared and written independently, so a getter whose
    // region changed does not rewrite (and so re-trigger) the two that did not.
    const bag = value && typeof value === 'object' ? value : {}
    for (const name of entry.attrs) {
      // An absent/null/undefined value is written as '' rather than the string "undefined" -- the
      // grid reads these as plain filter strings and "undefined" would be a filter that matches
      // nothing, which is the empty-grid failure this repo has already paid for once.
      const raw = bag[name]
      const next = raw === undefined || raw === null ? '' : String(raw)
      if (next === entry.last[name]) continue
      entry.last[name] = next
      entry.el.setAttribute(name, next)
    }
  }

  function register(el, configGetter) {
    if (!el || typeof configGetter !== 'function') return
    // The attribute the caller already set at mount is the baseline: recording it here means the
    // first watchEffect pass does not rewrite an identical value.
    add({ el, get: configGetter, attrs: null, last: { 'profile-config': el.getAttribute('profile-config') }, warned: false })
  }

  /**
   * The attribute-configured sibling. `attrsGetter` returns an object keyed by ATTRIBUTE NAME
   * (kebab-case, as written in the DOM), e.g. { 'wagf-region': 'africa' }.
   * ★ THE NAME LIST IS FIXED AT REGISTRATION, from the getter's first result. A pane's attribute
   * surface is static -- it is the element's contract -- and pinning it means a later getter that
   * omits a key CLEARS that attribute rather than silently leaving a stale filter applied, which is
   * the same class of lie as the frozen config this helper exists to fix.
   */
  function registerAttrs(el, attrsGetter) {
    if (!el || typeof attrsGetter !== 'function') return
    let first
    try { first = attrsGetter() } catch (e) {
      console.error('[usePaneConfig] attrs getter threw at registration; this pane is not registered:', e)
      return
    }
    const attrs = Object.keys(first && typeof first === 'object' ? first : {})
    if (!attrs.length) {
      console.error('[usePaneConfig] attrs getter returned no attribute names; this pane is not registered.')
      return
    }
    const last = {}
    for (const name of attrs) last[name] = el.getAttribute(name)
    add({ el, get: attrsGetter, attrs, last, warned: false })
  }

  // ★ GUARDED, the house pattern (useMapData.js:144). onBeforeUnmount only binds inside setup(); a
  // caller outside one gets a Vue warning and no auto-cleanup. `dispose` is returned so such a
  // caller has something to call -- silently leaking a watchEffect would be the worse half.
  const dispose = () => { if (stop) { stop(); stop = null } entries.length = 0 }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { register, registerAttrs, dispose, count: () => entries.length }
}

export default usePaneConfig
