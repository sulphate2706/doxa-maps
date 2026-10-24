# library/components/poster/slots/ — poster regions

Each slot is a small Vue component that fills one named region of the assembled poster.

```
  ┌─────────────────────────┐
  │ TitleSlot               │  ← title block
  ├─────────────────────────┤
  │        (the map)         │
  ├──────────┬──────────────┤
  │ LegendSlot│ ScaleBarSlot │  · NorthArrowSlot
  ├──────────┴──────────────┤
  │ FooterSlot              │
  └─────────────────────────┘
```

- Each slot is self-contained: data in via props, reads no stores.
- Dimensions come from `usePosterLayout()`; print CSS lives at the poster-document level, not here.
- To add a slot: create it here and register it in `constants/posterDefaults.js`.

**Full slot contract:**
**[../../../../documentation/architecture/components.md](../../../../documentation/architecture/components.md)**.
