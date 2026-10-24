# template-bundle — copy this to start a new plugin

**This folder is the STARTER. Copy it to make a new plugin. That's the whole idea.**

Your starting point. **Copy this folder, then build your map inside the copy** — don't start from
blank. It's a tiny working bundle plus a `src/` sandbox laid out for your real code:

- **`template-map-a.vue` is a real map.** It draws the points in `data/places.geojson` on a basemap,
  shows its text translated, and follows the page's engine, language (including right-to-left) and
  Mapbox token. **It needs no account**: with no token it runs on the free MapLibre engine. Swap in
  your own points and it is your map.
- **`template-map-b.vue`** is a second, trivial screen: a heading and two lines of translated text,
  one of them a sentence that carries markup. It shows that one bundle can hold several screens, and
  how a sentence is translated. Delete it if you want one.

## In plain English (read this first)

If you've never touched this repo, here are the only 4 words you need:

| Word | Plain-English meaning |
|---|---|
| **plugin / bundle** | One folder = one plugin. It compiles into a **single `.js` file** you can paste onto any web page. "Bundle" and "plugin" mean the same thing here — the folder you copy. |
| **profile** | One `.vue` file inside the folder = one **screen** (one map). A bundle can hold one profile or many. You pick which screen shows at embed time with a `profile` name. |
| **root.vue** | Each profile IS a normal Vue component — it's the "root" (the top of the tree) for that one screen. The filename (minus `.vue`) is the profile's name. Everything that screen draws hangs off this one file. |
| **`src/`** | Your private sandbox — your own colors, components, and helpers. Nothing in here can affect another plugin. Shared building blocks live in `library/` (imported as `@map/…`) and you never edit those. |

**Make a new plugin in 2 moves:**

```bash
# 1. copy this starter to a new name
cp -r plugin-designs/template-bundle plugin-designs/my-plugin

# 2. build (the ONE command)
bun run build      # → public/dx-maps/my-plugin/my-plugin.js  (your paste-anywhere plugin)
```

Then rename the tag + profile strings (the "exactly four things" list below) so your copy has its
own name, and rebuild. That's it — the build auto-detects your new folder, compiles it to one `.js`
custom element, and lists it in the gallery.

> Proven: a copy of this folder (`cp -r` + rename the 4 strings) runs `bun run build` and emits a
> working `<my-plugin>` custom element `.js` bundle that passes every build guard. If it builds for
> the starter, it builds for your copy.

## Two zones — know which one a file is in

| Zone | What | Edit it? |
|---|---|---|
| **`library/`** (imported as `@map/…`) | shared, reusable building blocks — map, legends, toolbars, composables, color + API registries | **No — reuse only.** A change here can break every other map. |
| **`plugin-designs/<your-map>/src/`** | your private sandbox — screens, colors, API wiring, components, utils | **Yes — build anything.** Nothing here leaks to another map. |

