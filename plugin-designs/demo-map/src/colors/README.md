# src/colors/ — this map's colors

All of one map's colors live here, and it's **bundle-private** — editing it can never affect
another map. Two surfaces sit side by side:

```
  src/colors/
  ┌──────────────────────────────────────────────┐
  │ colors.json     fixed colors (hex only, no code)│  ← non-coders edit this
  │ <mode>.js       data-driven color strategies    │  ← green if praying, red if not
  └──────────────────────────────────────────────┘
     index.js globs *.js as strategies · colors.json is a plain import
```

- **`colors.json`** — pins/polygons/fallback as plain hex. Import it relatively:
  `import colors from './src/colors/colors.json'` (the sandbox has no `@map/` alias).
- **A strategy `.js`** — colors pins by a data value. Drop one in and this bundle's `index.js`
  auto-registers it, merging **over** the shared library set. Same mode key as a shared strategy →
  overrides it; a new key → adds one. For this bundle only.
- Filename → mode key: `example-mode.js` → `exampleMode`. Files starting with `_`/`.` are skipped.

**Writing a strategy?** The full contract (required `export default` shape, checklist,
profile-local overrides) is in
**[../../../../documentation/architecture/color-strategies.md](../../../../documentation/architecture/color-strategies.md)**.
Two places a color can live, in depth: [`../../../../contributing/COLORS.md`](../../../../documentation/contributing/COLORS.md).
