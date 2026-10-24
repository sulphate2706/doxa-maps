# india-states.json

India's 28 states and 8 union territories, each with the UPG-100 people groups located inside it. The term is
**"states and union territories"**, never "provinces".

## Who reads it

- **UPG-100's batch selection:** a state selected on the map finds its people groups (Copy / Export CSV / the
  prayer packet).
- **Country Posters' India section:** one poster per state / union territory.

Both fetch it at runtime through `library/data/indiaStates.js`, only when a state is needed. It is **served**
(`assets/people-groups/india-states.json`, via `internal/generate-tree.mjs`), not bundled, because this build inlines
every `import()`.

## Shape

```
{ "meta": { what, regenerate, inputs: { membership, geometry }, served_geometry, shape_property, counts },
  "states": [ { "id": "india-gj", "iso": "IN-GJ", "kind": "state" | "union_territory",
                "name": "Gujarat", "shapeName": "Gujarāt", "bbox": [w, s, e, n], "count": 90, "slugs": [ … ] }, … ×36 ] }
```

- `iso` and `kind` follow ISO 3166-2:IN.
- `name` is the English name; the display names in 11 languages come through each consumer's strings.
- `shapeName` is the exact `shapeName` feature property of `served_geometry`
  (`boundaries/gb-IND-ADM1-full-web.geojson`), so a poster can highlight its shape.
- `bbox` is `[west, south, east, north]` in degrees, the poster frame.
- A division with no people groups (Nagaland, Mizoram today) is listed with `"slugs": []`. Each consumer
  decides what an empty division shows.

## How it is made: REPRODUCIBLE

When the people-group data changes:

1. `node plugin-designs/my-upg-100-list/data/pip-stamp.mjs` re-stamps every record's coordinates against the
   ADM1 shapes (India against all 36, `data/boundaries/gb-IND-ADM1-full.geojson`), writing `admin-membership.json`.
2. `node plugin-designs/my-upg-100-list/data/emit-india-states.mjs` derives this table from `admin-membership.json`
   and the geometry, and writes its sha384 pin (`library/data/indiaStates.integrity.js`) **in the same run**.
3. `bun run tree` serves the new copy.

`meta.inputs` records the sha384 of both inputs.

## The gate

`check:india-states` (gates:pre) fails if any of these breaks:

- the table drifts from `admin-membership.json` (it re-derives the table and compares bytes, and it compares
  the recorded input sha384s);
- a people group sits in zero or two divisions;
- a division is missing or duplicated (all 36, 28 + 8);
- a `shapeName` is not in the served geometry;
- the pin, the table and the served copy disagree.

The emitter is deterministic: no timestamps, sorted by ISO code, slugs sorted.
