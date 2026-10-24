/**
 * doxa-maps Vite config — per-bundle IIFE build.
 * WHY? -> !!! EACH BUNDLE ONLY BUNDLES WHAT IT NEEDS BASED ON ITS APP PROFILE :)
 * Layout:
 *   library/               ← shared library (components, composables, config, etc.; aliased as @map)
 *   plugin-designs/<name>/   ← bundle source folder
 *     ├── index.html       ← Vite html entry (staging page; loads index.js as a module in dev)
 *     ├── index.js         ← bundle entry — registers the custom element (globs ./*.vue)
 *     └── *.vue            ← profile components at the bundle root (auto-discovered via import.meta.glob('./*.vue'))
 *   app/doxa-maps/         ← build output tree (see below)
 *
 * Build mode: each invocation builds ONE bundle (selected via BUNDLE env var) so we can
 * use IIFE format with inlineDynamicImports. The npm `build` script runs vite once per
 * plugin-designs/<name>/ folder, emitting app/doxa-maps/<bundle>/<bundle>.js. After all
 * bundles are built, `generate-tree.mjs` writes the manifest + self-contained staging
 * HTML into the tree and copies the whole doxa-maps/ folder to every destination
 * (default ./app/ + each line in vite.destination.md).
 *
 * Dev mode (`npm run dev`): no BUNDLE selection — Vite serves all bundles at their html
 * paths under the dev server.
 */
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { autoSpaDevPlugin } from './internal/plugin-gallery/dev-plugin.mjs'
import { stripShadowCssCommentsPlugin } from './internal/vite-plugin-strip-shadow-css-comments.mjs'
import { backendDevPlugin, devBackendProxy } from './internal/backend-dev-plugin.mjs'
import { devSyncPlugin } from './internal/dev-sync-plugin.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { TREE_NAME, GATED_PROFILES, SHARE_BASE } from './internal/_tree-name.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Ship only the ACTIVE locale: inline `en` (the fallbackLocale) and emit the other ten beside each
// bundle for the runtime to fetch. Off by default — the build is byte-identical until it is set —
// so this can land, be measured, and be turned on as a separate decision.
const SHIP_ONE_LOCALE = process.env.DX_SHIP_ONE_LOCALE === '1'
const profilesDir = resolve(__dirname, 'plugin-designs')

// The multi-MFE output folder name is configured in vite.doxa-maps-build-config.json (`name`),
// so you can name the output tree independently of this bundler folder's own name. It is read in
// ONE place, internal/_tree-name.mjs, which every tool shares — so renaming the tree is a one-line
// config change rather than a hunt through the gates.
const MFE_NAME = TREE_NAME

// Default output tree. generate-tree.mjs reads the same name + copies it onward.
// DOXA_OUT_ROOT redirects a build's output WITHOUT touching public/: check:composite rebuilds each
// composite into a temp dir and compares bytes with the committed bundle. Unset = unchanged behaviour.
// ★ A GATED bundle (gatedProfiles) never builds into public/: it goes to .gated/<tree>/, which git ignores.
// Leaving it out of the manifest was not enough: its .js sat in public/<tree>/<bundle>/, so any host that
// serves or copies the folder (the drop-in copies <tree>/ whole) shipped it anyway.
const OUT_ROOT = process.env.DOXA_OUT_ROOT ? resolve(process.env.DOXA_OUT_ROOT)
  : GATED_PROFILES.includes(process.env.BUNDLE) ? resolve(__dirname, '.gated', MFE_NAME)
  : resolve(__dirname, 'public', MFE_NAME)

function discoverBundles() {
  if (!existsSync(profilesDir)) return {}
  const entries = {}
  for (const name of readdirSync(profilesDir)) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const dir = resolve(profilesDir, name)
    if (!statSync(dir).isDirectory()) continue
    const html = resolve(dir, 'index.html')
    const js = resolve(dir, 'index.js')
    if (!existsSync(html) || !existsSync(js)) continue
    entries[name] = { html, js }
  }
  return entries
}

