<script setup>
/**
 * data-tables.vue — the GOSPEL RESOURCES list view.
 *
 * @description Eleven tables covering both halves of one question: every gospel resource with its real URL and how much Scripture it is, and the 1,613 people groups where nothing was found with the pools searched recorded per row, plus translation priority, bridge languages, city bridges, the deaf gap and access against population growth.
 *
 * Eleven tables, and the first two answer the two halves of one question. "Every Resource
 * + Link" lists what EXISTS — 8,437 real, openable resources across 4,231 languages, each
 * named and scoped as a Full Bible, New Testament or portions. "Where Nothing Was Found"
 * lists what does NOT — 1,613 people groups, 208 million people — with each row carrying
 * the pools that were searched and the pools that were not, so an exported CSV can never
 * be read as a claim about the world.
 *
 * The growth table is the one with teeth: `growing_without_resource` marks a group
 * whose population is RISING while its language still has no scripture and no film
 * in any pool checked. 431 groups, 34.5M people, ~599 estimated deaths/day.
 *
 * The mortality estimate applies a NATIONAL crude death rate to a SUB-POPULATION.
 * It is order-of-magnitude, not a count — and DataTable renders that caveat from
 * the table's own meta so the method travels with the number.
 */
import { computed, inject, ref, watch } from 'vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { sentenceParts, strong, ltr, keep } from '@map/composables/useSentence.js'
import { h } from 'vue'
import { EN_MESSAGES } from '@map/i18n/index.js'
import DataTable from '@map/components/tables/DataTable.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { commitUrl, urlOwnerOf } from '@map/composables/useViewAddress.js'
import { searchWithout, FILTER_KEYS } from './filter-url.js'


const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

/* NAMED tr(), NOT t(). The tab loop already binds `t` to a tab object — `v-for="t in TABS"` —
   so a translator called t() would be shadowed inside the one block that needs it most, and
   the labels would silently render as whatever the tab object stringifies to. Guarded like
   every other useI18n() call in this bundle: the host may never have installed i18n. */
// C4: the guard is library/composables/useOptionalT.js now. enLookup STAYS as the fallback, passed
// in, so a bare host renders the same ENGLISH it always did -- routing this to the catalogue default
// would make a bare host honour ?lang=ar, which is the plugin owner's call and not this migration's.
// C4 wave 3a, the plugin owner's call (2026-09-26): take the LOCALE-HONOURING fallback rather than
// enLookup's English. A partner host that never installed vue-i18n now gets the reader's language,
// with English as the last resort. tStatic resolves 'gospel.<key>' against the same catalogue.
const tr = useOptionalT('gospel')

// ★ ONE KEY for the gap hero. keep() makes the lookup return the placeholders rather than blanking
// them; each count arrives already formatted, and the quoted phrase goes in as an ltr() VALUE so a
// translator never reproduces the markup.
const gapHero = computed(() => {
  if (!gap.value) return null
  const msg = tr('gospel.gapHero.hero', keep('groups', 'growing', 'noFound', 'pop', 'deaths'))
  return h('span', sentenceParts(msg, {
    groups: strong(fmt(gap.value.groups)),
    growing: strong(tr('gospel.gapHero.growing')),
    noFound: ltr(tr('gospel.gapHero.found')),
    pop: strong(fmt(gap.value.population)),
    deaths: strong(fmt(gap.value.deathsDay)),
  }))
})

