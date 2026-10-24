# Architecture — UPG100 List poster generation

> The simple overview is in `library/scripts/posters/README.md`. This is the full reference for the
> generator: files, environment, pipeline, and the gotchas that have bitten before.

The poster generator for the **my-upg-100-list** profile renders one 3ft × 3ft print poster per
zone (28 today) from the profile's own data.

**It lives inside doxa-maps on purpose.** It used to sit outside the repo in a sibling generator
folder and reach in for data via a `UPG100_DATA_PATH` env var. That cost real bugs: forget the var
and it silently rendered a **stale duplicate** of `clusters.json` — which is how Nepal, and later
Bangladesh + Bhutan, vanished from posters that looked fine otherwise. The generator and the data
it reads now ship together.

## Run it

```bash
bun run posters            # all 28 posters      -> out/posters/*.html
ONLY=asia-india-tamil-nadu bun run posters:one   # just one (fast, ~15s)
bun run posters:shoot      # HTML -> PNG @3000x3000 (Playwright/Firefox)
bun run posters:gallery    # review pages        -> out/index.html + out/hd.html
bun run posters:export     # region folders      -> ../../../upg-100-posters/
```

The full pipeline, in order:

```
posters  ->  posters:shoot  ->  (convert to WebP previews)  ->  bun run build
```

The WebP step feeds `plugin-designs/my-upg-100-list/assets/previews/`, which is what the poster wall
shows in the app. **A template change is not visible in the app until previews are regenerated and
the app is rebuilt.**

## Files

| File | What it does |
|---|---|
| `generate.mjs` | THE template. Reads the profile data, writes one HTML poster per zone. |
| `shoot.mjs` | Screenshots each poster to PNG (Firefox — never Chromium; privacy-first policy). |
| `poster-regions.mjs` | The region map (India, Africa, …). Shared by both gallery builders. |
| `build-gallery.mjs` | `out/index.html` — browsable preview grid, sectioned by region. |
| `build-hd-gallery.mjs` | `out/hd.html` — full-resolution review + copy-to-clipboard. |
| `export-public.mjs` | Copies PNGs into region folders OUTSIDE the repo (see below). |

## Environment

| Var | Default | Notes |
|---|---|---|
| `SPARSE=1` | — | **Required.** Selects the approved template. Without it you get the older full-vision layout. |
| `FORMAT=3x3` | `3x4` | 1500×1500 square sheet. |
| `OFFLINE=1` | — | Use the cached `out/_records.json` instead of calling the API. |
| `VITE_API_BASE_URL` | — | Satisfies the fail-closed config gate. No request is made under `OFFLINE=1`. |
| `ONLY` | — | Build a single zone by `zoneKey`. |
| `UPG100_DATA_PATH` | the profile in this repo | Only override to test against other data. |
| `SERIES_INDEX` / `SERIES_NAME` | derived / `UPG100 List` | Series line on the sheet. |

## Two things that will bite you

**1. The exported PNGs must NOT go in `public/`.** `capacitor.config.json` sets `webDir: "public"`
and Capacitor packages that directory wholesale — no per-path exclude. The export is ~52 MB, and
the per-bundle vite build also fans the served root into every MFE, so it duplicated **11×**
(631 MB) when it lived there. `export-public.mjs` therefore writes to `../../../upg-100-posters/`, a
sibling of the repo. Desktop/web can serve from there or a CDN; the phone gets posters from a CDN
or generates on device.

**2. Fail-loud guards, not silent overlaps.** `generate.mjs` throws if the header would be drawn
over the map frame, or if the below-map block would run off the sheet. Raise the constant or tighten
the copy — never delete the guard. Both have caught real regressions (`west-africa`, `sudan`,
`gujarat`, `oceania-indonesia`).

## Measurement discipline

SVG `<text>` does not word-wrap, so all multi-column setting is measured in the generator via
`CHADV -> textW -> wrapPx -> paraInto`. **That estimator is calibrated for Lato at body sizes and is
wrong elsewhere** — measured drift: Georgia bold display type runs ~1.35× wider than predicted, bold
digits ~0.98em against an assumed 0.63em, mixed bold/regular runs ~10% narrower. Every size that
must fit a box is therefore taken from the **rendered** artefact (`getBBox`), not from the formula.
When adding new display text, render it and measure before trusting a computed size.
