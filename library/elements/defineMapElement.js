/**
 * defineMapElement.js — the one correct way to turn a profile into a custom element.
 *
 * Every plugin that ships a `<tag>` wraps ProfileLoader in Vue's defineCustomElement and configures the
 * app the same way: a per-instance Pinia, a per-instance i18n, and the profile's own .vue modules. Five
 * plugins did it by hand.
 *
 * ★ THE FOURTH LINE IS THE ONE THAT MATTERS, AND IT IS THE ONE THAT GETS LEFT OUT.
 * `app.provide('appI18n', i18n)` is not bookkeeping. ProfileLoader reads the instance back with
 * `inject('appI18n', null)` (ProfileLoader.vue:176) and drives its global locale from profile-config; if
 * nothing provided it, that watcher holds null and the drive never happens. `app.use(i18n)` alone LOOKS
 * complete — the catalogue is installed, t() resolves, nothing throws — and every component that reads
 * through useI18n()/t() is then stuck at the locale the app booted with, whatever the host asked for.
 *
 * ★ THE MEASUREMENT, from regions-dashboard/index.js:44-52, where this was hit and written down first:
 *   "app.use() alone is not enough: createAppI18n() resolves its locale ONCE from <html lang>, and every
 *    generated leaf page bakes lang=\"en\", so the element was permanently English no matter what the
 *    host asked for. ProfileLoader drives appI18n.global.locale.value from profile-config.locale (its
 *    established contract, ProfileLoader.vue:148-169) — but only if appI18n is PROVIDED. MEASURED before
 *    this line: with a Spanish catalogue present in the bundle and es set, every string still rendered
 *    English, and silently, because the t() shim falls back to its key rather than throwing."
 *
 * That last clause is why it survived in five plugins at once: the failure is a SILENT FALLBACK, so
 * nothing throws, and English looks like a working default to anyone developing in English.
 *
 * It fails quietly in the worst way: setRuntimeLocale() still runs, so the tStatic-based strings DO
 * follow the host, and the plugin renders a convincing mixture of the reader's language and English.
 * regions-dashboard's own comment records it being measured — a Spanish catalogue present, `es` set, and
 * every t() string still English — and gospel-resources/index.js is shipping exactly that today.
 *
 * So the provide is not a step in a list a caller has to remember. It is the reason this helper exists,
 * and check:element-bootstrap plants an element built without it as a negative case.
 */
import { defineCustomElement } from 'vue'
import { createPinia } from 'pinia'
import ProfileLoader from '../ProfileLoader.vue'
import { createAppI18n } from '../i18n/index.js'
import { provideOwn, withoutInheritedProvides } from './provide-own.js'

// ★ THE PILOT'S HOT-RELOAD SERVER PREVIEWS UNRELEASED CONTENT. globalThis.DXM_PREVIEW_UNRELEASED lets a preview show
// what is withheld from the public (the whole-India country poster, library/packet/countrySheet.js). It is set here,
// in every element's first module, ONLY under the Vite dev server: import.meta.env.DEV is a compile-time false in
// every build, so the build drops the line and no built bundle (the public tree, the research landing, DX Life's
// /dx-maps) can carry it. check:preview-flag-dev-only greps the built tree for any assignment of the flag.
if (import.meta.env && import.meta.env.DEV && typeof globalThis !== 'undefined') globalThis.DXM_PREVIEW_UNRELEASED = true

/**
 * @param {Object} o
 * @param {Object} o.profileModules  the profile's `import.meta.glob('./*.vue')` map — per-plugin, which
 *                                   is why it is a parameter and not something this file can find
 * @param {Function} [o.configureApp] extra per-plugin setup, run AFTER the standard three. It receives
 *                                    (app, { pinia, i18n }) so a plugin that needs the store can reach
 *                                    THE SAME pinia this created -- wall-of-people-groups takes a store
 *                                    off its own instance, and a helper that hid pinia would have given
 *                                    it a second one, which is two stores and a silent state split.
 * @returns {CustomElementConstructor}
 *
 * ★ AND EACH ELEMENT'S VALUES ARE ITS OWN, WHICH VUE WARNS ABOUT WHEN THEY NEST. A composite mounts
 * child custom elements, and Vue's CE layer lets a child app inherit its parent element's provides.
 * runtime-core's app.provide() then warns on every key that is already reachable —
 *   'App already provides property with key "profileModules" inherited from its parent element.
 *    It will be overwritten with the new value.'
 * — 8 of those per key, 24 in a live console (2026-09-28), for three keys where overwriting is
 * the POINT. `profileModules` is the plugin's own .vue glob and a child must not render its parent's
 * components; pinia is per-instance so two embeds never bleed state; and the i18n instance is what
 * ProfileLoader drives from THIS element's profile-config, which is the whole of the permanently-
 * English fix. Inheriting any of the three would be the bug, not the warning.
 *
 * So the shadow is made DELIBERATE rather than silenced: provideOwn() writes straight to the app's own
 * provides when the key is already reachable, and uses the public app.provide() when it is not. Vue's
 * warning exists to catch an ACCIDENTAL overwrite; this says, at the one line that does it, that this
 * one is meant. Nothing about the resolved values changes — a child gets exactly what it got before.
 *
 * ★ CALL IT ONCE PER TAG. Vue's defineCustomElement returns a CLASS, and registering one class under
 * two tag names is undefined behaviour — doxa-simple-map ships two tags and calls this twice for that
 * reason. A helper that cached and returned one class would reintroduce the bug it was written around.
 */
/**
 * provide(), minus the dev warning, for a value that is MEANT to shadow a parent element's.
 * Falls through to the public API whenever the key is absent, so the ordinary path is unchanged and
 * only the intentional shadow touches internals.
 */
export function defineMapElement({ profileModules = {}, configureApp = null } = {}) {
  return defineCustomElement(ProfileLoader, {
    configureApp(app) {
      // Per-instance, so two embeds on one page never bleed state into each other.
      const pinia = createPinia()
      // ★ pinia PROVIDES ITS OWN KEY DURING install(), and its symbol is not exported, so it cannot be
      // shadowed by name the way the two below are. Hiding the INHERITED provides for the duration of
      // the install makes the key genuinely absent, so app.use takes its ordinary path with no warning,
      // and the chain is restored on the next line — every other inherited value still resolves.
      // A per-element pinia is deliberate: two embeds on one page must never bleed store state.
      withoutInheritedProvides(app, () => app.use(pinia))
      const i18n = createAppI18n()
      app.use(i18n)
      // ★ BY REFERENCE, NOT JUST INSTALLED. See the header: without this the element is stuck at its
      // boot locale and says so to nobody.
      provideOwn(app, 'appI18n', i18n)
      provideOwn(app, 'profileModules', profileModules)
      if (configureApp) configureApp(app, { pinia, i18n })
    },
  })
}

export default defineMapElement
