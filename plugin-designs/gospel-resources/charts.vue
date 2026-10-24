<script setup>
/**
 * charts.vue — GOSPEL RESOURCES, CHARTED BY LANGUAGE (ISO 639-3).
 *
 * @description The gap measured by LANGUAGE (ISO 639-3) rather than by people group, because one translation serves every group that speaks it, so counting by group overstates how much work remains.
 *
 * The list view answers "what does this people group have". These charts answer the
 * question one level up: WHERE IS THE GAP, BY LANGUAGE — because a translation is
 * made once per language and then serves every group that speaks it. 2,106 people
 * groups collapse to 862 languages, and that collapse is the unit the work is
 * actually done in.
 *
 * ═══ THE JOIN IS ON THE CODE, NEVER THE NAME ════════════════════════════════
 * Rows are grouped by EXACT `iso639_3`. Language NAMES are not unique, not stable
 * across scripts, and matching on them is precisely where scripture gets
 * mis-attributed to a language that does not have it. Verified before building:
 * across all 2,106 rows, no ISO code carries two different language names and no code
 * carries conflicting resource flags — so the collapse is lossless, not a guess.
 *
 * ═══ WHAT A BAR MEANS, AND WHAT IT MUST NEVER BE READ AS ════════════════════
 * A bar counts what was FOUND IN THE POOLS CHECKED — eBible.org and PNG.Bible (text
 * Scripture), Arclight/JESUS Film (film), Door43/unfoldingWord (stories and Scripture)
 * Faith Comes By Hearing (audio Scripture), Scripture Earth (minority-language Scripture)
 * and Global Recordings Network (gospel audio). It is NEVER proof of absence. Three pools
 * remain unchecked — API.Bible, DBL, progress.bible and YouVersion. GRN is not among them
 * any more for the gap: that sweep finished, at the crawl delay they ask for.
 *
 * Three consequences the charts are built around:
 *   1. A pool nobody has queried is drawn as a HATCHED "not measured" row, never a zero
 *      bar, because a zero would read as "none exists" when the truth is "nobody looked".
 *      AUDIO used to be that row and is now a real count: hasField() decides this from
 *      the data itself, so the bar appeared when FCBH data arrived without anyone
 *      switching it on, and would disappear again if that source went away.
 *   2. The zero-resource languages are labelled "no resource FOUND in the pools
 *      checked", never "no resource".
 *   3. 33 languages carry a code OUTSIDE the ISO 639-3 registry (mostly private-use
 *      q* sign-language codes). No pool can index those codes, so their status is
 *      UNRESOLVED BY JOIN — structurally false, not measured. They are drawn in a
 *      distinct colour with that meaning stated, never merged into the measured bar.
 *
 * SAFETY: this is resource-availability data only — a library catalogue, not a map of
 * people. No church, believer, fellowship or meeting-point data is here and none may
 * be added. That boundary is a standing design ruling (2026-08-01).
 *
 * DATA: fetched at runtime from assets/tables/ (people-group-resources.json is 1.2MB;
 * inlining it into the IIFE would block first paint for every profile in the bundle).
 */
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { sentenceParts, strong, ltr, keep } from '@map/composables/useSentence.js'
import { h } from 'vue'
import { computed, inject, ref, watch } from 'vue'
import BarChart from '@map/components/charts/BarChart.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'

/* Guarded like every other useI18n() in this bundle — the host may never have installed it,
   and the shipped English catalogue is the fallback rather than a broken key. */
/* ★ NUMBERS ARRIVE AS PARAMETERS, NEVER CONCATENATED. The subtitles carry a count, and a
   sentence built by gluing a number between two fragments cannot be translated — word order
   differs and several of these locales put the number where English does not. The catalogue
   holds the whole sentence with a {n} placeholder instead.
   THE FALLBACK HAS TO INTERPOLATE TOO. Without it a host that never installed i18n would render
   the placeholder literally — "Across all {n} languages" on screen — which is worse than the
   English sentence the fallback exists to protect. */
