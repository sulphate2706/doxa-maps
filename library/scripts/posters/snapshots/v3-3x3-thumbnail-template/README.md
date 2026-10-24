# SNAPSHOT v3 — 3ft × 3ft "THUMBNAIL TEMPLATE" ⭐ THE LEADING EXAMPLE

Frozen 2026-07-31. **This is the approved template** — the Brief: *"alright I like that map now,
snapshot it as the new leading example, and then roll it out for all the maps, reuse it as a template."*

Every one of the 28 posters is generated from this.

## How to build with it

```bash
cd <repo-root>/library/scripts/posters

# ONE poster
SPARSE=1 SERIES_INDEX=1 ONLY=asia-india-uttarakhand \
UPG100_DATA_PATH=<repo-root>/plugin-designs/my-upg-100-list/data \
OFFLINE=1 VITE_API_BASE_URL=https://pray.doxa.life FORMAT=3x3 \
node generate.mjs

# ALL 28 (drop ONLY=)
SPARSE=1 UPG100_DATA_PATH=... OFFLINE=1 VITE_API_BASE_URL=https://pray.doxa.life FORMAT=3x3 node generate.mjs
```

### The flags that matter

| Flag | Why it is **required** |
|---|---|
| `SPARSE=1` | **Selects THIS template.** Without it you get the v2 full-vision layout. |
| `FORMAT=3x3` | 1500×1500 square sheet. |
| `UPG100_DATA_PATH` | **Required.** The generator's default points at a STALE DUPLICATE of the profile data in `plugin-designs/` (58 slugs, no `adm0`) — without this, Nepal silently vanishes and the sheet renders 58 pins instead of 92. |
| `OFFLINE=1` | Uses the cached `out/_records.json` instead of calling the API. |
| `VITE_API_BASE_URL` | Satisfies the fail-closed config gate. No request is made under `OFFLINE=1`. |
| `SERIES_INDEX` | Optional. Overrides the sheet's position in the series. |

## The layout

```
        UNENGAGED PEOPLE GROUPS OF
           North India + Nepal          ← title, 56px
   Series "List of 100 UPG's" — 1 of ~30 maps…
        see https://Doxa.Life for more information
  ─────────────────────────────────────────────
   "But when he saw the multitudes…"  MATTHEW 9:36   ← scripture, ruled, spans map width
  ─────────────────────────────────────────────
  PEOPLE GROUPS │ COUNTRIES │ PROVINCES │ POPULATION
    92 UPG's    │  India ·  │ Uttarā… │   ~4.1M      ← 4 columns; the 2 NUMERIC ones are 34px
  ─────────────────────────────────────────────
  1. Byangsi  ┌──────────────────────┐  47. Pahari…
  2. Chaudangsi│      THE MAP        │  48. Jaine     ← names 16.8px BOLD, both gutters
     …         └──────────────────────┘     …
  ─────────────────────────────────────────────
   How can we multiply indigenous disciples…?        ← the goal, ruled
            START WITH PRAYER!
   1 · Thirty     │ 2 · Thirty   │ 3 · Thirty        ← three networks, equal columns
     disciples    │   churches   │   indigenous…
  ─────────────────────────────────────────────
   "And they sat down in groups…"        MARK 6:40   ← footer verse, 23px bold, ONE line
```

### The visual hierarchy (the the brief's stated priority order)

1. **Tier 1** — title · people-group names (16.8px **bold**) · footer scripture (23px **bold**)
2. **Tier 2** — the four columns; the two NUMERIC ones at 34px display (`92 UPG's`, `~4.1M`)
3. **Tier 3** — the three networks under the map (13.5px)

> *"the main takeaways when they look closer is to see the title and the footer and people group
> names, and then the four columns, and finally they see the three columns at the bottom."*

## Geometry

- Sheet **1500 × 1500**, `GUTTER 240` a side → map **1020 × 950**
- `HEADER 355`, `FOOTER 240`
- Label band runs the FULL sheet column (`HEADER-40` → `PH-FOOTER+40`), not the map band — the
  names live in the margins, so nothing requires them to track the map, and row pitch is what
  sets their type size.

## Everything is DERIVED — this is a template

| Value | Source |
|---|---|
| `92 UPG's` | `pins.length` — counted from the pins actually placed on that sheet |
| `~4.1M` | summed from those same records' `population`, rounded |
| Countries | from the pins' `country_code` |
| Provinces | `zone.provinces` |
| Series index | `SERIES_INDEX` env, else zone order |
| Series name | `SERIES_NAME` env, default `List of 100 UPG's` |

