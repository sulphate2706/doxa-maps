# library/components/poster/ — poster export UI

The dialog and preview surfaces that turn a live map into a printable poster. Used by
`research-map.vue`.

```
  PosterDialog.vue   ← pick size, orientation, title → export
  PosterPreview.vue  ← live preview, updates as you change settings
  PosterWall.vue     ← grid of poster previews
  slots/             ← the composable regions of a poster (own README)
        fed by useMapPoster() · sizes from constants/posterSizes.js
```

- Open/close state comes from `inject('uiStore')`; the preview is fed by `useMapPoster()`.
- Page sizes: `library/constants/posterSizes.js`. Defaults: `library/constants/posterDefaults.js`.

**Full wiring + slot contract:**
**[../../../documentation/architecture/components.md](../../../documentation/architecture/components.md)**.
