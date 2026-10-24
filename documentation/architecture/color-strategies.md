# Architecture — color strategies (the full contract)

> The simple overview is in `library/colors/README.md`. This is the complete contract for
> **writing or overriding** a color strategy.

A *color strategy* decides how people-group pins are colored for a given color mode (language
family, prayer progress, religion, …). One strategy = one file. `_registry.js` auto-discovers
every `<name>.js` via `import.meta.glob` and builds the `COLOR_MODES` enum + lookup from the
filenames — no manual registration.

**Filename → mode mapping:** `prayer-progress.js` → `prayerProgress` / `COLOR_MODES.PRAYER_PROGRESS`;
`religion.js` → `religion` / `COLOR_MODES.RELIGION`. Files starting with `_` or `.` are skipped.

## The strategy contract

Every `<name>.js` MUST `export default` this shape. A missing `name` (regression card #20) leaves
the tab/legend label blank (the map still paints):

```js
export const PROPERTY_KEY = 'myField'         // GeoJSON feature property this reads
export function getColor(properties) { ... }  // (props) -> '#rrggbb' — JS-side resolver
export function applyColor(options = {}) { ... } // -> Mapbox expression array (head = operator)
export const buildColorExpression = applyColor   // alias used by the tab-switch handler

export default {
  name:        'My Strategy',   // REQUIRED — human label, never omit
  propertyKey: PROPERTY_KEY,
  getColor, applyColor, buildColorExpression,
  // …any palette/labels you also want on the default export
}
```

`applyColor()` must return a valid Mapbox paint expression — an array whose first element is an
operator (`'match'`, `'case'`, `'interpolate'`, …). It feeds `circle-color` in
`useMapLayers.addLanguageFamilyLayer`.

## Add a custom strategy (checklist)

1. **Create `<name>.js`** following the contract. Deriving color from a string? reuse
   `generateColorFromString` from `../utils/geoUtils.js` (see `doxa-region.js`). The mode key is the
   camelCased filename — pick the filename to match the mode string consumers pass.
2. **Build — it auto-registers.** No `_registry.js` edit. (Needs a `export default` with a non-empty
   `name`; files without a default export are ignored.)
3. **Make the pin feature carry your `PROPERTY_KEY`** — pin properties are built in
   `composables/useMapLayers.js → addLanguageFamilyLayer`. Missing field → every pin falls to default.
4. **Wire the legend** (only if the mode shows a legend tab) in
   `composables/legends/useLegendData.js`: add `TITLE_KEYS`, `activeFilter`, `setFilter`, and `items`
   branches. Religion is the worked example (reads `PALETTE`, `RELIGION_FAMILIES`, `getReligionFamily`
   via named exports, so export those too).
5. **Verify** — the structural tooling resolves every mode and asserts a non-empty `name`, a valid
   expression array, and a hex `getFeatureColor`.

## Profile-local strategies (override / add without touching the library)

`library/colors/` is the **shared** set. A single map that wants its own coloring drops a `<name>.js`
in that bundle's `plugin-designs/<bundle>/src/colors/`. At init, `index.js` calls
`registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))`, merging local files
**over** the shared set:

- **Same mode key** as a shared strategy → local **overrides** it, for that bundle only.
- **New mode key** → local **adds** a bundle-private strategy.

Each bundle is its own IIFE, so a local strategy can't leak to another map. This is the "local by
default, promote deliberately" seam. See `documentation/contributing/COLORS.md` and
`plugin-designs/template-bundle/src/colors/` for the copy-me example.

## Status / custom modes

`COLOR_MODES.STATUS` and `COLOR_MODES.CUSTOM` are declared but have no strategy file —
`getColorStrategy()` falls back to `LANGUAGE_FAMILY` for any unknown mode. Add a real file (steps
above) when one graduates from placeholder.
