# library/utils/ — pure JS helpers

No Vue, no Pinia, no Mapbox. Anything reactive is a composable; anything stateful is a store.

| File | Purpose |
|---|---|
| `apiBaseUrl.js` | Resolves the API base URL at runtime (`window.MAP_APP_API_URL` / `VITE_API_BASE_URL`) |
| `embedBase.js` | Share/embed URL ladder — the built bundle derives its tree root from its own script url (`profileConfig.shareUrl` / `embedBaseUrl` / `window.MAP_EMBED_BASE_URL` override) so tree-relative `<bundle>/<profile>/index.html` links work on any host |
| `geoUtils.js` | Centroid, bounds, validation, GeoJSON helpers |
| `ClusterHelpers.js` | Shared helpers for the two clustering utilities below |
| `MSTClusteringUtil.js` | Minimum-spanning-tree clustering for affinity blocks |
| `NetworkClusteringUtil.js` | Network-line clustering — connect nearby pins with edges |

- No `import { ref } from 'vue'` and no `import mapboxgl` in this folder — operate on plain
  `[lng, lat]` arrays.
- Named exports (for tree-shaking), JSDoc on every export.
- Writing reactive logic or needing Mapbox APIs? That's a composable — move it to `../composables/`.
