# library/components/ — shared Vue components

The map UI, built from parameterized pieces every app-profile reuses. Fix one here and every map
benefits — never edit a shared component to customize one map.

```
  library/components/
  ┌───────────────────────────────────────────┐
  │ legends/        map-controls/   poster/      │
  │ charts/         tables/                       │
  │ PeopleGroupDetail.vue   SideMenuDrawer.vue    │
  │ ResearchMapFilterPanel.vue  …SideMenu.vue     │
  └───────────────────────────────────────────┘
     reused by every app-profile via @map/components/…
```

- `legends/`, `map-controls/`, `poster/` each have their own README.
- Every component uses `<script setup>`, calls `useShadowStyles()`, and reaches stores via
  `inject('mapStore' | 'uiStore' | 'dataStore')` — never a direct store import.

**Full catalog + conventions:**
**[../../documentation/architecture/components.md](../../documentation/architecture/components.md)** ·
per-file roles: [`../../documentation/reference.md`](../../documentation/reference.md).