const TABS = [
  // ★ THE DOXA TABLE LEADS, because it is the question actually asked: which of
  // THEIR people groups have gospel resources and which do not. Every other tab here is
  // scoped to the research corpus — 12,379 groups, 4,231 languages — which is the right
  // scope for finding what exists and the wrong one for working a list of 2,107. A
  // mobiliser cannot plan from a table that is four-fifths other people's groups.
  { id: 'doxa',      labelKey: 'gospel.tables.t_doxa',       file: 'doxa-gospel-access' },
  // THE LINKS lead. Every other table here is keyed by PEOPLE GROUP and answers "who has
  // nothing"; this one is keyed by the RESOURCE and answers "what exists and where do I
  // open it" — the question a mobiliser asks first, and the only table whose every row
  // carries a URL you can click.
  { id: 'links',     labelKey: 'gospel.tables.t_links',      file: 'gospel-resource-links' },
  // The other half of the same question. Every other table here lists what EXISTS; this
  // one lists the groups with nothing found, which is the list a mobiliser can
  // actually export and work through. It is NOT the "Gaps & Opportunities" table below:
  // that one is one row per group across the curated 2,106-record set and structurally
  // cannot see these groups.
  { id: 'nothing',   labelKey: 'gospel.tables.t_nothing',    file: 'gospel-gaps' },
  // The same gap, aggregated to the place a team gets sent. It existed only inside the
  // map's sheet — readable, not exportable — while every other tab here offers CSV and
  // JSON. Derived from gospel-by-country, which is refreshed from the pin index, so it
  // cannot drift from the map above it.
  { id: 'countrygap', labelKey: 'gospel.tables.t_countrygap',        file: 'country-gap' },
  // The OPPOSITE question from "where nothing was found", and none of these groups appear
  // in that table because none of them is tier 0: they can already hear the gospel and have
  // no text to read. It was selectable on the map and nowhere else, and a filter cannot be
  // sorted, exported, or handed to a committee — which is precisely what this list is for.
  { id: 'translation', labelKey: 'gospel.tables.t_translation',     file: 'translation-priority' },
  // The same population aggregated to the place a team is SENT. Its two columns disagree on
  // purpose: Nigeria and the DRC lead on languages, which is the translation workload, while
  // China and Pakistan lead on people across far fewer languages.
  { id: 'translationcountry', labelKey: 'gospel.tables.t_translationcountry', file: 'translation-priority-by-country' },
  // GAPS & OPPORTUNITIES leads: it is the table that answers "where can the work
  // actually happen", which is the whole point of the corpus.
  { id: 'gaps',      labelKey: 'gospel.tables.t_gaps',      file: 'gaps-and-opportunities' },
  // The actionable shortlist: 28 places where a co-located language ALREADY
  // carries a resource the group's own language lacks.
  { id: 'bridges',   labelKey: 'gospel.tables.t_bridges',              file: 'city-bridge-opportunities' },
  // The largest structurally-invisible bloc. Rebuilt from the pins: it used to be derived
  // from the curated 2,106-record set and showed 73 sign languages / 120 groups / 19.35M,
  // while the map drew 150 / 234 / 84.2M — the Deaf tab was missing more than half of the
  // thing it is named for. Counts live in the table's own meta now, not in this comment.
  { id: 'deaf',      labelKey: 'gospel.tables.t_deaf',              file: 'deaf-gap' },
  { id: 'resources', labelKey: 'gospel.tables.t_resources', file: 'people-group-resources' },
  // Ranked languages per country joined to resources — the bridge-language view.
  { id: 'languages', labelKey: 'gospel.tables.t_languages',        file: 'languages-by-country' },
  { id: 'growth',    labelKey: 'gospel.tables.t_growth', file: 'gospel-access-vs-growth' },
  // SUB-NATIONAL, and the only tab at a grain smaller than a country. India and China hold
  // most of the world's zero-access people between them, and "India" is not a place anyone is
  // sent — a state is. Every row says placement is APPROXIMATE: a group is assigned to the
  // province its map point falls in, and a point is one dot for a people that may live across
  // several. It is the same file the map's province sheet reads, so the two cannot disagree.
  { id: 'province',  labelKey: 'gospel.tables.t_province', file: 'gospel-by-province' },
  // THE INVERSE QUESTION, and nothing else here asks it. Every other tab answers "who has
  // nothing" and then, group by group, "what is the way in for this one". A mobiliser with a
  // budget asks: if I resource ONE language, how many peoples does that reach? 35 rows cover all
  // 369 groups with nothing — SUN is the way in for 93 Deaf groups across 93 countries, Mandarin
  // for 36, Akha for 33. Same data as the group-by-group answer, turned around.
  { id: 'bridgereach', labelKey: 'gospel.tables.t_bridgereach', file: 'bridge-language-reach',
    en: 'One Language, How Many Peoples' },
]

