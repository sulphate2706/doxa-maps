# Reference

**Look-up tables and contracts for doxa-maps: one shared library, many independent embeddable bundles.**
Each bundle is one self-contained `.js` file that registers a custom HTML element (`<doxa-map>`,
`<doxa-research-map>`, …) you can drop on any web page. For learning, see the
**[tutorial](./tutorial.md)**; for tasks, **[how-to.md](./how-to.md)**; for the *why*, **[why.md](./why.md)**.

## Quick reference — "I want to…"

| I want to… | Do this |
|---|---|
| **Add a new map** | copy `plugin-designs/template-bundle/` → rename the folder and the tag in `index.js` |
| **Add a screen to an existing bundle** | drop a `.vue` flat in that bundle's folder; request it via `profile-config.profile` |
| **Fix a legend or control for ALL maps** | edit it once in `library/` (`@map`); rebuild |
| **Add a colour strategy** | a new file in `@map/colors/` (shared) or the bundle's `src/colors/` (map-private) |
| **See my change while working** | `bun run dev` → http://localhost:5173/ (the Plugin Studio) |
| **Build everything** | `BUILD_ALLOW=1 bun run build` → `public/dx-maps/<bundle>/<bundle>.js` |
| **Build just one bundle** | `BUNDLE=<name> bun x vite build` |
| **See a change on the served site** | rebuild, then refresh (the dev server never writes `public/`) |
| **Repoint the API without a rebuild** | set `window.MAP_APP_API_URL` before the bundle loads |
| **Repoint the Mapbox token** | pass `tk` in `profile-config`, or set `window.MAP_TOKEN_URL` / build-config `tokenUrl` |
| **Run a map without a Mapbox key** | nothing: MapLibre is the default. To force it anyway: `"provider": "maplibre"` in `profile-config` (or `?provider=maplibre`) |

---

## The three zones

| Zone | Path | Alias | License | You edit it… |
|---|---|---|---|---|
| **Shared library** | `library/` | `@map` | Apache-2.0 | …rarely, and only for reusable, parameterized code; a fix reaches every bundle on the next build |
| **Your plugin** | `plugin-designs/<name>/` | — | yours | …freely; nothing here leaks to other maps |
| **The build machine** | `internal/` | — | Apache-2.0 | …not as a map author — it is the bundler's own scripts and gates |

**Terminology.** An **element** is a custom HTML tag this repo defines, such as `<doxa-map>`; each pasted tag
is one live *instance*. A **bundle** is a folder under `plugin-designs/`. A **profile** (app profile) is one
`.vue` sitting **flat** in that folder; a bundle can hold several, and the host picks one with the `profile`
field of `profile-config`. In class-and-object terms: the element is the class, each tag an instance, the
profile the screen that instance loads.

## The five capabilities (profile types)

Smallest first. Which bundle is the current example of each: **[reference-capability-exemplars.md](./reference-capability-exemplars.md)**
(generated from `manifest.json`; cite it rather than memory).

| # | Type (a.k.a.) | Machine key | What it is | How the build recognises it |
|---|---|---|---|---|
| 1 | **single-element** (single) | `single` | one profile, one map; the default | a flat `.vue` with no `<profile>.meta.json` and no `*.instances.json` in the folder |
| 2 | **preset-element** (prop-table) | `parameterized` | one profile + a table of named presets; each row is a ready-made map with its own embed page | the bundle ships `<name>.instances.json` — `{ "instances": [{ "id", "title", "props" }] }`; one page per row at `<bundle>/<profile>/<id>/index.html` |
| 3 | **multi-view-element** (monolithic) | `monolithic` | one profile holding several screens (tabs or steps), one shown at a time | declared: `<profile>.meta.json` → `{ "type": "monolithic" }` |
| 4 | **composite-element** (nested elements) | `nested-elements-mfe` | a profile that places other plugins together and ships the set as one new element | declared: `<profile>.meta.json` → `{ "type": "nested-elements-mfe", "composes": [ … ] }` |
| 5 | **app-shell** (nested SPAs) | `nested-mfe-spa` | the outer frame — rail, header, navigation — that mounts any of the others; e.g. Deep Research (`doxa-maps-spa`) and the Plugin Studio | declared the same way; a compiled Vue custom element like every other rung |

