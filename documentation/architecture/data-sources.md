# Architecture — data sources (the full contract)

> The simple overview is in `library/api/README.md`. This is the complete contract for
> **adding or overriding** a data connection.

The `api/` seam decides **where people-group data comes from** and **how its raw fields map onto
the system field names** the map/legend/detail components read. The components are
source-agnostic — only the connection knows the source's shape, so a new connection needs zero
component changes.

## The four parts

| File | Role | You touch it? |
|---|---|---|
| `sources.json` | **The customization surface.** Declares each connection (`type`, endpoints/path/url, `fieldMappings`, `imageConfig`) and which one is `activeSource`. | **Yes** — add your connection here. |
| `apiBaseUrl.js` | Resolves the rest-api base URL at runtime (`window.MAP_APP_API_URL` → `VITE_API_BASE_URL` → `''`). Lets the host set the URL with no rebuild. | Only to read the priority order. |
| `DataSourceManager.js` | The engine: fetch → normalize → per-source cache. Maps raw rows to system fields, coerces booleans, resolves image URLs. | No — shared machinery. |
| `_registry.js` | The front door: `SOURCE_TYPES`, `SOURCES`, `getActiveSourceId()`, `getSourceConfig()`, `listSources()`, plus re-exports of `getApiBaseUrl` + `DataSourceManager`. | Import from here. |

`sources.json` lives in `library/api/`, alongside the engine it drives. Old imports of
`@map/utils/apiBaseUrl.js` and `@map/utils/DataSourceManager.js` still work via back-compat shims
left in `../utils/`.

## The connection contract

Every entry under `sources` in `sources.json` MUST have:

```jsonc
"my-source": {
  "id":   "my-source",          // REQUIRED — must equal the key. listSources()/getSourceConfig() key on it.
  "name": "My Source",          // REQUIRED — human label for any source-picker UI.
  "type": "rest-api",           // REQUIRED — one of: "csv" | "api" | "rest-api" (SOURCE_TYPES).
  // --- locator: pick the one your type needs ---
  "path": "assets/data/my.csv",                 // csv  → fetched relative to MAP_APP_BASE_URL
  "url":  "https://example.com/all.json",        // api  → a single JSON URL
  "endpoints": { "bulk": "/api/people-groups/list" }, // rest-api → base URL comes from apiBaseUrl.js
  "defaultFields": ["slug","name","latitude"],   // rest-api → appended as ?fields=
  "queryParams": { "lang": "en" },               // rest-api → static query params
  // --- the mapping every type needs ---
  "fieldMappings": {                             // REQUIRED — systemField: sourceField (or [a,b] composite)
    "uniqueId": "slug", "name": "name",
    "latitude": "latitude", "longitude": "longitude"
    // …map every system field your map needs; see "systemFields" in sources.json
  },
  "imageConfig": { "useField": "imageUrl", "placeholderUrl": "…" }
}
```

- **`uniqueId`, `name`, `latitude`, `longitude` are required system fields** — a pin with
  `lat===0 && lng===0` is dropped during normalization.
- A `fieldMappings` value may be an **array** (composite key, joined with `_`).
- rest-api rows often arrive as `{ value, label }` objects — `DataSourceManager.normalizeData`
  unwraps these to `field` + `fieldLabel` automatically.
- **Never inline data or stub the API** — connections call the real source. (See the
  `never-stub-always-real-api` rule; `pray-tools` is the live default.)

## Add a custom connection (checklist)

1. **Add an entry** under `sources` in `sources.json` (this folder) following the contract above.
   If your source is a REST API on the pray-tools shape, copy the `pray-tools` entry and edit
   `endpoints` / `defaultFields` / `fieldMappings`.
2. **Map every system field your map reads.** Unmapped fields normalize to `''`/`0`; for CSV,
   `validateFieldMappings()` logs a `[DataSourceManager]` warning naming the missing columns.
3. **Set `activeSource`** to your connection's id (or leave the default and pass the id to
   `dataSourceManager.setActiveSource(id)`).
4. **For a rest-api source, give the host the base URL** — inject before the bundle loads:
   ```html
   <script>window.MAP_APP_API_URL = 'https://api.example.com';</script>
   ```
   (or set `VITE_API_BASE_URL` at build time). See `apiBaseUrl.js` for the full priority order.
5. **Verify** — resolve and load it:
   ```js
   import { DataSourceManager, listSources } from '@map/api/_registry.js'
   console.log(listSources())                       // your source appears, active flag correct
   const dsm = new DataSourceManager()
   await dsm.init()
   const rows = await dsm.setActiveSource('my-source')
   console.log(dsm.getStats())                       // totalRecords > 0, coords/photos sane
   ```

## How it integrates with the component library

`ProfileLoader.vue` / the app-profile creates a `DataSourceManager` and hands it to
`composables/useMapData.js` (the instance is **passed in**, not imported — one per `<doxa-map>`).
`useMapData` calls `dsm.init()` then `dsm.setActiveSource(id)`, caches the normalized rows in the
Pinia `dataStore`, and feeds them to the map layers. Downstream code only ever sees the
**system field names** from your `fieldMappings` — which is exactly why a new connection needs
zero component changes.