/* A LABEL THAT IS MISSING MUST NOT RENDER AS ITS KEY. tr() falls back to the shipped English
   catalogue and then to the key itself, which on a TAB reads "gospel.tables.t_bridgereach" —
   worse than the English it replaced. A tab may carry its own English until its key lands, and
   switches to the catalogue the moment it does, with no second change here. */
const tabLabel = (t) => {
  const v = tr(t.labelKey)
  return v && v !== t.labelKey ? v : (t.en || t.labelKey)
}
// DEEP-LINK FILTER. The map and this table are separate PAGES, so "click a pin and the
// table follows" is a URL, not shared state. The map links here with ?tab=links&iso=<code>
// or &country=<ISO3>, and the rows are filtered HERE rather than by teaching the shared
// DataTable a new prop — that component has other consumers and this needs none of them.
function qp() {
  try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() }
}
const params = qp()
const fIso = ref((params.get('iso') || '').trim().toLowerCase())
const fCountry = ref((params.get('country') || '').trim().toUpperCase())
const fLabel = ref((params.get('label') || '').trim())
/* A PROVINCE IS A THIRD KEY, and it is a NAME rather than a code: geoBoundaries' shapeName is
   what the province table joins on, so that is what travels in the URL. Matched case- and
   diacritic-insensitively — a link typed as ?province=Arunachal Pradesh must still find
   "Arunāchal Pradesh", or the deep link works only for whoever copied it off the map. */
const fProvince = ref((params.get('province') || '').trim())
const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const hasFilter = computed(() => !!(fIso.value || fCountry.value || fProvince.value))
// "Show all" drops only the filter's own keys (filter-url.js) through the one history writer, and only on a page
// this element owns (urlOwner 'app'); a partner's or a host's address is never written. The tab, every other key,
// the hash and the history state stay.
function clearFilter() {
  fIso.value = ''; fCountry.value = ''; fLabel.value = ''; fProvince.value = ''
  if (urlOwnerOf(profileConfig.value) === 'app') commitUrl({ search: searchWithout(window.location.search, FILTER_KEYS) })
}

const active = ref(TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'links')
const current = computed(() => TABS.find((t) => t.id === active.value) || TABS[0])

// ═══ COMPOSED MODE ═══ when these tables are stacked under the map in the dashboard, the
// map asks them to filter in place instead of linking to this page. Null on the standalone
// page, where the URL remains the only source of a filter and nothing here changes.
const composedFilter = inject('composedFilter', null)
if (composedFilter) {
  watch(composedFilter, (f) => {
    if (!f) return
    fIso.value = String(f.iso || '').trim().toLowerCase()
    fCountry.value = String(f.country || '').trim().toUpperCase()
    fLabel.value = String(f.label || '').trim()
    fProvince.value = String(f.province || '').trim()
    // The links tab is the one that carries URLs; a filter is meaningless on the others.
    if (TABS.some((t) => t.id === 'links')) active.value = 'links'
  })
}

// Fetched at runtime — see the note in cities-internet/data-tables.vue. These two
// tables alone are 2.8MB of JSON; inlining them blocked first paint.
const cache = ref({})
const loading = ref(false)
const loadErr = ref(null)
async function ensure(file) {
  if (cache.value[file]) return
  loading.value = true; loadErr.value = null
  try {
    const r = await fetch(`${assetsBase.value}/tables/${file}.json`)
    if (!r.ok) throw new Error(`table not found (${r.status})`)
    cache.value = { ...cache.value, [file]: await r.json() }
  } catch (e) { loadErr.value = String(e.message || e) }
  finally { loading.value = false }
}
watch(current, (t) => t && ensure(t.file), { immediate: true })
const rawTable = computed(() => cache.value[current.value?.file] || null)

