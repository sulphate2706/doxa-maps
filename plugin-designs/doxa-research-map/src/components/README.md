# src/components/ — this map's own Vue pieces

Small `.vue` components used by **this map only** — a custom info card, a bespoke overlay, a one-off
panel. Reusable, parameterized components (legend, toolbar button, drawer) live in
`library/components/` and are reused via `@map/components/…`.

Before building one, check the library first — it ships legends, map-control buttons, drawers, a
geocoder, poster tools, and more (see [`../../../../documentation/reference.md`](../../../../documentation/reference.md)).

```js
import LegendDesktop from '@map/components/legends/LegendDesktop.vue'  // reuse (by reference)
import YourThing     from './src/components/YourThing.vue'             // your own (relative)
```

Your profile `.vue` screens stay **flat at the bundle root** (that's the discovery convention); the
pieces they're built from live here.
