# SNAPSHOT v1 — 3ft × 4ft portrait ("North India + Nepal" template)

Frozen 2026-07-31, at the request, before trying a square format.
This is the first state the design called good.

## What is in here

| File | What it is |
|---|---|
| `generate.mjs` | the generator exactly as it stood |
| `asia-india-uttarakhand.html` | the rendered template poster |
| `preview-north-india-nepal.png` | 1350×1800 screenshot of it |

## Geometry at this snapshot

- Sheet **1350 × 1800 CSS px** = 3:4 portrait; `shoot.mjs` at `deviceScaleFactor 4` → **5400 × 7200**
- `GUTTER 210` a side → map **930 px** wide, full sheet height between header and footer
- Header 150, footer 70

## What this version does that earlier ones did not

- **6 leader crossings** (from 191) via greedy adjacent-swap repair, with **0 inter-column** crossings
- Labels fill the **full map height**, evenly pitched, 15 px type
- Each name is **underlined**, and the underline flows into a straight hairline to its numbered pin
- **Nepal joined** to the cluster — land *and* its 34 people groups; title "North India + Nepal"
- **92 pins = 92 names = count field**, agreeing for the first time
- Neighbouring **provinces drawn and named**; the zone's own five provinces named individually
- **Country labels placed inside their own polygon** (pole-of-inaccessibility sampling), so no more
  "CHINA" printed in Uttar Pradesh
- **Sea labels** — the Bay of Bengal is named, so water is not mistaken for a missing polygon
- Header block: **Countries: / Provinces: / count + Luke 10:2**, left-justified

## How to restore

```bash
cp snapshots/v1-3x4-portrait/generate.mjs generate.mjs
```

## Why a snapshot exists

The next experiment changes the sheet to **3ft × 3ft square**, which moves every layout constant that
the above was tuned against — gutters, label pitch, map aspect, the crossing count. If square reads
worse, this is the state to come back to.
