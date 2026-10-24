# Editing map colors

Pins on a map are colored by a **color strategy** — one small file that says "for this
color mode, paint each pin this color." There are two places a color strategy can live,
and which one you pick follows the one rule:

> **Reused by more than one map → shared library.  Only your map uses it → your profile.**

---

## Path A — tweak a color in the shared library

Use this when the color is genuinely shared (prayer-progress, engagement, adoption,
religion, language-family — these are used by the shared map machinery across
profiles).

1. Open `library/colors/<name>.js` (e.g. `religion.js`).
2. Edit the `PALETTE` — just change a hex value.
3. `bun run dev` → the change shows on every map that uses that mode, live (HMR).

The library **auto-discovers** every `<name>.js` in that folder (`import.meta.glob`), so
there's no registration step — edit the palette and you're done. The full strategy
**contract** (the required `export default` shape) is in
`library/colors/README.md`; `religion.js` is the canonical worked example.

**Be deliberate here** — a change to a shared strategy affects *every* map that uses it.
If you only want to change *your* map, use Path B instead.

---

## Path B — a color private to YOUR map (override or add)

Use this when the color is specific to your map — you want a different shade than the
shared one, or a brand-new coloring nobody else has. This keeps the shared library clean
("local by default").

1. In your bundle folder, create `plugin-designs/<your-map>/src/colors/<name>.js`.
   (No such folder yet? Just make it. `template-bundle/src/colors/example-mode.js`
   is a copy-me starting point.)
2. Follow the same contract as a library strategy
   (`export default { name, propertyKey, getColor, applyColor }`).
3. `bun run dev` → your map picks it up via HMR. No rebuild.

### How override vs. add is decided (the filename)

Your bundle's `index.js` runs, at startup:

```js
registerStrategies(import.meta.glob('./src/colors/*.js', { eager: true }))
```

(The glob is `*.js`, so a `colors.json` of plain values sitting in the same
`src/colors/` folder is ignored by the registry — values and strategies coexist.)

That merges your local files **over** the shared library set. The **filename** derives
the mode key:

- `language-family.js` → mode `languageFamily` / `COLOR_MODES.LANGUAGE_FAMILY`
- `example-mode.js`    → mode `exampleMode`    / `COLOR_MODES.EXAMPLE_MODE`

Then:

- **Same mode key as a shared strategy → your file OVERRIDES it** (for your map only).
- **A new mode key → your file ADDS a private strategy** (only your map sees it).

### It can't break other maps

Each bundle is built as its own self-contained IIFE, so it carries its **own** copy of
the color registry. Registering a local strategy changes **only your bundle** — it can
never leak into another map. Which is exactly why "local by default" is safe.

---

## Which colors are shared vs. private (today)

The five strategies currently in `library/colors/` are **shared** — the
reusable map machinery (`useMapLayers`, `useLegendData`, the mobile legend, the data
loader, the store) references them, so they correctly stay in the library:

`adoption`, `engagement`, `language-family`, `prayer-progress`, `religion`.

Three more are **research-only** and live in the research bundle's own folder,
`plugin-designs/doxa-research-map/src/colors/`: `affinity-block`, `doxa-region`,
`resource`.

If you want *your* map to color one of these differently, don't edit the library — drop
a same-named file in your profile's `src/colors/` (Path B) and it overrides the
shared one for your map alone.