// Narrow library/i18n/index.js's catalogue glob to the areas one bundle uses (see plugins below).
/** Locale folders on disk — directories only, so a README beside them is not read as a locale. */
const localeDirs = () => readdirSync(join(__dirname, 'library/i18n/locales'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort()

/** The exact JSON this build will emit for one locale, so its hash describes what actually ships. */
function localeTree(areas, lc) {
  const root = join(__dirname, 'library/i18n/locales')
  const tree = {}
  for (const a of areas) {
    const p = join(root, lc, `${a}.json`)
    if (!existsSync(p)) continue               // missing area: falls back to English by design
    try { tree[a] = JSON.parse(readFileSync(p, 'utf8')) } catch { /* skip an unreadable area */ }
  }
  return Object.keys(tree).length ? JSON.stringify(tree) : null
}

function i18nAreasPlugin(bundle) {
  let areas = null
  return {
    name: 'doxa-i18n-areas',
    enforce: 'pre',
    async buildStart() {
      const { areasForBundle } = await import('./internal/i18n-areas.mjs')
      areas = areasForBundle(__dirname, bundle).areas
      this.info?.(`i18n areas for ${bundle}: ${areas.join(', ') || '(none)'}`)
    },
    transform(code, id) {
      if (!areas || !id.replace(/\\/g, '/').endsWith('/library/i18n/index.js')) return null
      const GLOB = "import.meta.glob('./locales/*/*.json'"
      if (!code.includes(GLOB)) this.error('i18n catalogue glob not found in library/i18n/index.js; cannot narrow it')
      // ★ THE LOCALE STAR IS THE SECOND DIMENSION. With DX_SHIP_ONE_LOCALE on, only `en` is inlined
      // — it is the fallbackLocale, so it must be — and the other ten are emitted below as assets
      // this bundle fetches. Measured on doxa-simple-map: the ten unused locales are 113 KB gzip,
      // 40% of what a reader downloads. Without the flag the glob keeps every locale, so this is
      // the same build it has always been until someone turns it on.
      const loc = SHIP_ONE_LOCALE ? 'en' : '*'
      const list = areas.length ? '[' + areas.map((a) => `'./locales/${loc}/${a}.json'`).join(', ') + ']' : "['./locales/*/__none__.json']"
      let out = code.replace(GLOB, 'import.meta.glob(' + list)
      // ★ THE PIN TRAVELS WITH THE BUNDLE. Embeds are SRI-pinned and a fetched catalogue would not
      // be, so each emitted file's sha384 is baked in here and passed to fetch({ integrity }). A
      // swapped catalogue then fails closed to English instead of injecting text into the page.
      // Hashed from localeTree() — the same bytes generateBundle() emits, so the pin cannot describe
      // a file that was never shipped.
      if (SHIP_ONE_LOCALE) {
        const sri = {}
        for (const lc of localeDirs()) {
          if (lc === 'en') continue
          const json = localeTree(areas, lc)
          if (json) sri[lc] = 'sha384-' + createHash('sha384').update(json).digest('base64')
        }
        out = `const __DX_LOCALE_SRI__ = ${JSON.stringify(sri)};\n` + out
      }
      return { code: out, map: null }
    },
    // Emit <bundle>/locales/<lc>.json for every locale the IIFE no longer carries, holding exactly
    // the areas this bundle uses — the same areasForBundle() answer the glob above was narrowed
    // with, so the two dimensions cannot drift apart. Emitted from THIS plugin on purpose: the
    // composite-freshness, landing-consumers, fix:sri and .gated/ steps already walk the build's
    // own output, so assets that appear here are covered with no new pipeline step.
    generateBundle() {
      if (!SHIP_ONE_LOCALE || !areas?.length) return
      for (const lc of localeDirs()) {
        if (lc === 'en') continue                      // inlined: never fetched
        const json = localeTree(areas, lc)
        // fileName is already relative to this bundle's output dir — prefixing the bundle name
        // again produced <bundle>/<bundle>/locales/, which the runtime would never find.
        if (json) this.emitFile({ type: 'asset', fileName: `locales/${lc}.json`, source: json })
      }
    },
  }
}

export default defineConfig(({ command, mode }) => {
  // .env values (VITE_MAPBOX_TOKEN) are NOT on process.env inside this config —
  // load them explicitly so the dev plugin gallery can hand the token to each map.
  const env = loadEnv(mode, __dirname, '')
  const all = discoverBundles()
  const allNames = Object.keys(all)
  const target = process.env.BUNDLE
  const isBuild = command === 'build'

  if (isBuild && !target) {
    throw new Error(
      `[${MFE_NAME}] Set BUNDLE=<name> for build, or use \`npm run build\` (loops all).\n` +
      `Available: ${allNames.join(', ') || '(none)'}`
    )
  }

  if (isBuild && !all[target]) {
    // A plugin-designs/<name>/ folder was passed as BUNDLE but has no index.html+index.js
    // entry pair (e.g. a half-authored map, or a folder still being scaffolded). Fail with
    // a clear, actionable message instead of a `Cannot read properties of undefined` stack.
    throw new Error(
      `[${MFE_NAME}] Bundle "${target}" is not buildable: plugin-designs/${target}/ is missing ` +
      `index.html and/or index.js (the custom-element entry pair every bundle needs).\n` +
      `Buildable bundles: ${allNames.join(', ') || '(none)'}`
    )
  }

  const buildEntries = isBuild
    ? { [target]: all[target].js }
    : Object.fromEntries(allNames.map(n => [n, all[n].html]))

  return {
    // COMPILE-TIME QA GATE (release governance): the QA corner widget references
    // the maintainer's internal platform and must NOT exist in public
    // artifacts. Default FALSE strips it from every bundle (dead-branch +
    // treeshake); an explicitly-flagged platform build sets DOXA_QA=1.
    // The dev server listens on THIS MACHINE ONLY. A reachable one serves the source tree, node_modules
    // and the token baked into /; a remote viewer reaches it through an ssh tunnel (ssh -L), never a public
    // port. `--host` on the command line still overrides this for a deliberate LAN session.
    // Local plugin backends (backend/, e.g. rudder-engine) are started by backendDevPlugin and reached
    // through these same-origin routes, so a plugin calls /api/<name>/… in dev exactly as on desktop.
    // NOT WATCHING public/ (the first laptop run with DX_SYNC_REMOTE, 2026-09-28): a landing rewrites
    // dozens of built leaf index.html files there, and Vite answers each changed .html with a FULL page reload
    // (measured: one edited leaf page -> one full-reload broadcast), so a pull fired a burst of reloads while
    // git was still writing and the page went white. The dev server never serves public/ through its module
    // graph (the script-embed route reads it on request), so nothing there needs watching.
    server: { host: '127.0.0.1', proxy: devBackendProxy(env), watch: { ignored: ['**/public/**'] } },
    define: {
      // ★ NO 'unsafe-eval' (CRITIC-4, 2026-09-26). vue-i18n's default message compiler builds each message
      // with `new Function`, so a partner with a strict Content-Security-Policy saw every translated string
      // fail. The JIT compiler (vue-i18n >= 9.3) compiles messages to an AST and evaluates it without eval;
      // defining the flag lets the bundler drop the eval path entirely (check:no-eval asserts it).
      __INTLIFY_JIT_COMPILATION__: 'true',
      __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
      __DOXA_QA__: JSON.stringify(process.env.DOXA_QA === '1'),
      // The output tree's name (vite.doxa-maps-build-config.json `name`, the same value OUT_ROOT uses),
      // for the few runtime paths that must name the tree — so renaming the tree needs no source edit.
      __DOXA_TREE_NAME__: JSON.stringify(MFE_NAME),
      // The tree's PUBLIC address for the Share menu's Embed tab (the config's shareBaseUrl), or '' when unset.
      __DOXA_SHARE_BASE__: JSON.stringify(SHARE_BASE),
    },
    // Build only: shadow-DOM CSS is injected from useShadowStyles(`…`) literals that
    // ship verbatim, so their block comments are stripped before the Vue compiler
    // runs (enforce: 'pre'). Dev keeps the comments.
    plugins: [
      // ★ ONLY THE TRANSLATION AREAS THIS BUNDLE USES (CRITIC-10). library/i18n/index.js globs every
      // locales/*/*.json; in a BUNDLE build the glob is narrowed to the areas internal/i18n-areas.mjs finds
      // in this bundle's source graph. Dev (no BUNDLE) keeps every area. check:i18n-treeshake verifies it.
      isBuild && target ? i18nAreasPlugin(target) : null,
      stripShadowCssCommentsPlugin(),
      // ─── STRUCTURAL shadow-DOM CSS fix (customElement mode) ──────────────────
      // WHY: every bundle here is a `defineCustomElement(...)` that renders inside a
      // SHADOW ROOT. In @vitejs/plugin-vue's DEFAULT mode, each SFC <style> compiles
      // to a CSS *asset* that vite-plugin-css-injected-by-js dumps into document.head —
      // which a shadow root CANNOT see, so Vue's _applyStyles gets an empty styles[]
      // and the element renders unstyled (a list of naked buttons / a collapsed shell).
      // Running the plugin in customElement mode makes it compile each SFC <style> as an
      // INLINE string and attach it to the component's `styles: [...]` array (see
      // genStyleCode in @vitejs/plugin-vue: `directQuery = &inline`, then
      // attachedProps.push(['styles', ...])). Vue's defineCustomElement then injects that
      // array into EVERY instance's shadow root automatically — correct-by-construction,
      // so no element can forget it. This replaces the per-element useShadowStyles()
      // discipline for each SFC's OWN <style>; the remaining useShadowStyles() calls stay
      // (they inject a child's critical CSS and are idempotent-by-key, so a double inject
      // is harmless). `true` = ALL .vue in this build are custom-element SFCs, which is
      // exactly what this repo builds (one defineCustomElement per bundle).
      vue({ customElement: true }),
      cssInjectedByJsPlugin(),
      autoSpaDevPlugin(env.VITE_MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || ''),
      backendDevPlugin(__dirname, env),
      devSyncPlugin(__dirname, env),
      // DOXA_BUILD_INPUTS=<file> (set only by check:composite): write down every file this build READ — its
      // module graph plus watched files such as CSS @imports — so the gate can refuse a verdict built from a
      // file git does not track (an untracked locale a glob matched). Unset, the plugin is not added at all.
      process.env.DOXA_BUILD_INPUTS && {
        name: 'doxa-record-build-inputs',
        apply: 'build',
        buildEnd() { writeFileSync(process.env.DOXA_BUILD_INPUTS, [...this.getModuleIds(), ...this.getWatchFiles()].join('\n')) },
      },
    ],
    resolve: {
      alias: { '@map': resolve(__dirname, 'library') },
    },
    // COLD `bun run dev` (measured on all 40 dev pages): the first load of every page got "504 (Outdated Optimize
    // Dep)" on vue.js / pinia.js, because Vite discovered them mid-request, re-optimised, and invalidated the
    // page before it mounted. Naming the bare packages the leaves import makes Vite pre-bundle them at
    // startup. These are EVERY bare runtime import in library/ and plugin-designs/ (vue, vue-i18n, pinia)
    // plus jspdf, loaded lazily on poster export and so otherwise re-optimised on the first export. The map
    // engines and d3 are pinned CDN scripts, not imports.
    optimizeDeps: { include: ['vue', 'vue-i18n', 'pinia', 'jspdf'] },
    // NEVER copy public/ into a bundle's output. Vite's default publicDir is
    // 'public', and the build runs vite ONCE PER PROFILE — so the default copied
    // the entire 95MB shared asset tree into all nine bundle folders, taking the
    // served tree to 717MB (assets/previews/west-africa.webp existed nine times)
    // and making `cap sync` push 717MB into the APK, past Play's 150MB ceiling.
    // public/ is the SHARED web-root: bundles reach it via the `assetsBase` that
    // generate-tree stamps into each page, not via a private copy.
    publicDir: false,
    build: {
      // Each bundle lands in its own folder: public/<name>/<bundle>/<bundle>.js.
      // public/ IS the served web-root and is committed, so the build writes there
      // DIRECTLY — no intermediate tree and no copy step migrating files in from
      // elsewhere. generate-tree.mjs then fills in the index.html files + manifest.
      outDir: isBuild ? resolve(OUT_ROOT, target) : OUT_ROOT,
      emptyOutDir: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      sourcemap: false,
      assetsDir: '',                  // emit assets next to the .js, no assets/ subfolder
      chunkSizeWarningLimit: 2500,    // research-map is ~1.2 MB; tree-shaking already done
      rollupOptions: {
        input: buildEntries,
        // Externalize jspdf — it is used ONLY by the lazy poster/packet export
        // (`await import('jspdf')` in useMapPoster/useMapPacket). Because the IIFE
        // build uses inlineDynamicImports, that "lazy" import was being INLINED,
        // bloating every research/countries/upg bundle by ~0.6 MB (jspdf pulls in
        // html2canvas + canvg). Marking it external + mapping it to a CDN ESM URL
        // keeps it out of the bundle entirely; the browser fetches it at runtime
        // ONLY when the user actually exports a poster/packet. (Build-only — dev
        // still resolves jspdf from node_modules.)
        external: isBuild ? ['jspdf'] : [],
        output: isBuild ? {
          format: 'iife',
          name: `MapForge_${(target || '').replace(/[^a-zA-Z0-9_]/g, '_')}`,
          entryFileNames: '[name].js',
          assetFileNames: () => `${target}.[ext]`,
          inlineDynamicImports: true,
          // Resolve the externalized `import('jspdf')` to a CDN ESM module at runtime.
          paths: { jspdf: 'https://esm.sh/jspdf@4.2.1' },
        } : {
          entryFileNames: '[name].js',
        },
      },
    },
  }
})
