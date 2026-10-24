# library/ (`@map`) — the shared map template

**The other half of the architecture** (see [`../plugin-designs/README.md`](../plugin-designs/README.md)):
every map in `plugin-designs/<your-map>/` composes the reusable, parameterized pieces that live here.
Fix something here and **every map benefits** on the next build; break something here and every map
breaks — read [`components/WARNING.md`](./components/WARNING.md) before touching shared pieces.

| Folder | What lives there |
|---|---|
| `ProfileLoader.vue` | The root of every bundle: parses `profile-config`, loads the profile, provides the stores + config |
| `components/` | Shared UI — map, legends, controls, popup (PeopleGroupDetail), tables, charts, hints ([README](./components/README.md)) |
| `composables/` | Shared logic — map engine (`useMapInstance`), provider switch, shadow-DOM styles, theming |
| `stores/` | Per-instance Pinia stores (ui / map / data) — provided by ProfileLoader, injected by children |
| `api/` | Data-source registry (`sources.json`) + fetch layer — the JAMstack runtime wiring |
| `colors/` | Color sets maps opt into via `profile-config.colorSet` |
| `i18n/` | The shared string catalogs (all maps speak the same languages) |
| `data/` | Small shared datasets baked at build time (big served data lives in `../data/`) |
| `constants/` | Shared constants |
| `scripts/` | Maintainer pipelines (posters, research) — not part of any bundle |

**The rule of thumb** (same as WARNING.md): *custom code in your app-profile, reusable code here —
and things only move from the first to the second once they've earned it.*