**Tiers 3–5 are always declared, never guessed** (either spelling; see `TYPE_ALIASES` in
`internal/plugin-gallery/discover.mjs`). A folder's apparent simplicity does not decide its tier: an
`*.instances.json` makes a bundle capability 2 however light it looks.

---

## Directory tree

```
doxa-maps/
├── library/                      ← SHARED LIBRARY (alias @map, Apache-2.0)
│   ├── index.js                  ← thin barrel; prefer subpath imports for tree-shaking
│   ├── ProfileLoader.vue         ← the ONE component that reads profile-config & loads a screen
│   ├── components/               ← map UI: legends/, map-controls/, poster/, dashboards/, drawers
│   ├── composables/              ← useMapInstance, useMapData, useMapLayers, … (+ legends/, poster/)
│   ├── layouts/                  ← VerticalTabsLayout, StackLayout — how composites compose
│   ├── api/                      ← DataSourceManager (csv | api | rest-api) + sources.json
│   ├── colors/                   ← one colour strategy per file, auto-registered by _registry.js
│   ├── constants/                ← never-change values: mapDefaults.js, zoom.js, poster*.js
│   ├── i18n/locales/             ← 11 base locales: ar de en es fr hi it pt ro ru zh
│   ├── stores/                   ← Pinia: dataStore, mapStore, uiStore (per-instance)
│   └── utils/                    ← pure helpers (geoUtils, clustering)
│
├── plugin-designs/               ← ALL bundles live here (each subfolder = 1 bundle)
│   ├── <bundle>/
│   │   ├── index.js              ← bundle ENTRY — registers the web component
│   │   ├── index.html            ← the dev staging page (the build requires it)
│   │   ├── <profile>.vue         ← 1..N FLAT profile screens (no profiles/ subfolder)
│   │   └── src/                  ← everything else only this map needs
│   └── template-bundle/          ← minimal copy-me reference bundle
│                                    (folders starting with _ or . are SKIPPED by the build)
│
├── internal/                     ← the build generator and the verification gates
├── deployment/                   ← capacitor/ (mobile) · wordpress/ · src-tauri/ (desktop)
├── public/                       ← THE SERVED WEB-ROOT, committed:
│   ├── index.html                    the Plugin Studio host page
│   ├── dx-maps/<bundle>/             built bundles + manifest.json + leaf pages
│   └── assets/                       posters & data the maps fetch at runtime
├── vite.config.js                ← multi-entry: discovers plugin-designs/<name>/ folders
└── vite.doxa-maps-build-config.json ← output tree name + copy destinations + token settings
```

---

## The `profile-config` runtime contract

**A bundle exposes ONE attribute, `profile-config`** — a JSON string `ProfileLoader.vue` parses at runtime.
It is the entire wiring between host page and map, so the same built bundle re-points to different data,
colours or language with **no rebuild**.

```html
<doxa-map profile-config='{
  "profile":    "doxa-simple-map",   // which flat .vue screen to render (required)
  "tk":         "MAPBOX_PUBLIC_TOKEN",         // Mapbox token (host-supplied)
  "instanceId": "my-map",            // optional; isolates window events between embeds
  "dataSource": "pray-tools",        // or { "type":"rest-api","endpoint":"https://…" }
  "colorSet":   "default",
  "locale":     "en",
  "provider":   "mapbox",            // map engine: "mapbox" (default) | "maplibre" (no key needed);
                                     //   also per page via ?provider= or window.MAP_PROVIDER
  "assetsBase": "/assets",           // where tables/, boundaries/, previews/ are served (see below)
  "shareUrl":   "https://…",         // optional; the WHOLE url the Share button links/embeds
  "embedBaseUrl": "https://…/dx-maps", // optional; tree root the Share button joins embed pages to
  "tabs":       [ /* parameterized screens read this */ ]
}'></doxa-map>
```

