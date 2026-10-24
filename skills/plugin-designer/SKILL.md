---
name: plugin-designer
description: >-
  Use this skill to design and build a new map plugin in this repo's
  plugin-designs/ folder, or to add a screen to an existing one. Teaches the
  bundle = folder = one JS file pattern, reusing library/ before writing code,
  the universal props every plugin must honour (map engine, language, Mapbox
  token or token service), the rules for working under both MapLibre and
  Mapbox, localization and right-to-left, the five capability levels, the one
  build step, and the three outputs (web folder, mobile app, desktop app).
  Works directly with the Plugin Studio (`bun run dev`).
---

# Plugin designer

You build map plugins for this repo. A **plugin** is a folder under `plugin-designs/`; one build
turns it into one JavaScript file that any page can embed as an HTML tag. Your plugin must work
the same under both map engines, in every language, and with or without a Mapbox token.

Run every command from the repo root (the folder with `package.json`).

---

## 1. The pattern: bundle = folder = one JS file

```
plugin-designs/<your-plugin>/     one FOLDER = one BUNDLE (the folder name is the bundle name)
   ├── index.js                  entry: registers the custom element, finds the profiles
   ├── index.html                a staging page that mounts the element
   ├── <screen>.vue              one .vue = one PROFILE (one screen), FLAT in the folder
   ├── <screen>.meta.json        optional: {"type": "<capability>", "label": "…"}
   ├── <screen>.instances.json   optional: named presets of one screen (capability 2)
   ├── data/                     optional: the bundle's own data files (imported, so they ship inside the bundle)
   └── src/                      the bundle's PRIVATE code: components, colors, helpers
        builds to ─────────────► public/dx-maps/<your-plugin>/<your-plugin>.js
```

- **Profiles are flat.** `index.js` finds them with `import.meta.glob('./*.vue')`; a `.vue` in a
  subfolder is not found. The filename (without `.vue`) is the profile's name.
- **Elements live inside.** One bundle registers one tag named after the folder, and can hold more
  elements for its own screens to nest (see `plugin-designs/dashboard-plus-grid/dashboard-plus-grid.meta.json`).
- **Folders starting with `_` are skipped** by the build: a free place for work in progress.
- **New plugins appear in the Plugin Studio at once**, sorted into the rail by **capability**, with
  a translated "experimental" prefix until they are marked production. There is no Experimental
  *section* to be promoted out of — it was replaced with capability tiers
  (`plugin-designs/plugin-studio/plugin-studio.vue:630`, and `:642` for the label). Stage and
  capability are different axes; see `references/glossary.md`.
- **Your rail entry comes from `<profile>.meta.json` `"label"`**, and
  `internal/check-studio-rail.mjs:68` fails a plugin whose label is just its own id. Give it a
  human name.

## 2. Start by copying the starter

```bash
cp -r plugin-designs/template-bundle plugin-designs/<your-plugin>
```

Then rename exactly these, and nothing else:

1. the tag in `index.js` — both the `customElements.define('template-bundle', …)` call and the
   `customElements.get('template-bundle')` guard;
2. the tag, the `profile` strings and the CSS selector in `index.html`;
3. the `.vue` filenames (`template-map-a.vue` → `<screen>.vue`); delete `template-map-b.vue` if
   you need one screen.

`template-map-a.vue` is a real minimal map: it draws `data/places.geojson` with one translated
title, and already follows the page's engine, language (with right to left) and token, falling
back to keyless MapLibre. **Replace `data/places.geojson` with your own points** and you have a
working map. Your own translated text needs a catalogue file in `library/i18n/locales/`, which is
a library change (section 3); until that lands, plain English in your `.vue` is fine.

Keep the entry's `configureApp` exactly as the starter has it: it installs Pinia, installs i18n
**and** provides it as `appI18n`, and provides `profileModules`. The element's root
(`library/ProfileLoader.vue`) cannot call `useI18n()`; it drives the language through the
provided instance. Drop the provide and a host can no longer set your plugin's language.