// C4: the guard is library/composables/useOptionalT.js now. enLookup STAYS as the fallback, passed
// in, so a bare host renders the same ENGLISH it always did -- routing this to the catalogue default
// would make a bare host honour ?lang=ar, which is the plugin owner's call and not this migration's.
// C4 wave 3a, the plugin owner's call (2026-09-26): take the LOCALE-HONOURING fallback rather than
// enLookup's English. A partner host that never installed vue-i18n now gets the reader's language,
// with English as the last resort. tStatic resolves 'gospel.<key>' against the same catalogue.
const tr = useOptionalT('gospel')

// ★ THE HERO SENTENCE, ONE KEY. Each COUNT arrives already formatted and already pluralised from its
// own key: vue-i18n resolves one plural form per key, so a sentence carrying three counts cannot
// pluralise them from its own message. keep() hands the placeholders back to t() intact — without it
// the lookup BLANKS them and the sentence renders with no values at all, in every locale at once.
const heroSentence = computed(() => {
  const msg = tr('gospel.charts.noneHero', keep('nNone', 'nLang', 'noScripture', 'popNone'))
  return h('span', sentenceParts(msg, {
    nNone: strong(fmt(nNone.value)),
    nLang: fmt(nLang.value),
    // The phrase is quoted from English sources and must not reverse inside an Arabic sentence, so it
    // keeps its own dir. Passed in as a VALUE: a translator never has to reproduce the markup.
    noScripture: ltr(tr('gospel.charts.noneHeroFound', 'no scripture and no film found in the pools checked'), true),
    popNone: strong(fmt(popNone.value)),
  }))
})


const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)

