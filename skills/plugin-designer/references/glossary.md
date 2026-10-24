# Glossary

The words this repo uses, and the file that decides each one. When a definition here and the
code disagree, the code is right — these are pointers, not a second source of truth.

## The shape

| Word | What it means | Decided by |
|---|---|---|
| **bundle** | One folder under `plugin-designs/`. Builds to exactly one JavaScript file. The folder name is the bundle name. | `internal/plugin-gallery/discover.mjs` |
| **profile** | One `.vue` file, flat in the bundle folder. One profile = one screen = one embeddable page. | `internal/plugin-gallery/discover.mjs` |
| **element** | The custom HTML tag a bundle registers. One bundle usually registers one tag; it may register more for its own screens to nest. | your `index.js` |
| **instance** (preset) | One row of `<name>.instances.json`. Same code, different settings, its own page. | `internal/plugin-gallery/discover.mjs:126-138` |
| **capability** | A number 1–5 saying how composed a profile is. See `targets.md`. | `internal/check-capability-derived.mjs` |
| **the tree** | The build output under `public/dx-maps/` — every bundle, its staging pages, and `manifest.json`. | `internal/generate-tree.mjs` |
| **the library** | `library/`, imported as `@map/…`. Shared by every plugin. | `documentation/reference.md` |
| **profile-config** | The JSON attribute an embedder puts on your tag to set the universal props. | `library/ProfileLoader.vue` |

## Presets, precisely

A preset is **not** a variant of your code. It is a row in `<name>.instances.json` giving a
preset `id`, `title` and `props`. The build writes one page per row.

**Presets merge over the profile's defaults, they do not replace them.** This is rule 3 of
`documentation/PRESET-PLUGIN-STANDARD.md`, and it is asserted on the built tree by
`bun run check:preset-config-merge`:

> A preset page's config is the profile's `<profile>.meta.json` `config`, then the preset's
> `props` over it, key by key (a shallow merge). A default the preset does not repeat is kept:
> set it in `props` only to change it.

You can see the merge order in the spread at `internal/generate-tree.mjs:1094` (the embed page) —

```js
config: { assetsBase: assetsBaseFor(4), ...(profile.extraConfig || {}), ...inst.props },
```

— and at `:1147` (the manifest row). The profile's own config is written first, the preset's props
second, so a key the preset sets wins and a key it omits survives. The comment directly above
records the bug that forced the rule: "a preset lost its profile's `pinHint:false`".

Read that standard before shipping presets — it also covers the two accepted file shapes, and the
silent failure mode (a filename not ending `.instances.json`, or an `instances` key that is not an
array, types the bundle `single` with no error).

If two presets need **different code**, they are not presets — make another profile.

## Stage vs capability — two different axes

These get confused, so keep them apart:

- **Capability (1–5)** is *how composed* a plugin is. Derived and checked by
  `internal/check-capability-derived.mjs`.
- **Stage (`production` / experimental)** is *how finished* it is. It is an attribute on the
  plugin's row, not a place it lives.

There is no "Experimental section" to be promoted out of. That section was replaced with
capability tiers on 2026-09-27 — see the comment at `plugin-designs/plugin-studio/plugin-studio.vue:630`
("★ EVERY PLUGIN IS CAPABILITY 1-5 … replacing the Experimental section"). Line 642 shows what
replaced it: a non-production row simply gets a translated `stageExperimental` prefix on its
label, in a rail organised by capability.

## Rail labels

The Plugin Studio's left rail shows the `label` from `<profile>.meta.json`. It is not optional in
practice: `internal/check-studio-rail.mjs:68` fails a plugin whose label is just its own id —

```
if (r.label === r.profile || r.label === r.bundle)
  fail(`${r.key} shows a bare id ("${r.label}") — give its <profile>.meta.json a "label"`)
```

So "give it a label" is a gate, not a convention. Run `bun run check:studio-rail`.

## Related

- `targets.md` — capabilities, `targets`, and where a plugin is allowed to run
- `backend.md` — data and the user tiers (design intent, not built)
- `workflow.md` — the loop from empty folder to landed on development
