/**
 * dashboard.config.js — the ONE config object for the doxa-research-dashboard profile.
 *
 * This is the headline DOXA-LIB-2 proof: the FACET_ACC accessor map (formerly copy-pasted
 * into 9 files) is declared ONCE here, under `facets`, and read everywhere via
 * inject('dashboardConfig') + useDashboardShell. Columns / charts / facet-rail sections /
 * KPIs / detail fields are likewise data, not code — the library panels render them
 * generically. Values are copied faithfully from the original research-dashboard so the
 * migrated bundle behaves identically.
 */
import { lbl } from '@map/composables/useFacetAggregation.js'
import { tStatic } from '@map/i18n/index.js'
import { RELIGION_FAMILIES } from '@map/colors/religion.js'
import { canonicalFamilyName } from '@map/colors/language-family.js'
import langFamilyByIso from '@map/data/langFamilyByIso.json'
import { getPrayerLevel, LABELS as PRAYER_LABELS } from '@map/colors/prayer-progress.js'

// ★ EVERY LABEL IN THIS CONFIG WAS ENGLISH IN ALL ELEVEN LOCALES. Measured under ?lang=ru on Big
// Picture: the facet rail, chart titles, KPI strip and table headers read Region / Bloc / Country /
// Religion while the map beside them was fully translated.
// They are declared with GETTER SYNTAX (`get label() {...}`) rather than resolved values, because
// this module is imported ONCE at load while the locale is only known later (?lang=, the host's
// profile-config, <html lang>). A getter resolves on every read, so one config object serves
// whichever locale asks — and note that SPREADING a getter would not work: the spread copies the
// resolved value, not the accessor, which is the trap this comment exists to stop.
// tStatic, not useI18n: plain config, no component instance, and mounts that install no i18n.

// same numeric coercion the DataTable uses for its num columns
const num = (v) => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }

// affinity fields arrive on the RAW pray-tools row as {value,label} objects
// (rop1 / imb_reg_of_people_2 / imb_reg_of_people_25 — the same objects DataSourceManager
// splits into affinityBlock+affinityBlockLabel / cluster+clusterLabel / peopleGroup+peopleGroupLabel).
// The People facet accessors return the stable CODE (value) for identity/filtering; the human
// name is resolved in DashboardFacetRail via useAffinityBlockLegendData — the SAME resolver the
// research-map's semantic tree uses — so bloc/cluster/PG labels can never drift from the map.
const code = (v) => (v && typeof v === 'object' ? (v.value ?? v.label ?? '') : (v ?? ''))

