# src/ — doxa-simple-map's sandbox

Everything the simple map needs that isn't already in the shared `library/` gets built here. Nothing
here leaks to another map — build freely. **All subfolders are empty scaffolds today** (this map
ships no local code and no local color strategies) — they mark where things go as it grows.

```
src/
├── api/          which API/CSV/endpoint this map reads
├── colors/       this map's colors: values (colors.json) + strategy .js files
├── components/   this map's own .vue pieces (not reusable)
├── composables/  this map's own logic hooks (useThing.js)
└── utils/        this map's own pure helpers
```

Two import styles, two meanings:

```js
import { useMapInstance } from '@map/composables/useMapInstance.js'  // reuse the shared library
import { fmt }            from './src/utils/format.js'               // your own sandbox (relative)
```

**Reusable + parameterized → `library/` (an expert move); specific to this map → stays here.**
Local by default. See also:
[`../../template-bundle/README.md`](../../template-bundle/README.md) ·
[`../../../documentation/reference.md`](../../../documentation/reference.md).