## 3. Reuse `library/` first

`library/` (imported as `@map/…`) is shared by every plugin. Its menu is
`documentation/reference.md`.

- **Reuse by import, never by copy.** `import { useMapInstance } from '@map/composables/useMapInstance.js'`.
- **Your own code goes in your `src/`**, imported by relative path. Nothing there reaches another plugin.
- **Don't edit `library/` to customise one plugin.** A library change reaches every plugin that
  imports it, so it needs every consumer rebuilt. On a team with a build owner, hand library
  changes to that owner rather than landing them yourself.
- **Reusable by default.** If a component could serve more than one plugin, build it once in
  `library/`, driven by props rather than hard-coded to your plugin, and land it through the build owner.
  Other plugins then adopt it instead of copying it.
- **A new pattern is piloted, approved, then rolled out.** It starts on one plugin, built by that
  plugin's owner, and a maintainer approves it on the dev server (the Plugin Studio). Only then do
  the owners of the other plugins it applies to adopt it, each in their own plugin.
- **One shape per kind of control.** Controls on a map are round and spaced apart: put them in
  `MapToolbar`, whose default is a spaced column of round `MapControlButton`s (both in
  `library/components/map-controls/`), not its grouped square card (`controls="square"`). Buttons in
  a dashboard's header bar are rounded squares with the vertical tabs' corner radius
  (`var(--vtl-radius, 8px)` in `library/layouts/VerticalTabsLayout.vue`).

## 4. The universal props — every plugin honours these

A plugin never decides these for itself; it reads them from whoever embeds it. The Plugin Studio
header sets all of them, which is how you test yours.

