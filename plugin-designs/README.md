# plugin-designs/ — where YOUR maps live

The shared template lives in `../library/` (aliased `@map`) — you never edit it per-map.
You build your map by making a folder **here**, `plugin-designs/<your-map>/`, and composing the
template's building blocks. Your folder is yours (colors, API, i18n); the template is shared
(Apache-2.0, propagated to every map on the next build).

## Shared vs. yours — the balance

```
  library/  (@map)  ── SHARED, reusable, parameterized ──►  legend · map · map-controls
        │                                                    (every map reuses these)
        │  imported by
        ▼
  plugin-designs/<your-map>/  ── YOURS ──►  the map's "main" class (the .vue profile = the Vue
        │                                  instance for that map)
        └── src/            ── YOURS ──►  this map's OWN non-reusable components, colors, API, utils

  One bundle can hold as many maps as you want — add another .vue profile and rebuild.
```

- **Reusable → `library/`.** The legend, the map, the map-controls are shared, parameterized
  components every map reuses. Fix once, every map benefits. Never edit it to customize one map.
- **This map's own → `plugin-designs/<your-map>/`.** It holds two things: the map's **"main" class**
  (each `.vue` profile *is* the Vue instance for that map) **and** that map's **own non-reusable
  components** (in `src/`). Nothing here leaks to another map.
- **Many maps per bundle.** The bundler bundles one map or many — add another flat `.vue` and rebuild.

## Production or experimental — every profile declares itself

Every app profile is one of two things, and **experimental profiles are unlimited and
encouraged** — create as many as you need:

- **Experimental, not built:** prefix the folder with `_` — the build skips it; it just sits
  in code. Zero cost, zero risk.
- **Experimental, built:** builds normally, but it belongs in the **Experimental section** of
  the power app's layout (nav section) — never embedded on partner surfaces.
- **Production:** a real product — main sections of the power app + individually embeddable.

(The **power app** = the SPA layout that composes all profiles into one application.)

## The pattern in one picture

```
plugin-designs/<your-map>/     ← one FOLDER = one BUNDLE, named after the folder
   ├── index.js               ← entry: registers the custom element, finds the profiles
   ├── overview.vue           ← one .vue = one PROFILE (flat in the folder — no profiles/ subfolder)
   └── detail.vue             ← another profile in the SAME bundle

     builds to ─────────────► public/dx-maps/<your-map>/<your-map>.js   (one file)
```

- **Folder name = bundle name.** Folders starting with `_` or `.` are skipped (handy for WIP).
- **Each `.vue` = one profile** (one map screen). One bundle can hold many.
- **Pick the profile at embed time** with the `profile` field — every profile shares one bundle:

```html
<script src="/dx-maps/<your-map>/<your-map>.js"></script>
<your-map profile-config='{"profile":"overview","tk":"MAPBOX_PUBLIC_TOKEN"}'></your-map>
<your-map profile-config='{"profile":"detail","tk":"MAPBOX_PUBLIC_TOKEN"}'></your-map>
```

## Add a map — three steps

```bash
# 1. create the folder + one profile
mkdir -p plugin-designs/<your-map>
#    index.js   ← copy doxa-simple-map/index.js, rename the tag
#    <name>.vue ← your screen, built from @map/* blocks (flat in the folder)

# 2. build
npm run build            # → public/dx-maps/<your-map>/<your-map>.js
#    (just this one:  BUNDLE=<your-map> npm run build:bundle)

# 3. embed the script tag + element (dev staging at `npm run dev` shows a paste-ready snippet)
```

## Your three things (everything else is shared)

- **Colors** — how pins are colored. Pick one the template ships (`getColorStrategy('language-family')`),
  or drop your own in `plugin-designs/<your-map>/src/colors/` (start from
  `template-bundle/src/colors/example-mode.js`). Never edit `@map/colors/` to recolor your map.
- **API** — your map reads its data from the `profile-config` on the page, so the same bundle points
  at different data with no rebuild. `DataSourceManager` accepts `csv` (bundled file), `api` (one JSON
  URL), or `rest-api` (a live REST endpoint, the default). Prefer the real API over inlined JSON.
- **i18n** — the template ships 11 base locales in `@map/i18n/locales/`. Use `useI18n()` for strings
  and `RTL_LOCALES` for right-to-left; add or override strings from your own profile.

## The one hosting variable

The only thing that changes between hosting modes is the `<script src>`: a **relative** path when
your own site serves the file, or an **absolute CDN URL** when a partner site serves it. The bundle
is identical either way. See `../documentation/CONTRIBUTING.md` for the two CDN modes and partner-site embedding.

## Profile patterns (mix freely)

- **Individual** — one `.vue` per bundle (simplest).
- **Parameterized** — one profile, behavior driven by `profile-config` props (e.g. `tabs[]`).
- **Nested** — one profile that renders others (workbench-style, like `doxa-research-map`).

## See also

- `doxa-simple-map/index.js` — fully commented reference bundle entry
- `template-bundle/` — minimal two-profile skeleton to copy
- `../library/colors/README.md` — the color-strategy contract
- `../README.md` — repo overview & build pipeline · `../documentation/CONTRIBUTING.md` — build vs dev, CDN modes
