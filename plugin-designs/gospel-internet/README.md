# Gospel × Internet

Which people groups already have gospel resources in their own language, and where the internet can
carry those resources to the ones that do not.

This file is the durable record of how the board is built. It replaces a planning document that lived
outside the repository, so the comments in this bundle can cite something a reader of the public
source can actually open.

## The views

One tab strip over one shared state. Every view is a URL state
(`?view=&access=&band=&country=&province=&lang=&list=&group=`), so any view can be shared or embedded
exactly as the reader left it.

| View | What it answers |
|---|---|
| **Board** (default) | map + facets + grid + drawer + charts, over every group in the chosen list |
| **Nothing in own language** | the groups with no resource found, as a front door, by population against their country's access band |
| **India & China by province** | province outlines and per-province counts, where national figures are too coarse to act on |
| **Language tree** | every language family of these people groups, coloured by what exists in each language |
| **Bounded set** | one boundary: reached inside, unreached outside |
| **Centered set** | rings by how close a group is to a reached neighbour, arrows pointing inward |

## The people-group list

The board draws a **list**, not the whole table. The default list (`doxa`) fetches nothing and filters
nothing. A different list keeps only the rows whose slug belongs to it and **fails closed**: if its
membership cannot be loaded the map gets no rows rather than silently falling back to everything.

## The two set charts

Both are drawn on a **whiteboard projection** — an abstract plane mapped through the map engine, so the
charts pan, zoom and click like the rest of the board instead of being pictures beside it.

**Rings.** 1–10 is placement by distance from a reached neighbour; ring 0 is the centre (the group *is*
reached, not missing); ring −1 is "no relation found", which is a real outcome and never rounded onto
ring 10. A group absent from the join is reported as unmatched, separately again.

**Bands, not circles.** `library/components/charts/ringBands.js` spreads the groups on a ring *through*
its band rather than along one circle. Positions are a pure function of the group's own id, so two
renders — and two printings of one packet — are identical, and a dot that moves means the data moved.
There is deliberately no seed: a seed would rescramble every dot while the data was unchanged, which on
a printed sheet is unrecoverable.

**Labels first.** Each ring label reserves an arc, and the band fill refuses to place a pin inside it.
Both come from one source, so "pins never overlap the labels" holds by construction. A label longer
than its ring can carry truncates rather than eating the circle: uncapped, a long name on ring 1 once
claimed 96% of that small circle and the innermost ring drew empty.

### `fit` and `fill-all`

The binding constraint is the band's **depth**, not the arc's length. Separation cannot fall below twice
the pin floor, so a band of the current depth holds at most three rows — and no separation setting
reaches the busiest ring's population.

- **`fit`** (the default today) keeps every pin separable at the chart's own scale and *reports* what
  will not fit. This is the honest mode for a printed sheet, which cannot zoom: a dot a reader cannot
  resolve is a dot that is not there.
- **`fill-all`** places every group and lets zoom do the separating, since separation is in map units.
  Zoomed out a busy band reads as an arc of colour; zoomed in the pins separate and become clickable.

Whichever mode is used, the caption states the number of groups that **have a ring** — a fact about the
data — and never the number of pins currently drawn, which would change as the reader zooms.

Measured on the default list, through the component's own join: 2,074 groups reach the layout. `fit`
places 931 of them and reports the other 1,143; `fill-all` places all 2,074, with none outside its band
and none under a label. Tightening the separation does not close that gap — 931 at a separation of 7,
1,369 at 5, and 1,369 again at 4 — and that plateau is the evidence that the band's depth is binding
rather than the spacing. The busiest ring carries 658 groups into a band that holds 156 at any
separation the pin floor allows.

### Why the charts fit their box

The engine renders one world without copies, so it will not zoom out past the point where that world
fills the canvas *width*. On a wide, short figure that floor is too close for the drawing's own height,
and the outermost groups fall outside the frame. The fix is the chart's own footprint
(`extentFraction`), not the engine's behaviour. `check:gospel-set-fit` asserts every layout still fits
at that floor, with the previous footprint as its negative control.

The fit follows the container with a `ResizeObserver`: these panels are `v-show`, so a map can be built
while its container is `display:none` and zero-sized, and a one-shot fit against that box lands at the
wrong zoom.

## Data joins

People groups join the near-neighbour table by **slug** first — the only key that is one field on both
sides and unique by construction — then by `rop3 + iso3`, then by `name + iso3`. Rows that match none
of these are counted and reported, never guessed at.

Administrative names are matched **diacritic-folded**, at the lookup rather than by spelling each
variant, so "Jämtland" and "Jamtland" reach the same zone.

## Honesty, and what this board will not say

These are constraints on the product, not preferences:

- **Pins are approximate.** A dot marks a people group, not a town. The notice is
  shown on the map and in every drawer, and provinces are marked approximate everywhere.
- **Never "reached".** The words are "resource found in the sources checked" and "nothing found in own
  language". No game words — nothing is "claimed" or "done".
- **Never who works where.** No engagement status, no agencies, no workers, no teams, no field access.
  The column exists in the data and is not read.
- **Internet figures are the country's**, or the state's, with source and year on every surface. There
  is no group-level internet claim.
- **Public data only**, and every outbound link goes through the doctrine screen and allowlist.

## Columns and export

One row per group: people group · country · province (IND/CHN, approximate) · language · population ·
access level · best resource · bridge language and strength · country internet % with year · internet
band · top platform · pray link. Hidden by default but available in the picker and in CSV:
`translated_by`, `training_url`, `bridge_training_url`, `deaf_bridge_publisher`, `mobile_per_100`,
`people_praying`.

Export writes the filtered grid in its visible columns, with a header line carrying the sources and the
date.

## Its gates

| Gate | What it refuses to let through |
|---|---|
| `check:gospel-set-charts` | the set layouts' pinned properties, including that no chart grew a `seed` prop |
| `check:gospel-set-fit` | a layout whose drawing cannot fit its canvas at the engine's zoom floor |
| `check:ring-bands` | a pin outside its band, two pins closer than their own diameter, a pin under a label, or output that is not identical for identical input |
| `check:gospel-zone-tree` | the admin→zone join, including the diacritic folding |
| `check:gospel-whiteboard` | the whiteboard projection's contract |
