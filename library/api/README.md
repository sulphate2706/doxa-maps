# library/api/ — where map data comes from

One of the three customization seams (`colors/`, **`api/`**, `i18n/`). This one decides **where
people-group data comes from** and **how its raw fields map onto** the field names the map reads.
The components are source-agnostic — only the connection knows the source's shape.

```
  sources.json            DataSourceManager.js         the map
  ┌──────────────────┐    ┌───────────────────┐        ┌──────────────┐
  │ your connection   │──►│ fetch → normalize  │──────►│ map · legend  │
  │ (type, endpoint,  │    │ → cache            │        │ · detail card │
  │  fieldMappings)   │    └───────────────────┘        └──────────────┘
  └──────────────────┘     maps raw rows → system field names
```

- `sources.json` is **your surface** — add a connection (`csv`, `api`, or `rest-api`) and set
  `activeSource`. No code.
- `DataSourceManager.js` is shared machinery — you never edit it.
- Import through `_registry.js` (`SOURCES`, `getSourceConfig()`, `listSources()`, …).

**Adding or overriding a connection?** The full contract (required fields, checklist, integration)
is in **[../../documentation/architecture/data-sources.md](../../documentation/architecture/data-sources.md)**.
