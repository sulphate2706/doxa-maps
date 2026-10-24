# SNAPSHOT v2 — 3ft × 3ft square, FULL-VISION header ("North India + Nepal")

Frozen 2026-07-31 at the request, before building a **thumbnail-worthy v3**.
This is the most *informative* version of the poster — it carries the whole vision on the sheet.

> Brief: *"keep this one as a snapshot copy so we can reference it among the other snapshots…
> keep them in a snapshot so we can always forever keep a snapshot of it."*

## What is in here

| File | What it is |
|---|---|
| `generate.mjs` | the generator exactly as it stood |
| `asia-india-uttarakhand.html` | the rendered template poster |
| `preview-north-india-nepal.png` | 1500×1500 screenshot of it |

## Geometry at this snapshot

- Sheet **1500 × 1500 CSS px** = 3ft × 3ft square (`FORMAT=3x3`)
- `GUTTER 200` a side → map **1100 × 785**
- `HEADER 460`, `FOOTER 255`

## What this version has that v1 did not

- **The sandwich** — the goal question + the three networks sit BELOW the map, so the
  question and its three answers bracket the map with the scripture above it
- **Two ruled full-map-width blocks** — Matthew 9:36 at the top, the multiplication
  question at the bottom, each on one line with a hairline above and below
- **The header grid** — a centred facts table (Countries / Provinces / People groups /
  Series) plus TWO vision columns: *Jesus' Strategy to Feed the 5000* and
  *What is a Prayer List of 100 UPG?*
- **The three networks** below the map in three equal columns, under *Start with Prayer!*
- **Doxa.Life lockup** top-left; two-part title (*UNENGAGED PEOPLE GROUPS OF* / region)
- **Nepal fully joined** — land, its 34 people groups, and labelled in the ZONE ink
  (`.ctry-name-own`) rather than the neighbour grey, so a member country never reads as context
- **92 pins = 92 names = count field**
- Fail-loud guards on BOTH bands (`HEAD_BOTTOM > HEADER`, and the below-map block
  running off the sheet) — these caught two real overlaps during the build

## Machinery worth keeping

- `CHADV` → `textW` → `wrapPx` → `paraInto`: SVG `<text>` does not word-wrap, so
  multi-column setting is measured in the generator. **`WFUDGE = 1.11` is CALIBRATED
  against the renderer** (Lato 12.5px measured 0.498/char via `getBBox`, vs ~0.45
  estimated) — do not re-tune it by eye.

## Known state

- Leader crossings ≈ **358**. v1 achieved **6** via greedy adjacent-swap repair; every
  geometry change since (square format, wider map, sandwich layout) moved the field that
  repair was tuned against. The algorithm is intact — it needs a re-run, not a rewrite.
- Tuned to THIS zone. `HEADER`/`FOOTER` are shared constants; a zone with a taller facts
  table (e.g. `west-africa`) will trip the header guard.

## Why a snapshot exists

The next version (v3) goes the OTHER way deliberately: **less information, larger people-group
names, larger map, minimal header and footer** — optimised to work as a blog thumbnail where
the names must be readable when scaled down. That removes the two vision columns, which is
exactly the content this snapshot preserves. If the sparse version loses something important,
this is the state to come back to.

## How to restore

```bash
cp snapshots/v2-3x3-full-vision/generate.mjs generate.mjs
```

## How this was generated

```bash
ONLY=asia-india-uttarakhand \
UPG100_DATA_PATH=<repo-root>/plugin-designs/my-upg-100-list/data \
OFFLINE=1 VITE_API_BASE_URL=https://pray.doxa.life FORMAT=3x3 \
node generate.mjs
```

`UPG100_DATA_PATH` is **required** — the generator's default points at a stale duplicate of
the profile data in `plugin-designs/`, which is missing Nepal (58 slugs, no
`adm0`). Without it Nepal silently disappears from the sheet.
