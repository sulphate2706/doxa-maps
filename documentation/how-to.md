# How-to — task recipes

Short recipes for specific tasks. New to the project? Read the **[tutorial](./tutorial.md)**
first, then use this page to look up a task. For contracts and field tables, see
**[reference.md](./reference.md)**.

The three zones govern everything: **reuse `library/` (`@map`), build in
`plugin-designs/<your-map>/`, never touch `internal/`.**

**Pick your task:**
[embed on a site](#embed-a-map-on-a-partner-site) · [link/iframe directly](#link-or-iframe-a-map-directly-zero-effort-embed) ·
[add a map](#add-a-new-map-profile) · [preset variants](#ship-n-preset-variants-of-one-screen-instances) · [imitate a profile](#imitate-an-existing-profile-dont-re-derive-it) ·
[change colors](#change-colors) · [choose a CDN](#where-do-the-maps-get-served-from) ·
[build a SPA](#compose-maps-into-a-spa-the-app-shell) · [mobile app](#build-the-android--ios-app-optional) ·
[swap engine](#swap-the-map-engine-mapbox--maplibre) · [API + token](#set-the-api--mapbox-token) · [agent guardrail](#give-your-agent-the-guardrail) ·
[troubleshooting](#troubleshooting)

---

## Embed a map on a partner site

A built bundle is a plain `<script src>` plus a custom element — no framework, no build step
on the partner's end. A partner page loads the Mapbox peer, then the bundle, then drops in the
element with its own `profile-config`.

```html
<!-- Mapbox peer (once per page, before the bundle) -->
<link  href="https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.js"></script>
<script src="https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js"></script>

<!-- The bundle (relative path = host serves it; absolute https = external CDN) -->
<script src="/dx-maps/my-map/my-map.js"></script>

<!-- The map. `profile` = your .vue filename. `tk` = the Mapbox token. -->
<my-map profile-config='{"profile":"my-map","tk":"MAPBOX_PUBLIC_TOKEN"}'></my-map>
```

`profile-config` is read at **runtime**, so the same bundle re-points at different data,
colors, or language with **no rebuild** — just change the JSON on the page. Without a valid
`tk` the bundle loads but the basemap stays blank (see *Set the API + Mapbox token* below).

---

## Link or iframe a map directly (zero-effort embed)

You don't have to use the script tag. **Every profile also builds its own standalone page** —
a bare, full-screen map at:

```
https://<your-cdn>/dx-maps/<bundle>/<profile>/index.html
```

Link it, share it, or iframe it (perfect for CMSs and tools that only accept iframes, like
Start.me or Notion):

```html
<iframe src="https://<your-cdn>/dx-maps/doxa-research-map/research-map/index.html"
        width="100%" height="600" style="border:none;border-radius:12px;" allowfullscreen></iframe>
```

You never write these snippets by hand — `public/dx-maps/manifest.json` lists a ready-made
`embed.iframe` and `embed.script` snippet for every profile, and the staging pages show them
copy-paste ready. Design details: [architecture/embeddability.md](./architecture/embeddability.md).

**After each release:** iframe embeds update automatically. A script embed with an `integrity`
hash pins the exact bytes, so re-copy its snippet from `manifest.json` after each release — once
the bundle changes, the old hash stops matching and the browser refuses to run the script.

---

## Add a new map profile

The fastest path is **copy `template-bundle` and rename it.** A bundle is one folder under
`plugin-designs/`; its name becomes the bundle name and the output filename. Don't prefix it
with `_` or `.` — those are skipped by the build.

1. **Copy the template.**
   ```bash
   cp -r plugin-designs/template-bundle plugin-designs/my-new-map
   ```
2. **Rename the element tag.** In `plugin-designs/my-new-map/index.js`, change the
   `customElements.define('…', …)` tag to your map's tag. The entry must glob the bundle's
   flat profiles and hand them to the loader — it already does this; keep the shape:
   ```js
   const profileModules = import.meta.glob('./*.vue')   // FLAT — matches only this bundle's screens
   // …app.provide('profileModules', profileModules) inside configureApp…
   customElements.define('my-new-map', buildElement())
   ```
3. **Keep `index.html`.** Vite needs it to discover the bundle; it's also the dev staging
   page. At minimum it ends with `<script type="module" src="./index.js"></script>`.
4. **Write your profile screen** `my-new-map.vue`, **flat** in the folder (no `profiles/`
   subfolder — the glob is `./*.vue`). The filename (without `.vue`) is the profile name the
   host requests via `profile-config.profile`. Compose it from `@map` blocks and read host
   inputs with `inject` (`mapboxToken`, `dataSource`, `profileConfig`, `instanceId`, and the
   instance-scoped Pinia stores) — never prop-drill, never call `useXxxStore()` directly.
5. **Pick reusable pieces** from the `@map` library index in **[reference.md](./reference.md)**.
   Import each with the `@map/…` alias; do not copy their code into your folder.
6. **Build and verify.**
   ```bash
   BUNDLE=my-new-map bun run build:bundle   # builds just yours → public/dx-maps/my-new-map/my-new-map.js
   bun run verify                           # data guards (fast, no browser)
   ```
   A green build is not a working map — the build proves the bundle *compiles*; the guards
   prove the data is right and the app renders it. Confirm the pane actually paints; a profile
   that fails to mount looks identical to one that mounted and rendered nothing.

> **Two ways to ship several maps from one bundle:** *(A) Parameterized* — one `.vue`, mounted
> many times with different `profile-config` (same `profile`, different data/colors). *(B)
> Multi-profile* — several `.vue` files in one folder, selected by the `profile` field. Both
> ship one script tag. Pick A when maps differ only by config, B when they're genuinely
> different map types that share the same slice of the library.

---

## Ship N preset variants of one screen (instances)

One parameterized profile can emit **many standalone embed pages** — no extra `.vue`. Drop a
`<profile>.instances.json` next to the profile:

```jsonc
{
  "profile": "doxa-simple-map",
  "apiBaseUrl": "https://…",            // optional
  "instances": [
    { "id": "prayer", "title": "Prayer Map",
      "props": { "instanceId": "embed-prayer", "dataSource": "pray-tools",
                 "tabs": [{ "id": "prayer", "colorStrategy": "prayer" }] } }
  ]
}
```

`bun run build` then emits a page **per instance** at `dx-maps/<bundle>/<id>/index.html` —
each directly linkable/iframe-able with its preset props baked into the page (the base profile
still accepts live props). Instances *split* one profile into many render targets; `tabs`
*nest* many views into one element — different tools.

---

## Imitate an existing profile (don't re-derive it)

You have a map that works and want a second one that behaves almost the same. **Copy the
profile and change parameters in the copy** — do not build it from scratch, and do not add a
`mode` flag to the original.

> **The rule: PROFILES duplicate. COMPONENTS get promoted and parameterized.**
> A profile is cheap — a duplicated profile that reads top-to-bottom beats one profile with a
> flag threaded through 40 branches. A *component* used by two profiles is different: promote
> it to `library/components/` and give it props. Duplicating a profile duplicates
> *configuration* (the part that's supposed to differ); duplicating a component duplicates
> *behaviour* (the part that shouldn't).

Steps:

1. **Find the profile you're imitating — including nested ones.** A `.vue` profile can contain
   another full profile inside a tab. Search for the *behaviour* you want, not the app name; if
   you copy the wrong level you inherit the wrong thing.
2. **Copy the folder, then the profile file.** `profile` is the **filename**, not the folder.
   One folder = one bundle = one element; each flat `.vue` inside is one profile.
3. **Change ONLY named parameters.** If you're typing new logic, you've stopped imitating — go
   find the parameter in the original that already does what you're about to write. Count
   parameter *sites* by diffing the two files, not by memory.
   > **Trap: `onMounted` runs last and overwrites your default.** If the source initializes a
   > value in its mount handler, setting it at declaration is not enough — one constant must
   > drive both the initial `ref` and the `onMounted` path.
4. **Wire it into the shell registry** (`library/layouts/app-wrapper-material/index.html`, the
   `PROFILES` object). A nav entry with no registry entry renders a silent placeholder. Take
   `src` from the folder, `tag` from `customElements.define` in `index.js`, `profile` from the
   `.vue` filename — never from a guess.
5. **Load data per tab with `fetch`, never `import`.** The single-file IIFE inlines every
   import, so a static `import` of a data table inlines it into the bundle (one such import
   took two bundles to 2.0 MB and 2.9 MB; per-tab `fetch` brought them to 308 KB and 647 KB).
6. **Verify it mounts.** Open it and confirm the pane paints — don't infer it from a clean
   build.

**One-line test:** are you changing a named constant, or writing logic? Constant → you're
imitating. Logic → stop.

---

## Change colors

Colors are **values, not logic** — you edit values, the library owns the mechanism. Which of
two places a color lives follows one rule: **reused by more than one map → shared library;
only your map uses it → your profile.**

**Path A — a shared color (affects every map that uses it).** Edit
`library/colors/<name>.js` (e.g. `religion.js`) and change a hex in the `PALETTE`. The library
auto-discovers every `<name>.js` in that folder, so there's no registration step. Be
deliberate — this changes *every* map using that mode.

**Path B — a color private to your map.** Create
`plugin-designs/<your-map>/src/colors/<name>.js` (copy `template-bundle/src/colors/example-mode.js`
as a starter). Your bundle's `index.js` runs `registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))`
at startup, merging your local files **over** the shared set. The **filename** derives the
mode key (`language-family.js` → `languageFamily`):

- **Same key as a shared strategy → your file overrides it** (for your map only).
- **A new key → your file adds a private strategy** (only your map sees it).

Because each bundle is its own self-contained IIFE with its own copy of the registry, a local
strategy can never leak into another map. The required `export default` shape (the strategy
contract) is in [architecture/color-strategies.md](./architecture/color-strategies.md);
`religion.js` is the canonical example.

---

## Where do the maps get served from?

Your built maps are just files. To show them on other websites, the files need a **public home**
on the internet that any site can pull from — that's what a "CDN" is. **You choose the home, and
there are options:**

- **Your own site (doxa-life).** Put the built maps in doxa-life's `public/` folder — its Nuxt
  site serves them, so **doxa-life is the CDN**. No third party.
- **GitHub.** Push the built maps to a public GitHub repo and serve them free through
  **GitHub Pages or jsDelivr** — **GitHub is the CDN**.
- **A Git host you run (for example Forgejo).** Push the maps there and serve them from it, with
  no extra service to set up.
- **Anywhere else.** Any static host works — Cloudflare, an S3-style bucket, etc.

Pick one home and **every partner site embeds the same map from it** — change the map once and it
updates everywhere.

**How it's wired** (one file: `vite.doxa-maps-build-config.json`; full field table in
**[reference.md](./reference.md)**): `bun run build` always writes to `public/dx-maps/<bundle>/`.
Set `paths` to also copy the tree into another host's folder (e.g. doxa-life's `public/`). Set
`embedBaseUrl` to the public URL of your chosen home — it generates absolute, paste-anywhere embed
snippets (leave it empty for relative URLs that work wherever the folder is dropped).

> **`dev` never updates a built `public/`.** Run `bun run build` (or `BUNDLE=<name> bun run
> build:bundle`) and refresh to see a change on the served site. `bun run dev` is for iterating
> on a map in isolation.

---

## Hosting the dx-maps folder: caching, compression, CORS

**Why it matters.** On a cold load a map's layers draw about 10–17 s after the page opens (measured
on the UPG100 Posters page). The bundle and the map engine take under 2 s of that; the rest is basemap
tiles and data files such as the country-boundary file (1,866 KB raw, 597 KB gzipped). Compression
cuts every visit; caching means a returning reader doesn't download the same files again.

**Every file in `dx-maps/` has a fixed name today.** Nothing is content-hashed, so a new release
overwrites files in place: bundles (`<bundle>/<bundle>.js`), their pages (`index.html`) and
`manifest.json` change whenever the build changes them. Images, fonts and data files change rarely,
but under the same names.

| Files | `Cache-Control` | Why |
|---|---|---|
| everything in `dx-maps/`, as it ships today | `public, max-age=86400, stale-while-revalidate=604800`, with an `ETag` | a revisit revalidates cheaply and never re-downloads unchanged bytes, and a release shows up within a day |
| content-hashed names, if you add them (e.g. `world-adm0.3f9a1c2e.geojson`) | `public, max-age=31536000, immutable` | a changed file gets a new name, so a year-long cache is always safe |

**Never send `immutable` for a fixed name**: an update would stay invisible for a year.

**Compress:** serve `br` or `gzip`, and give data files a JSON content type (`application/json`, or
`application/geo+json` for `.geojson`) so CDNs compress them. Many servers send `.geojson` as
`application/octet-stream`, which CDNs don't compress.

**CORS for script embeds:** every `embed.script` snippet loads the bundle with an `integrity` hash
and `crossorigin="anonymous"`. For that to work on another site, the host must send
`Access-Control-Allow-Origin: *`; without it the browser can't check the hash across origins and refuses
the script. iframe embeds need no CORS.

On Cloudflare Pages or Netlify, a `_headers` file at the folder's root sets the CORS and cache headers:

```
/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
```

Check the content type your host gives `.geojson` files (`curl -sI <url>`) before relying on compression.

---

## Compose maps into a SPA (the app shell)

Several maps + one layout = a single-page app, served from the same `public/` tree.

1. **Pick a wrapper** in `library/layouts/` (`app-wrapper-material` is the full shell: sidebar,
   lazy-loading, i18n).
2. **Register your map** in two places inside the wrapper:
   - `nav.js` — add a sidebar entry (`{ kind, id, label, icon, target }`; `target` controls
     desktop/mobile packaging).
   - the `PROFILES` object in its `index.html` — tell the shell what to mount:
     `{ tag: '<your-element>', src: './dx-maps/<bundle>/<bundle>.js', views: ['map'] }`.
3. **Install the shell**: `bun run shell` — copies the wrapper to `public/index.html`, so the
   site root IS the SPA and the bundles sit beneath it. (Also required for the mobile app.)
   > Note: the build's own front page — the **Plugin Studio** — is `public/dx-maps/index.html`,
   > inside the output folder, so installing the shell at `public/index.html` does not replace it.
   > The next `bun run build` leaves the shell's copy alone and regenerates the output folder.
4. **Build & serve**: `bun run build`, then serve `public/` — the shell lazy-loads each bundle
   the first time you open its nav entry.

Contracts and gotchas (PROFILES shape, tag-vs-bundle names, `--no-token`):
[architecture/app-wrappers.md](./architecture/app-wrappers.md).

---

## Build the Android / iOS app (optional)

**Mobile is separate from `bun run build`.** The default build produces **only** the `dx-maps`
web folder — the embeddable maps (and the SPA, if configured). It never touches Capacitor. The
Android/iOS app is an **opt-in** step that *reuses* that web build: Capacitor's `webDir` points at
`public/dx-maps/` (`appId: life.doxa.maps`, `appName: "Doxa Maps"`), so `cap sync` wraps the already-built
folder into a native app. You never need to build mobile to ship the web maps.

**The quickest app is one plugin, with no rebuild:** `bun run phone:deep-research` installs Deep Research
as an app. The whole tutorial: [how to build mobile apps from plugins](how-to-build-mobile-apps-from-plugins/README.md).

**Android** (project is committed; needs Android Studio + a JDK):

```bash
bun run apk:debug     # build web → cap sync → verify → assemble a debug APK (the full build asks for BUILD_ALLOW=1)
bun run apk:install   # adb install onto a connected device/emulator
```

Step by step instead: `bun run build` → `bun run cap:sync` → open `deployment/capacitor/android` in Android Studio.

**iOS** (scaffold once on a Mac): `./node_modules/.bin/cap add ios`, then `bun run build &&
./node_modules/.bin/cap sync ios`, and open `deployment/capacitor/ios` in Xcode. Same `webDir: public`.

> **Invoke the local bin, not `bunx`.** `bunx` is not on PATH in every environment (it exits 127,
> *command not found*), which is what broke `cap:sync` → `apk:debug` → `phone` at step one. The
> Capacitor CLI is installed locally, so `./node_modules/.bin/cap` always resolves. Elsewhere this
> repo uses the spaced `bun x` form for the same reason.

> `cap sync` copies `public/` into the native project's assets. A wrong `webDir` gives a **blank
> white screen** at launch (empty assets), not an error — `bun run cap:verify` guards against it.

---

## Swap the map engine (Mapbox ↔ MapLibre)

The engine is a **runtime parameter** — same bundle, no rebuild. Resolution order
(first defined wins): `profile-config.provider` → `?provider=` in the page URL →
`window.MAP_PROVIDER` → default `auto`.

`auto` is **MapLibre**: keyless, with no request to Mapbox. Since 2026-09-28 a token no longer chooses the
engine. **Mapbox** is an explicit `provider: "mapbox"`, and the token then authenticates it (a `tk` in the
profile-config, `window.MAP_TOKEN`, `?tk=`, a token pasted once in the tree, the studio's ⚙ Settings, or a
configured token URL). An explicit `provider` always wins.

```html
<!-- per embed -->
<my-map profile-config='{"profile":"my-map","provider":"maplibre"}'></my-map>

<!-- or flip any generated page from the URL -->
https://<cdn>/dx-maps/<bundle>/<profile>/index.html?provider=maplibre
```

`maplibre` runs token-free on the OpenFreeMap style (the right GL script/CSS is injected
automatically); the geocoder search bar keeps working in both engines. Its **place** results come
from Mapbox geocoding, on either engine, and only with a token: without one no request goes to Mapbox,
the box says "place search needs a Mapbox token", and people-group, language, religion and country
search (local data) keep working. `mapbox` behaves exactly
as before, and an embed that passes a token keeps getting Mapbox under `auto`.

> Status: **on `main`.** Generated pages honor `provider:'maplibre'` end-to-end — the page
> loads the MapLibre peer instead of Mapbox and **skips the token ladder entirely** (no
> account, no key). Living demo: `demo-map/demo-map/maplibre/index.html` (a preconfigured
> instance); the embed smoke (`bun run smoke:embeds`) verifies it mounts with a live canvas.

---

## Show a different people-group list

Every map shows DOXA's people groups unless you ask for another list — same bundle, no rebuild.
Resolution order (first defined wins): `profile-config.list` → `?list=` in the page URL →
`window.MAP_LIST` → default `doxa`.

| `list` | also accepts | shows |
|---|---|---|
| `doxa` | `2000`, `project-2000` | Project 2000: DOXA's people groups |
| `unreached` | `7000`, `project-7000` | Project 7000: unreached people groups |
| `frontier` | `4700`, `project-4700` | Project 4700: frontier people groups |
| `frontier-500k` | `700`, `project-700` | Project 700: frontier people groups of 500,000 or more |
| `unengaged` | — | Unengaged unreached people groups |

```html
<!-- per embed -->
<my-map profile-config='{"profile":"my-map","list":"frontier-500k"}'></my-map>

<!-- or flip any generated page from the URL -->
https://<cdn>/dx-maps/<bundle>/<profile>/index.html?list=700
```

**What you get today:** the DOXA groups that belong to that list. Rows and prayer data come from the
DOXA API, so a list's groups that DOXA does not carry are not shown yet. An unknown list falls back to
`doxa` with a console warning. If a list's membership file cannot load, the map shows **no**
groups rather than DOXA's whole list under the wrong name. Composites pass `list` to every child.
The definitions live in `library/lists/lists.json`; `bun run lists` regenerates the membership files.
Full contract: [reference-universal-props.md](./reference-universal-props.md), section 5.

---

## Hide the Plugin Studio header

The Studio header is where you set the universal props (language, engine, token). **Hide header**
collapses it so the plugin takes the full height; a **Show header** button stays in the top corner
to bring it back. The choice is remembered in this browser.

---

## Embed under a strict Content-Security-Policy

No bundle needs `'unsafe-eval'` (translations compile without `eval`; `bun run check:no-eval`), and
every third-party script is pinned with an integrity hash (`library/constants/cdn.js`,
`bun run check:cdn-pins`). A page embedding the maps needs, in addition to its own sources:

| Directive | Add | Why |
|---|---|---|
| `script-src` | `https://cdn.jsdelivr.net` (and `https://api.mapbox.com` for Mapbox) | the map engine and the search geocoder |
| `style-src` | `'unsafe-inline'`, the same CDN hosts | each plugin styles its own shadow root with a `<style>` element |
| `worker-src` | `blob:` | the map engines run their tile workers from a blob URL |
| `connect-src` | the tile/style hosts you use (`https://tiles.openfreemap.org` for MapLibre, `https://*.mapbox.com` for Mapbox), your data API | tiles, styles, glyphs, data |
| `connect-src` (Bible Posters) | `https://bible.helloao.org` | the public-domain Bible text, fetched per book at render time (no text is bundled) |
| `img-src` | `data:` `blob:` and the same tile hosts | sprites and raster tiles |

---

## Set the API + Mapbox token

Both the data backend and the Mapbox token are **runtime inputs**, never baked into a bundle.

**Data (the API).** Maps read data through `@map/api/`, driven by `library/api/sources.json`,
which lists every connection by id, picks one `activeSource`, and maps each source's raw field
names onto the system field names components expect (`fieldMappings`). Three connection types:
`rest-api` (the default — the live people-group API), `csv` (a local file), `api` (a single
JSON URL). To add or change a source, edit `sources.json` — components stay source-agnostic.
The base URL resolves at runtime from `window.MAP_APP_API_URL` → `VITE_API_BASE_URL` → `''`
(same-origin), so a host repoints the API with **no rebuild**.

**The Mapbox token.** Supply it per embed as `tk` in `profile-config`, or point
`window.MAP_TOKEN_URL` (or the build-config `tokenUrl`) at an endpoint that returns it. The
token stays remote — only the URL ships. Set `tokenUrl` **absolute**
(`https://…/api/maps/token`) so a CDN-hosted folder and the mobile app both work; the endpoint
must send CORS headers permitting the embedding origins. In dev, the token comes from `.env`'s
`VITE_MAPBOX_TOKEN`. A Mapbox `pk.` token is designed to be client-visible — protect it with
URL restrictions at Mapbox, not by hiding it.

---

## Give your agent the guardrail

If you point an AI agent at this repo, paste this first, before it reads any code:

> This is the doxa-maps bundler. Three zones: `library/` (`@map`) = reusable shared blocks —
> **reuse via the `@map/…` alias, never edit**. `plugin-designs/<map>/` = the sandbox for **one**
> map — **build everything here**. `internal/` = the build machine — **never touch it**.
> To build a map: copy `plugin-designs/template-bundle/`, read its README, pick reusable pieces
> from `documentation/reference.md`, then build the map's own code inside `plugin-designs/<the-map>/`.
> Change colors by editing **values** in that map's `src/colors/` folder — not logic in
> `library/`. Then run `bun run build`. If a change seems to belong in `library/`, stop and
> ask — that's an expert move that can break every other map.

Optional power-up: Mapbox publishes official agent skills (cartography, style patterns,
performance, integration) that make an agent much better at map work —
`/plugin marketplace add mapbox/mapbox-agent-skills` then `/plugin install mapbox`, or
`npx skills add mapbox/mapbox-agent-skills`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Changed a `.vue`, served site shows old map | You ran `dev`, or didn't rebuild | `bun run build`, then refresh |
| `Set BUNDLE=<name> for build` | Ran `vite build` with no bundle selected | `bun run build` (all) or `BUNDLE=<name> bun run build:bundle` |
| New bundle doesn't appear | Missing `index.html` or `index.js` in the folder | Vite discovers a bundle only when both exist |
| Old bundle still loads after a build | Browser cached the static `.js` | Hard-refresh / disable cache in devtools |
| Map is blank on a partner page | Mapbox peer not loaded, or no token | Load `mapbox-gl.js` + geocoder **before** the bundle; pass a valid `tk` |
| `Profile not found` error box | `profile` doesn't match a flat `.vue` filename in the bundle | Fix the `profile` field to match a filename |
