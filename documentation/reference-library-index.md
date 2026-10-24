# REFERENCE-library-index — reusable pieces you can import into an app-profile

> **DERIVED FILE — do not hand-edit.** Regenerate: `node internal/generate-library-index.mjs`
> Generated: run `node internal/generate-library-index.mjs` to refresh

**You are a programmer (or an agent) building a map.** This is the menu of REUSABLE,
parameterized pieces the shared `library/` offers. Import what you need with the `@map/…`
alias; **build your own custom code in your app-profile's `src/` folder.** Do NOT edit
anything listed here unless you know what you're doing — these are shared across every map,
and a change here can break other maps.

- **Three zones:** `library/` (this menu — reuse, don't edit) · `plugin-designs/<map>/` (your sandbox — build anything) · `internal/` (the build machine — never touch).
- **To make a new map:** copy `plugin-designs/template-bundle/`, read its README, list your requirements, pick from below.

### Components (reusable UI)

- **BackToTopButton** — BackToTopButton — a ↑ that appears once a long list has been scrolled, and sits NEXT TO the  
  `import … from '@map/components/BackToTopButton.vue'`
- **LargerScreenNotice** — LargerScreenNotice — what a map says on a phone when its <profile>.meta.json declares mobile  
  `import … from '@map/components/LargerScreenNotice.vue'`
- **PeopleGroupDetail** — (no description)  
  `import … from '@map/components/PeopleGroupDetail.vue'`
- **ResearchMapFilterPanel** — ResearchMapFilterPanel.vue — Multi-field filter UI for the research-map.  
  `import … from '@map/components/ResearchMapFilterPanel.vue'`
- **ResearchMapSideMenu** — ResearchMapSideMenu.vue — Side drawer specific to the research-map profile.  
  `import … from '@map/components/ResearchMapSideMenu.vue'`
- **ShellLanguageMenu** — ShellLanguageMenu — the language menu a header-off shell puts in VerticalTabsLayout's #phone-end  
  `import … from '@map/components/ShellLanguageMenu.vue'`
- **SideMenuDrawer** — SideMenuDrawer.vue — Slide-in side panel for the map application.  
  `import … from '@map/components/SideMenuDrawer.vue'`
- **ViewSelect** — ViewSelect.vue — the "SELECT VIEW" switcher: a fieldset + legend wrapping a row of  
  `import … from '@map/components/ViewSelect.vue'`
- **BarChart** — BarChart.vue — THE SHARED HORIZONTAL BAR CHART (hand-rolled SVG, zero dependencies).  
  `import … from '@map/components/charts/BarChart.vue'`
- **LifeCalendar** — LifeCalendar — a ~100-year life in weeks: 52 columns x 100 rows, 5,200 cells.  
  `import … from '@map/components/charts/LifeCalendar.vue'`
- **ProgressBar** — ProgressBar.vue — the DX-life progress bar: a single-value track, or a segmented one with a legend.  
  `import … from '@map/components/charts/ProgressBar.vue'`
- **ShareCalendar** — ShareCalendar — the same 5,200-cell grid, shaded by a population-weighted share.  
  `import … from '@map/components/charts/ShareCalendar.vue'`
- **DashboardFacetRail** — DashboardFacetRail (was Sidebar.vue) — RDASH redesign phase 2: the floating @map SemanticTreeLegend is DROPPED  
  `import … from '@map/components/dashboards/DashboardFacetRail.vue'`
- **DashboardFilterChips** — DashboardFilterChips — the live filterSet rendered as removable AND-stacked chips  
  `import … from '@map/components/dashboards/DashboardFilterChips.vue'`
- **PinHint** — PinHint.vue — the conversion coach-mark (bottom-center of any map).  
  `import … from '@map/components/hints/PinHint.vue'`
- **MapInfo** — MapInfo.vue — a map's "what can this do for you?" button, one-time pointer and example popup.  
  `import … from '@map/components/info/MapInfo.vue'`
- **ApproxPinNote** — ApproxPinNote.vue — the ONE wording every map with people-group pins uses (APPROXPIN, 2026-09-26).  
  `import … from '@map/components/legends/ApproxPinNote.vue'`
- **LegendCollapseCaret** — LegendCollapseCaret.vue — SHARED (@map/components/legends/LegendCollapseCaret.vue).  
  `import … from '@map/components/legends/LegendCollapseCaret.vue'`
- **LegendDesktop** — This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside  
  `import … from '@map/components/legends/LegendDesktop.vue'`
- **LegendMobile** — (no description)  
  `import … from '@map/components/legends/LegendMobile.vue'`
- **LegendProgressBar** — LegendProgressBar — the prayer legend's header progress bar.  
  `import … from '@map/components/legends/LegendProgressBar.vue'`
- **LegendRows** — (no description)  
  `import … from '@map/components/legends/LegendRows.vue'`
- **LegendTools** — Does the Fly + Clusters toolbar render for this legend type?  
  `import … from '@map/components/legends/LegendTools.vue'`
- **SemanticTreeLegend** — SemanticTreeLegend — reusable hierarchical legend for any one-to-many semantic tree.  
  `import … from '@map/components/legends/SemanticTreeLegend.vue'`
- **FullscreenButton** — FullscreenButton.vue — Toggles fullscreen for the map host element.  
  `import … from '@map/components/map-controls/FullscreenButton.vue'`
- **GeocoderComponent** — GeocoderComponent.vue — Mapbox Geocoder search bar as a self-contained Vue component.  
  `import … from '@map/components/map-controls/GeocoderComponent.vue'`
- **HamburgerButton** — HamburgerButton.vue — Toggle button for the side menu drawer.  
  `import … from '@map/components/map-controls/HamburgerButton.vue'`
- **HelpButton** — HelpButton.vue — the map's "?" control: what this map is and how to use it.  
  `import … from '@map/components/map-controls/HelpButton.vue'`
- **LocationButton** — LocationButton.vue — Flies the map to the user's current location via the  
  `import … from '@map/components/map-controls/LocationButton.vue'`
- **MapControlButton** — MapControlButton.vue — Shared base button for all map toolbar controls.  
  `import … from '@map/components/map-controls/MapControlButton.vue'`
- **MapControlMenu** — MapControlMenu.vue — the ONE menu every map control opens.  
  `import … from '@map/components/map-controls/MapControlMenu.vue'`
- **MapInfoButton** — MapInfoButton.vue — the map's "what can this map do for you?" control, IN the map's control column.  
  `import … from '@map/components/map-controls/MapInfoButton.vue'`
- **MapToolbar** — MapToolbar.vue — Positioned layout shell for map control buttons.  
  `import … from '@map/components/map-controls/MapToolbar.vue'`
- **ShareButton** — ShareButton.vue — Non-technical share modal for the map toolbar.  
  `import … from '@map/components/map-controls/ShareButton.vue'`
- **ThemeToggleButton** — ThemeToggleButton.vue — Switches the app between light and dark mode.  
  `import … from '@map/components/map-controls/ThemeToggleButton.vue'`
- **ZoomInButton** — ZoomInButton.vue — Increments the map zoom level by one step.  
  `import … from '@map/components/map-controls/ZoomInButton.vue'`
- **ZoomOutButton** — ZoomOutButton.vue — Decrements the map zoom level by one step.  
  `import … from '@map/components/map-controls/ZoomOutButton.vue'`
- **RegionCountryMap** — RegionCountryMap.vue — DX-life's CountryMap, rebuilt on the dx-maps map library.  
  `import … from '@map/components/maps/RegionCountryMap.vue'`
- **MapPrintProgress** — MapPrintProgress.vue — SHARED. The loading screen of a map print (mapPrintTemplate.js).  
  `import … from '@map/components/poster/MapPrintProgress.vue'`
- **PanelSheets** — PanelSheets.vue — SHARED. A preview of a large poster as the sheets it prints on: the sheets pulled apart, eac  
  `import … from '@map/components/poster/PanelSheets.vue'`
- **PosterDialog** — PosterDialog.vue — modal for previewing + rendering a poster export.  
  `import … from '@map/components/poster/PosterDialog.vue'`
- **PosterPreview** — PosterPreview.vue — scaled live preview of the poster composition.  
  `import … from '@map/components/poster/PosterPreview.vue'`
- **PosterSection** — PosterSection.vue — ONE section of a poster wall: its head (the name, the count, the collapse toggle) and its  
  `import … from '@map/components/poster/PosterSection.vue'`
- **PosterSectionView** — PosterSectionView.vue — ONE poster section on its own: the profile behind <dxm-poster-section>.  
  `import … from '@map/components/poster/PosterSectionView.vue'`
- **PosterWall** — PosterWall.vue — THE SHARED POSTER WALL.  
  `import … from '@map/components/poster/PosterWall.vue'`
- **FooterSlot** — FooterSlot.vue — STUB. Poster-rendering slot for FooterSlot.  
  `import … from '@map/components/poster/slots/FooterSlot.vue'`
- **LegendSlot** — LegendSlot.vue — STUB. Poster-rendering slot for LegendSlot.  
  `import … from '@map/components/poster/slots/LegendSlot.vue'`
- **NorthArrowSlot** — NorthArrowSlot.vue — STUB. Poster-rendering slot for NorthArrowSlot.  
  `import … from '@map/components/poster/slots/NorthArrowSlot.vue'`
- **ScaleBarSlot** — ScaleBarSlot.vue — STUB. Poster-rendering slot for ScaleBarSlot.  
  `import … from '@map/components/poster/slots/ScaleBarSlot.vue'`
- **TitleSlot** — TitleSlot.vue — renders the poster title strip.  
  `import … from '@map/components/poster/slots/TitleSlot.vue'`
- **QaCorner** — QaCorner.vue — the embeddable QA corner widget (bottom-right of any map).  
  `import … from '@map/components/qa/QaCorner.vue'`
- **GoalCard** — GoalCard.vue — a headline figure with a goal line pinned to the bottom of the card.  
  `import … from '@map/components/regions/GoalCard.vue'`
- **RegionSectionCard** — RegionSectionCard.vue — one region as a card: a heading, a summary line, a grid of its countries,  
  `import … from '@map/components/regions/RegionSectionCard.vue'`
- **StatCard** — StatCard.vue — one figure with a caption, on the DX-life card surface.  
  `import … from '@map/components/regions/StatCard.vue'`
- **FilterDropdown** — FilterDropdown.vue — SHARED (@map/components/search/FilterDropdown.vue).  
  `import … from '@map/components/search/FilterDropdown.vue'`
- **SearchBar** — SearchBar.vue — SHARED (@map/components/search/SearchBar.vue).  
  `import … from '@map/components/search/SearchBar.vue'`
- **SearchFilterHeader** — SearchFilterHeader.vue — SHARED (@map/components/search/SearchFilterHeader.vue).  
  `import … from '@map/components/search/SearchFilterHeader.vue'`
- **DataTable** — DataTable.vue — THE SHARED TABULATOR LIST VIEW.  
  `import … from '@map/components/tables/DataTable.vue'`

### Composables (reusable logic — Vue Composition API)

- **host-token-url** — host-token-url.js — the tokenUrl rule, with NO framework import, so a gate can run it.  
  `import … from '@map/composables/host-token-url.js'`
- **joinBase** — joinBase.js — SHARED (@map/composables/joinBase.js). Join a host-supplied base URL to a path.  
  `import … from '@map/composables/joinBase.js'`
- **researchLegendOptions** — researchLegendOptions.js — research-mfe-only options passed to the shared  
  `import … from '@map/composables/legends/researchLegendOptions.js'`
- **useAffinityBlockLegendData** — useAffinityBlockLegendData — 4-tier affinity-block legend data for SemanticTreeLegend.  
  `import … from '@map/composables/legends/useAffinityBlockLegendData.js'`
- **useLanguageFamilyLegendData** — useLanguageFamilyLegendData — language-family legend rows with  
  `import … from '@map/composables/legends/useLanguageFamilyLegendData.js'`
- **useLegendData** — useLegendData — builds a unified, data-driven legend item tree  
  `import … from '@map/composables/legends/useLegendData.js'`
- **useLegendMapBridge** — useLegendMapBridge — the wiring between a semantic-tree legend and the map beside it.  
  `import … from '@map/composables/legends/useLegendMapBridge.js'`
- **useWagfRegionsLegendData** — useWagfRegionsLegendData — 3-tier WAGF Regions legend for SemanticTreeLegend.  
  `import … from '@map/composables/legends/useWagfRegionsLegendData.js'`
- **mapPrintTemplate** — mapPrintTemplate.js — SHARED (@map/composables/poster/mapPrintTemplate.js).  
  `import … from '@map/composables/poster/mapPrintTemplate.js'`
- **useMapPoster** — useMapPoster — render a Mapbox GL map to a poster-grade PNG or PDF blob.  
  `import … from '@map/composables/poster/useMapPoster.js'`
- **usePosterLayout** — usePosterLayout — slot positioning math for poster compositions.  
  `import … from '@map/composables/poster/usePosterLayout.js'`
- **printInPlace** — printInPlace.js — SHARED (@map/composables/printInPlace.js).  
  `import … from '@map/composables/printInPlace.js'`
- **retryFetch** — retryFetch.js — fetch(), with the same transient-blip retry the lazy components already get.  
  `import … from '@map/composables/retryFetch.js'`
- **retryableAsyncComponent** — retryableAsyncComponent.js — SHARED (@map/composables/retryableAsyncComponent.js).  
  `import … from '@map/composables/retryableAsyncComponent.js'`
- **useAvatarGenerator** — Avatar Generator Composable  
  `import … from '@map/composables/useAvatarGenerator.js'`
- **useCardSurface** — useCardSurface.js — the DX-life card surface, as ONE rule set shared by every card component.  
  `import … from '@map/composables/useCardSurface.js'`
- **useCountryOutline** — useCountryOutline.js — country boundary OUTLINE overlay on country search.  
  `import … from '@map/composables/useCountryOutline.js'`
- **useCsvExport** — useCsvExport.js — ★ SHARED LIBRARY CODE (dashboard-kit landing 3). Two parameters make it  
  `import … from '@map/composables/useCsvExport.js'`
- **useDashboardData** — useDashboardData.js — RDASH phase 2: the single in-memory row store (kills the hardcode).  
  `import … from '@map/composables/useDashboardData.js'`
- **useDashboardLayout** — useDashboardLayout.js — reusable drag-resize + persistence engine for the CMV dashboard grid.  
  `import … from '@map/composables/useDashboardLayout.js'`
- **useDashboardSearch** — useDashboardSearch.js — the ONE free-text search the whole dashboard shares.  
  `import … from '@map/composables/useDashboardSearch.js'`
- **useDocumentFont** — useDocumentFont.js — register a self-hosted @font-face at DOCUMENT level, once per page.  
  `import … from '@map/composables/useDocumentFont.js'`
- **useEdgeScrollAffordance** — useEdgeScrollAffordance — the gray "you can scroll past this" edge strips.  
  `import … from '@map/composables/useEdgeScrollAffordance.js'`
- **useFacetAggregation** — useFacetAggregation.js — count rows by a facet accessor, and roll the tail into one bucket.  
  `import … from '@map/composables/useFacetAggregation.js'`
- **useGeocoderSearch** — Shared geocoder→map search logic (kind-switch + Mapbox filter builder + the  
  `import … from '@map/composables/useGeocoderSearch.js'`
- **useHostTokenUrl** — useHostTokenUrl.js — a composite honours tokenUrl the way ProfileLoader does.  
  `import … from '@map/composables/useHostTokenUrl.js'`
- **useHostedHelp** — useHostedHelp — a map's "?" that its HOST answers.  
  `import … from '@map/composables/useHostedHelp.js'`
- **useMapAttribution** — useMapAttribution.js — the data-credit line every map MUST carry.  
  `import … from '@map/composables/useMapAttribution.js'`
- **useMapClustering** — useMapClustering.js — Map Clustering Composable  
  `import … from '@map/composables/useMapClustering.js'`
- **useMapData** — useMapData.js - Map Data Loading Composable  
  `import … from '@map/composables/useMapData.js'`
- **useMapEvents** — useMapEvents.js - Map Event Handlers Composable  
  `import … from '@map/composables/useMapEvents.js'`
- **useMapFly** — useMapFly.js - Map Navigation/Fly Composable  
  `import … from '@map/composables/useMapFly.js'`
- **useMapInstance** — useMapInstance.js — Map Initialization Composable  
  `import … from '@map/composables/useMapInstance.js'`
- **useMapLayers** — useMapLayers.js - Map Layers Composable  
  `import … from '@map/composables/useMapLayers.js'`
- **useMapProvider** — useMapProvider.js — resolve the active map engine ("provider").  
  `import … from '@map/composables/useMapProvider.js'`
- **useMapTheme** — useMapTheme.js — shared light/dark theme for every map profile.  
  `import … from '@map/composables/useMapTheme.js'`
- **useOptionalT** — ★ NO <area>.<key>-SHAPED EXAMPLES IN THIS FILE'S COMMENTS. check:i18n-keys-exist reads any such  
  `import … from '@map/composables/useOptionalT.js'`
- **usePaneConfig** — usePaneConfig — keep a composite's panes' profile-config in step with the outer element's.  
  `import … from '@map/composables/usePaneConfig.js'`
- **usePosterPrints** — usePosterPrints.js — THE print actions every poster wall shares.  
  `import … from '@map/composables/usePosterPrints.js'`
- **usePplrInstance** — usePplrInstance.js — per-map "instance store" mediator.  
  `import … from '@map/composables/usePplrInstance.js'`
- **usePrayedLocally** — usePrayedLocally.js — the "my dot glows" encouragement loop.  
  `import … from '@map/composables/usePrayedLocally.js'`
- **usePrayerStatistics** — usePrayerStatistics.js — the ONE authoritative prayer-coverage source of truth.  
  `import … from '@map/composables/usePrayerStatistics.js'`
- **useScreenGate** — useScreenGate — the phone rule for one element (SPEC-MOBILE-FLAG).  
  `import … from '@map/composables/useScreenGate.js'`
- **useSearch** — useSearch.js — Local geocoder search composable  
  `import … from '@map/composables/useSearch.js'`
- **useSelectedPin** — useSelectedPin.js - Selected Pin Highlight + Animated GO Marker  
  `import … from '@map/composables/useSelectedPin.js'`
- **useSelectionBus** — useSelectionBus.js — hand-rolled pub/sub brushing-and-linking bus.  
  `import … from '@map/composables/useSelectionBus.js'`
- **useSelectionCamera** — useSelectionCamera.js — "select rows in the table, the map zooms to that selection."  
  `import … from '@map/composables/useSelectionCamera.js'`
- **useSentence** — useSentence.js — a translated SENTENCE that carries values and markup, as one key.  
  `import … from '@map/composables/useSentence.js'`
- **useShadowStyles** — useShadowStyles.js — Shadow DOM Style Injection  
  `import … from '@map/composables/useShadowStyles.js'`
- **useShareableView** — useShareableView — a dashboard's view state in the address bar, so a narrowed table can be SENT.  
  `import … from '@map/composables/useShareableView.js'`
- **useSharedMapToken** — useSharedMapToken.js — ONE page, ONE map token, shared by every element on it.  
  `import … from '@map/composables/useSharedMapToken.js'`
- **useTextHighlight** — highlightRanges(value, indices) — wrap each matched index range in  
  `import … from '@map/composables/useTextHighlight.js'`
- **useViewAddress** — useViewAddress.js — the page's ADDRESS for the view a reader is on: which app tab, which view inside it, which  
  `import … from '@map/composables/useViewAddress.js'`

### Utilities (pure helper functions)

- **ClusterHelpers** — ClusterHelpers.js — Pure helpers shared across clustering modes.  
  `import … from '@map/utils/ClusterHelpers.js'`
- **DataSourceManager** — Back-compat shim. The real DataSourceManager.js lives in the api/ seam  
  `import … from '@map/utils/DataSourceManager.js'`
- **MSTClusteringUtil** — MSTClusteringUtil.js  
  `import … from '@map/utils/MSTClusteringUtil.js'`
- **NetworkClusteringUtil** — NetworkClusteringUtil.js  
  `import … from '@map/utils/NetworkClusteringUtil.js'`
- **apiBaseUrl** — Back-compat shim. The real apiBaseUrl.js lives in the api/ seam folder.  
  `import … from '@map/utils/apiBaseUrl.js'`
- **colocation** — colocation.js — which people groups share ONE coordinate on a map (APPROXPIN, 2026-09-26).  
  `import … from '@map/utils/colocation.js'`
- **countries-meta** — countries-meta.js — a PORT of DX-life's config/countries-meta.ts (326 lines), the rollup  
  `import … from '@map/utils/countries-meta.js'`
- **countryName** — countryName.js — a country's name in the reader's language.  
  `import … from '@map/utils/countryName.js'`
- **embedBase** — embedBase.js — Where THIS bundle's built tree is served from, resolved at runtime.  
  `import … from '@map/utils/embedBase.js'`
- **embedScript** — embedScript — load another bundle's script and wait for its element to register.  
  `import … from '@map/utils/embedScript.js'`
- **formatCount** — formatCount — the ONE place the fleet decides how a COUNT is punctuated.  
  `import … from '@map/utils/formatCount.js'`
- **geoUtils** — geoUtils.js — Geographic / GeoJSON Utility Functions  
  `import … from '@map/utils/geoUtils.js'`
- **hostElement** — hostElement — the custom element a component is mounted inside.  
  `import … from '@map/utils/hostElement.js'`
- **html** — html.js — the two helpers every HTML string built in library/ must use (CRITIC-3, 2026-09-26).  
  `import … from '@map/utils/html.js'`
- **languageLabel** — languageLabel.js — turn the API's comma-inverted language label into the natural reading.  
  `import … from '@map/utils/languageLabel.js'`
- **languageRequest** — languageRequest.js — how a shell asks its HOST PAGE before it changes language.  
  `import … from '@map/utils/languageRequest.js'`
- **loadPinnedUmd** — loadPinnedUmd — load a PINNED, integrity-checked UMD library and capture it WITHOUT touching the host  
  `import … from '@map/utils/loadPinnedUmd.js'`
- **peopleGroupName** — peopleGroupName.js — a people group's name in the reader's language, or English if it was machine-translated.  
  `import … from '@map/utils/peopleGroupName.js'`
- **peopleGroupPoints** — peopleGroupPoints.js — SHARED (@map/utils/peopleGroupPoints.js).  
  `import … from '@map/utils/peopleGroupPoints.js'`
- **publicEmbed** — publicEmbed.js: the Share menu's Embed codes for THIS plugin, from the tree's PUBLIC address.  
  `import … from '@map/utils/publicEmbed.js'`
- **scrollport** — findScrollportAncestor — the nearest ancestor that actually scrolls.  
  `import … from '@map/utils/scrollport.js'`
- **viewportScrim** — viewportScrim.js — make a position:fixed full-screen SCRIM actually cover the VIEWPORT,  
  `import … from '@map/utils/viewportScrim.js'`

### Stores (Pinia — shared state)

- **dataStore** — dataStore.js — Centralized data cache  
  `import … from '@map/stores/dataStore.js'`
- **mapStore** — Map Store - Centralized state management for all map instances  
  `import … from '@map/stores/mapStore.js'`
- **uiStore** — UI Store - Centralized UI state management  
  `import … from '@map/stores/uiStore.js'`

### Constants (never-change values)

- **cdn** — cdn.js — EVERY third-party script and stylesheet a plugin loads at runtime, pinned to an EXACT version  
  `import … from '@map/constants/cdn.js'`
- **mapDefaults** — mapDefaults.js — Default map initialization settings  
  `import … from '@map/constants/mapDefaults.js'`
- **posterDefaults** — posterDefaults.js — default margins, bleed, slot sizes, and typography  
  `import … from '@map/constants/posterDefaults.js'`
- **posterSizes** — posterSizes.js — preset poster dimensions (US + ISO).  
  `import … from '@map/constants/posterSizes.js'`
- **zoom** — zoom.js - Centralized Zoom Configuration  
  `import … from '@map/constants/zoom.js'`

### Data (static reference tables)

- **countries** — (no description)  
  `import … from '@map/data/countries.json'`
- **country-posters** — (no description)  
  `import … from '@map/data/country-posters.json'`
- **iso-numeric-to-alpha2** — (no description)  
  `import … from '@map/data/iso-numeric-to-alpha2.json'`
- **iso3-to-alpha2** — alpha-3 -> alpha-2 so Intl.DisplayNames can produce a LOCALIZED country name. Drives no data fetch.  
  `import … from '@map/data/iso3-to-alpha2.json'`
- **langFamilyByIso** — (no description)  
  `import … from '@map/data/langFamilyByIso.json'`
- **langFamilyByLanguage** — (no description)  
  `import … from '@map/data/langFamilyByLanguage.json'`

### API / data sources (`@map/api`)

The library provides the data-source **mechanism**; you declare WHICH sources your map uses
in your own `src/api/sources.json`. Add a REST API, CSV, or MCP source by adding one entry —
no code. Mechanism (do not edit): `@map/api/_registry.js`, `@map/api/DataSourceManager.js`.

### Colors (`@map/colors`)

The library provides the color-strategy **registry** (the mechanism). Shared color taxonomies
(religion, adoption, engagement, language-family) live here. Your map's OWN colors live in your
app-profile's `src/colors/` folder — strategy `.js` files auto-merge OVER the shared set
for your map only, so editing them can't break other maps. Mechanism (do not edit): `@map/colors/_registry.js`.
