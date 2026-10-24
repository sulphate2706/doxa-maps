/**
 * provide-own.js — provide a value that is MEANT to shadow a parent element's, with NO framework import.
 *
 * Split from defineMapElement.js deliberately: that module imports ProfileLoader.vue, so it cannot be
 * loaded by a node gate. The DECISION lives where it can be executed; the WIRING lives where it needs
 * Vue. Same split as library/composables/host-token-url.js and library/packets/describeGroup.js.
 *
 * ★ WHY SHADOWING IS CORRECT HERE. Vue's CE layer lets a nested custom element inherit its parent
 * element's provides, and app.provide() warns on any key already reachable — 24 of those in a live
 * console (2026-09-28), 8 each for profileModules, appI18n and pinia's symbol. All three must
 * be the child's OWN: profileModules is the plugin's own .vue glob, pinia is per-instance so two embeds
 * never bleed state, and the i18n instance is what ProfileLoader drives from THIS element's
 * profile-config. Inheriting any of them would be the bug. The warning is Vue reporting an intentional
 * act, so the act is made explicit rather than the warning silenced.
 */

/**
 * app.provide(), minus the overwrite warning, for a key we can name.
 * Falls through to the public API when the key is absent, so the ordinary path is untouched and only
 * the intentional shadow reaches into the app's own provides.
 */
export function provideOwn(app, key, value) {
  const provides = app?._context?.provides
  if (provides && key in provides) { provides[key] = value; return }
  app.provide(key, value)
}

/**
 * Run `fn` with the app's INHERITED provides hidden, then restore them.
 * For a value whose key cannot be named — pinia's symbol is module-private, so it can only be provided
 * by calling app.use() — making the key genuinely absent is the only way to take the public path
 * without the warning. Restored in a `finally`, so a throwing install cannot leave an element unable to
 * see its parent.
 */
export function withoutInheritedProvides(app, fn) {
  const provides = app?._context?.provides
  const inherited = provides ? Object.getPrototypeOf(provides) : null
  if (inherited) Object.setPrototypeOf(provides, null)
  try { return fn() } finally { if (inherited) Object.setPrototypeOf(provides, inherited) }
}