// Only the links table carries iso639_3/country_codes, so a filter is a NO-OP elsewhere
// rather than an empty table — switching tabs under an active filter must not look broken.
// Both keyed tables filter. The links table carries country_codes (the ISO3 set a
// LANGUAGE is spoken in); the gaps table is one row per people-group-IN-COUNTRY and
// carries iso3 directly. Filtering only the links table meant a country click could show
// you what a country HAS and never what it lacks — which is the half a mobiliser came for.
const FILTERABLE = new Set(['doxa', 'links', 'nothing', 'province'])
const table = computed(() => {
  const t = rawTable.value
  /**
   * ═══ THE COLUMN HEADINGS WERE TRANSLATED AND THE CELLS UNDER THEM WERE NOT ═══════════════
   *
   * "Type" is an ENUMERATED LABEL, not free data: every cell in it is one of eight fixed
   * values that the catalogue already translates into all eleven locales. Translating the
   * heading and leaving the column beneath it in English is the worst of both — it reads as
   * a translation that gave up halfway.
   *
   * DERIVED FROM THE CATALOGUE, NOT LISTED HERE. The map is built from EN_MESSAGES.gospel.res,
   * so a resource type added there is translated the moment it lands. A hand-written list of
   * the eight values is the same shape as the bug the surfaces gate exists for: it would be
   * one entry short the first time a ninth type appeared, and nothing would fail.
   *
   * ONLY the Type column, and only on an EXACT match. The Source column next to it holds
   * organisation names — Faith Comes By Hearing, eBible.org, Door43 — which are proper nouns
   * and stay as they are, the same decision already taken for "Open Bible Stories".
   */
  const resValues = new Map()
  for (const [key, english] of Object.entries(EN_MESSAGES.gospel?.res || {})) {
    if (typeof english !== 'string') continue
    const v = tr('gospel.res.' + key)
    if (v && v !== 'gospel.res.' + key && v !== english) resValues.set(english, v)
  }
  const localiseValues = (tbl, rows) => {
    const typed = (tbl.columns || []).filter((c) => c.field === 'type').map((c) => c.field)
    if (!typed.length || !resValues.size) return rows
    return rows.map((r) => {
      let out = r
      for (const f of typed) {
        const hit = resValues.get(r[f])
        if (hit) out = { ...out, [f]: hit }
      }
      return out
    })
  }
  /* ⚠ TWO PATHS, AND THE FIRST VERSION OF THIS FIX ONLY TOOK THE SECOND. The unfiltered table
     returns through localise() and the filtered one builds its own object; I added the title
     lookup to the filtered path and measured the bug on an UNFILTERED table, which would have
     shipped a fix for the state a reader is rarely in. One resolver, called from both. */
  const localTitle = (tbl) => {
    const id = current.value?.id
    const v = id ? tr('gospel.tableTitles.' + id) : ''
    return v && !v.startsWith('gospel.tableTitles.') ? v : tbl?.meta?.title
  }
  const localise = (tbl) => ({
    ...tbl,
    meta: { ...tbl.meta, title: localTitle(tbl) },
    columns: (tbl.columns || []).map((c) => {
      const k = 'gospel.columns.' + String(c.title || '')
      const v = tr(k)
      return v && v !== k ? { ...c, title: v } : c
    }),
    rows: localiseValues(tbl, tbl.rows || []),
  })
  if (!t || !hasFilter.value || !FILTERABLE.has(current.value?.id)) return t ? localise(t) : t
  const rows = (t.rows || []).filter((r) => {
    /* The province table has no language column, so it answers the province key alone. */
    if (fProvince.value) return fold(r.province) === fold(fProvince.value)
    if (fIso.value && String(r.iso639_3 || '').toLowerCase() !== fIso.value) return false
    if (!fCountry.value) return true
    // links: a language spoken in many countries. gaps: one row, one country.
    const set = r.country_codes != null
      ? String(r.country_codes).toUpperCase().split(' ')
      : [String(r.iso3 || '').toUpperCase()]
    return set.includes(fCountry.value)
  })
  /* THE TITLE TRAVELS WITH THE ROWS.
   *
   * Export three filtered views and you get three files called
   * gospel-resources-every-link-and-who-it-reaches.csv — DataTable names the download from
   * meta.title, and meta.title did not know about the filter. Measured: China exported 265
   * lines and Germany 7, both correct, both under the same name, so the second download
   * either overwrote the first or landed as "(1)". The rows were right and the file was
   * unidentifiable, which is the failure mode for the person this export exists for: someone
   * pulling a list per country to hand to a team.
   *
   * Naming it here rather than teaching DataTable a new prop keeps the decision this file
   * already made — that component has other consumers and none of them need this — and it
   * fixes the on-screen heading in the same move: it read "every link, and who it reaches"
   * over a table showing one country's. */
  /* ═══ AND THE TITLE ITSELF WAS NEVER LOCALISED ════════════════════════════════════════
   * Measured at ?lang=ar: the tabs render in Arabic and then the heading above the table reads
   * "Gospel Resources — every link, and who it reaches" in English, over English column headers.
   * The headers have had a lookup since cell E; the TITLE had none at all, so it came straight
   * out of the data file in every locale.
   *
   * Keyed by the tab's ID rather than by its English text, unlike the columns: a title is a
   * sentence, and keying 'gospel.tableTitles.Gospel Resources — every link, and who it reaches'
   * would break the day a builder rewords its own meta. The English stays the fallback, so this
   * renders exactly what it renders today until each key lands. */
  const base = localTitle(t)
  const title = base
    ? `${base} — ${fLabel.value || fProvince.value || fIso.value || fCountry.value}`
    : t.meta?.title
  /* ═══ COLUMN HEADERS ARE CHROME, BUT THEY LIVE IN THE DATA FILE ══════════════════════
   * A reader navigates a table by its headers, so they are UI strings by any fair reading of
   * cell E. They are also the CSV's field names, and a consumer feeding that CSV into their
   * own system wants those stable and English. Translating the data file would serve the
   * reader and break the consumer.
   * So the header is localised HERE, at render, and I claimed the export would keep the data
   * file's English field names. MEASURED, THAT WAS WRONG: Tabulator exports the column titles
   * it was given, so a Russian reader's CSV heads "Народ","Страна","Регион". Checked rather
   * than assumed, after asserting the opposite in a commit message.
   * Left translated, deliberately. This map is a gift for people to use, and someone who
   * exports what is on their screen should get what was on their screen. The stable contract
   * for a machine is the data file itself at data/tables/, which is untouched and English.
   * If a consumer ever needs English headers from the UI export, that is a switch, not a
   * silent default. */
  const columns = (t.columns || []).map((c) => {
    const k = 'gospel.columns.' + String(c.title || '')
    const v = tr(k)
    return v && v !== k ? { ...c, title: v } : c
  })
  /* THE FILTERED VIEW IS A SECOND PATH and it has to localise too. It builds its own columns
     and rows instead of calling localise(), so a fix applied only there leaks the moment a
     pin or a country is clicked — the state a mobiliser is actually in. */
  return { ...t, meta: { ...t.meta, title }, columns, rows: localiseValues(t, rows) }
})
const filterCount = computed(() => (table.value?.rows || []).length)
const totalCount = computed(() => (rawTable.value?.rows || []).length)

