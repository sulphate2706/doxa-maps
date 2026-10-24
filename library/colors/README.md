# library/colors/ — how pins get colored

Each file here is one **color strategy** — a way to color the map's pins (by language family, prayer
progress, religion, …). Drop a `<name>.js` in and it's auto-discovered; no registration.

```
  library/colors/                        a map picks a mode
  ┌──────────────────────────┐           ┌───────────────────────┐
  │ language-family.js        │           │ getColorStrategy(      │
  │ prayer-progress.js        │──auto───► │   'language-family')    │──► colored pins
  │ religion.js   engagement.js│  glob     │                        │
  │ _registry.js (the scanner)│           └───────────────────────┘
  └──────────────────────────┘
        shared set                  a single map can add/override its own in
                                    plugin-designs/<map>/src/colors/ (that map only)
```

- **Shared here** = reused by every map. **Your map's own** color → put it in your bundle's
  `src/colors/` (it merges over the shared set, for your map only — never edit the library to
  recolor one map).
- Filename = mode key (`prayer-progress.js` → `prayerProgress`). Files starting with `_`/`.` are skipped.

**Writing or overriding a strategy?** The full contract (required exports, legend wiring, checklist)
is in **[../../documentation/architecture/color-strategies.md](../../documentation/architecture/color-strategies.md)**.
