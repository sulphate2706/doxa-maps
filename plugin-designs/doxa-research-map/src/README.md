# src/ — doxa-research-map's sandbox

Everything the research map needs that isn't already in the shared `library/` gets built here.
Nothing here leaks to another map — build freely.

```
src/
├── api/          which API/CSV/endpoint this map reads
├── colors/       this map's colors: values (colors.json) + strategy .js files
├── components/   this map's own .vue pieces (not reusable)
├── composables/  this map's own logic hooks (useThing.js)
└── utils/        this map's own pure helpers
```

**What's here today:** `colors/` holds the three research-only strategies — `affinity-block.js`,
`doxa-region.js`, `resource.js` — registered by this bundle's `index.js`. Shared strategies
(adoption, engagement, language-family, religion) stay in `library/colors/` because other maps use
them. `api/`, `components/`, `composables/`, `utils/` are empty scaffolds — fill them as the map grows.

Two import styles, two meanings:

```js
import { useMapInstance } from '@map/composables/useMapInstance.js'  // reuse the shared library
import { fmt }            from './src/utils/format.js'               // your own sandbox (relative)
```

**Reusable + parameterized → `library/` (an expert move); specific to this map → stays here.**
Local by default. See also:
[`../../template-bundle/README.md`](../../template-bundle/README.md) ·
[`../../../documentation/reference.md`](../../../documentation/reference.md).