// ═══ WHERE THE TABLES LIVE ══════════════════════════════════════════════════
// The embedding page MAY pass assetsBase; the generated standalone profile page does
// NOT, and the bare './assets' default resolves against the PROFILE folder
// (…/gospel-resources/charts/assets) where nothing is served — the tree keeps assets
// one level up, at the BUNDLE root. Measured 2026-08-02: the shipped data-tables page
// 404s on every table for exactly this reason, so a chart that assumed './assets'
// would render an empty axis on the one surface that matters.
// So: try the explicit config first, then the base DERIVED from the bundle script's
// own URL (true wherever the folder is dropped), then the historical defaults. The
// first base that actually returns a table wins and is reused.
function derivedBase() {
  try {
    const src = Array.from(document.querySelectorAll('script[src]'))
      .map((el) => el.getAttribute('src') || '')
      .find((s) => /gospel-resources\.js(\?|#|$)/.test(s))
    if (!src) return null
    return `${new URL(src, document.baseURI).href.replace(/\/[^/]*$/, '')}/assets`
  } catch (_) { return null }
}
const candidates = computed(() => [
  profileConfig.value?.assetsBase,
  derivedBase(),
  '../assets',
  './assets',
].filter(Boolean).map((s) => String(s).replace(/\/+$/, ''))
  .filter((s, i, a) => a.indexOf(s) === i))

const resolvedBase = ref(null)
const tables = ref({})
const loading = ref(true)
const loadErr = ref(null)

async function fetchTable(file) {
  const tries = resolvedBase.value ? [resolvedBase.value] : candidates.value
  let lastStatus = null
  for (const base of tries) {
    try {
      const r = await fetch(`${base}/tables/${file}.json`)
      if (!r.ok) { lastStatus = r.status; continue }
      resolvedBase.value = base
      return await r.json()
    } catch (_) { /* try the next base */ }
  }
  throw new Error(`${file}.json not reachable from ${tries.join(', ')}${lastStatus ? ` (last status ${lastStatus})` : ''}`)
}

async function load() {
  loading.value = true; loadErr.value = null
  try {
    // people-group-pins is the index the MAP draws from: 5,447 language codes against the
    // 862 in people-group-resources. Charting the smaller table meant these charts
    // described a sixth of the corpus the map beside them shows — the same defect the
    // country sheet had at tick 13, where it listed 36 groups for Indonesia against 669 pins.
    const [pins, byCountry] = await Promise.all([
      fetchTable('people-group-pins'),
      fetchTable('languages-by-country'),
    ])
    tables.value = { pins, byCountry }
  } catch (e) { loadErr.value = String(e.message || e) }
  finally { loading.value = false }
}
watch(profileConfig, load, { immediate: true })

// ═══ 2,106 PEOPLE GROUPS → 862 LANGUAGES ════════════════════════════════════
// Boolean flags accumulate with OR (a resource found for ANY group speaking the
// language IS found for the language); `none` accumulates with AND for the mirror
// reason. In this corpus the flags are already consistent per code, so this changes
// nothing today — it just cannot go wrong if a later rebuild makes them disagree.
const splitCountries = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)

const languages = computed(() => {
  // One entry per LANGUAGE, built from the pin index: codes[] carries what exists, pins[]
  // carries who speaks it and where. Same shape as before so every chart below is unchanged.
  const d = tables.value.pins
  if (!d || !d.codes) return []
  const { codes, pins } = d
  const by = new Map()
  for (const [, , , iso3, code, pop, tier] of pins) {
    if (!code) continue
    let e = by.get(code)
    if (!e) {
      const c = codes[code] || {}
      const obs = (c.d || []).some((x) => /^Open Bible Stories/.test(x.s || ''))
      const scope = c.ss || ''
      e = {
        iso: code,
        name: c.l || 'unknown',
        groups: 0,
        population: 0,
        // TEXT Scripture from any checked pool. While this read only c.s the bar counted
        // 1,237 languages when 2,003 have a text Scripture — Faith Comes By Hearing
        // publishes Bible text too, and the list profile had already been corrected for
        // exactly this. A chart that undercounts by 766 languages is not a smaller truth.
        scripture: !!c.s || !!(c.au && /text/.test(c.au.m || '')),
        fullBible: scope === 'Full Bible',
        // "New Testament" and "Portions of both Testaments" both contain NT books; a
        // Full Bible does too. Counting only the exact NT label would undercount.
        nt: scope === 'Full Bible' || /New Testament|both Testaments/.test(scope),
        film: !!c.f,
        jesusFilm: !!c.f,
        obs,
        // Audio is now MEASURED, from Faith Comes By Hearing, so this is a real count and
        // no longer an "unknown". GRN is now searched too, through their 5fish site, and
        // counted separately as gospel audio rather than folded in here.
        audioKnown: !!(c.au && /audio/.test(c.au.m || '')),
        // THREE MEDIA THE CHART DID NOT DRAW AT ALL. Bible video reaches 1,666 languages —
        // more than Scripture does — and was simply absent, so the picture a reader took
        // away was missing its second-largest bar.
        bibleVideo: !!(c.bv || (c.au && /video/.test(c.au.m || ''))),
        tract: !!c.gp,
        training: !!c.z,
        // READ THE TIER, DO NOT RECOMPUTE IT. This line used to list the resource fields by
        // hand, and it drifted every single time a source was added: first 7 codes drawn as
        // having nothing while the map showed them a link, then 28 when Scripture Earth
        // landed. The pin index already decides this, one place, and a gate guards it — so
        // the chart asks rather than deciding again. A new source now reaches this view for
        // free instead of silently leaving it a source behind.
        none: tier === 0,
        unmatchable: !code,
        countries: new Set(),
      }
      by.set(code, e)
    }
    e.groups += 1
    e.population += Number(pop) || 0
    if (iso3) e.countries.add(iso3)
  }
  return Array.from(by.values())
})

const meta = computed(() => tables.value.pins?.meta || {})
// The pin index records per code which pools were searched, so this is derivable rather
// than unknown. It read meta.sources from the old table, which the pin index does not
// carry, and rendered "Pools CHECKED: unknown" over a corpus where we know exactly what
// was searched — the same understatement the gaps table carried until tick 30.
// SIGN LANGUAGES CARRY A DIFFERENT PROVENANCE, and unioning the two vocabularies produced
// nonsense: "arclight (14 sign languages, all captured), fcbh (none), ebible, arclight,
// door43, fcbh" — the sign-language sentence spliced into the general list, with arclight
// and fcbh appearing twice. The two are different claims about different media and are now
// reported separately.
const poolSets = computed(() => {
  const codes = tables.value.pins?.codes || {}
  const ck = new Set(), un = new Set(), sck = new Set(), sun = new Set()
  for (const v of Object.values(codes)) {
    const isSign = v.sg === 1
    for (const x of String(v.ck || '').split(',')) if (x.trim()) (isSign ? sck : ck).add(x.trim())
    for (const x of String(v.un || '').split(',')) if (x.trim()) (isSign ? sun : un).add(x.trim())
  }
  return { ck: [...ck], un: [...un], sck: [...sck], sun: [...sun] }
})
// A POOL CANNOT BE IN BOTH LISTS. GRN was swept a batch at a time, so some codes carried "grn"
// as checked and the rest carry "grn (not yet swept)" as unchecked — and unioning across the
// corpus printed it on BOTH sides, which reads as a flat contradiction to anyone who notices.
// It is neither fully checked nor untouched, and the honest rendering says exactly that once.
const bare = (x) => x.replace(/\s*\(.*\)\s*$/, '')
const partial = computed(() => {
  const ck = new Set(poolSets.value.ck.map(bare))
  return poolSets.value.un.map(bare).filter((x) => ck.has(x))
})
/* ⚠ "STILL RUNNING" WAS TRUE AND MISLEADING, WHICH IS THE WORSE KIND OF SENTENCE. It is measured
   by check:no-stale-sweep-claim, which SKIPS rather than fails because a code really is undecided —
   and the number it skips on is ONE code out of 1,184. A reader who sees "the sweep is still
   running" discounts the whole audio column on the strength of 0.08%. So the proportion is stated,
   from counts the pin index now publishes and the gate counts the same way; and when the last code
   is decided the pool stops being described as partial at all, which is the behaviour the gate
   then demands rather than something anyone has to remember. */
const grnLeft = computed(() => {
  const c = tables.value.pins?.counts || {}
  return { pending: c.grnPending ?? null, of: c.grnGapCodes ?? null }
})
const checkedPools = computed(() => {
  const { pending, of } = grnLeft.value
  /* Nothing left to check: it is simply a checked pool, however the code fields still read. */
  const part = new Set(pending === 0 ? [] : partial.value)
  const full = poolSets.value.ck.filter((x) => !part.has(bare(x)))
  const partTxt = [...part].map((x) => (pending && of
    ? `${x} (partly — ${pending.toLocaleString()} of ${of.toLocaleString()} still to check)`
    : `${x} (partly)`))
  return [...full, ...partTxt].join(', ') || 'unknown'
})
const uncheckedPools = computed(() => {
  const part = new Set(partial.value)
  return poolSets.value.un.filter((x) => !part.has(bare(x))).join(', ') || 'none'
})

// The caveat block every chart carries — the pools, and what a missing value means.
const poolCaveats = computed(() => [
  `Pools CHECKED: ${checkedPools.value}. Pools NOT checked: ${uncheckedPools.value}.`,
  `For SIGN languages the pools differ, because text and audio do not reach a Deaf group: checked ${poolSets.value.sck.join(', ') || 'none'}; not checked ${poolSets.value.sun.join(', ') || 'none'}.`,
  meta.value.absence_meaning
    || 'A resource not found means NOT FOUND in the pools checked — never proof that none exists.',
])

const nLang = computed(() => languages.value.length)
const nGroups = computed(() => (tables.value.pins?.pins || []).length)
const count = (fn) => languages.value.filter(fn).length

// ═══ A FIELD THAT IS NOT IN THE TABLE IS NOT A ZERO ═════════════════════════
// MEASURED 2026-08-02: the copy of people-group-resources.json served from the
// bundle tree predates `has_open_bible_stories`, while the copy under plugin-designs/
// carries it for 38 languages. Counting a missing field gives 0, and a 0 bar reads as
// "no language anywhere has this" — a fabricated absence, from a build artifact being
// a version behind. So a metric whose FIELD is absent renders as not-measured,
// exactly like a pool that was never queried.
const hasField = (f) => {
  // Same rule against the pin index, which stores what exists on codes[] rather than as
  // table columns: a metric is MEASURED only if at least one code carries the field. This
  // rule is why the audio bar appears on its own now that FCBH data exists — nothing here
  // had to be switched on by hand, and nothing has to be switched off if that source ever
  // goes away. A pool nobody has looked in still renders as not-measured, never as a zero.
  const codes = tables.value.pins?.codes
  if (!codes) return false
  const key = f === 'has_audio' ? 'au' : f === 'has_open_bible_stories' ? 'd' : f
  for (const v of Object.values(codes)) if (v && key in v) return true
  return false
}

const C = {
  scripture: '#0ea5e9',
  film: '#8b5cf6',
  found: '#10b981',
  none: '#ef4444',
  unresolved: '#f59e0b',
}

// ── CHART 1: which resource types were found, across all languages ───────────
const coverage = computed(() => {
  if (!nLang.value) return []
  return [
    { label: tr('gospel.charts.scriptureAny'), value: count((l) => l.scripture), color: C.scripture,
      note: 'a published text translation — eBible.org, PNG.Bible or Faith Comes By Hearing' },
    { label: '· ' + tr('gospel.charts.fullBible'), value: count((l) => l.fullBible), color: C.scripture },
    { label: '· ' + tr('gospel.charts.newTestament'), value: count((l) => l.nt), color: C.scripture },
    { label: tr('gospel.charts.filmAny'), value: count((l) => l.film), color: C.film,
      note: 'Arclight / JESUS Film Project' },
    { label: '· ' + tr('gospel.res.jesusFilm'), value: count((l) => l.jesusFilm), color: C.film },
    { label: tr('gospel.res.bibleStories'), value: count((l) => l.obs), color: C.film,
      unknown: !hasField('has_open_bible_stories'),
      unknownText: 'not measured — this build of the table has no Open Bible Stories field' },
    // NOT a zero bar. Zero known values across every language means the pool was never
    // queried, and the chart has to say that rather than draw an empty bar.
    { label: tr('gospel.res.audio'), unknown: !hasField('has_audio') || count((l) => l.audioKnown) === 0,
      value: count((l) => l.audioKnown), color: C.found,
      unknownText: `unknown for all ${fmt(nLang.value)} — no audio pool has been searched` },
      // The GRN caveat moved to a note: audio IS measured now, and saying it is unknown
      // would be the stale-caveat mistake this bundle keeps finding.
    { label: tr('gospel.res.bibleVideo'), value: count((l) => l.bibleVideo), color: C.film,
      note: 'Faith Comes By Hearing — Bible narrative video, NOT the JESUS Film' },
    { label: tr('gospel.res.gospelPresentation'), value: count((l) => l.tract), color: C.found,
      note: 'Cru / GodTools tracts on knowgod.com' },
    { label: tr('gospel.res.training'), value: count((l) => l.training), color: C.found,
      note: 'Zume Training' },
    { label: tr('gospel.charts.nothingInPools'), value: count((l) => l.none), color: C.none,
      note: 'not proven absent' },
  ]
})

// ── CHART 2: the largest populations with nothing found ─────────────────────
const TOP_N = 15
const topNone = computed(() => languages.value
  .filter((l) => l.none)
  .sort((a, b) => b.population - a.population)
  .slice(0, TOP_N)
  .map((l) => ({
    label: `${l.name} (${l.iso})`,
    value: l.population,
    color: l.unmatchable ? C.unresolved : C.none,
    note: `${l.groups} people group${l.groups === 1 ? '' : 's'}`
      + (l.unmatchable ? ' · code not indexable by any pool — status unresolved' : ''),
    meta: l,
  })))
const nNone = computed(() => count((l) => l.none))
// A per-LANGUAGE chart cannot count a group that has no language code, so these totals
// leave one out. Named rather than left as a silent 2.33M discrepancy against the gaps
// table, which is keyed per people group and does include it.
const noCodePeople = computed(() => {
  const d = tables.value.pins
  if (!d) return 0
  return (d.pins || []).reduce((n, r) => (r[4] ? n : n + (Number(r[5]) || 0)), 0)
})
const noCodeGroups = computed(() => {
  const d = tables.value.pins
  if (!d) return 0
  return (d.pins || []).reduce((n, r) => (r[4] ? n : n + 1), 0)
})

const popNone = computed(() => languages.value.filter((l) => l.none)
  .reduce((n, l) => n + l.population, 0))

// ── CHART 3: countries by how many of their languages have nothing found ────
// Derived from the resource table's own `countries` column rather than
// languages-by-country.json: that file is capped at the TOP 12 languages per country
// (21 countries sit exactly at 12), so ranking countries by its row counts would
// mostly be ranking the cap. A language spanning several countries counts once in
// each — this is "languages present in this country", not a partition of 862.
const byCountry = computed(() => {
  const m = new Map()
  for (const l of languages.value) {
    for (const c of l.countries) {
      let e = m.get(c)
      if (!e) { e = { country: c, total: 0, none: 0 }; m.set(c, e) }
      e.total += 1
      if (l.none) e.none += 1
    }
  }
  return Array.from(m.values())
    .sort((a, b) => b.none - a.none || b.total - a.total)
    .slice(0, TOP_N)
    .map((e) => ({
      label: e.country,
      segments: [
        { label: tr('gospel.legend.tier0'), value: e.none, color: C.none },
        { label: tr('gospel.charts.aResourceFound'), value: e.total - e.none, color: C.found },
      ],
      note: `${e.none} of ${e.total} languages with nothing found in the pools checked`,
      meta: e,
    }))
})

/* COMPUTED, NOT A CONST. These labels come from the catalogue now, and a plain array is
   evaluated once at setup — the tab strip would keep whichever language the leaf first
   rendered in and never follow a locale change. The legend arrays in the template are
   re-evaluated on render, so only this one had to move. */
const TABS = computed(() => [
  { id: 'coverage', label: tr('gospel.charts.tabCoverage') },
  { id: 'gap', label: tr('gospel.charts.tabGap') },
  { id: 'countries', label: tr('gospel.tabs.countries') },
])
const active = ref('coverage')

// Clicking a bar is the drill-down seam: today it surfaces the row's own record, so a
// number on screen can always be traced back to the language or country it came from.
const picked = ref(null)
const onPick = (row) => { picked.value = row?.meta ? row : null }

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
  '.gc{position:absolute;inset:0;overflow-y:auto;padding:18px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.gc.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.gc-h{margin:0 0 4px;font-size:18px;font-weight:700}' +
  '.gc-sub{margin:0 0 12px;font-size:12.5px;opacity:.72;line-height:1.5}' +
  '.gc-hero{margin:0 0 14px;padding:12px 14px;border-radius:9px;font-size:12.5px;line-height:1.6;' +
  'background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.18)}' +
  '.is-dark .gc-hero{background:rgba(220,38,38,.12);border-color:rgba(248,113,113,.25)}' +
  '.gc-hero b{font-weight:800;font-variant-numeric:tabular-nums}' +
  '.gc-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}' +
  '.gc-tab{font:600 12px inherit;padding:7px 14px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit}' +
  '.is-dark .gc-tab{border-color:rgba(255,255,255,.18)}' +
  /* The house accent, matching the other three leaves — see resources-list for the measured
     contrast. The chart COLOURS below are a separate question and deliberately untouched:
     they encode meaning (scripture / film / found / nothing / unresolved) and must stay
     distinguishable from one another, which is a different constraint from matching a
     brand palette. Changing them is a judgement about legibility, not tidiness. */
  '.gc-tab.on{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.is-dark .gc-tab.on{background:#92b195;border-color:#92b195;color:#0f1419}' +
  '.gc-card{padding:16px 16px 14px;border-radius:11px;background:#fff;' +
  'border:1px solid rgba(0,0,0,.08)}' +
  '.is-dark .gc-card{background:#122019;border-color:rgba(255,255,255,.09)}' +
  '.gc-load{padding:22px;text-align:center;font-size:12.5px;opacity:.6}' +
  '.gc-err{padding:11px 13px;border-radius:8px;background:rgba(220,38,38,.10);color:#a12020;font-size:12.5px}' +
  '.gc-pick{margin-top:12px;padding:11px 13px;border-radius:9px;font-size:12px;line-height:1.6;' +
  'background:rgba(16,185,129,.09);border:1px solid rgba(16,185,129,.22)}' +
  '.gc-pick b{font-weight:700}' +
  '.gc-pick button{float:right;font:600 11px inherit;padding:4px 10px;border-radius:6px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit}',
  'doxa-gospel-charts',
)
</script>

