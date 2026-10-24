# library/components/map-controls/ — toolbar buttons

Each file is a single, focused button or input that mounts inside the map's control area. Replaces
the older monolithic `MapControlsComponent.vue`.

```
  MapToolbar.vue  (container)
   ├─ ZoomInButton · ZoomOutButton · LocationButton
   ├─ FullscreenButton · HamburgerButton · ThemeToggleButton
   ├─ HelpButton · ShareButton
   └─ GeocoderComponent   (all built on MapControlButton.vue)
```

- Every button takes a `size` prop (`sm | md | lg`) and follows the `MapControlButton` shape.
- Click handlers go through `inject('mapStore')` or `getMap()` — never a captured Mapbox instance.
- To add one: copy `ZoomInButton.vue` and register it in `MapToolbar.vue`.

**Full conventions + catalog:**
**[../../../documentation/architecture/components.md](../../../documentation/architecture/components.md)**.
