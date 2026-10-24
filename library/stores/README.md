# library/stores/ — per-instance Pinia stores

Three stores, one responsibility each. Created fresh per `<doxa-map>` element and provided to
descendants from `ProfileLoader.vue` — reach them via `inject()`, never a direct `useXxxStore()`
import (LL-010, LL-023).

| File | Owns | Example fields |
|---|---|---|
| `mapStore.js` | Map state: selections, zoom, bbox, Mapbox instances | `selectedRegion`, `selectedFamily`, `maps[mapId]`, `activeMapId` |
| `uiStore.js` | UI state: sidebar, tabs, theme, toasts, modals | `activeTab`, `sidebarCollapsed`, `theme`, `legendState` |
| `dataStore.js` | Data caching: GeoJSON (markRaw), fetch status, errors | `sources[sourceId]`, `loadingStates[sourceId]` |

- Use `markRaw()` on large GeoJSON — Vue should not deeply proxy it.
- Keep state changes in named actions; stores don't import each other (cross-store coordination
  happens at the component level).