| Prop | Values | Channels, first found wins | Default |
|---|---|---|---|
| **Map engine** (`provider`) | `mapbox` · `maplibre` · `auto` (any case) | `profile-config` `"provider"` → `?provider=` in the page address → `window.MAP_PROVIDER`; an explicit choice always wins | `auto`: MapLibre. A token no longer chooses the engine: Mapbox needs `"provider": "mapbox"` plus a token (any row below). Confirm in `library/composables/useMapProvider.js`, never assume it |
| **Language** (`locale`) | one of the 11 in `library/i18n/locales/` | `profile-config` `"locale"` (or `"lang"`) → `?lang=` / `?locale=` → `<html lang>` | English |
| **Mapbox token** (`tk`) | a public `pk.…` token | `profile-config` `"tk"` → `?tk=` on a generated page → `window.MAP_TOKEN`; generated pages also keep a token pasted once in the tree (browser storage) | none. The embed snippet's `YOUR_MAPBOX_TOKEN` placeholder counts as no token |
| **Token service** (`tokenUrl`) | a URL that returns a `pk.` token | `profile-config` `"tokenUrl"` (the element asks it when it has no token; the studio header's field feeds this) → on generated pages also `window.MAP_TOKEN_URL` → the build config's `tokenUrl` → same-origin `/api/maps/token` | none |

```html
<your-plugin profile-config='{"profile":"<screen>","provider":"maplibre","locale":"ar"}'></your-plugin>
```

Read them through the library (`resolveMapProvider`, the injected `mapboxToken`, the i18n
instance), never by parsing the URL yourself, and never fetch a token service yourself: the
library asks it, accepts only a `pk.` answer, and a Mapbox map waits for it before it starts.
**Your plugin must draw under MapLibre with no token at all.** `library/composables/useMapProvider.js` and
`library/ProfileLoader.vue` are the authority when this table and the code disagree.

## 5. Two engines: rules that keep MapLibre and Mapbox equal

Write every map feature once, so it works under both engines. These rules each come from a
real bug:

1. **Ask the map which engine it is.** Use `engineFor(map)` / `isMapboxMap(map)` from
   `@map/composables/useMapProvider.js`, never a global that may still be defined after a switch.
2. **Some APIs differ in shape.** `getProjection()` is `{name}` on Mapbox but `{type}` or
   `undefined` on MapLibre; `setProjection` takes `'mercator'` on Mapbox but `{type:'mercator'}` on
   MapLibre; `setConfigProperty` and light presets exist only on Mapbox. Wrap these calls in `try`,
   and never assume the result's shape. An uncaught throw silently skips everything after it.
3. **Mapbox-only paint properties drop the whole layer on MapLibre.** Never write
   `'circle-emissive-strength'` (or any `*-emissive-strength`) literally. Spread
   `...emissivePaint(map, kind)` from `useMapProvider.js`.
4. **Fonts must exist on the engine's glyph server.** Under MapLibre, a Mapbox font name
   (`DIN Offc Pro`, `Arial Unicode MS`) gets a 404, and the layer draws **no text** with no error.
   Spread `...labelFont(map, {…})` from `@map/maps/label-font.js` into every symbol layer.
5. **`mapbox://` sources don't load on MapLibre.** The country polygons come from the Mapbox tileset
   `mapbox.country-boundaries-v1` under Mapbox. Under MapLibre, use the local file
   `boundaries/world-adm0.geojson` under the assets base. It names the country code `iso3`, where
   the tileset says `iso_3166_1_alpha_3`, so normalise once. `library/composables/useMapLayers.js`
   (the "region polygons, per engine" block) is the worked example.
6. **Load assets from the assets base, never a page-relative path.** Use
   `resolveAssetsBase(profileConfig)` from `@map/utils/embedBase.js`. A hard-coded `./assets`
   works in the built folder and breaks under `bun run dev`.
7. **Prove your expressions parse under MapLibre without a browser.** MapLibre's own parser,
   `@maplibre/maplibre-gl-style-spec`, is installed as a dependency of `maplibre-gl`. It is NOT
   declared in `package.json`, so a lockfile change can remove it: if the import fails, add it as a
   dev dependency rather than dropping the check.

   ```js
   import { expression, featureFilter } from '@maplibre/maplibre-gl-style-spec'
   const e = expression.createExpression(['match', ['get', 'status'], 'reached', '#2e7d32', '#c62828'])
   if (e.result !== 'success') throw new Error(e.value.map(x => x.message).join('; '))
   const admits = featureFilter(['==', ['get', 'iso3'], 'TUN']).filter({ zoom: 2 }, { properties: { iso3: 'TUN' } })
   ```

   Run each paint and filter expression your layers use against a few real features from the data.
8. **ATTRIBUTION PLACEMENT (best practice).** The engine's credit is a licence term, so it must always
   be on the map, uncovered and tappable. On a phone:
   - **A map with a footer legend sheet** (`LegendMobile`): the credit goes in the **top corner on the
     start side** (top-left; top-right in RTL), opposite the map's control column. LegendMobile does
     this while it is mounted.
   - **A map without a footer sheet**: the credit goes at the **bottom-right** (bottom-left in RTL).
   - **Both**: the credit is compact and **folds to its (i) 3 s after it first shows**; a tap on the (i)
     expands it again. Its corner's z-index sits **above the scroll-edge strips** (`.map-scroll-edge`,
     z-index 2), so the tap always lands.
   - Remove MapLibre's optional logo control. Its licence does not require it; the credit stays.

## 6. Localization and right to left

- **Every word on screen comes from a catalogue** in `library/i18n/locales/<code>/*.json`, the same
  key in all 11 languages. Components use `t('file.key')`; code that runs outside the Vue app uses
  `tStatic(path, locale)` from `@map/i18n/index.js`.
- **Add a key to all 11 catalogues at once.** `bun run check:i18n-parity` fails when one is missing;
  `bun run check:i18n-never-translated` flags a key that was copied, not translated.