Nothing is hardcoded per-zone. A 58-group zone prints `58 UPG's` with its own population.

## Machinery worth knowing

- **`CHADV` → `textW` → `wrapPx` → `paraInto`.** SVG `<text>` does not word-wrap, so all
  multi-column setting is measured in the generator.
- **`WFUDGE = 1.11` is CALIBRATED against the renderer** (Lato 12.5px measured 0.498/char via
  `getBBox`, vs ~0.45 estimated). **Do not re-tune it by eye.**
- **Wrap at the size you RENDER at.** Wrapping at one size and rendering at another overruns the
  column by exactly the ratio between them. This bit twice — once at 12.5-vs-17, once at 17-vs-34.
- **Two fail-loud guards**, both of which caught real overlaps during the build:
  - `HEAD_BOTTOM > HEADER` → header would be drawn over the map frame
  - `VERSE_RULE_Y + 56 > PH` → the below-map block would run off the sheet
  Raise the constant or tighten the copy; never delete the guard.

## Bugs fixed in this version (do not reintroduce)

1. **Label overflow.** The auto-shrink measured `it.name` while the element renders `"36. " + name`,
   and used an uncalibrated 0.5em advance. `"36. Khangar (Bundeli)"` rendered 209.5px into a 184px
   column — off the sheet edge. Now measures the WHOLE drawn string, calibrated, with a bold factor.
2. **Population showed `—`.** The pin record dropped the `population` field (exactly as it once
   dropped `country_code`), though all 2,106 API records carry it.
3. **Series line collided with the scripture, then with the title.** It was absolutely positioned at
   a fixed `y` while the scripture flowed from `headY`. Now emitted inside the header flow.
4. **The footer verse could never fit.** It was anchored at `PH - FOOTER`, but `FOOTER` also shrinks
   `MAP_H`, so raising it moved the block and the rule by the same amount — the gap stayed stuck at
   164px for every value. The verse rule is now measured from the block's real bottom.

## Rollout fixes (added after the template was approved, during the 28-poster rollout)

Rolling out to all 28 exposed three faults that a single reference zone could never show:

1. **`HEADER` cannot be a shared constant.** The facts table's height depends on how many countries
   and provinces a zone has. Tuned to North India (2 countries) it overflowed on `west-africa` (13);
   tuned to `west-africa` it would steal ~60px of map from every other sheet. `measureHeader()` now
   predicts the height from each zone's OWN content and `setMapBox()` derives the map box from it,
   so every poster gets exactly the header it needs. The fail-loud guard remains the backstop — and
   it is what caught both `west-africa` and `sudan`.
2. **Pin badges could not hold 3-digit numbers.** Radius and type size were both fixed, so on zones
   with 100+ groups the digits spilled out of their circles and read as stray marks on the map.
   Both now scale with the digit count.
3. **Country/province labels piled up at world scale.** The area test admits a label if a country is
   big enough to deserve one, but says nothing about whether there is ROOM. On `uncovered-scatter`
   (a world-extent zone) ~60 names stacked into Eurasia as an unreadable block. Labels now reserve
   their box and later ones that would collide are dropped, biggest-visible-area first. Provinces
   de-overlap against the SAME list, so a province never lands on a country name.

## Known state

- **Leader crossings ≈ 359.** v1 achieved **6** via greedy adjacent-swap repair; every geometry
  change since moved the field it was tuned against. The algorithm is intact and needs a re-run,
  **This is the top open item.**
- **Provinces wraps to 3 lines** at 17px, so that column is taller than the other three and the
  band's baseline is uneven. Candidate fix: abbreviate to two names plus a count.
- `HEADER`/`FOOTER` are shared constants tuned against this zone. A zone with a taller facts table
  may trip the header guard — the guard reports the exact number needed.

## How to restore

```bash
cp snapshots/v3-3x3-thumbnail-template/generate.mjs generate.mjs
```

## Lineage

| Snapshot | What it is |
|---|---|
| `v1-3x4-portrait` | 3×4 portrait; **6 leader crossings**, the best crossing result so far |
| `v2-3x3-full-vision` | 3×3 square, full vision copy (2 vision columns) — the most *informative* version |
| **`v3-3x3-thumbnail-template`** | **THIS — the approved template. Sparse, large names, blog-thumbnail-ready.** |