Rule of thumb: **local by default.** Code only moves into `library/` once a *second* map genuinely
needs it — an expert move, not a first move. To see everything `library/` offers, read
`../../documentation/reference.md` (that's the menu you pick from).

## Build a new map — the steps

1. **Copy this folder** → `plugin-designs/<your-map>/`, then change **exactly four things**:
   - the **folder name** (= bundle name = output file `<your-map>.js`),
   - the **tag** in `index.js` (`customElements.define('<your-map>', …)`),
   - the **tag + `profile` strings** in `index.html` (the staging page must mount your tag),
   - the **`.vue` filenames** — rename `template-map-a.vue` to your screen's name and delete
     `template-map-b.vue` if you only want one screen (filename = the `profile` name). Each `.vue` has a
     **`.meta.json`** beside it (its name in the Plugin Studio): rename it with the `.vue` and change its
     `label`. Without it your plugin builds but is not listed in the Studio.
   Nothing else. Check it: `bun run dev` → your map renders at
   `http://localhost:5173/plugin-designs/<your-map>/index.html`.
2. **List what your map needs** — data, colors, controls (legend, search, share, fullscreen…).
3. **Pick pieces from `../../documentation/reference.md`** and import them by reference (`@map/…`) — never
   copy library code into your folder.
4. **Put your own code in `src/`** — screens, components, hooks, helpers.
5. **Set colors in `src/colors/colors.json`** (plain hex, no code). For color that varies by data,
   use a strategy `.js` in `src/colors/` (copy `example-mode.js`).
6. **Build** — `bun run build` (or just this one: `BUNDLE=<your-map> bun run build:bundle`).

## What's in this folder

```
template-bundle/
├── index.js              ← bundle entry: registers <template-bundle>, globs ./*.vue
├── index.html            ← dev staging page (the build needs it to find the bundle)
├── template-map-a.vue    ← profile "template-map-a": THE MAP  ← FLAT at the bundle root
├── template-map-b.vue    ← profile "template-map-b": a box  ← FLAT at the bundle root
├── data/places.geojson   ← the map's points (imported by template-map-a.vue, ships inside the .js)
└── src/                  ← YOUR SANDBOX (each subfolder has its own README)
    ├── api/  colors/  components/  composables/  utils/
```

**The flat rule:** profile `.vue` files sit **directly in the bundle folder** — there is no
`profiles/` subfolder, because the entry discovers them with a flat glob
(`import.meta.glob('./*.vue')`). A `.vue` inside a `profiles/` subfolder would NOT be found. Keep
your profile screens flat; the small pieces they're built from live in `src/`.

Everything builds into **one** file: `public/dx-maps/template-bundle/template-bundle.js`.

## The map's pieces (template-map-a.vue)

| Piece | Where it comes from | To change it |
|---|---|---|
| the points | `data/places.geojson` (a static import, so no extra request on the host) | replace the file with your own GeoJSON points |
| the pin colour | `src/colors/colors.json` → `pins.selected` | edit the hex |
| the engine (Mapbox or MapLibre) | the page: `profile-config` `provider`, `?provider=`, or `window.MAP_PROVIDER`; no token → MapLibre | nothing: leave it to the page |
| the language and right-to-left | the page's locale, given by the library's ProfileLoader | nothing: leave it to the page |
| the words on screen (the title, the two error lines) | keys in `library/i18n/locales/<lc>/template.json`, shown with `t()` in the template | see below |

**Your own text.** Every string a reader sees is a key, in all eleven locales. Translations live in
`library/` (every locale in one place), so a new key there is a library change: ask the build owner
to land it. Until then, a plain English string in your `.vue` is fine. Three habits keep it right:

- **Call `t()` in the template**, not once at setup. `const title = t('template.title')` freezes the
  first language; `{{ t('template.title') }}` follows a page that switches language later.
- **Keep a message's KEY in state, not its words.** An error stores `'template.engineMissing'`, and the
  template translates it when it shows (see `errorKey` in `template-map-a.vue`).
- **A sentence is ONE key, even with markup in it.** `template-map-b.vue` renders "Served from {file}
  in the {bundle} bundle." with `@map/composables/useSentence.js`; the two names go in as their own
  `<code>` elements, so each language can put them where its grammar wants. Never build a sentence
  from pieces ("Served from" + name + "in the" …): that fixes English word order in every language.

## The two ways you import

- **Reuse from the library** → the `@map/…` alias: `import { useMapInstance } from '@map/composables/useMapInstance.js'`
- **Your own sandbox code** → a relative path: `import colors from './src/colors/colors.json'`

There's no alias for your sandbox — your code is always relative. That boundary keeps it private.

## Embed it

```html
<script src="/dx-maps/template-bundle/template-bundle.js"></script>
<template-bundle profile-config='{"profile":"template-map-a"}'></template-bundle>
<template-bundle profile-config='{"profile":"template-map-b"}'></template-bundle>
```

(`profile` must match a `.vue` filename in this folder, without `.vue`. Add a third profile by
dropping another flat `.vue` next to these and rebuilding — no config to edit.)

## See also

- `src/README.md` — sandbox layout · `../README.md` — the plugin-designs authoring guide
- `../../documentation/tutorial.md` — 3 zones + 3 rules in one page · `../../documentation/reference.md` — the `@map/…` menu
- `../doxa-simple-map/index.js` — a fuller, real-map reference entry