- **Names from the data stay as the data has them** (people groups, places); translate only the
  interface.
- **Right to left belongs to your element, not the page.** Arabic mirrors the plugin's own box; the
  library sets `dir` on it. Never write `document.documentElement.dir` from a plugin: an embedded
  plugin that does flips the whole partner page.

## 7. Choose the capability level

Pick the lowest level that does the job. Declare levels 3–5 in `<screen>.meta.json` `"type"`;
levels 1 and 2 are detected on their own.

| Level | Name (`type`) | What it is | Example |
|---|---|---|---|
| 1 | single element (`single`) | one screen, one element | `plugin-designs/prayer-walk-planner/` |
| 2 | preset element (`parameterized`) | one screen, several named presets from `<screen>.instances.json` | `plugin-designs/doxa-simple-map/` |
| 3 | multi-view element (`monolithic`) | many views fused inside one element | `plugin-designs/doxa-research-map/` |
| 4 | composite element (`nested-elements-mfe`) | nests other elements, each still embeddable alone, wired by props and events | `plugin-designs/dashboard-plus-grid/` (the Big Picture tab) |
| 5 | app shell (`nested-mfe-spa`) | nests whole apps | `plugin-designs/doxa-maps-spa/` (Deep Research) |

**Your declaration is checked, not merely trusted.** `internal/check-capability-derived.mjs`
derives the level from what your plugin actually `composes` and fails when an explicit `"type"`
disagrees with it — a `meta.json` that contradicts the structure means one of the two is stale.
Run `bun run check:capability-derived`. Details and the two traps in `references/targets.md`.

**Presets merge over the profile's defaults, they do not replace them** — a preset page's config is
the profile's `<profile>.meta.json` `config`, then the preset's `props` over it, key by key. Set a
key in `props` only to change it. That is rule 3 of `documentation/PRESET-PLUGIN-STANDARD.md`,
asserted by `bun run check:preset-config-merge`; **read that standard before shipping presets.**
If two presets need different *code*, they are not presets — make another profile.

## 8. Learn from the reference plugins

The seven production plugins are the reference: each shows what a good plugin does. Before you
write a rule's code, read the plugin that shows it best. Find code by the name given here, not by
line number, because lines move.

| Rule | Read this | What to look at |
|---|---|---|
| Entry: i18n installed **and** provided; one bundle, two tags | Prayer Progress: `plugin-designs/doxa-simple-map/index.js` | `configureApp` and its `app.provide('appI18n', …)` |
| Presets from one screen (capability 2) | Prayer Progress: `plugin-designs/doxa-simple-map/simple-map.instances.json` | Prayer / Engagement / Adoption as three embeddable pages |
| Engine-asymmetric APIs, guarded | Regions: `plugin-designs/regions-dashboard/src/RegionCountryMap.vue` | `projectionOf` and `setProjectionOn` — both shapes, inside `try` |
| Polygons both engines can draw; data from the assets base | Cities with Internet: `plugin-designs/cities-internet/connectivity-map.vue` | `resolveAssetsBase(…)`, the `boundaries/world-adm0.geojson` fetch (polygon data with no `mapbox://` source), and `resolveNamedStyle(…, provider)` for a basemap that matches the engine |
| Interface text from the catalogues | Gospel Resources: `plugin-designs/gospel-resources/resources-map.vue` | its interface text goes through `t('…')` (about 80 calls) |
| Basemap labels in the reader's language; right to left | Prayer Progress: `plugin-designs/doxa-simple-map/doxa-simple-map.vue` | the `name_<locale>` label switch and `isRTL` |
| Interop: one element reacts to another's events | Simple Research: `plugin-designs/research-map-plus-grid/research-map-plus-grid.vue` | the map listening for the grid's `groups-filtered` event |
| Composite element (capability 4) | Big Picture: `plugin-designs/dashboard-plus-grid/dashboard-plus-grid.meta.json` | `"composes"`: two elements, each still embeddable alone |
| One bundle, several embeddable screens | UPG-100: `plugin-designs/my-upg-100-list/` | `upg-100-mfe`, `upg-100-list` and `poster-wall` from one bundle |
| App shell (capability 5) | Deep Research: `plugin-designs/doxa-maps-spa/doxa-maps-spa.vue` | every plugin as a tab, filled from the manifest |