// Computed from the growth table ONCE it has loaded — the hero is hidden until
// then rather than rendering zeros, which would read as "no gap" (the opposite of
// the truth) while the fetch is still in flight.
const gap = computed(() => {
  const g0 = cache.value['gospel-access-vs-growth']
  if (!g0) return null
  const r = g0.rows || []
  const g = r.filter((x) => x.growing_without_resource)
  return {
    groups: g.length,
    population: g.reduce((n, x) => n + (x.population || 0), 0),
    deathsDay: Math.round(g.reduce((n, x) => n + (x.est_deaths_per_day || 0), 0)),
  }
})
/* ═══ NUMBER FORMAT IS HELD FLEET-WIDE ════════════════════════════════════════════════
 * This briefly formatted with the locale i18n resolved, which is almost certainly the right
 * answer — but it decides number format for THIS map alone, and the decision belongs to every
 * map at once or none. Reverted on that ground, not because the finding was wrong.
 *
 * THE FINDING, kept here so it is not re-derived: toLocaleString() with no argument formats for
 * the JS RUNTIME's locale, i.e. the browser's, which has nothing to do with the locale this
 * plugin was asked to render in. The same page therefore shows different numbers to different
 * readers — Hindi grouping in lakhs, French and Russian spaces — depending on their browser and
 * not on the locale the page is in. Pinning numberingSystem to latn would change the DIGITS for
 * region tags only (ar-EG resolves to arab, fa to arabext); the eleven tags this bundle ships,
 * plain "ar" included, already resolve to latn.
 */
