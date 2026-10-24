# The dashboard kit contract

Four panels — a map, a data table, a charts rail and a detail drawer — behave as one dashboard
without importing each other. This file is the contract they share. It is **documentation of what
exists today**, verified against `development`, not a proposal.

The components still live in `plugin-designs/research-dashboard/src/components/dashboards/`. They
are not in `library/` yet. Under the repo's "reusable by default" rule
([`skills/plugin-designer`](../../skills/plugin-designer/SKILL.md), section 3), a component another
dashboard could use belongs in `library/`, driven by props; moving these is a library change for the
build owner.

## The shape

One composable provides; every panel injects. Nothing is passed down as props, and no panel imports
another.

`plugin-designs/research-dashboard/src/composables/useDashboardShell.js` provides five keys:

| key | what it is |
|---|---|
| `selectionBus` | the shared event bus and selection/filter state (`library/composables/useSelectionBus.js`) |
| `dashboardData` | the row store the panels read |
| `dashboardConfig` | per-profile configuration — labels, colours, which column is the photo |
| `dataStore` | the underlying data source |
| `searchSourceId` | identifies whose search a result belongs to |

A panel takes what it needs and tolerates absence:

```js
const dash = inject('dashboardData', null)
const bus  = inject('selectionBus', null)
const cfg  = inject('dashboardConfig', {})
```

The `null` defaults are load-bearing. A panel rendered outside a shell must degrade, not throw — a
thrown `setup()` removes the subtree with an empty error and no build failure, which is expensive to
diagnose.

## The bus carries two different things

`on(event, cb)` and `emit(event, payload)` are **generic**: any string is a valid event. That makes
the bus easy to extend and easy to misread, so the distinction matters.

**State events** — owned by `useSelectionBus`, emitted only by it, in response to its own mutators:

| event | payload | emitted when |
|---|---|---|
| `filter` | `filterSet` | `setFilter`, `clearFilters`, `toggleFilterValue` |
| `select` | `selectionSet` | `toggleSelect`, `selectMany`, `deselectMany`, `setSelection`, `clearSelection` |
| `search` | the term | `setSearch` |
| `hover` | the key, or `null` | `setHover` |

**UI events** — passed through the same bus by panels, with no composable behind them:
`focusRow`, `mapFocus`, `toggleTable`, `toggleRail`, `toggleFacet`, `resetLayout`, `layoutResizing`.

★ **Do not look for a state event's emitter in the panels.** Two panels listen for `select` and no
panel emits it; the emitter is `useSelectionBus.js:202`. Grepping components for the bus's traffic
cannot see the bus itself, and reading that absence as a dead contract is a mistake worth naming
here because it has already been made twice while auditing this kit.

## Selection does not travel by emit

`selectionSet` is a plain `Set<slug>`, deliberately **not** reactive — a per-row `toggleSelect()`
loop firing a synchronous `emit('select')` per row is why. `selectionVersion` is the reactive handle:
watch that, read the Set.

So a panel reacting to selection watches `selectionVersion` (or subscribes to `select`) and then
reads `bus.selectionSet`. The table writes into it; the map frames its camera off the **full** row
store rather than the filtered rows, so a record selected and then filtered out of scope still shows.

## What each panel does with it today

| panel | reads | writes |
|---|---|---|
| data table | `selectionSet`, `filter` | `selectionSet`, `toggleTable` |
| map panel | `select`, `focusRow`, `toggleTable`, `layoutResizing` | `focusRow`, `mapFocus` |
| detail drawer | `select`, `focusRow` | — |
| charts rail | `filterSet` via `isFilterActive` / `rowMatchesFilters` | `setFilter` |

★ The charts rail participates in **filtering only**. Clicking a slice narrows the map; selecting a
pin does **not** highlight its slice, because the rail neither emits nor listens for `select`. That
is the current contract, not an oversight to fix casually — whether selection should reach the
charts is a product decision, and it is open.

## Adding a panel

Inject the three keys with `null`/`{}` defaults, subscribe in `setup`, and unsubscribe on unmount —
`on()` returns its own unsubscribe function. Read state from `bus`, never from another panel. If a
new cross-panel signal is needed, prefer a **state** event with a mutator on the composable over a
new ad-hoc UI event: the ad-hoc ones are invisible to anyone reading `useSelectionBus.js`, which is
where a maintainer looks first.
