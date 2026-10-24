# data/ — the bundler's source-of-truth data

**The law: data lives here; `public/` is generated.** `public/` holds only the output folder
(`public/<tree>/`, named by `name` in `vite.doxa-maps-build-config.json`) and a generated README. The
build (`internal/generate-tree.mjs`) copies what the plugins FETCH at runtime from here into
`<tree>/assets/`, alongside the per-profile data in `plugin-designs/*/data/`. You should be able to
`rm -rf public/` and get it all back with `bun run build`.

| Folder | Served at | What it is |
|---|---|---|
| `people-groups/` | `<tree>/assets/people-groups/` (the fetched cuts only) | People-group datasets (CSV/JSON) the maps read at runtime |
| `vendor/` | `<tree>/assets/vendor/` | Third-party runtime assets (e.g. table libraries) |
| `posters/` | `<tree>/assets/posters/` (opt-in: `bundlePosters` / `posterSources`) | Rendered poster set (heavy pipeline output; the export button fetches these) |
| `tables/` | `<tree>/assets/tables/` | The MERGED served table set (its index.json is the merge; per-profile `plugin-designs/*/data/tables` are build-time sources) |
| `pplr/` | `<tree>/assets/pplr/` (the fetched files only) | The PPLR data maps' derived datasets |
| `fonts/` | `<tree>/assets/fonts/` | Vendored typefaces (SIL OFL), e.g. Bebas Neue for the regions clone |
| `images/` | `<tree>/assets/images/` | Images the plugins fetch (e.g. the regions list's world-map watermark; see its PROVENANCE) |
| `brand/` | not served | Logos and brand imagery (sources; the optional `library/layouts/app-wrapper-material` shell references them) |
| `legacy/` | not served | Archived standalone builds kept for reference (e.g. the original upg-neighbor page) |
| `external-bundles/` | not served | Prebuilt map IIFEs vendored from sibling projects (not built here); only the optional `layouts/` shell mounted them |

`fonts/`, `images/`, `brand/` and `legacy/` moved here from `public/assets/` on 2026-09-25 (card
BUILD-OUTPUT-IS-ONE-FOLDER): they were sources that existed only in the generated folder.

Don't edit anything under `public/` by hand — change it here (or in `plugin-designs/*/data/`,
`layouts/*/assets/`) and rebuild.