`emissivePaint` and `labelFont` (section 5) have no production-plugin exemplar, because the
production plugins get them through the library's own layers. The starter uses both directly:
read the pin and label layers in `plugin-designs/template-bundle/template-map-a.vue`.

## 9. Develop, build, land

```bash
bun run dev                              # the Plugin Studio at http://localhost:5173/
BUNDLE=<your-plugin> bun x vite build    # just your bundle → public/dx-maps/<your-plugin>/
git add -A && git commit -m "…" && git pull --rebase origin development && git push origin HEAD:development
```

- Your plugin appears in the studio as soon as its folder exists; edits reload live. One screen
  alone: `http://localhost:5173/__leaf/<your-plugin>/<screen>`.
- **Test every combination from the studio header**: both engines × with and without a token ×
  English and Arabic.
- **Build only your own bundle.** `BUILD_ALLOW=1 bun run build` rewrites *every* plugin's output;
  on a team one agent owns it.
- **A rejected push is normal** — someone landed first. Rebase and push again; measured at 95%
  rejected, zero conflicts. Stage only your own files.

**Done means**: your bundle builds and appears in `manifest.json`; it works under both engines,
with and without a token, in English and Arabic; every new string is in all 11 catalogues
(`bun run check:i18n-parity`); your expressions parse under MapLibre (section 5, rule 7); and you
changed nothing in `library/` or another plugin's folder.

Full loop, the gate list, and working when your agent runs on a server: `references/workflow.md`.

## 10. The three outputs

One built folder, three ways to ship it: the **web folder** (`public/dx-maps/`, iframe or script
tag from any host), the **mobile app** (the same folder wrapped by Capacitor, `bun run phone`), and
the **desktop app** (the same folder in Tauri, `bun run tauri:build`, a proof of concept).

**Your plugin runs everywhere unless you say otherwise.** A `<profile>.meta.json` `"targets"` list
narrows that, and it is read, not decorative: Deep Research skips a bundle that does not
list `web` (`plugin-designs/doxa-maps-spa/doxa-maps-spa.vue:605`). Declare it only for a plugin
that genuinely cannot work in a plain web embed — Rudder needs a local speech engine. Details:
`references/targets.md`.

## Going deeper

| Read | For |
|---|---|
| `references/glossary.md` | bundle, profile, preset, element; stage vs capability; rail labels |
| `references/targets.md` | the five capabilities in full, how they are derived and checked, `targets`, the three outputs |
| `references/backend.md` | when your plugin needs a service; databases and migrations; the user tiers (design intent, not built) |
| `references/workflow.md` | the full develop → build → check → land loop |
| `references/i18n.md` | translating a plugin: whole-sentence keys, label-form counts, inline markup composed (no `<i18n-t>`), deliberate English in `dir="ltr"`, labels that follow a locale switch, the checks to run |

In the repo itself:

- `plugin-designs/README.md`: authoring guide
- `plugin-designs/template-bundle/`: the starter, and its README
- `documentation/reference.md`: the `@map/…` library menu and the profile types
- `documentation/PRESET-PLUGIN-STANDARD.md`: presets in full — the six rules, and how they are discovered
- `documentation/how-to.md`: recipes, including swapping the map engine
- `documentation/HOWTO-join-the-table.md`: working alongside other people
- `library/composables/useMapProvider.js`: engine resolution and engine helpers
- `library/maps/label-font.js`: fonts per engine
- `library/i18n/index.js`: languages, `tStatic`, right to left
