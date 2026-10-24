# `@map/components/search` — shared search + filter primitives

ONE source of truth for the search-bar, the searchable filter-dropdown, and the
fuzzy matcher. Consumed by BOTH plugins so there is **no duplication**:

- **cap-2** `plugin-designs/people-groups-grid/` — its own header (default) drives the grid.
- **cap-1** `plugin-designs/big-picture/` — the Unified Research Dashboard header
  (`BpResearchHeader.vue`) can adopt these to replace its hand-rolled `<input>` +
  native `<select>`s (card `BUILD-G1-CAT4-BIG-PICTURE-DASHBOARD` wires them in).

All three are **props-driven, emit-based, framework-agnostic** — no Nuxt context,
no i18n composables, no plugin-specific hardcoding. Styles are inlined + scoped so
each self-styles inside a standalone custom-element shadow root.

Import via the `@map` alias (resolves to `library/`):

```js
import SearchBar          from '@map/components/search/SearchBar.vue'
import FilterDropdown     from '@map/components/search/FilterDropdown.vue'
import SearchFilterHeader from '@map/components/search/SearchFilterHeader.vue'
import Fuse               from '@map/components/search/fuzzy.js'
```

- **research-dashboard** `plugin-designs/research-dashboard/` — bakes `SearchFilterHeader` in as
  header-1 (search) + header-2 (dropdowns) via the thin adapter
  `src/components/dashboards/DashboardResearchFilters.vue` (couples it to the selection bus).

---

## `SearchBar.vue`

A magnifier-icon + `<input type="search">`.

| Prop          | Type   | Default    | Purpose                                                             |
|---------------|--------|------------|--------------------------------------------------------------------|
| `modelValue`  | String | `''`       | Bound value; supports `v-model`.                                   |
| `placeholder` | String | `'Search…'`| Input placeholder text.                                            |
| `ariaLabel`   | String | `'Search'` | Accessible label.                                                 |
| `maxWidth`    | String | `''`       | Optional CSS max-width (e.g. `'480px'`); empty = fill container.   |

| Event               | Payload           | When                                                        |
|---------------------|-------------------|-------------------------------------------------------------|
| `update:modelValue` | `String`          | On every input (enables `v-model`).                        |
| `search`            | `{ value }`       | On every input; `value` is the raw string (read in-control, so shadow-DOM retargeting never loses it). |

```vue
<SearchBar :model-value="term" placeholder="Search people groups…" max-width="480px" @search="onSearch" />
<!-- onSearch(payload) { term = payload.value } -->
```

---

## `FilterDropdown.vue`

A searchable single-select with per-option counts (the four axes:
Region / Block / People-Group / Religion in the grid; Region / Status in the dashboard).

| Prop          | Type   | Required | Default               | Purpose                                      |
|---------------|--------|----------|-----------------------|----------------------------------------------|
| `label`       | String | yes      | —                     | Control label, e.g. `"Region"`.             |
| `name`        | String | yes      | —                     | Axis/field key echoed back in events.       |
| `options`     | Array  | no       | `[]`                  | `[{ value, label, count?, type? }]`.        |
| `value`       | String | no       | `''`                  | Currently-selected value (controlled).      |
| `placeholder` | String | no       | `'Type to search...'` | In-menu search placeholder.                 |

| Event           | Payload                          | When                       |
|-----------------|----------------------------------|----------------------------|
| `filter-change` | `{ name, value, label, type }`   | An option was picked.      |
| `filter-clear`  | `{ name }`                       | Selection was cleared.     |

```vue
<FilterDropdown label="Region" name="wagf_region" :options="opts" :value="sel"
  @filter-change="onFilterChange" @filter-clear="onFilterClear" />
```

---

## `SearchFilterHeader.vue`

The DX-life research-page filter header, cloned as ONE parameterized element: header-1 (a
`SearchBar`) + header-2 (an "expand filters" row of `FilterDropdown`s + optional boolean
toggle-pills + a removable active-chip strip). Pure UI/interaction — no bus, no fetch — so the
consumer supplies option lists + selected values and reacts to the emits. The dropdown row is a
SINGLE row that **never wraps** — it horizontal-scrolls on overflow (card
`BUILD-DROPDOWNS-HORIZONTAL-SCROLL-ONE-ROW`).

| Prop            | Type          | Default | Purpose                                                        |
|-----------------|---------------|---------|----------------------------------------------------------------|
| `search`        | String        | `''`    | Search-bar value (supports `v-model:search`).                  |
| `filters`       | Array         | `[]`    | Dropdown axes: `[{ name, label, options, value?, placeholder? }]`. |
| `toggles`       | Array         | `[]`    | Boolean pills: `[{ name, label, active? }]`.                    |
| `activeChips`   | Array \| null | `null`  | Removable chips `[{ name, label }]`; omit to auto-derive.       |
| `searchPlaceholder` | String    | `'Search…'` | header-1 placeholder.                                       |
| `searchMaxWidth`| String        | `'520px'` | header-1 search box max-width.                                |
| `showFilters`   | Bool \| String| `true`  | Render the header-2 filter row at all.                          |
| `startExpanded` | Boolean       | `false` | Show the dropdown row without a first click.                    |
| `collapsible`   | Boolean       | `true`  | Show the Show/Hide-Filters toggle; `false` = always open.      |
| `labels`        | Object        | `{}`    | i18n overrides (show/hide_filters, clear_all, type_to_search…).  |

| Event           | Payload                            | When                          |
|-----------------|------------------------------------|-------------------------------|
| `update:search` | `String`                           | Search changed (`v-model`).   |
| `search`        | `{ value }`                        | Every keystroke.              |
| `filter-change` | `{ name, value, label, type }`     | A dropdown option was picked. |
| `filter-clear`  | `{ name }`                         | A dropdown selection cleared. |
| `toggle`        | `{ name, active }`                 | A toggle-pill flipped.        |
| `remove-filter` | `{ name }`                         | An active chip's ✕ clicked.   |
| `clear-all`     | —                                  | "Clear all" clicked.          |

```vue
<SearchFilterHeader
  v-model:search="term" :filters="filters" :active-chips="chips" start-expanded
  @search="onSearch" @filter-change="onPick" @filter-clear="onClear"
  @remove-filter="onRemove" @clear-all="onClearAll" />
```

---

## `fuzzy.js`

A zero-dependency Fuse.js-shaped matcher (so no npm dep is added to the shared
`package.json`/`bun.lock`).

```js
const fuse = new Fuse(list, {
  keys: ['name', 'country_code.label', 'religion.label'], // dotted paths
  threshold: 0,          // 0 = exact substring only; >0 = fuzzy (k-errors edit distance, Fuse-parity)
  minMatchCharLength: 3, // shortest run counted as a match
})
fuse.search(term) // -> [{ item, matches: [{ key, indices: [[start,end], …] }] }]
```

- Empty `term` → every item with `matches: []`.
- `matches[].indices` drive `<span class="search-highlight">` wrapping (same shape as
  Fuse's `includeMatches`).

---

## Verification (headless)

- `fuzzy.js`: exact + fuzzy + empty-term contracts asserted via a node harness.
- `SearchBar` / `FilterDropdown`: SSR-mounted (`@vue/server-renderer`) — render icon +
  input, trigger + label, and reflect a selected value.
- `bun run build` builds the `people-groups-grid` bundle green consuming these shared
  imports (all guards pass).