const fmt = (n) => (Number(n) || 0).toLocaleString()

useShadowStyles(
  // ★ STANDALONE THIS NEEDS A HOST; COMPOSED IT MUST NOT BE CLAMPED. Two facts make one rule safe:
  //  1. STANDALONE (data-tables.meta.json) this mounts as its own custom element, so :host applies and
  //     .gt — position:absolute;inset:0 — resolves against it. Without a :host rule the element is
  //     inline with no height and .gt escapes to whatever the PARTNER page has positioned, the same
  //     defect measured in cities-internet (16,355px below a 420px box) and connectivity-map.
  //  2. COMPOSED, gospel-dashboard renders <DataTables/> as an INLINE Vue component, not a custom
  //     element. It has no shadow host of its own there, so :host matches NOTHING and cannot reach it;
  //     gospel-dashboard.vue:81 keeps its '.gd-tables .gt{position:static;…}' override, which is what
  //     lets the stacked section take its natural height and the PAGE scroll. That override recorded a
  //     measured failure (docScrollHeight 900 = clientHeight 900, a wheel gesture moving 0px) and must
  //     keep working.
  // min-height, NOT height: with no height at all, .gt's absolute inset:0 gives the table 0px in an
  // AUTO-height box — it would stop escaping and become invisible instead, which is not a fix. A floor
  // gives an auto host something to grow from; a definite-height slot still decides via height:100%.
  ':host{display:block;position:relative;width:100%;height:100%;min-height:320px}' +
  '.gt{position:absolute;inset:0;overflow-y:auto;padding:18px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.gt.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.gt-h{margin:0 0 4px;font-size:18px;font-weight:700}' +
  '.gt-sub{margin:0 0 12px;font-size:12.5px;opacity:.72;line-height:1.5}' +
  '.gt-hero{margin:0 0 14px;padding:12px 14px;border-radius:9px;font-size:12.5px;line-height:1.6;' +
  'background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.18)}' +
  '.is-dark .gt-hero{background:rgba(220,38,38,.12);border-color:rgba(248,113,113,.25)}' +
  '.gt-hero b{font-weight:800;font-variant-numeric:tabular-nums}' +
  '.gt-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:8px 12px;border:1px solid #d1d4cd;border-inline-start:3px solid #92b195;border-radius:8px;background:#f3f3f1;color:#3b463d;font-size:13px}' +
  '.gt-clear{border:1px solid #d1d4cd;background:#fff;color:#3b463d;font:600 12px inherit;padding:5px 11px;border-radius:7px;cursor:pointer;min-height:32px}' +
  '.gt-clear:hover{background:#f3f3f1}' +
  '.gt-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}' +
  '.gt-tab{font:600 12px inherit;padding:7px 14px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit}' +
  /* HOUSE ACCENT, NOT TAILWIND EMERALD. #10b981 is not in this product's palette
     (#f3f3f1 #fff #3b463d #92b195 #d1d4cd #6d766e), and the three gospel leaves did not
     even agree with each other: the map's active mode was near-black while the list and
     the tables were emerald, so the same control looked like two different controls
     depending on which tab you were on. Light uses the house dark on white text, dark uses
     the house sage on near-black. MEASURED contrast: 9.86:1 and 7.89:1, both well past AA
     for 12px bold. Sage with #3b463d text was the obvious pairing and was rejected — 4.20:1,
     under the 4.5 this size needs. */
  '.gt-tab.on{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.is-dark .gt-tab.on{background:#92b195;border-color:#92b195;color:#0f1419}' +
  '.gt-load{padding:22px;text-align:center;font-size:12.5px;opacity:.6}' +
  '.gt-err{padding:11px 13px;border-radius:8px;background:rgba(220,38,38,.10);color:#a12020;font-size:12.5px}' +
  '.gt-n{font-size:10.5px;opacity:.6;margin-inline-start:5px;font-variant-numeric:tabular-nums}',
  'doxa-gospel-tables',
)
</script>

