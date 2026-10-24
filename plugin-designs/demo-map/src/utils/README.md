# src/utils/ — this map's own helper functions

Small, pure, stateless helpers (formatters, tiny transforms, lookups) specific to **this map**.
General reusable helpers — geo math, cluster helpers, `apiBaseUrl` — live in `library/utils/` and
are reused via `@map/utils/…` (see [`../../../../documentation/reference.md`](../../../../documentation/reference.md)).

```js
import { haversine }   from '@map/utils/geoUtils.js'      // reuse
import { formatLabel } from './src/utils/format.js'        // your own (relative)
```

- Keep functions pure (no side effects, no global state).
- Named exports, one concern per file.
