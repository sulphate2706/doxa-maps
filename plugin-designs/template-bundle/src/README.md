# src/ — your map's sandbox

Everything your map needs that isn't already in the shared `library/` gets built here. Nothing in
this folder leaks to another map — build freely.

```
src/
├── api/          which API/CSV/endpoint this map reads
├── colors/       your colors: values (colors.json) + strategy .js files
├── components/   your map's own .vue pieces (not reusable)
├── composables/  your map's own logic hooks (useThing.js)
└── utils/        your map's own pure helpers
```

Two import styles, two meanings:

```js
import { useMapInstance } from '@map/composables/useMapInstance.js'  // reuse the shared library
import colors             from './src/colors/colors.json'            // your own sandbox (relative)
```

There is no `@map/`-style alias for your sandbox — your code is always relative. That boundary keeps
it private. **Reusable + parameterized → `library/` (an expert move); specific to this map → stays
here.** Local by default.

Each subfolder has its own README. See also:
[`../README.md`](../README.md) (build-a-map guide) ·
[`../../../documentation/reference.md`](../../../documentation/reference.md) (the `@map/…` menu).