| Field | What to know |
|---|---|
| `profile` | **must** match a flat `.vue` filename in the bundle; a mismatch shows an inline "Profile not found" box listing the names |
| `tk` | supplied at runtime; dev reads `.env`'s `VITE_MAPBOX_TOKEN` |
| `instanceId` | scopes cross-instance window events so several embeds never interfere |
| `dataSource` | handed to `DataSourceManager` (`csv` · `api` · `rest-api`) |
| `assetsBase` | data-driven profiles fetch `${assetsBase}/tables/*.json` and `${assetsBase}/boundaries/*.geojson` **before** creating their map. Unset, it is `./assets` relative to the host page; if the host doesn't serve that path the map is never created. Generated pages set it for you; any other host must point it at a copy of `public/assets/` |
| `shareUrl` / `embedBaseUrl` | the **Share ladder** (`library/utils/embedBase.js`): `shareUrl` > the profile's embed page joined to `embedBaseUrl` > `window.MAP_EMBED_BASE_URL` > the root derived from the bundle's own script URL (so a dropped tree works on any host) > the page's own location |

**What descendants receive.** `ProfileLoader` `provide()`s `mapboxToken` and `dataSource` (both **computed
refs** — `unref` before use), `colorSet`, `profileConfig`, `instanceId`, `lang`, and the instance-scoped Pinia
stores `uiStore` / `mapStore` / `dataStore`. Descendants **inject**; never call `useXxxStore()` directly (it
would bleed between embeds). Each bundle registers a **shadow-DOM** element with its own styles, Pinia and
i18n, under a **distinct** tag, since `customElements.define()` is one-shot per name.

---

## Build scripts & output

| Script | What it does |
|---|---|
| `bun run dev` | Vite dev server with hot reload at http://localhost:5173. **`/` is the Plugin Studio**; `/__gallery` is the archived bundle index. Serves every bundle at its own html path and `/assets/*` from `public/assets/`. **Writes nothing to `public/`.** |
| `BUILD_ALLOW=1 bun run build` | `clean` → one `vite build` per `plugin-designs/*/` folder → `tree` → static gates. Refuses (exit 75) without `BUILD_ALLOW=1`, because it wipes `public/dx-maps/` first. Takes a lock; `BUILD_LOCK_WAIT=600` queues instead of failing |
| `BUNDLE=<name> bun x vite build` | builds ONE bundle without cleaning the rest of the tree |
| `bun run build:watch` | rebuilds into `public/` on every change |
| `bun run clean` | wipes and recreates the `public/<name>/` output tree |
| `bun run tree` | writes `manifest.json` + the leaf pages, then copies the tree to every build-config `paths` destination |
| `bun run verify` · `bun run verify:full` | data-integrity, shipped-bundle and network-policy guards (fast, no browser) · plus rendered posters and live apps in a browser |
| `bun run dropin` | the one-server drop-in: copies the built tree into your site's `public/` (`dropin.dest`, default `../doxa-life/public`), so the site's own server serves every map. Never prunes; `--prune` into a `public/` folder is refused |
| `bun run sync:dropin <dest> [--from-config] [--prune]` | mirrors the built `public/` into a host checkout. The allowlist lives in ONE place, `vite.doxa-maps-build-config.json` → `dropin.include`; `dropin.exclude` lists built files no page fetches. Never copies credentials, docs or staging pages; `--dry-run` first |
| `bun run check:public-hygiene [<dir>] [--strict]` | proves a served folder is fit to publish: no local paths, internal names, dev URLs, token-shaped secrets, source maps or staging pages. Run it on a drop-in before any public push |

**How a build works.** `vite.config.js` registers every `plugin-designs/` subfolder that doesn't start with
`_`/`.` and has **both** `index.html` and `index.js`. One `vite build` builds **exactly one** bundle (selected
by `BUNDLE=<name>`) as a self-contained **IIFE**; the full build loops every folder. Sizes differ with what each
bundle imports (simple ≈ 420 KB, research ≈ 1.3 MB).