export default {
  // ── identity ──
  id: 'doxa-research-dashboard',
  // "Big Picture Research Dashboard" (decided 2026-09-20). The share button embeds THIS whole
  // element on a partner site, so the title is what a visitor reads there — it has to name the
  // product, not just the page. "Big Picture" is also the cap-4 composite's name and tab-1 of the
  // cap-5 SPA, so one term now runs consistently from the tab through to an embedded partner view.
  get title() { return tStatic('dashboard.dashboard_title') || 'Big Picture Research Dashboard' },
  element: 'doxa-research-dashboard',

  // ── data source ── (consumed by useDashboardData; the arg is currently advisory —
  // the store reads @map/config/sources.json activeSource = pray-tools, preserving behavior)
  data: {
    source: 'pray-tools',
    primaryKey: 'slug',
  },

  // ── facet accessors ── THE single former-duplicated FACET_ACC, declared ONCE.
  facets: {
    // ── PRAYER (card BUILD-ADD-A-PRAYER-FILTER-FIRST-IN-THE-ROW) ──
    // `people_praying` is a LIVE per-row pray-tools field, already read by three shipping
    // consumers in this very config: the KPI sum (kpis 'praying'), the table column
    // ('Praying', num(r.people_praying)) and detail.fields. No derived boolean was invented.
    //
    // It is a COUNT, not a flag, and the app already splits that count THREE ways in
    // library/colors/prayer-progress.js (the prayer map's colour strategy):
    //   none (0/null) · partial (0 < n < 144) · full (n >= 144)
    // Three levels => a DROPDOWN. We reuse getPrayerLevel + its LABELS instead of re-deriving
    // the split, so the filter can never disagree with the colour of the pin it filters to —
    // one threshold, one owner.
    //
    // ★ WHY THIS ACCESSOR MUST LIVE IN THE CONFIG AND NOT IN THE ADAPTER. useDashboardShell
    // builds FACET_ACC from `config.facets` ALONE, and filteredRows FAILS OPEN on a key it
    // cannot resolve (`return a ? a(r) === filterSet[k] : true`). A facet defined only in
    // DashboardResearchFilters.vue therefore renders a working dropdown, lands a chip, and
    // filters NOTHING — silently. A filter that filters nothing is worse than no filter,
    // because the user reads the chip as proof the scope narrowed. The adapter keeps a local
    // default and merges config-first, so THIS definition is the one that takes effect.
    //
    // Returns the human LABEL, which is both the display text and the bus value: the same
    // value-is-label contract every non-People axis follows.
    prayer_level: {
      get label() { return tStatic('dashboard.prayer') || 'Prayer' },
      get: (r) => {
        const n = r?.people_praying
        const raw = n && typeof n === 'object' ? n.value : n
        return PRAYER_LABELS[getPrayerLevel({ peoplePraying: raw ?? null })]
      },
    },
    religion: { get label() { return tStatic('dashboard.religion') || 'Religion' }, get: (r) => lbl(r.religion) },
    // ── Religion TIER 1 (card BUILD-STACKED-TREE-LEGEND) ──
    // The Doxa API's religion code is 1-3 chars whose FIRST LETTER is the family
    // ('MSN' → 'M' → Islam), which is precisely how the cap-3 map paints religion pins
    // (library/colors/religion.js:104 slices char 0). Naming the family here turns Religion
    // from a flat list of ~25 codes into the 2-tier tree the other three axes already are.
    //
    // Returns the human family NAME, not the letter: the value an accessor returns is BOTH the
    // display label and the bus filter value, and codes must never reach a user-facing menu
    // (same rule the People axis follows). A separate facet key — not a second accessor on
    // `religion` — because the bus matches on the accessor's exact output, so one key = one
    // projection keeps the byte-match contract intact.
    // Measured live (2,107 rows, 2026-09-20): 10 families, all named in RELIGION_FAMILIES,
    // family totals sum exactly to the leaf-code totals.
    religion_family: {
      get label() { return tStatic('dashboard.religion_family') || 'Religion Family' },
      // ★ NO LONGER dashboard-only (2026-09-23). This facet's value is DERIVED ("Hinduism" from
      // the religion code's first letter), which for months meant no grid row field could match
      // it -- the honest stopgap was a dashboardOnly flag the rail rendered as "updates this
      // dashboard only". The real fix landed instead: people-groups-grid runs the SAME
      // derivation (DERIVED_AXES, importing the same RELIGION_FAMILIES map this file reads), so
      // the family name the bus carries now byte-matches a value the grid computes per row.
      get: (r) => {
        const code = r.religion && typeof r.religion === 'object' ? r.religion.value : r.religion
        const c = String(code || '').charAt(0).toUpperCase()
        return c && RELIGION_FAMILIES[c] ? RELIGION_FAMILIES[c] : ''
      },
      // The family LETTER, used only to look up the map's religion palette. Never displayed,
      // never sent to the bus.
      famKey: (r) => {
        const code = r.religion && typeof r.religion === 'object' ? r.religion.value : r.religion
        const c = String(code || '').charAt(0).toUpperCase()
        return RELIGION_FAMILIES[c] ? c : ''
      },
    },
    wagf_region: { get label() { return tStatic('dashboard.region') || 'Region' }, get: (r) => lbl(r.wagf_region) },
    // "Bloc" (NOT "Block") — a bloc is a SUBSET of a region, per the WAGF place hierarchy
    // region > bloc > country. Display label only; the facet KEY stays `wagf_block` because the
    // API field, the fieldMappings, and every consumer prop (wagfBlock) are spelled that way.
    wagf_block: { get label() { return tStatic('dashboard.bloc') || 'Bloc' }, get: (r) => lbl(r.wagf_block) },
    country_code: { get label() { return tStatic('dashboard.country') || 'Country' }, get: (r) => lbl(r.country_code), geoIso: (r) => r.country_code && r.country_code.value },
    engagement_status: { get label() { return tStatic('dashboard.status') || 'Status' }, get: (r) => lbl(r.engagement_status) },
    // ── THE PHASES OF ENGAGEMENT ──────────────────────────────────────────────────────────
    // `engagement_status` above is a BINARY flag — measured live over 2,108 rows it is 2,081
    // Unengaged / 27 Engaged. imb_gsec is the ordinal ladder underneath it (present 2,106/2,108):
    //   0 No Evangelicals, Churches or Resources ....... 225
    //   1 Less than 2% Evangelical, No Active CP ..... 1,853
    //   2 Less than 2% Evangelical, Concentrated CP ...... 23
    //   4 2% or Greater but Less than 5% Evangelical ...... 4
    //   6 10% or Greater Evangelical ...................... 1
    // Cross-tabbed, ALL 225 groups with no evangelicals, churches or resources are merely
    // "Unengaged" under the flag — indistinguishable from 1,841 groups that have some presence.
    //
    // A REAL row field, so unlike language_family/religion_family this one CAN move the grid: 5
    // distinct {value,label} pairs with no value-vs-label cross-collision ('0' never reads as a
    // label), which is the same safety property that made country_code and cluster wireable.
    gospel_access: { get label() { return tStatic('dashboard.gospel_access') || 'Gospel Access' }, get: (r) => lbl(r.imb_gsec) },
    // ── Language TIER 1 — API value FIRST, ISO lookup as FALLBACK ──
    // MEASURED on the live API (2,107 rows, 2026-09-20): `imb_language_family` is null on
    // 2,073 of them — it is populated for just 34 rows (1.6%). Read alone, the Language tree
    // (one of the four axes) renders as a near-empty stub and looks broken.
    //
    // `primary_language` IS populated on 100% of rows and its `.value` is an ISO-639-3 code
    // ('abf'), and the library already ships @map/data/langFamilyByIso.json (815 entries).
    // Resolving through it lifts coverage from 34 → 2,031 rows (1.6% → 96.4%).
    //
    // The API's own value stays AUTHORITATIVE and is only fallen back on when absent — verified
    // safe: across every row where BOTH exist, the two agree 8/8 with 0 disagreements, so the
    // fallback never contradicts upstream, it only fills gaps.
    //
    // canonicalFamilyName() case-folds onto the palette's spelling (language-family.js:150) so
    // the value this returns is both the display label AND a direct palette key — one projection,
    // byte-match contract intact.
    language_family: {
      get label() { return tStatic('dashboard.language_family') || 'Language Family' },
      // ★ NO LONGER dashboard-only (2026-09-23) — same arc as religion_family above: the value
      // is DERIVED (imb_language_family label, else langFamilyByIso over the ISO code), and the
      // grid now runs the SAME derivation from the SAME @map modules (DERIVED_AXES), so the
      // Language tree's top tier drives the grid like every fetched axis.
      get: (r) => {
        const api = lbl(r.imb_language_family)
        if (api) return canonicalFamilyName(api)
        const iso = r.primary_language && typeof r.primary_language === 'object' ? r.primary_language.value : null
        const hit = iso && langFamilyByIso[iso]
        return hit ? canonicalFamilyName(hit) : ''
      },
    },
    primary_language: { get label() { return tStatic('dashboard.language') || 'Language' }, get: (r) => lbl(r.primary_language) },
    // People tier accessors — key by CODE (DashboardFacetRail resolves code→human name via
    // useAffinityBlockLegendData). Mirrors research-map's affinity-block → cluster → PG hierarchy.
    //
    // ── ONE AXIS, ONE FACET (card BUG-PEOPLE-AND-AFFINITY-BLOC-ARE-THE-SAME-AXIS-TWICE) ──
    // `affinity_bloc` is THE People axis. It used to have a twin: a second facet keyed `rop1`
    // reading lbl(r.rop1) — the LABEL of the very same field this reads the CODE of. Two facet
    // keys over ONE row field meant two controls for one axis (a "People" dropdown beside an
    // "Affinity Bloc" tree tier) that could never recognise each other: the tree stored
    // affinity_bloc='A012' while the dropdown stored rop1='South Asian Peoples', and
    // filteredRows byte-matches each key against its OWN accessor, so neither ever saw the
    // other's selection. Observed from behaviour: two filters, "People" and "Affinity Bloc", that are
    // the same axis — the People filter always WAS the affinity-bloc filter.
    //
    // THE RULE THIS RESTORES: one axis = one filterable facet key. The CODE won as canonical
    // because every other People tier (cluster / people_group) already keys by code, and
    // FACET_TO_PROP in dashboard-plus-grid.vue already mapped BOTH keys onto the one grid prop
    // `rop1` — the grid had already been treating them as a single thing.
    //
    // `optionLabel` is how the dropdown keeps showing HUMAN NAMES while STORING codes ("codes
    // must never reach a user-facing menu" — still true). It is a DISPLAY projection of the
    // same row, so option.value=code('A012') byte-matches the accessor while option.label
    // reads 'South Asian Peoples'. Both come off the SAME rop1 object on the SAME record, so
    // they cannot drift the way a cross-source name lookup could. SearchFilterHeader already
    // supports value≠label (it resolves a chip's text via `o.value === f.value`).
    affinity_bloc: {
      get label() { return tStatic('dashboard.people') || 'People' },
      get: (r) => code(r.rop1),
      optionLabel: (r) => lbl(r.rop1),
    },
    cluster: { get label() { return tStatic('dashboard.cluster') || 'Cluster' }, get: (r) => code(r.imb_reg_of_people_2) },
    people_group: { get label() { return tStatic('dashboard.people_group') || 'People Group' }, get: (r) => code(r.imb_reg_of_people_25) },
    // SEARCH-ONLY projection of the People name. NOT an axis: no control list names it
    // (`facetRail.drill`, `charts[].facet` and `researchFilters.dropdowns` all name
    // `affinity_bloc`), and nothing enumerates `facets` to render a control — every consumer
    // looks a key UP. It exists solely so free-text search keeps matching "South Asian" rather
    // than the code 'A012' (buildSearchAccessors resolves searchKeys through facets first).
    // Never add this key to a control list: that would reintroduce the duplicate axis.
    rop1_name: { get label() { return tStatic('dashboard.people_name') || 'People (name)' }, get: (r) => lbl(r.rop1) },
  },

  // ── facet rail sections ── (DashboardFacetRail) — ONE centralized semantic tree mirroring the
  // research-map's tree, top→bottom: People → Place → Language → Religion → Status.
  // `tree:'affinity'` tells the rail to resolve the People codes to human names via the shared
  // useAffinityBlockLegendData composable (single source of truth with the map's semantic tree).
  // ── THE FOUR STACKED TREES (card BUILD-STACKED-TREE-LEGEND) ──
  // The purpose: a team working to bring the gospel to every place needs to search by people, place,
  // language and religion, and to find who has gospel resources and who does not. The legend is how a
  // researcher navigates those FOUR axes, in THIS order.
  //
  // `axis` names which cap-3 colour strategy paints the tree (see useTreeLegendColors.js) — the
  // legend reads the map's palettes, so the two can never drift. Status is NOT one of the four
  // axes; it stays below them as a flat utility list (`axis:null` = uncoloured), so the four
  // trees read as the stack that was asked for rather than as five peers.
  facetRail: [
    { id: 'people', get title() { return tStatic('dashboard.people') || 'People' }, axis: 'people', drill: ['affinity_bloc', 'cluster', 'people_group'], tree: 'affinity', topN: [30, 40, 60] },
    { id: 'place', get title() { return tStatic('dashboard.place') || 'Place' }, axis: 'place', drill: ['wagf_region', 'wagf_block', 'country_code'] },
    { id: 'language', get title() { return tStatic('dashboard.language') || 'Language' }, axis: 'language', drill: ['language_family', 'primary_language'] },
    // Religion was the odd flat axis; it is now the 2-tier tree the data always supported
    // (family → religion). See the `religion_family` facet above.
    { id: 'religion', get title() { return tStatic('dashboard.religion') || 'Religion' }, axis: 'religion', drill: ['religion_family', 'religion'], topN: [12, 24] },
    // ★ THE 'Status' SECTION IS REMOVED, per the 2026-09-23 instruction not to add the engagement
    // or status filter. It rendered engagement_status as a rail section — 2 rows, Unengaged
    // 2,081 / Engaged 27 — which is a status filter by another name.
    //
    // NOT DELETED, only unlisted: `engagement_status` survives as a facet accessor, a table column
    // and a FACET_TO_PROP mapping, so the grid can still filter on it and nothing downstream breaks.
    // Re-add one line here to bring the section back.
    //
    // Gospel Access STAYS. It is a different question from engagement status and the two are
    // measurably independent: over 2,108 live rows they DISAGREE on 25 — 12 groups are "Engaged" at
    // gsec rung 1 and 13 are "Unengaged" at rung 2 — so this is not the status filter wearing a new
    // label. Its own section rather than a drill under anything: the ladder is not a sub-division of
    // the engagement flag, and 5 rows do not need a topN cap.
    { id: 'gospel-access', get title() { return tStatic('dashboard.gospel_access') || 'Gospel Access' }, axis: null, facet: 'gospel_access', topN: 8 },
  ],

  // ── KPI strip ── (computed by useDashboardShell; mirrors the original 6 stat computeds)
  kpis: [
    { id: 'total', get label() { return tStatic('dashboard.upgs_in_scope') || 'UPGs in scope' }, kind: 'count', showDelta: true },
    { id: 'pop', get label() { return tStatic('dashboard.sum_population') || 'Σ population' }, kind: 'sum', field: 'population' },
    // ★ NO '%' IN A `kind:'pct'` LABEL. kpiText() returns k.value unchanged for pct, and that
    // value ALREADY carries its percent sign — so a label that also carries one renders
    // "99%  % UNREACHED". Found by reading the rendered screenshot, not by reading the code:
    // each half looks correct in isolation and only the composition is wrong, which is why it
    // survived review. The label says WHAT is measured; the value says how much.
    { id: 'unreached', get label() { return tStatic('dashboard.unreached') || 'unreached' }, kind: 'pct',
      test: (r) => !/engaged/i.test(lbl(r.engagement_status)) || /unengaged/i.test(lbl(r.engagement_status)) },
    { id: 'countries', get label() { return tStatic('dashboard.countries_touched') || 'countries touched' }, kind: 'distinct', field: 'country_code', via: 'geoIso' },
    { id: 'praying', get label() { return tStatic('dashboard.sum_praying') || 'Σ praying' }, kind: 'sum', field: 'people_praying' },
    { id: 'adopted', get label() { return tStatic('dashboard.adopted') || 'adopted' }, kind: 'pct', test: (r) => Number(r.adopted_by_churches) > 0 },
  ],

  // ── table columns ── (DashboardDataTable)
  //
  // `w` = the column's FLEX WEIGHT (default 1). DashboardDataTable renders each cell with
  // `flex: <w> 1 0`, so the row still fills the width at any viewport — the weights only change
  // how the space is SHARED.
  //
  // WHY THIS EXISTS — measured on the live dashboard, not guessed. Every column was `flex:1 1 0`,
  // which means "ignore content, split evenly": with flex-basis 0 the browser never consults
  // intrinsic width, so a 7-character number column claimed exactly as much room as a people-group
  // name. Measured at 1440px every column was 106px wide and "People Group" was ELLIPSISED while
  // "Praying" had room to spare; at 1280px (86px each) THREE headers were cut — People Group,
  // Population and Engagement. The data is worse than the headers: names run to
  // "North America & Non-Spanish Caribbean", far longer than any label.
  //
  // ★ THE WEIGHTS ARE DERIVED FROM MEASUREMENT, AND MY FIRST ATTEMPT WAS WRONG — recording why.
  // I first guessed from DATA width (numbers are short, so w:0.8) and made it WORSE: truncation went
  // 1 -> 2 at 1440px. The binding constraint is the HEADER LABEL, not the values. 'Population' is a
  // 10-character header whose values read '12,500'; the header sets the floor.
  //
  // Measured NEED per column (scrollWidth of the header cell, which includes its padding), then each
  // string column bumped for long DATA (names reach 'North America & Non-Spanish Caribbean',
  // religions 'Ethnoreligion - Animism'), then normalised so the weights average 1.0:
  //   People Group 144 · Country/Region/Language/Religion 112 · Engagement 104 · Population 92 · Praying 71
  // Total need 859px against ~878px of column space at 1440 — so it FITS, and the old even split was
  // simply spending the width in the wrong places. No padding or type-size change was needed.
  //
  // Deliberately NOT pixel widths: a fixed px column breaks at a viewport you did not test, while a
  // weight degrades proportionally everywhere.
  columns: [
    { key: 'name', get label() { return tStatic('dashboard.people_group') || 'People Group' }, get: (r) => r.name || '', type: 'str', w: 1.34 },
    { key: 'country', get label() { return tStatic('dashboard.country') || 'Country' }, get: (r) => lbl(r.country_code), type: 'str', w: 1.04 },
    { key: 'region', get label() { return tStatic('dashboard.region') || 'Region' }, get: (r) => lbl(r.wagf_region), type: 'str', w: 1.04 },
    { key: 'language', get label() { return tStatic('dashboard.language') || 'Language' }, get: (r) => lbl(r.primary_language), type: 'str', w: 1.04 },
    { key: 'religion', get label() { return tStatic('dashboard.religion') || 'Religion' }, get: (r) => lbl(r.religion), type: 'str', w: 1.04 },
    { key: 'population', get label() { return tStatic('dashboard.population') || 'Population' }, get: (r) => num(r.population), type: 'num', w: 0.86 },
    { key: 'people_praying', get label() { return tStatic('dashboard.praying') || 'Praying' }, get: (r) => num(r.people_praying), type: 'num', w: 0.66 },
    { key: 'engagement', get label() { return tStatic('dashboard.engagement') || 'Engagement' }, get: (r) => lbl(r.engagement_status), type: 'str', w: 0.97 },
  ],

  // ── map ── (DashboardMapPanel)
  // `paper` = "near-white minimal — data reads like print". The style registry
  // (library/styles/registry.js) already listed `research-dashboard` as this style's own
  // `bestFor` target, and already resolves the name on BOTH engines — Mapbox light-v11 and
  // the keyless MapLibre Positron. It was simply never set here, so the panel silently took
  // each engine's default instead. CARTO ships Positron expressly as the basemap "good for
  // POINT data", which is exactly this map's job, so this is an alignment, not a new choice.
  // One line, and it survives the MapLibre swap unchanged.
  map: {
    // ── PROVIDER: MapLibre ───────────────────────────────────────────────────────────────────
    // Asked 2026-09-22: the map on the big picture is to be MapLibre; and 2026-09-23 on the
    // terms — keep every Mapbox component working so Mapbox compatibility is not broken — we
    // just want interoperability, so we can come back to Mapbox if this breaks things."
    //
    // ★ THIS ONE KEY IS THE WHOLE SWAP, AND THAT IS THE POINT. DashboardMapPanel reads it
    // (`cfg.provider === 'maplibre' ? 'maplibre' : 'mapbox'`), useMapInstance loads the matching
    // engine + CSS, and registry.js resolves the style name on whichever engine is live. Delete
    // this line — or set it to 'mapbox' — and the dashboard is byte-for-byte what it was before,
    // with the Mapbox token still wired and no other file to restore. Reversibility is not a
    // claim here; it is the shape of the change. (Proven by flipping it and rebuilding, not
    // asserted — see the verification note in the commit.)
    //
    // WHY IT COSTS NOTHING TO STAY DUAL: MapLibre ignores accessToken rather than rejecting it,
    // so the Mapbox credential stays threaded through untouched while MapLibre is live.
    // ★ MAPBOX FOR THIS MAP. The target look is Mapbox's own: its globe, the space style with the
    // stars, and its water. Mapbox Standard's globe NATIVELY renders
    // the starfield, the atmosphere and that water -- no clone can beat the original, and we hold
    // a working baked token (accepted as a public token). MapLibre support
    // stays fully built and reversible: flip this one key back and the keyless VersaTiles path
    // returns. Interoperability was the requirement; it is intact.
    provider: 'mapbox',

    // 'galaxy' = "deep-space ground, blue oceans" (library/styles/registry.js).
    // Asked 2026-09-23: the map style needs BLUE WATER with a BLACK GALAXY
    // background. It resolves on BOTH engines — MapLibre's keyless OpenFreeMap dark and Mapbox
    // dark-v11 — each patched to the same blue water at style.load, so flipping `provider` above
    // does not change how the map LOOKS, only which engine draws it. That is what makes the
    // reversibility test above meaningful rather than cosmetic.
    // Was 'paper' (near-white minimal) until this change.
    mapStyle: 'galaxy',

    // ── HEARTBEAT ZONES ──────────────────────────────────────────────────────────────────────
    // A HEARTBEAT ZONE is a country holding the most people groups — where the concentration of
    // unreached peoples is densest. It is the TOP bin of the choropleth ramp, and the whole point
    // of the map: "the heartbeat zones are the most people groups in them."
    //
    // ★ WHY THIS IS A VARIABLE AND NOT A CONSTANT. 150 is not a property of choropleths; it is a
    // property of THIS DATASET — ~2000 people groups in focus across ~120 countries. Ported to a
    // dataset of 200 groups, a 150 cutoff puts EVERY country in the bottom bin and the map renders
    // uniformly pale: not an error, not a crash, just a dashboard that says nothing. That failure
    // is invisible to every existing gate, because the code is perfectly correct — the ASSUMPTION
    // is what moved. The cutoff of 150 must be a variable, not a static, so this dashboard can be
    // reused for other maps and other data sets.
    //
    // So the thresholds are declared HERE, in the dashboard's own config, where every other
    // per-dataset fact already lives (facets, columns, kpis). Re-pointing this dashboard at a new
    // dataset is a config edit, not a source edit.
    //
    // WHAT EACH KEY DOES
    //   heartbeatThreshold — the count at which a country BECOMES a heartbeat zone (top bin).
    //                        Change this alone and the other four bin edges rescale with it,
    //                        keeping the ramp's shape. This is the one number to turn.
    //   binThresholds      — OPTIONAL full control: the four lower edges, ascending. Supply this
    //                        only to override the derived rescale; the top bin is always
    //                        heartbeatThreshold..Infinity.
    //   heartbeatMode      — 'fixed' (default) uses heartbeatThreshold as an ABSOLUTE count.
    //                        'quantile' DERIVES the edges from the data actually loaded (see
    //                        heartbeatQuantile). Opt-in: it changes the ramp per dataset, which is
    //                        the right behaviour for an unknown dataset and the WRONG behaviour
    //                        for this one, where 150 is a deliberate, product-chosen number.
    //   heartbeatQuantile  — with mode 'quantile', the share of non-empty countries ABOVE the
    //                        heartbeat edge. 0.1 = "the top 10% of countries are heartbeat zones".
    //
    // The DEFAULTS below reproduce the historical ramp EXACTLY (5/20/60/150/Infinity) — verified
    // by internal/check-heartbeat-threshold.mjs, which replays the bin assignment and fails if a
    // default edit moves it.
    heartbeatThreshold: 150,
    binThresholds: [5, 20, 60],
    heartbeatMode: 'fixed',
    heartbeatQuantile: 0.1,

    // ── COLOUR RAMP — a NAME, resolved in DashboardMapPanel.vue's RAMP_PRESETS ──────────────
    // Same pattern as `mapStyle` above: a name in config, not a URL/hex-array a host has to
    // construct. 'heartbeat-red' is the shipped default (unchanged if this key is omitted).
    // 'greyscale' is the swappable alternative, a grey-to-black backdrop — set this to
    // 'greyscale' to swap the whole choropleth, legend included, with no other edit required.
    // ★ THE SHIPPED VALUE IS GREYSCALE: the grey-to-black ramp replaced the red one. One key, and the
    // choropleth AND its legend both move — which is why it was built as config rather than scattered hex.
    // The ramp is ['#e8e8e8','#a9a9a9','#6f6f6f','#3a3a3a','#060606'] (DashboardMapPanel.vue:467),
    // measured worst-case pin visibility 1.96 vs red's 1.84. THE DURABLE FINDING: the real fix for
    // pin contrast is the lightness-conditional STROKE, which holds whichever ramp is selected —
    // swapping the ramp alone will not rescue a pin that fails against it.
    colorRamp: 'greyscale',
  },

  // ── charts ── (DashboardChartsRail)
  charts: [
    // ★ HIGH-LEVEL RELIGIONS ONLY: each religion appears once, at the high level, not broken down into
    // smaller categories (Islam once, not "Islam - Sunni" and "Islam - Folk"). The rollup ALREADY EXISTED as the religion_family facet ("Islam",
    // "Hinduism", "Ethnoreligion" -- one row each); the chart was simply pointed at the
    // fine-grained `religion` facet ("Islam - Sunni", "Islam - Folk", ...). One word moves it.
    // religion_family is dashboardOnly by design (a derived value no row field carries), so a
    // slice click narrows the DASHBOARD but not the grid below -- documented behaviour, and for
    // a glanceable donut that is the right trade. The full breakdown still lives in the facet
    // rail's Religion tree for anyone who needs Sunni vs Folk.
    { id: 'religion', type: 'donut', facet: 'religion_family', get title() { return tStatic('dashboard.religion') || 'Religion' }, topN: 8 },
    { id: 'region', type: 'donut', facet: 'wagf_region', get title() { return tStatic('dashboard.region') || 'Region' }, topN: 9 },
    { id: 'country', type: 'bar', facet: 'country_code', get title() { return tStatic('dashboard.top_countries') || 'Top countries' }, topN: 12 },
  ],

  // ── detail drawer ── fields surfaced for a focused record
  detail: {
    photo: (r) => r.has_photo && r.image_url,
    fields: ['religion', 'primary_language', 'people_praying', 'adopted_by_churches', 'engagement_status'],
  },

  // ── research filters (DX-life clone) ── header-1 search bar + header-2 expand-filters
  // dropdown SET, baked via DashboardResearchFilters → the shared @map SearchFilterHeader.
  // `dropdowns` = the facet keys rendered as dropdowns (each returns a LABEL the bus matches on,
  // so a pick byte-matches filteredRows); `searchKeys` = the facet keys the free-text search
  // matches across (mirrors DX-life's Fuse keys: name/place/region/language/religion — here the
  // name comes from the `columns` string set and these facet labels). One horizontal row,
  // horizontal-scroll on overflow (card BUILD-DROPDOWNS-HORIZONTAL-SCROLL-ONE-ROW).
  // ── AXIS ORDER: People · Place · Language · Religion ──
  // Place expands to its three tiers region > bloc > country, so the row reads
  //   [People] [Region] [Bloc] [Country] [Language] [Religion].
  // People (`rop1`) was MISSING entirely (card BUILD-FILTER-PEOPLE-AXIS-MISSING) — the data was
  // always there (it is a defaultField on the pray-tools source and DX-life filtered on it), only
  // the dropdown was dropped when this list was first written.
  researchFilters: {
    // People = `affinity_bloc`, the SAME key the tree's top tier filters on, so a pick here and
    // a click there are one selection (card BUG-PEOPLE-AND-AFFINITY-BLOC-ARE-THE-SAME-AXIS-TWICE).
    // It stores the code and displays the name via the facet's `optionLabel`.
    // `prayer_level` listed FIRST so the config owns the order rather than the adapter forcing
    // it. DashboardResearchFilters de-duplicates on that key, so naming it here cannot render
    // it twice — and if the adapter's forcing is ever removed, the order still holds.
    // ★ EIGHT dropdowns: people, region, bloc, country, language, religion, prayer and engagement,
    // with prayer FIRST. engagement_status was the one
    // missing: it was already fully built (label + getter at :112, the Status tree section at :201,
    // the Engagement table column at :256) and simply never registered here, so the rail rendered
    // SEVEN. Measured live before this change: 7 filter buttons (Prayer, People, Region, Bloc,
    // Country, Language, Religion).
    //
    // ★ CORRECTED 2026-09-23 — this note used to say "GSEC is the underlying field the spec named
    // for 'the phases of engagement' — engagement_status is the label derived from it." IT IS NOT
    // DERIVED FROM IT, and believing so is why the phases stayed unbuilt: the dropdown looked like it
    // already covered the ask. Measured on 2,108 live rows, the two fields DISAGREE — 12 groups are
    // "Engaged" while sitting at gsec rung 1, and 13 are "Unengaged" at rung 2. They are independent
    // fields, and engagement_status is binary (2,081 / 27) where imb_gsec has five rungs.
    //
    // The phases now have their own facet (`gospel_access`, reading imb_gsec) plus a Gospel Access
    // tree section, and they reach the grid through FACET_TO_PROP.
    //
    // NOT a ninth dropdown, and the reason is the list, NOT layout. Measured at both 1440
    // and 1280: dropdowns are 168px on a 178px pitch, seven fit the first row (right edge 1250) and
    // the eighth wraps, with NO horizontal scrollbar at either width. A ninth would simply join the
    // second row — so the layout would tolerate it. The list stays at the eight the spec named;
    // the ladder is reachable through the tree rail, which is where a five-rung ordinal reads better
    // than a dropdown anyway.
    //
    // ★ NO HORIZONTAL SCROLLBAR is the constraint that goes with the count. RE-MEASURED 2026-09-23 at
    // both 1440 and 1280 on the built composite: each dropdown is 168px on a 178px pitch (this note
    // previously said 200px — the pitch was never measured, only assumed). Seven fit the first row,
    // ending at x=1250; the eighth wraps to a second row. document.scrollWidth does not exceed the
    // viewport at either width, so the promise holds today.
    // Verify after any change to this list: the filter row must not produce a horizontal scrollbar at
    // 1440 or 1280.
    // ★ ENGAGEMENT / STATUS REMOVED, per the 2026-09-23 instruction not to add the engagement or
    // status filter. `engagement_status` was the eighth dropdown; it is gone from this row. The
    // earlier note above about "the spec named eight ... engagement was the one missing" describes a
    // SUPERSEDED instruction — kept because it records why the eighth was added, not because it is
    // still the ask. SEVEN dropdowns now, which all fit the first row (seven fit, ending at x=1250 on
    // the measured 178px pitch), so the no-horizontal-scrollbar promise gets easier, not harder.
    //
    // The facet itself is NOT deleted: `engagement_status` remains a facet accessor and keeps its
    // Status tree section, because the grid still filters on it and removing the accessor would break
    // FACET_TO_PROP. What changed is only whether it is offered as a DROPDOWN in the filter row.
    dropdowns: ['prayer_level', 'affinity_bloc', 'wagf_region', 'wagf_block', 'country_code', 'primary_language', 'religion'],
    get searchPlaceholder() { return tStatic('dashboard.search_placeholder') || 'Search people groups, place, language, religion…' },
  },
  // `rop1_name` (not `affinity_bloc`) so free-text search matches the People NAME — DX-life's
  // Fuse key set includes 'rop1.label' (UupgsList.vue:299), and searching the axis's canonical
  // CODE would mean typing 'A012' to find South Asian Peoples. This is the one place the label
  // projection is still needed, and it is search-only — see the `rop1_name` facet note above.
  searchKeys: ['name', 'rop1_name', 'wagf_region', 'wagf_block', 'country_code', 'primary_language', 'religion', 'engagement_status'],

  // ── search header ── (DOXA-LIB-3) the 4 facet search bars (DashboardSearchHeader).
  // Each bar = one standalone GeocoderComponent consuming useGeocoderSearch via a
  // busAdapter sink. `context` scopes the geocoder's result ordering; `kinds` is the
  // supportedKinds subset the composable accepts for that bar; `label` is the placeholder.
  // The bar's busAdapter maps the RESOLVED kind → a dashboard facet key (people-group
  // results go to selectionSet; the rest to filterSet) — the kind-switch itself stays in
  // the composable. See src/components/dashboards/README.md.
  search: [
    { id: 'people', get label() { return tStatic('dashboard.search_people') || 'Search people' }, context: 'people-groups',
      kinds: ['affinity-bloc', 'cluster', 'people-group'] },
    { id: 'place', get label() { return tStatic('dashboard.search_place') || 'Search place' }, context: 'regions',
      kinds: ['region', 'country'] },
    { id: 'language', get label() { return tStatic('dashboard.search_language') || 'Search language' }, context: 'language',
      kinds: ['language-family', 'language', 'dialect'] },
    { id: 'religion', get label() { return tStatic('dashboard.search_religion') || 'Search religion' }, context: 'religion',
      kinds: ['religion'] },
  ],
}
