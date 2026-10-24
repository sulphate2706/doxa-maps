# SNAPSHOT v5 — 3ft × 3ft, THE APPROVED TEMPLATE ⭐

Frozen 2026-08-01, immediately before the **granular-data (4-column table)** experiment.

> Brief: *"I would keep a snapshot of the template so we don't lose it — basically
> a version, using version control so we don't lose the template. And then we'll
> create a new template that will try implementing granular data."*

**This is the state all 28 posters currently ship from.** If the granular experiment
does not read well, restore this and nothing is lost.

## Restore

```bash
cd doxa-maps/library/scripts/posters
cp snapshots/v5-3x3-approved/generate.mjs .
cp snapshots/v5-3x3-approved/poster-regions.mjs .
# clusters.json only if the DATA also needs rolling back:
# cp snapshots/v5-3x3-approved/clusters.json ../../plugin-designs/my-upg-100-list/data/
bun run posters && bun run posters:shoot && bun run posters:previews && bun run build
```

## What v5 is

The single-column name list either side of the map — **one line per people group**:
a right-aligned index, the name, and an underline that runs out to the white sheet
edge and turns into a hairline leader reaching its numbered pin.

| | |
|---|---|
| Sheet | 1500 × 1500 (3ft × 3ft square), `FORMAT=3x3` + `SPARSE=1` |
| Gutter | 330 a side → label column ~266px |
| Name type | uniform ~18px bold, wraps only when a name genuinely overruns |
| Pin badges | `PIN_R_BASE = 8.0`; numeral sized from measured digit width |
| Header | two-tone title · series line · ruled Matthew 9:36 · 4-col facts table |
| Footer | ruled goal question · "Start with Prayer!" · three networks · Mark 6:40 |

## What v5 fixed (do not reintroduce)

- **Nepal / Bangladesh / Bhutan missing** — zones declared `extraCountryCodes` but
  `zone-geometry.js` reads `adm0`. Three separate data-loss bugs of one class:
  a field exists but its consumer reads a different name.
- **Three zones on a legacy render path** — `numbered = laid.length >= 40` sent
  sparse zones (6, 28, 39 pins) to a branch with no badges and no straight leaders.
  One template means ONE path.
- **Antimeridian + outlier zoom failures** — `pinBbox()` cuts the longitude circle
  at the largest gap and trims the extreme 4%.
- **Pin numerals overflowing** — the `.pin-num` CSS declared `font-size:13px`, and
  a CSS rule BEATS the SVG presentation attribute, so every computed per-badge size
  was silently discarded.
- **Header/footer spacing drift** — both gaps now derive from one `MAP_BREATH`.
- **Province labels running off the frame** — width is checked, not just the anchor.

## Known open at freeze time

- Pin badges are still judged **too large** aesthetically (F94) — F90 fixed the
  overflow, not the size.
- Leader crossings ~270–700 depending on zone; v1 achieved 6. The greedy repair is
  intact and needs re-running against the current geometry, not rewriting.
- "Poster Map" serves a pre-rendered WebP rather than generating client-side (F95).

## Lineage

| Snapshot | What it is |
|---|---|
| `v1-3x4-portrait` | 3×4 portrait; **6 leader crossings** — the best crossing result to date |
| `v2-3x3-full-vision` | square, full vision copy (two vision columns) |
| `v3-3x3-thumbnail-template` | first sparse/thumbnail-worthy layout |
| `v4-3x3-refined` | regional names, full-width bands, floating map frame |
| **`v5-3x3-approved`** | **THIS — what all 28 posters ship from today** |
