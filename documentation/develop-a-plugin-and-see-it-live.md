# Develop a plugin and see it live — the golden path

**Author a map plugin, build it once, prove it mounts, and see it live — in six steps.** Each step links
to the doc that teaches that piece in depth.

| Step | You do | Command | Done when |
|---|---|---|---|
| **1. Pick a capability** | choose how much your plugin nests | — | you know your tier (1–5) |
| **2. Author** | write 3 files in `plugin-designs/<your-plugin>/` | — | the folder has `.vue` + `index.js` + `index.html` |
| **3. See it in the studio** | iterate with hot reload, no build | `bun run dev` | your plugin appears at http://localhost:5173/ |
| **4. Build** | produce the deployable tree | `BUILD_ALLOW=1 bun run build` | exit 0, all guards PASS |
| **5. Prove it mounts** | open every plugin in a real browser | `bun run smoke:embeds` | `N/N pages mount cleanly` |
| **6. Publish and see it live** | copy the tree to your host, embed it | see Step 6 | the live URL shows it |

Everything you build is a **compiled Vue custom element**: one folder → one bundle → one `<tag>`. A static
HTML page is never a plugin (it can only be iframed).

---

## Step 1 — Pick a capability

A plugin is one of five tiers, simplest → most composable:
**single element → prop-table → multi-view → composite (nested elements) → app shell (nested SPAs)**.
Composite tiers declare themselves in `<bundle>.meta.json` (`{"type": …}`). Imitate the nearest reference
plugin: [reference-capability-exemplars.md](reference-capability-exemplars.md) names one per tier.

## Step 2 — Author: three files are enough

In **`plugin-designs/<your-plugin>/`**:

| File | Required? | What it is |
|---|---|---|
| `<your-plugin>.vue` | **required** | the root Vue SFC — your plugin's UI (styles are shadow-scoped automatically) |
| `index.js` | **required** | `defineCustomElement(RootVue)` → `customElements.define('<your-tag>', El)` — register ONLY your own tag |
| `index.html` | **required** | the staging entry page that mounts `<your-tag>` — the build fails without it |
| `<your-plugin>.meta.json` | composite tiers only | `{"type": "<machine key>", "composes": […], "label": "…"}` |
| `<your-plugin>.instances.json` | optional | preset instances — supplying one makes the bundle **prop-table** (cap 2) |
| `src/` | optional | private components used only by this plugin |

**`plugin-designs/` is your free zone.** Contribute to the shared `library/` (`@map`) only when a component
is genuinely **reusable and parameterized** — a library edit reaches every plugin. Walkthrough:
[tutorial.md](tutorial.md).

## Step 3 — See it in the studio (seconds, no build)

```sh
bun run dev          # vite on :5173; `/` is the Plugin Studio, every plugin in one place
bun run smoke:studio # ~5s: asserts the studio mounts and every plugin is a real subtree
```

This is the loop to live in while authoring: about 5 seconds, against a full build of 1–4 minutes.
The build is for publishing, not for looking.

## Step 4 — Build the deployable tree

```sh
BUILD_ALLOW=1 bun run build      # discovers plugin-designs/*, bundles each, writes public/dx-maps/<plugin>/<plugin>.js
```

**Exit 0 + every guard PASS = a good build.** Your plugin now exists under `public/dx-maps/<your-plugin>/`
with a standalone leaf page and a `manifest.json` entry. `BUILD_ALLOW=1` is deliberate: a full build first
wipes `public/dx-maps/`, so it refuses (exit 75) in a shared checkout unless you mean it. To compile only
your plugin: `BUNDLE=<your-plugin> bun x vite build`. Recipes: [how-to.md](how-to.md).

## Step 5 — Prove it mounts in a real browser

**A green build is a static result**: it proves files exist, parse and carry correct hashes. It never opens
your element, and an element that throws on setup renders nothing while the build stays green.

```sh
MAPBOX_TOKEN=$(python3 -c "import json;print(json.load(open('vite.doxa-maps-build-config.json'))['token'])")
MAPBOX_TOKEN=$MAPBOX_TOKEN bun run smoke:embeds                                 # every plugin
MAPBOX_TOKEN=$MAPBOX_TOKEN node internal/embed-smoke.mjs --grep <your-plugin>   # just yours
```

