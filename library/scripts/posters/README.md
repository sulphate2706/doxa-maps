# library/scripts/posters/ — UPG-100 poster generator

Renders one 3ft × 3ft print poster per zone (28 today) for the **my-upg-100-list** profile, from
the profile's own data. It ships inside the repo alongside that data on purpose — reaching for the
data via an env var once silently rendered stale posters (Nepal, Bangladesh, Bhutan vanished).

```
  bun run posters  ->  posters:shoot  ->  (WebP previews)  ->  bun run build
   HTML per zone       PNG @3000²        assets/previews/     app shows them
```

- `generate.mjs` is the template; `shoot.mjs` screenshots to PNG (Firefox only — privacy-first policy).
- A template change is not visible in the app until previews are regenerated **and** the app rebuilt.
- Exported PNGs go to a sibling folder (`../../../upg-100-posters/`), never `public/` — Capacitor
  packages `public/` wholesale.

**Full reference — files, env vars, gotchas, measurement discipline:**
**[../../../documentation/architecture/poster-generation.md](../../../documentation/architecture/poster-generation.md)**.
