# Capabilities and targets

Two separate questions about a plugin: **how composed is it** (capability 1–5) and **where can it
run** (`targets`). Both are enforced: `check:capability-derived` and `check:targets`.

## Capability 1–5

Pick the lowest level that does the job.

| Level | `type` | What it is | Example |
|---|---|---|---|
| 1 | `single` | one screen, one element | `plugin-designs/prayer-walk-planner/` |
| 2 | `parameterized` | one screen, several named presets from `<screen>.instances.json` | `plugin-designs/doxa-simple-map/` |
| 3 | `monolithic` | many views fused inside one element | `plugin-designs/doxa-research-map/` |
| 4 | `nested-elements-mfe` | nests other elements, each still embeddable alone | `plugin-designs/dashboard-plus-grid/` |
| 5 | `nested-mfe-spa` | nests whole apps | `plugin-designs/doxa-maps-spa/` |

### It is DERIVED, and your declaration is CHECKED against it

Levels 1 and 2 are inferred: a bundle with an `*.instances.json` is `parameterized`, otherwise
`single` (`internal/plugin-gallery/discover.mjs:44-52`). Levels 3–5 you declare in
`<screen>.meta.json` `"type"`.

Declaring is not the end of it. `internal/check-capability-derived.mjs` derives the capability
from what your plugin actually `composes` and **fails when an explicit `type` disagrees**. Its
own header states the contract:

> A profile that composes anything derives cap-4, or cap-5 if it composes a cap-4 — and an
> EXPLICIT type must AGREE with that. The declaration stays authoritative; it is not overridden,
> it is checked.

The defect it exists for: research-dashboard nested ten views with no `meta.json` and shipped as
capability 1, because a missing file is indistinguishable from a deliberate choice. Every surface
that shows a tier — the manifest, the gallery, the studio rail — reads that one field, so the
understatement propagated everywhere.

Run `bun run check:capability-derived`. Two related gates: `check:capability-citations` and
`check:capability-exemplars`.

### Two traps the gate documents

Worth knowing because they will bite you the same way:

- **`composes` is per-profile at source but hoisted to the bundle in the manifest.** Deriving from
  the bundle row applies a composite's edges to its plain sibling leaves — gospel-resources has one
  composite and four single leaves, and all four wrongly derived as cap-4.
- **Refs appear in three forms in the same field**: `'bundle/profile'`, a bare `'bundle'`, and an
  element tag. Resolving only the first demoted plugin-studio from 5 to 4.

## `targets` — where the plugin may run, and it has teeth

A `<profile>.meta.json` may carry `"targets"`, naming where the plugin is meant to run:

```json
{ "type": "single", "label": "Rudder", "targets": ["desktop", "widget"], "widget": { "corner": "bottom-right" }, "backend": "backend/rudder-engine" }
```

**Omitting it means "everywhere", and that is the right default for almost every plugin.** The
whole point of the build is one folder that runs as a web embed, a mobile app and a desktop app.

Known values: **`web`** (a published map or tool), **`mobile`**, **`desktop`** (a desktop app, `bun run desktop:build`),
**`widget`** (the Plugin Studio's corner; needs a `"widget": { "corner" }`). `internal/plugin-targets.mjs`
holds the one reading every tool shares, and `bun run check:targets` rejects an unknown value, an empty list,
a widget target without a corner (or a corner without the target), and a `backend` naming a missing folder.

**Declaring it has a real consequence**, so declare it only when you mean it:

- **A plugin whose targets leave out `web` is not built for the web at all.** `bun run build` (and the
  `/cdn` export) skip it, `generate-tree` writes no leaf page or manifest entry for it, and `check:targets`
  fails if one appears in `public/`. The dev server still discovers it from source, so a `widget` plugin
  keeps its Studio corner on `bun run dev`.

- `internal/profile-meta.mjs:28` reads the field (string entries only) and `:36` carries it into
  the manifest, so every consumer of the manifest sees it.
- **Deep Research skips a bundle whose every profile is a widget or lacks the `web`
  target** — `plugin-designs/doxa-maps-spa/doxa-maps-spa.vue:605`:

  ```js
  if (profiles.every(p => p.widget || (Array.isArray(p.targets) && !p.targets.includes('web')))) continue
  ```

  So `"targets": ["desktop"]` removes your plugin from the gallery. That is the feature, not a
  bug: it keeps a plugin that cannot work on a static host out of a surface that is served from
  one. `bun run check:gallery-embed` covers the gallery's embeds.

The worked example is Rudder: its speech model runs in a local backend started by `bun run dev`
and run by Tauri as a sidecar, so "a website has no local engine" (its `_comment`). It is
correctly absent from the gallery and makes no network call on a static host.

- **Say why in `_comment`** when you declare it — the next reader needs the reason, not just the list.
- **A `backend` key alongside it** names the folder that must be running. See `backend.md`.
- **Do not add `targets` "for documentation".** Adding it without `web` silently removes you from
  the gallery.

## Where a plugin actually runs

The three outputs, all from the same built folder:

| Output | What it is | How |
|---|---|---|
| Web folder | `public/dx-maps/`, embeddable by iframe or script tag from any host | copy the folder; snippets in `manifest.json` |
| Mobile app | the same folder wrapped by Capacitor (`capacitor.config.json` `webDir`) | `bun run phone` |
| Desktop app | ONE plugin whose targets include `desktop`, in Tauri (`deployment/src-tauri/`), with its `backend` as a sidecar | `bun run desktop:build <plugin>` (see `documentation/HOWTO-build-the-desktop-app.md`) |

WordPress (`deployment/wordpress/`) embeds the web folder's snippets; it is experimental.

Embeddability is checked, unlike `targets`: `bun run check:embed-targets` runs
`internal/check-embed-targets-exist.mjs`.

## Related

- `glossary.md` — bundle, profile, preset, stage vs capability
- `backend.md` — plugins that need a service, and the user tiers