**Expect `N/N pages mount cleanly`.** The token matters: without it every *map* plugin fails to mount while
every non-map plugin passes, which looks like many broken plugins and is not. Take the token from the
build config, as above ([why](#notes-and-history)).

## Step 6 — Publish and see it live

**Copy the built tree to any static host, then embed from it.** The tree is `public/dx-maps/`; every
plugin's ready-made snippets are in its `manifest.json`.

```sh
set -e                                   # first line: a failing check must stop the publish
bun run check:settled                    # never publish a tree a build is rewriting
bun run check:sri                        # every leaf's integrity hash matches its bundle
bun run check:embed-targets              # every embed snippet points at a real file
rsync -a --delete public/dx-maps/ <your-host-checkout>/dx-maps/
# commit and push the host checkout; for a large tree: git -c http.postBuffer=524288000 push …
```

| # | Deployment method | How | Status |
|---|---|---|---|
| 1 | **iframe** | point an `<iframe>` at the plugin's leaf page | ✅ production |
| 2 | **mobile app** | `bun run phone` (Capacitor) — same tree, no new code | ✅ built |
| 3 | **JavaScript embed** | `<script src=".../<plugin>.js">` + `<your-tag>` (SRI-pinned) | ✅ production |
| 4 | **WordPress / Disciple Tools** | `deployment/wordpress/doxa-maps-embed/` emits the embed snippet | 🧪 proof of concept |
| 5 | **desktop (Tauri)** | `bun run tauri:build` — a binary and `.deb` wrapping the same tree | 🧪 proof of concept |

**Done = the live site shows it, not a green build.** To check the whole pipe at once, open the
`golden-path-check` plugin on your host: it reads the manifest beside it and reports how many bundles
it can see and whether it finds itself. To check that what you published is *current*, run
`bun run check:catalog-currency`.

**Your plugin surfaces itself.** Deep Research (`doxa-maps-spa`) reads the built `manifest.json`
and puts every bundle it doesn't already curate into its folded **Experimental** shelf, with the label and
description from the manifest — no code edit. Promoting it to a curated tab is an optional edit to
`TAB_DEFS` and `NAV_MODEL` in `plugin-designs/doxa-maps-spa/`. One row per bundle: a bundle's extra
profiles are views inside its pane.

---

**The whole path:** author in `plugin-designs/` → see it in the studio → `BUILD_ALLOW=1 bun run build`
→ prove it mounts (`smoke:embeds`) → publish → it appears on the Experimental shelf. Deep dives:
[tutorial.md](tutorial.md) · [how-to.md](how-to.md) · [reference.md](reference.md) · [why.md](why.md).

---

## Notes and history

The measurements behind the steps above, kept for whoever needs the reasoning.

- **Step 2 — how many files a plugin really has (measured 2026-09-21).** Across 18 bundles a folder held
  3 to 8 files. `all-people-groups` is the true minimum at 3 (root `.vue` + `index.js` + `index.html`), and
  9 of 18 had no `.meta.json` because single and prop-table tiers are inferred. Removing `index.html` from
  `demo-map/` made the build error and dropped the bundle (18 → 17 buildable).
- **Step 3 — studio vs build timing (measured 2026-09-22).** `smoke:studio` passed in 4.7 s (29 tabs,
  0 failed requests); a full build took 43 s–4 min on the same box. The studio also catches a bug class the
  built tree cannot: the dev manifest hands rooted refs (`/plugin-designs/…`), the built one relative refs
  (`./bundle/bundle.js`), so a base-join bug is invisible in one and fatal in the other.
- **Step 5 — why the browser check exists (measured 2026-09-21).** A `throw` injected into
  `template-map-a.vue`'s `setup()` still built (exit 0), passed `check:parse` and `check:drop`, and
  `smoke:embeds` reported 0/2 mounted. Without a token, 27/40 mount — every map profile fails. A composite
  also needs `window.MAP_TOKEN`, because `?tk=` reaches only the top-level element; the smoke sets both.
  The browser check is not in CI (no browser binary there), so it is a local gate you run on purpose.
- **Step 5 — which token (measured 2026-09-23).** The `https://doxa.life/api/maps/token` endpoint serves a
  token restricted to `doxa.life`: a tile request without that Referer returns 403, so basemaps render
  blank while pins draw. The build-config `token` returns 200 from any origin. It is a `pk.` public key,
  restricted by URL rather than kept secret; `check:public-hygiene` allows `pk.` and fails on `sk.`/`tk.`.
- **Step 6 — why `set -e` comes first.** An earlier publish took the live catalog down with a 404 twice
  over: the verify was chained so a failing check fell through to the push, and `rsync --delete` ran from
  a tree a concurrent build had just emptied, mirroring the emptiness to the host. Hence `check:settled`
  as a precondition and a verify that can abort.
- **Step 6 — `http.postBuffer=524288000`.** The tree is ~39 MB; git's 1 MB default cannot stream it, and
  the failure (`The remote end hung up unexpectedly`) reads like a server rejection when it is a local
  buffer limit.
- **Step 6 — deployment status wording.** "Proof of concept" means the code exists and its contract check
  passes, but it is not production-ready: method 4 has no capture on a live WordPress install, and method 5
  emits a real binary and `.deb` (~67 MB and ~60 MB) that has not been launched on a desktop.