**Where output goes.** One bundle → one file: `public/dx-maps/<bundle>/<bundle>.js`, with CSS injected by
JS (no separate `.css`). Beyond it, `tree` writes a standalone, iframe-able `index.html` per bundle, per
profile and per preset instance, plus `public/dx-maps/manifest.json` with ready-made
`embed.iframe` / `embed.script` snippets for every profile. Full design:
[architecture/embeddability.md](./architecture/embeddability.md). Preset instances:
[how-to.md](./how-to.md#ship-n-preset-variants-of-one-screen-instances).

**Bun is required.** `bun.lock` is the committed lockfile; use `bun x vite`, not `bunx`.

### Standalone gates — run these before publishing

These live **outside** the build on purpose: each checks something a fresh build would mask, or needs a
browser or network.

| Script | Catches |
|---|---|
| `bun run smoke:embeds` | an element that **builds, lists in the manifest, and renders nothing** — mounts every profile page in a browser |
| `bun run smoke:studio` | the Plugin Studio at `/` not mounting every plugin (~5 s, needs `bun run dev`) |
| `bun run check:composite` | a composite still shipping an OLD copy of a child it nests — a one-bundle rebuild does not recompile its parents |
| `bun run verify:map-paint` | a map that **lays out but never paints** — asserts a live GL context and attribution |
| `bun run verify:5-caps` · `bun run verify:interop` | a capability tier with no working exemplar · cap-4 plugins not interoperating through props and events |
| `bun run check:shots` | a README screenshot shot from a different bundle than the one built now (compares a recorded bundle hash) |
| `bun run check:shot-distinctness` · `check:shot-fidelity` | two screenshots showing the same view · a machine that cannot render what a shot must show (e.g. no emoji font) |
| `bun run check:library-index` · `check:capability-exemplars` · `check:quoted-scripts` | a generated doc drifting from `library/`, from the manifest, or from `package.json` |
| `bun run check:catalog-identity` · `check:catalog-currency` | a live host serving something other than your build (SRI hash comparison) · an older build, or a bundle missing from it |
| `bun run check:settled` | measuring or publishing a tree **mid-build** (a build's `clean` step empties it) |
| `bun run check:mobile` · `check:tauri` · `check:wp-embed` | the Capacitor sync, the Tauri config contract, the WordPress embed markup — deploy methods 2, 5 and 4 |
| `bun run smoke:gallery` · `smoke:share` | the archived `/__gallery` page · share links round-tripping to the same element |
| `bun run check:a11y-button-names` | an icon-only control with no accessible name |

**Some gates need a precondition, or they look broken.** Read the message before trusting the exit code:

| Gate | Needs | What a bare run does |
|---|---|---|
| `smoke:gallery` | a dev server on :5173 (`bun run dev`) | exits non-zero: "cannot read …/registry.json — is `bun x vite` running?" |
| `smoke:share` | `--url <page>` arguments, a served tree, a token, `--browser chromium` | prints `usage:` and exits non-zero |
| `smoke:embeds` · `verify:map-paint` · `verify:5-caps` | `MAPBOX_TOKEN` in the environment (below) | **degrades rather than fails**: map profiles time out, which looks like broken plugins and is not |

```sh
# The token every map gate wants: read it from the build config (it works from any origin).
export MAPBOX_TOKEN=$(python3 -c "import json;print(json.load(open('vite.doxa-maps-build-config.json'))['token'])")
```

**Share round-trip over every plugin with a Share button**, from the repo root:

```sh
( node internal/serve-strict.mjs --port 4950 & )   # serve the built tree, loopback only
B=http://127.0.0.1:4950/dx-maps; ARGS=""
for p in demo-map/demo-map cities-internet/connectivity-map doxa-research-map/research-map \
         country-posters/countries-map doxa-simple-map/doxa-simple-map \
         gospel-resources/resources-map my-upg-100-list/upg-100-list my-upg-100-list/upg-100-mfe; do
  ARGS="$ARGS --url $B/$p/index.html?tk=$MAPBOX_TOKEN"
done
node internal/share-roundtrip-smoke.mjs $ARGS --browser chromium
```

Check the reopened **tags**, not just the pass count: each share URL must reopen its *own* element. List the
plugins fresh rather than trusting this one: `grep -rln ShareButton plugin-designs/*/*.vue`.

### Writing a new gate

**Plugin and library source is written for Vite, not Node** — `import()`ing it from a plain Node gate fails:

| Vite-only feature | What plain `node` does |
|---|---|
| the **`@map` alias** (`@map/ProfileLoader.vue`) | `Cannot find package '@map/ProfileLoader.vue'` |
| **`import.meta.glob`** (used across plugin entries and the library registries) | `TypeError: (intermediate value).glob is not a function` — often arriving **transitively**, from a module you never named |

| Approach | When |
|---|---|
| Import only the **leaf module** under test | the logic is in a plain `.js` with no Vite features (most composables) |
| Test the **built bundle** over `bun run serve` | the logic only exists after bundling, or needs the DOM — a browser gate, not a build step |
| Parse the **source text** | you are asserting a structural property; say in the gate's header that it cannot catch runtime behaviour |

**A gate goes inside the build only if it runs clean in plain Node, with no browser and no network — and run
it before wiring it in.** Build-box constraints worth knowing: Node **v20** (no `fs.glob`), and use
`bun x`, not `bunx`.

---

## `vite.doxa-maps-build-config.json` fields

Edit this one file, then rebuild.

| Field | What it does |
|---|---|
| `name` | output folder name (`dx-maps`; a config with no name falls back to `doxa-maps`) |
| `paths` | **extra** folders to copy the whole built tree into — point at a host repo's `public/` and that host serves the maps. Empty ⇒ `public/<name>/` only |
| `embedBaseUrl` | the public URL the tree is served from, for **absolute, paste-anywhere** snippets. Empty ⇒ relative URLs (position-independent; required for Capacitor) |
| `token` | a `pk.` public Mapbox token baked into every page, so a map works on any host. It is public by design — protected by URL restrictions in the Mapbox dashboard, not by secrecy; `check:public-hygiene` allows `pk.` and fails on `sk.` |
| `tokenUrl` | an endpoint each page may fetch its token from (a URL, not a secret); it must send CORS for the embedding origins. `window.MAP_TOKEN_URL` overrides at runtime |
| `assetsBaseUrl` | where the shared asset tree is served from. Empty ⇒ a relative path per page depth; set it absolute for partner embeds and mobile |

**Token resolution ladder:** per-map `tk` prop > `?tk=` > baked `token` > `window.MAP_TOKEN_URL` > `tokenUrl` > same-origin `/api/maps/token`.

---

## Data sources

Maps read data through `@map/api/`, driven by `library/api/sources.json`:

| Type | What | Points at |
|---|---|---|
| `rest-api` | versioned REST endpoint (default) | the live people-group API; base URL resolves at runtime (`window.MAP_APP_API_URL` → `VITE_API_BASE_URL` → same-origin) |
| `csv` | a local CSV parsed at load | the Joshua Project dataset (+ photo fallbacks) |
| `api` | a single JSON URL | any plain JSON endpoint |

Country and region polygons are not a `sources.json` connection: they come from Mapbox's
`country-boundaries-v1` tileset plus a lazy-loaded WAGF-regions GeoJSON. Adding a source:
[architecture/data-sources.md](./architecture/data-sources.md).

### Persecution-safety — which fields a profile may carry

**Some profiles are deliberately kept free of gospel, church and believer data.** A profile failing a
"should have resource links" check may be *obeying* this rule. The binding instance, in
`plugin-designs/cities-internet/connectivity-list.vue`:

> **PERSECUTION-SAFETY:** this profile carries connectivity + population + language only. It has **NO
> gospel-resource, church or believer field and must not gain one.**

Its `source` field (World Bank Open Data) is API provenance shown as a citation, not a user-facing link.
"Persecution-safe" means two other things elsewhere in the repo — placename precision in
`key-cities/cities-list.vue`, a dependency-free table in `research-dashboard` — and only this one governs
what data a profile may hold.

---

## Colours

**Reused by more than one map → shared `library/colors/`. Only your map uses it → your bundle's
`src/colors/`** (merges over the shared set, for that bundle only). The filename sets the mode key
(`language-family.js` → `languageFamily`). Contract: [architecture/color-strategies.md](./architecture/color-strategies.md) ·
the two homes in depth: [contributing/COLORS.md](./contributing/COLORS.md).

## Importing from `@map`

Everything under `library/` imports via the `@map/…` alias, mirroring the file path:

```js
import SemanticTreeLegend from '@map/components/legends/SemanticTreeLegend.vue'
import { useMapInstance }  from '@map/composables/useMapInstance.js'
import { useMapData }      from '@map/composables/useMapData.js'
import langFamilyByIso     from '@map/data/langFamilyByIso.json'
```

Prefer subpath imports over the thin `@map` barrel so tree-shaking works. The menu of what exists:
[reference-library-index.md](./reference-library-index.md) (generated) and
[architecture/file-map.md](./architecture/file-map.md) (every file, one line each).

## Going deeper — the architecture folder

| Doc | What it holds |
|---|---|
| [file-map.md](./architecture/file-map.md) | every file, one line each, with the gotcha each carries |
| [data-sources.md](./architecture/data-sources.md) | the `api/` seam: connection contract + checklist |
| [color-strategies.md](./architecture/color-strategies.md) | the strategy contract + legend wiring |
| [components.md](./architecture/components.md) | shared component catalogue + conventions |
| [i18n.md](./architecture/i18n.md) | the locale contract + add-a-language checklist |
| [embeddability.md](./architecture/embeddability.md) | generated per-map pages + manifest — embeddable by default |
| [app-wrappers.md](./architecture/app-wrappers.md) | the app shell: `nav.js` + `PROFILES` contracts |
| [poster-generation.md](./architecture/poster-generation.md) | the poster/preview generator pipeline |
| [patterns-and-provenance.md](./architecture/patterns-and-provenance.md) | the two multi-map patterns + provenance |

---

## Notes and history

The measurements behind the rules above, kept for whoever needs the reasoning.

- **Capability citations (2026-09-22).** "Which bundle is the capability-N example" was answered wrongly in
  three places — a gate, the README's captions and an authoring skill — because `doxa-vision-card` looks
  like the lightest plugin and is capability 2 (it ships an `*.instances.json`). Hence the generated
  exemplars file and `check:capability-citations`.
- **Why gates live outside the build.** `check:composite` could never fail inside a full build (every
  composite is fresh by construction); `check:library-index` compared mtimes, which a fresh CI checkout sets
  equal; `check:shots` first compared dates, then git commit times, and now a recorded bundle hash, because
  a byte-identical retake kept its old commit date and read as stale.
- **The Node-import trap (2026-09-22).** A new gate `import()`ed the dashboard config, which transitively
  reached the colour registry's `import.meta.glob`, and crashed — while already wired into the build, so
  `bun run build` failed for a reason unrelated to the code being built. 18 files used `import.meta.glob`
  at the time.
- **Missing dependency names (2026-09-22).** A folder rename rewrote `@capacitor/{android,cli,core}` to a
  path-like name, so `bun install` failed in a fresh clone while every existing checkout passed. Hence
  `check:dep-names`, which also checks each installed package's own `name`.
- **Machine-specific paths (2026-09-22).** A planted `/home/…` line passed `check:public-hygiene` (which
  scans the served tree, not source); `check:no-abs-paths` scans `git ls-files`.
- **Tokens (2026-09-23).** The `doxa.life` token endpoint serves a token restricted to that domain: tile
  requests return 403 without its Referer, so shell-driven gates got blank basemaps. The build-config
  `pk.` token returns 200 from any origin, which is why every command above reads it. Browser gates were
  never affected: pages resolve their token through the ladder and the built bundle carries the working
  one. `verify:map-paint` passes under both tokens (it checks GL + attribution, not tiles), so judge tile
  loading by the tile response count, not a screenshot — the basemap is Mapbox Light, which looks bare.
- **Share round-trip (2026-09-22).** 8/8 passed with six distinct reopened tags, each matching its plugin
  (the two UPG100 Posters profiles share one tag). A pass count alone cannot catch an SPA fallback that renders
  *a* map for every URL.
- **Why SRI identity, not HTTP status.** A platform's app URL can return 200 with a sign-in page; comparing
  each live bundle's bytes against the manifest's `integrity` hash is a cryptographic identity proof that
  costs nothing to maintain. Re-run `bun run check:catalog-identity` for today's count rather than quoting
  an old one.
- **Undocumented gates (2026-09-22).** 26 gates lived outside the build and only nine were listed; two
  unlisted ones had been failing for two sessions. A standalone gate nobody knows about does not run —
  which is why the table above is the list to run before publishing.
- **Screenshot distinctness.** Two README slots once showed the same view under two captions: the shot
  chased a "Next" control that did not exist inside a `try/catch`, and the PNGs differed by 0.16% render
  noise, so no checksum caught them.
- **Persecution-safety (2026-09-22).** All three `cities-internet` profiles had zero link bindings and the
  live leaf rendered 0 anchors — correct. A work item once batched "gospel-resources + cities-internet must
  render real resource links"; taken literally for `cities-internet` it would add exactly the field its
  header forbids.
