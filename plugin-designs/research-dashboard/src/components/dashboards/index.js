/**
 * dashboards/index.js — barrel export for the config-driven dashboards kit (DOXA-LIB-2).
 *
 * A profile imports the panels it needs from one place:
 *   import { DashboardTopBar, DashboardDataTable, DashboardMapPanel } from '@map/components/dashboards'
 *
 * Every panel is config-aware: it injects('dashboardConfig') (provided once by
 * useDashboardShell) instead of hard-coding FACET_ACC / COLUMNS / chart defs / KPI defs.
 * See ./README.md for the library-vs-profile rule and the build-a-dashboard steps.
 *
 * DashboardSearchHeader (DOXA-LIB-3) is the 4-bar facet search header: it renders one
 * standalone GeocoderComponent per config.search entry, each consuming the shared
 * useGeocoderSearch composable via a busAdapter sink (kind-switch stays in the composable).
 */
// ── THE TWO MOVED PANELS ARE NOT HERE ────────────────────────────────────────────────────────
// DashboardFacetRail, DashboardFilterChips and DashboardBreadcrumb live in library/components/
// dashboards/ (kit landings 4c-3, 4c-2 and 4c-4). Each was re-exported from here for ONE cycle so that moving a file and changing
// its importers were separate, reviewable landings; both shims are now retired. Import them from
// '@map/components/dashboards/<Name>.vue' — deliberately NOT re-added here, because a barrel that
// re-exports a library component makes the plugin look like its owner and is the thing that kept
// check:filter-multivalue reading a shim instead of the panel it was written to guard.
export { default as DashboardTopBar } from './DashboardTopBar.vue'
export { default as DashboardDataTable } from './DashboardDataTable.vue'
export { default as DashboardChartsRail } from './DashboardChartsRail.vue'
export { default as DashboardDetailDrawer } from './DashboardDetailDrawer.vue'
export { default as DashboardMapPanel } from './DashboardMapPanel.vue'
export { default as DashboardSearchHeader } from './DashboardSearchHeader.vue'
// DashboardResearchFilters — the DX-life research-page search bar + expand-filters dropdown SET
// (header-1 + header-2), a thin adapter over the shared @map/components/search/SearchFilterHeader
// coupling it to the selection bus (search → setSearch, dropdown pick → setFilter).
export { default as DashboardResearchFilters } from './DashboardResearchFilters.vue'
