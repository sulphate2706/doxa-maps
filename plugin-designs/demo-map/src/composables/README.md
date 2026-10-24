# src/composables/ — this map's own logic hooks

Composition-API hooks (`useSomething.js`) holding **this map's** logic. Reusable map logic already
ships in `library/composables/` — `useMapInstance`, `useMapData`, `useMapLayers`,
`useMapClustering`, `useMapFly`, `useMapTheme`, `useLegendData`, and more
(see [`../../../../documentation/reference.md`](../../../../documentation/reference.md)). Write here only the glue
unique to your map.

```js
import { useMapInstance } from '@map/composables/useMapInstance.js'   // reuse
import { useYourThing }   from './src/composables/useYourThing.js'    // your own (relative)
```

- One hook per file, named `useThing.js`, exporting a `useThing()`.
- Keep it framework-pure — that's what makes a hook easy to promote to `library/` later, *if* a
  second map ever needs it (local by default).