<template>
  <!-- The blanket dir="ltr" is gone: this profile's chrome is translated now, so Arabic gets
       the RTL layout it should have. What stays LTR is each block of English prose, marked
       where it sits — the same split the map profile already uses.
       ★ CORRECTION, measured 2026-09-25. The previous commit recorded "in RTL the leftmost
       data column clips against the edge" as known debt. That was wrong, and it was wrong in
       the way that wastes someone else's afternoon: I read a screenshot instead of measuring.
       Counting cells that fall outside the table holder, en and ar are IDENTICAL — 13 of 20
       columns off-screen in both, scrollWidth 3146 against clientWidth 1400 either way. A
       twenty-column table is simply wider than 1,400px, and RTL mirrors which edge the
       overflow sits on. There is no RTL clipping bug to chase. Whether twenty columns is the
       right design for a 1,400px screen is a real question, but it is a design question and
       it is the same question in English. -->
  <div class="gt" :class="{ 'is-dark': isDark }">
    <h2 class="gt-h">{{ tr('gospel.tables.title') }}</h2>
    <p class="gt-sub" dir="ltr">
      <!-- Named three media while the tables below carry seven. Kept short by naming the
           question rather than enumerating a list that will go stale again. -->
      Which people groups can reach the gospel in their own language — Scripture to read or
      hear, film, Bible video, Bible stories, a gospel presentation or discipleship training
      — and whether that access is keeping pace with population growth.
    </p>

      <div v-if="gap" class="gt-hero">
        <!-- ONE KEY, NAMED SLOTS: four fragments around three counts, two bold words and a bdi
             island became one message a translator can reorder. See gapHero in the script. -->
        <component :is="gapHero" />
      <br><bdi dir="ltr">The estimate applies a national death rate to a sub-population; it is
      order-of-magnitude, not a count.</bdi>
    </div>

    <div class="gt-tabs">
      <button v-for="t in TABS" :key="t.id" type="button"
        class="gt-tab" :class="{ on: active === t.id }" @click="active = t.id">
        {{ tabLabel(t) }}<span class="gt-n" v-if="cache[t.file]">{{ (cache[t.file].rows || []).length.toLocaleString() }}</span>
      </button>
    </div>

    <div v-if="hasFilter" class="gt-filter">
      <span v-if="FILTERABLE.has(current.id)">
        {{ tr('gospel.tables.showing') }} <b>{{ fmt(filterCount) }}</b> {{ tr('gospel.tables.of') }} {{ fmt(totalCount) }}
        {{ tr('gospel.tables.for') }} <b>{{ fLabel || fProvince || fIso || fCountry }}</b>
        <!-- The explanation stays English and declares its direction, like the map's prose:
             it is the caveat that says an empty result is not proof of absence. -->
        <template v-if="!filterCount"><span dir="ltr"> — nothing found for this selection in the pools checked, which is not proof that nothing exists.</span></template>
      </span>
      <span v-else>{{ tr('gospel.tables.filteredTo') }} <b>{{ fLabel || fProvince || fIso || fCountry }}</b><span dir="ltr"> — this tab is not filtered; only the keyed tables carry a language or country key.</span></span>
      <!-- "Show all" WHAT. Stacked under the map in the dashboard there are three controls
           with this exact label — two in the map's group lists and this one — and they do
           different things. A reader cannot tell which clears the table filter, and neither
           could a probe: the first attempt at verifying this clicked one of the map's and
           reported the filter as stuck when it was not. Naming the noun costs one word. -->
      <button type="button" class="gt-clear" @click="clearFilter">{{ tr('gospel.tables.showAll') }}</button>
    </div>

    <div v-if="loadErr" class="gt-err">{{ loadErr }}</div>
    <div v-else-if="!table" class="gt-load">{{ tr('gospel.sheet.loadingTable', { table: tabLabel(current) }) }}</div>
    <DataTable
      v-else
      :key="current.id + ':' + fIso + ':' + fCountry + ':' + fProvince"
      :table="table"
      :assets-base="assetsBase"
      :is-dark="isDark"
      height="600px"
    />
  </div>
</template>
