# Reference — capability exemplars (GENERATED)

> **Do not hand-edit.** Regenerate with `bun run capability-exemplars`; `bun run
> check:capability-exemplars` fails if this file falls behind the manifest.
>
> This answers one question authoritatively: **which bundles are the capability-N
> examples right now?** It is derived from `public/dx-maps/manifest.json`, which is what
> the build computed from each folder's real shape — so it cannot drift from what ships.
>
> **Cite this file rather than remembering.** The same citation has been wrong in three
> separate places: a gate, the README, and the `/plugin-designer` skill. The trap is that a
> folder's apparent simplicity does not decide its tier — an `*.instances.json` makes a
> bundle `parameterized` (cap-2) no matter how light it looks, and a `meta.json` `type`
> declares tiers 3/4/5.

Generated from 30 bundle(s).

### One canonical exemplar per tier (generated — quote these)

| Capability | Machine key | Cite this |
|---|---|---|
| 1 — single-element | `single` | `all-people-groups` |
| 2 — preset-element (prop-table) | `parameterized` | `doxa-simple-map` |
| 3 — multi-view-element (monolithic) | `monolithic` | `pplr-data-maps` |
| 4 — composite-element (nested-element SPA) | `nested-elements-mfe` | `big-picture` |
| 5 — app-shell (nested-SPA) | `nested-mfe-spa` | `doxa-maps-spa` |

> **Known-wrong citations this block replaces** (both measured 2026-09-22, both in the
> `/plugin-designer` skill, which lives outside this repo and so cannot be gated from here):
> `unified-research-dashboard` as the cap-4 reference — **that bundle does not exist**; it
> became `research-dashboard` (cap-3) plus `dashboard-plus-grid` (cap-4). And
> `doxa-vision-card` as the cap-1 example — it ships a `doxa-vision-card.instances.json`
> with 2 instances, which makes it **cap-2 parameterized** by the project's own rule.

## Capability 1 — single-element

| Bundle | Profile | Machine key |
|---|---|---|
| `all-people-groups` | `all-people-groups` | `single` |
| `bible-posters` | `bible-posters` | `single` |
| `bless-india-posters` | `bless-india-posters` | `single` |
| `cities-internet` | `connectivity-list` | `single` |
| `cities-internet` | `connectivity-map` | `single` |
| `cities-internet` | `data-tables` | `single` |
| `country-map` | `country-map` | `single` |
| `country-posters` | `countries-map` | `single` |
| `country-posters` | `country-poster-wall` | `single` |
| `country-posters` | `poster-section` | `single` |
| `golden-path-check` | `golden-path-check` | `single` |
| `gospel-internet` | `board` | `single` |
| `gospel-resources` | `charts` | `single` |
| `gospel-resources` | `data-tables` | `single` |
| `gospel-resources` | `resources-list` | `single` |
| `gospel-resources` | `resources-map` | `single` |
| `my-upg-100-list` | `poster-wall` | `single` |
| `my-upg-100-list` | `upg-100-list` | `single` |
| `poster-design` | `poster-sizes` | `single` |
| `poster-design` | `poster-styles` | `single` |
| `prayer-walk-planner` | `prayer-walk-planner` | `single` |
| `regions-dashboard` | `region-dashboards` | `single` |
| `regions-dashboard` | `regions-list` | `single` |

## Capability 2 — preset-element (prop-table)

| Bundle | Profile | Machine key |
|---|---|---|
| `demo-map` | `demo-map` | `parameterized` |
| `doxa-simple-map` | `doxa-simple-map` | `parameterized` |
| `doxa-vision-card` | `doxa-vision-card` | `parameterized` |
| `people-groups-grid` | `people-groups-grid` | `parameterized` |
| `poster-sections` | `poster-sections` | `parameterized` |

## Capability 3 — multi-view-element (monolithic)

| Bundle | Profile | Machine key |
|---|---|---|
| `doxa-research-map` | `research-map` | `monolithic` |
| `pplr-data-maps` | `pplr-data-maps` | `monolithic` |
| `research-dashboard` | `research-dashboard` | `monolithic` |
| `upg-neighbor` | `upg-neighbor` | `monolithic` |
| `wall-of-people-groups` | `wall-of-people-groups` | `monolithic` |

## Capability 4 — composite-element (nested-element SPA)

| Bundle | Profile | Machine key |
|---|---|---|
| `big-picture` | `big-picture` | `nested-elements-mfe` |
| `country-posters` | `country-posters-mfe` | `nested-elements-mfe` |
| `dashboard-plus-grid` | `dashboard-plus-grid` | `nested-elements-mfe` |
| `gospel-resources` | `gospel-dashboard` | `nested-elements-mfe` |
| `my-upg-100-list` | `upg-100-mfe` | `nested-elements-mfe` |
| `poster-design` | `poster-design-mfe` | `nested-elements-mfe` |
| `regions-dashboard` | `regions-mfe` | `nested-elements-mfe` |
| `research-map-plus-grid` | `research-map-plus-grid` | `nested-elements-mfe` |
| `stack-demo` | `stack-demo` | `nested-elements-mfe` |

## Capability 5 — app-shell (nested-SPA)

| Bundle | Profile | Machine key |
|---|---|---|
| `doxa-maps-spa` | `doxa-maps-spa` | `nested-mfe-spa` |
| `plugin-studio` | `plugin-studio` | `nested-mfe-spa` |
| `posterverse` | `posterverse` | `nested-mfe-spa` |

