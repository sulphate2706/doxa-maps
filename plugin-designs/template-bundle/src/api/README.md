# src/api/ — this map's data wiring

Declare **which** data source this map reads. The library owns the *mechanism* (how to fetch and
parse); you own the *declaration*.

- Mechanism (`DataSourceManager`, the source registry) → `library/api/`, reused via `@map/api/…`.
  Never edited.
- Which source, endpoint, and field mappings → **here**, in your own `sources.json`.

Data usually arrives at runtime from the host page's `profile-config` (`inject('dataSource')`), so
the same bundle can point at different data with no rebuild. Ship a `sources.json` here only for a
fixed default source. Prefer a real API over inlining large JSON.

- Source-entry contract (types + fields): [`../../../../library/api/README.md`](../../../../library/api/README.md)
- The `@map/api` mechanism: [`../../../../documentation/reference.md`](../../../../documentation/reference.md)
