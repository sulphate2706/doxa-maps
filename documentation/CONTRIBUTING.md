# Contributing to doxa-maps

Everything a contributor needs, short. Recipes live in [documentation/how-to.md](./how-to.md),
lookups in [documentation/reference.md](./reference.md), depth in
[documentation/architecture/](./architecture/).

## The mental model — three zones

```
  library/  (@map)          plugin-designs/<map>/          internal/
  shared, parameterized ──► your map: its screens ──►    the build machine
  legend · map · controls    (.vue) + private colors,     (scripts, staging)
  REUSE, never customize     api wiring, components       NEVER touch
  per-map                    BUILD EVERYTHING HERE
```

Rule of thumb: **local by default** — code moves into `library/` only when a *second* map
genuinely needs it. One fix in `library/` reaches every map on the next build.

## Two ways one bundle shows many maps

- **Pattern A — parameterized**: one `.vue`, many instances differing only by config
  (`*.instances.json` → the build emits one standalone page per instance).
- **Pattern B — multi-profile**: several `.vue` screens in one bundle, selected by
  `profile-config.profile`.

Pick A when the maps differ by *configuration*, B when they differ by *layout/behavior*.
Full walkthrough + the migration story:
[documentation/architecture/patterns-and-provenance.md](./architecture/patterns-and-provenance.md).

## The two build steps (never confuse them)

| Command | What | Writes to `public/`? |
|---|---|---|
| `bun run dev` | HMR plugin gallery at `localhost:5173` — iterate on a map in isolation | **No** |
| `bun run build` | every bundle → `public/dx-maps/<bundle>/<bundle>.js` + generated pages | **Yes** |

To see a change on the served site: `bun run build` (or `BUNDLE=<name> bun run build:bundle`),
then refresh. `dev` never updates the served tree.

**Two-terminal workflow** for integration work: terminal 1 `bun run build:watch` (rebuilds
into `public/` on save) · terminal 2 serves the host site / `public/`.

## Where the bundles go

`public/` is the committed web-root — serve it from anywhere and every map is embeddable from
it (script tag or the generated per-map page). Same-origin vs external-CDN modes, `paths`,
`embedBaseUrl`: [documentation/how-to.md → "Where do the maps get served from?"](./how-to.md).

## Ground rules

- Never edit `library/` to customize one map (bundle-private code goes in your `src/`).
- Never bake tokens or data into a bundle — everything arrives at runtime via `profile-config`.
- Before a PR: `bun run build && bun run verify` must pass (adds drop-portability + parse gates).
- Colors are values, not logic: [documentation/contributing/COLORS.md](./contributing/COLORS.md).
- A landing that changes source AND its build output arrives as **two commits in one push**: the source
  change first, then a `rebuild <bundle>` commit carrying only `public/`. Reviewers read the first; the
  second is machine output. Don't split them across two pushes: the landing check rebuilds every affected
  bundle on the commit about to reach main and refuses one whose `public/` bundle no longer matches its
  source. Exempt: a `public/`-only rebuild after someone else's source landed, and a comment-only source
  change (comments are stripped from the build, so there is no `public/` half).

## One-line recap

Copy `plugin-designs/template-bundle/`, change exactly four things (folder name, tag in
`index.js`, tag/profile strings in `index.html`, `.vue` filenames), build everything inside
your folder from `@map` blocks, `bun run build`, embed the snippet. That's the whole job.
