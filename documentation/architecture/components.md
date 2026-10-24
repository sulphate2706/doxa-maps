# Architecture — the shared component tree

> The simple overviews are in `library/components/README.md` and its subfolder READMEs. This is
> the full catalog and the wiring conventions every shared component follows.

`library/components/` holds the **shared, parameterized Vue components** every app-profile reuses.
Fix one here and every map benefits — never edit a shared component to customize one map.

## Catalog

| File / folder | Role |
|---|---|
| `legends/` | Legend UI — `LegendDesktop.vue`, `LegendMobile.vue`, `LegendRows.vue`, `LegendTools.vue`, `SemanticTreeLegend.vue` |
| `map-controls/` | Per-button toolbar controls (see below) |
| `poster/` | Poster export UI — dialog, preview, wall, slots (see below) |
| `charts/` | Chart components |
| `tables/` | Table components |
| `PeopleGroupDetail.vue` | Feature record card (right-side panel content); renders the live prayer-count bar |
| `ResearchMapFilterPanel.vue` | Research-map filter panel |
| `ResearchMapSideMenu.vue` | Research-map side menu |
| `SideMenuDrawer.vue` | Generic slide-in side-panel primitive |

Per-file roles and gotchas for the whole catalog are in `documentation/reference.md`.

## Conventions (every shared component)

- Every component uses `<script setup>` (Vue 3.5+).
- Every component that renders CSS calls `useShadowStyles()` so styles attach to the shadow root.
- Stores are reached via `inject('mapStore' | 'uiStore' | 'dataStore')` — never a direct
  `useXxxStore()` import (LL-010, LL-023).
- The Mapbox token is reached via `inject('mapboxToken')`.

To add a component: follow the conventions above and add a matching entry to the catalog.

## map-controls/

Per-button toolbar controls. Each file is a single, focused button or input that mounts inside the
map's control area. Replaces the older monolithic `MapControlsComponent.vue`.

| File | Role |
|---|---|
| `MapToolbar.vue` | Container that lays out the buttons |
| `MapControlButton.vue` | Base button primitive (icon + tooltip + accessibility) |
| `ZoomInButton.vue` | `+` — `map.zoomIn()` |
| `ZoomOutButton.vue` | `-` — `map.zoomOut()` |
| `LocationButton.vue` | Geolocation — fly to user's position |
| `FullscreenButton.vue` | Toggle fullscreen on the map container |
| `HamburgerButton.vue` | Open/close side menu |
| `ThemeToggleButton.vue` | Light/dark theme toggle (delegates to `uiStore.theme`) |
| `HelpButton.vue` | Opens help |
| `ShareButton.vue` | Share the current view |
| `GeocoderComponent.vue` | Mapbox Geocoder wrapper — Carmen-format aware, shadow-DOM-safe (LL-004, LL-015) |

Conventions:
- Every button takes a `size` prop (`'sm' | 'md' | 'lg'`) and follows the `MapControlButton` shape.
- Click handlers go through `inject('mapStore')` or `getMap()` — never a captured Mapbox instance.
- The geocoder z-index sits above the legend and below popups.
- To add a button: copy `ZoomInButton.vue` and register it in `MapToolbar.vue`.

## poster/

Poster export UI — the dialog and preview surfaces that drive the poster composables. Used by
`research-map.vue` for printable posters.

| File / folder | Role |
|---|---|
| `PosterDialog.vue` | Modal to pick page size, orientation, and title; triggers the export |
| `PosterPreview.vue` | Live preview of the assembled poster; updates as settings change |
| `PosterWall.vue` | Grid of poster previews |
| `slots/` | Composable poster slots (see below) |

Wiring:
- `PosterDialog` reads open/close state from `inject('uiStore')`.
- The preview is fed by `useMapPoster()` (`library/composables/poster/useMapPoster.js`).
- Page sizes come from `library/constants/posterSizes.js`; defaults (font, padding, theme) from
  `library/constants/posterDefaults.js`.
- To add a page size, edit `constants/posterSizes.js`.

## poster/slots/

Each slot is a small Vue component that fills one named region of the assembled poster.

| File | Slot region |
|---|---|
| `TitleSlot.vue` | Top title block (text + optional subtitle) |
| `FooterSlot.vue` | Bottom footer region |
| `LegendSlot.vue` | Legend region |
| `NorthArrowSlot.vue` | North arrow |
| `ScaleBarSlot.vue` | Scale bar |

Conventions:
- Each slot is self-contained: it receives data via props and reads no stores.
- Slot dimensions come from the layout returned by `usePosterLayout()`
  (`library/composables/poster/usePosterLayout.js`).
- Styling stays inside the component; print CSS lives at the poster-document level (iframe), not in
  the slot.
- To add a slot: create the component here, register it in the layout config
  (`constants/posterDefaults.js`), and add it to the table above.