<template>
  <div class="gc" :class="{ 'is-dark': isDark }">
    <h2 class="gc-h">{{ tr('gospel.pages.chartsTitle') }}</h2>
    <p class="gc-sub" dir="ltr">
      {{ fmt(nGroups) }} people groups collapse to {{ fmt(nLang) }} languages, joined on exact
      ISO 639-3 codes. A translation is made once per language and then serves every
      group that speaks it — so the language is the unit of the gap.
    </p>

      <!-- ONE KEY, NAMED SLOTS. This was six fragments concatenated around three counts and a bdi
           island ("of", "languages have", "the languages of", "people."). Arabic does not put those
           clauses in that order, so translating the fragments gives Arabic words in English order:
           grammatically broken, and worse than leaving it English because it looks translated. The
           sentence is now ONE message whose named placeholders a translator can reorder freely, with
           the bold counts and the ltr island passed in as values rather than written into the catalogue. -->
      <div v-if="nLang" class="gc-hero"><component :is="heroSentence" />
      <template v-if="noCodeGroups">
        <br><small><bdi dir="ltr">Counted BY LANGUAGE, so {{ fmt(noCodeGroups) }} people group{{ noCodeGroups === 1 ? '' : 's' }}
        with no ISO 639-3 code in the source — {{ fmt(noCodePeople) }} people — cannot appear here.
        The "Where Nothing Was Found" table is keyed per people group and does include them.</bdi></small>
      </template>
      <!-- This said "four resource pools, including all audio, were never queried" until
           Faith Comes By Hearing was added, then again when GRN was reached through 5fish.
           A stale caveat misleads exactly as much as a stale number. -->
      <br><bdi dir="ltr">Not found is not the same as not existing. Audio has been searched at Faith Comes By
      Hearing and at Global Recordings Network, the latter swept for every language in the gap
      at the ten-second crawl delay they ask for. api.bible, YouVersion, the Digital
      Bible Library and progress.bible all need credentials this build does not have.</bdi>
    </div>

    <div class="gc-tabs">
      <button v-for="t in TABS" :key="t.id" type="button"
        class="gc-tab" :class="{ on: active === t.id }" @click="active = t.id; picked = null">
        {{ t.label }}
      </button>
    </div>

    <div v-if="loadErr" class="gc-err">{{ loadErr }}</div>
    <div v-else-if="loading || !nLang" class="gc-load">{{ tr('gospel.pages.loadingTables') }}</div>

    <div v-else class="gc-card">
      <BarChart
        v-if="active === 'coverage'"
        :series="coverage"
        :is-dark="isDark"
        :title="tr('gospel.charts.c1Title')"
        :subtitle="tr('gospel.charts.c1Sub', { n: fmt(nLang) })"
        :unit="tr('gospel.charts.c1Unit')"
        :max="nLang"
        :legend="[
          { label: tr('gospel.charts.keyScripture'), color: C.scripture },
          { label: tr('gospel.charts.keyFilmStories'), color: C.film },
          // Audio, gospel presentations and training are drawn in this green and the legend
          // never named it, so three of the eleven bars had no key at all.
          { label: tr('gospel.charts.keyAudioEtc'), color: C.found },
          { label: tr('gospel.legend.tier0'), color: C.none },
        ]"
        :caveats="poolCaveats"
        @bar-click="onPick"
      />

      <BarChart
        v-else-if="active === 'gap'"
        :series="topNone"
        :is-dark="isDark"
        :title="tr('gospel.charts.c2Title')"
        :subtitle="tr('gospel.charts.c2Sub', { n: TOP_N })"
        :unit="tr('gospel.charts.c2Unit')"
        :legend="[
          { label: tr('gospel.charts.noResourceInPools'), color: C.none },
          { label: tr('gospel.charts.unresolvedCode'), color: C.unresolved },
        ]"
        :caveats="[
          ...poolCaveats,
          meta.unmatchable_note || 'Some codes sit outside the ISO 639-3 registry and no pool can index them.',
        ]"
        @bar-click="onPick"
      />

      <BarChart
        v-else
        :series="byCountry"
        :is-dark="isDark"
        :title="tr('gospel.charts.c3Title')"
        :subtitle="tr('gospel.charts.c3Sub', { n: TOP_N })"
        :unit="tr('gospel.charts.c3Unit')"
        :legend="[
          { label: tr('gospel.charts.nothingInPoolsLower'), color: C.none },
          { label: tr('gospel.charts.aResourceFound'), color: C.found },
        ]"
        :caveats="[
          ...poolCaveats,
          'Counted from the resource table\'s own country column, not from languages-by-country.json — that table keeps only the top 12 languages per country, so ranking by it would rank the cap.',
        ]"
        @bar-click="onPick"
      />

      <div v-if="picked" class="gc-pick">
        <button type="button" @click="picked = null">{{ tr('gospel.sheet.close') }}</button>
        <template v-if="picked.meta.iso">
          <b>{{ picked.meta.name }}</b> · ISO 639-3 <b>{{ picked.meta.iso }}</b> <bdi dir="ltr">·
          {{ fmt(picked.meta.population) }} people in
          {{ picked.meta.groups }} people group{{ picked.meta.groups === 1 ? '' : 's' }} ·
          spoken in {{ Array.from(picked.meta.countries).join(', ') }}.</bdi>
          <br><bdi dir="ltr">Scripture found: {{ picked.meta.scripture ? 'yes' : 'not in pools checked' }} ·
          Film found: {{ picked.meta.film ? 'yes' : 'not in pools checked' }} ·
          Audio: unknown (pool not checked).</bdi>
          <template v-if="picked.meta.unmatchable">
            <br><bdi dir="ltr">This code is outside the ISO 639-3 registry, so no pool can index it —
            its resource status is unresolved by join, not measured.</bdi>
          </template>
        </template>
        <template v-else>
          <b>{{ picked.meta.country }}</b> <bdi dir="ltr">— {{ picked.meta.none }} of
          {{ picked.meta.total }} languages present here have nothing found in the
          pools checked.</bdi>
        </template>
      </div>
    </div>
  </div>
</template>
