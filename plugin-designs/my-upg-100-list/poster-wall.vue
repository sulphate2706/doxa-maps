<script setup>
/**
 * poster-wall.vue — the UPG-100 POSTER WALL (pane 2 of the my-upg-100-list family).
 *
 * @description A wall of printable poster cards, one per 100-list entry, each with a "Show on map"
 *   action that hands off to the map profile in the same bundle.
 *
 * ★ MIGRATED ONTO THE SHARED WALL 2026-09-24. This file was 890 lines carrying its own copy of
 * markup, CSS, the export modal and three print paths; the rendering now comes from
 * @map/components/poster/PosterWall.vue, which country-posters (94 lines) and key-cities (75)
 * already consume. This profile supplies ONLY what cannot be shared: its data, its taxonomy and
 * its records provider.
 *
 * WHAT COULD NOT BE SHARED, and why each is here rather than in the component:
 *   REGION_OF / regionFor  — the 100-list's own continental taxonomy, keyed by list id because a
 *                            selector can be a wagf_block, a country_codes array or an explicit
 *                            pg_slugs list and none of those implies a continent.
 *   fetchListRecords       — knows the people-groups API, the selector evaluator AND the pg_slugs
 *                            special case. Key Cities and Country Posters have entirely different
 *                            data shapes, which is exactly why the shared wall takes a PROVIDER.
 *
 * THREE CAPABILITIES HAD TO BE ADDED TO THE SHARED WALL FIRST, over two ticks, because migrating
 * without them would have REGRESSED this wall rather than consolidated it:
 *   cardStocks             — the reader picks the prayer-card size at print time.
 *   posterAction="print"   — open the print dialog instead of saving a file.
 *   hidePrayerListWhenSoon — no "coming soon" placeholder on a wall whose list DOES print.
 * The last two are a product ruling, not a preference (2026-09-23): three print buttons, each
 * opening an in-browser print dialog, and no silent file download as the default action. A raw
 * 'Download' button and a 'Prayer List: coming soon' placeholder were exactly the two buttons
 * ruled out.
 *
 * CROSS-PANE COMMS — unchanged and still the decoupling that matters: this wall NEVER imports the
 * map. The shared component dispatches the window CustomEvent named below, scoped by instanceId,
 * so several embeds on one page never cross-talk. The shell listens and drives the map pane.
 *
 * ASSETS. previews/<id>.webp (~65KB, 378 generated) SHIP and are what the wall paints. Full
 * posters/<id>.webp do NOT ship by default (~42MB); export and print fall back to fetching
 * posters/<id>.html and rasterising it in the browser. See
 * IDEA-POSTER-EXPORT-404-ON-DROPPED-FOLDER-TRADEOFF.
 */
import { computed, inject, ref } from 'vue'
import { useOptionalT, useOptionalI18n } from '@map/composables/useOptionalT.js'
// The page's people-group LIST (library/lists/): every people-group fetch below keeps only its groups.
import { resolvePeopleGroupList } from '@map/lists/peopleGroupList.js'
import PosterWall from '@map/components/poster/PosterWall.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
// The reader's language, for the DATA fetch below. Not for interface text — that goes through t().
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
// The list's total for the intro, from the funnel (never a number written into a string; see data/upg-total.js).
import visionFunnel from '../../data/people-groups/vision-funnel.json'
import { upgTotal, countInSentence } from './data/upg-total.js'
// Named imports: only the list arrays ship in the bundle; the file's bookkeeping fields stay out.
import { zonesForList } from './data/zones-for-list.js'
// The SAME normalize+evaluate pipeline the sibling map profile uses to turn the live
// /people-groups/list payload + a list's `selector` into the exact rows that belong to it.
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { makeZoneSheet } from './data/zone-sheet-print.js'
import { REGION_KEY } from './data/legend-tree.js'
import { keyedError } from '@map/i18n/keyedError.js'
// A zone's title in the reader's language (tier A: its country; others keep their label) — the same
// generator the map's legend and the packet use, so a card, its alt text and its print say one name.
import { zoneTitle } from './data/zone-title.js'
import { countryName } from '@map/utils/countryName.js'
import { evaluate as evaluateSelector } from './data/selector-evaluator.js'

// The table the zone map sheets were generated from (generate.mjs labels each country with it), so a
// packet printed from this wall names page 1's countries in its own language, as the list's print does.
// Lazy: only a packet print needs it.
const iso3Names = () => import('@map/data/iso3-name.js').then((m) => m.ISO3_NAME)

const profileConfig = inject('profileConfig', ref(null))
const instanceId = computed(() => profileConfig.value?.instanceId || 'upg-100-wall')
const isDark     = computed(() => profileConfig.value?.isDark === true)
// Assets resolve RELATIVE to the host page so the tree stays drop-portable —
// file://, a CDN subpath, Railway and Capacitor all behave identically.
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

// Config-only, fail-closed API base — SAME resolution as the sibling map profile. No default
// host: a dev harness that never sets window.MAP_APP_API_URL simply gets no PG-level data, and
// the shared wall hides the row-dependent buttons rather than failing at click time.
const API_BASE = (typeof window !== 'undefined' && window.MAP_APP_API_URL)
  || import.meta.env.VITE_API_BASE_URL
  || ''

// ─── REGIONAL SECTIONS ───────────────────────────────────────────────────────
// clusters.json carries no region field, so the mapping lives here. It is keyed by
// list id rather than derived from the selector: a selector can be a wagf_block, a
// country_codes array or an explicit pg_slugs list, and none of those reliably
// implies the continent a reader expects to browse by.
//
// SE Asia + Oceania are ONE section deliberately (the island chains read as a
// single sweep), and the Americas gathers Brazil, the Andean/Caribbean list and the
// US-bearing scatter list.
const REGION_OF = {
  // Africa
  'west-africa': 'Africa', 'sudan': 'Africa', 'east-africa': 'Africa',
  'central-africa': 'Africa', 'southern-africa-islands': 'Africa',
  // Middle East. Maghreb+Egypt is geographically North AFRICA but belongs here:
  // the region is read as a cultural/linguistic sweep.
  'maghreb-egypt': 'Middle East',
  'middle-east-core': 'Middle East',
  // CENTRAL ASIA is its own section: the 55-UPG Pakistan map belongs to Central
  // Asia, not the Middle East. It had been folded into the Middle
  // East as "the same sweep continuing east", but Pakistan, Afghanistan,
  // Uzbekistan, Tajikistan, Kyrgyzstan and Kazakhstan are Central/South Asia —
  // filing them under the Middle East misnames six countries to save a heading.
  'uncovered-nas-a': 'Central Asia',
  // Southeast Asia + Oceania
  'laos': 'Southeast Asia + Oceania', 'oceania-indonesia': 'Southeast Asia + Oceania',
  'mainland-se-asia-philippines': 'Southeast Asia + Oceania',
  // Americas
  'brazil': 'Americas', 'andean-caribbean': 'Americas', 'uncovered-scatter': 'Americas',
  // Europe
  'europe': 'Europe',
  // India and China are their OWN sections, not one lump called "Asia". Between
  // them they are 1,122 people groups across 12 lists — more than every other
  // section combined — so collapsing them hides the two largest prayer fields in
  // the dataset behind a single continental label. Matched by id prefix below.
}
// ⚠ TAKES AN ID, while the shared wall's groupBy takes the whole ITEM. The template
// adapts it — `:group-by="(item) => regionFor(item.id)"` — rather than changing this
// signature, because the id is what the taxonomy is keyed by and every prefix rule
// below reads it directly. Passing regionFor straight in built and loaded cleanly and
// then threw `c.startsWith is not a function` at first render: the whole wall was blank,
// 0 cards, with nothing wrong at the source layer.
// ★ THE ENGLISH VALUES ABOVE ARE GROUPING KEYS; THIS TRANSLATES AT RENDER.
// REGION_OF keeps its English values as stable identity — changing them would re-key the
// grouping — and the heading a reader sees is resolved here, per locale, through REGION_KEY
// (data/legend-tree.js), the one table the legend's region rows translate through as well. Every
// heading has a poster.region_* key in all 11 locales, India and Other included.
const regionLabel = (english) => {
  const key = REGION_KEY[english]
  return key ? t(`poster.${key}`) : english   // no key yet -> the English heading, not a raw key
}
const regionFor = (id) => {
  if (REGION_OF[id]) return regionLabel(REGION_OF[id])
  if (id.startsWith('asia-india-')) return regionLabel('India')
  // "China + Mongolia": the northern zone declares Mongolia as a member country
  // (its land is drawn and highlighted), so the section heading names both rather
  // than folding a sovereign country under a China label.
  if (id.startsWith('asia-china-')) return regionLabel('China + Mongolia')
  return regionLabel('Other')
}
// One flat list of the zones the map paints — for WHICHEVER list is showing.
//
// ★ THROUGH zonesForList, not a static clusters.json import (pattern work, 2026-09-27). This wall already
// filtered its RECORDS by list (applyPeopleGroupList, below), so before this it showed another list's
// people groups arranged under UPG-100's zone names — half list-aware, which is the worst of the two
// states because it looks right. Now the zones follow the list too.
// Safe inside a computed: profileConfig is injected at :54 and this evaluates lazily, after setup —
// a module-level call would hit the temporal dead zone (it does in upg-100-list.vue, which is why that
// file resolves per call as well).
// ⚠ AND THE OLD COMMENT SAID "the same 27", which was already stale: the legend has 28 leaves, because
// buildLegendNodes collapses the two deaf_lists into one unified row. This spread still yields 27 because
// it reads the three geographic buckets and the deaf row is synthesised — so the number is right for what
// this list IS, and the old comment was describing the wrong thing.
const { locale: wallLocale } = useOptionalI18n('')
const items = computed(() => {
  const z = zonesForList(resolvePeopleGroupList(profileConfig))
  // The i18n locale REF, read here so this computed re-runs on a runtime language switch: getRuntimeLocale()
  // is a plain getter, and a computed that reads only it is resolved once and never again (a frozen label).
  const l = wallLocale && (wallLocale.value ?? wallLocale)
  const locale = (typeof l === 'string' && l) || getRuntimeLocale() || detectLocale()
  return [
    ...(z.lists || []),
    ...(z.asia_lists || []),
    ...(z.uncovered_lists || []),
  ].filter(l => l && l.id)
    // ★ THE CARD'S NAME IN THE READER'S LANGUAGE. item.label is the Show-on-map button's accessible
    // name, every poster's alt text and tooltip, the print HUD's title and the printed documents' title
    // — all five were English in every locale. zoneTitle declines (null) for a zone it cannot name, and
    // that zone keeps its hand-written label, exactly as on the legend and the packet.
    .map(l => { const title = zoneTitle(l, null, { countryName, locale }); return title ? { ...l, label: title } : l })
})

// ─── THE RECORDS PROVIDER — now the library's (lists/peopleGroupRecords.js) ─────────
// This wall kept its own fetch (the field list, the reader's language, list membership, normalisation
// and the pg_slugs special case). All of it is the print standard's records provider now, which every
// map shares, so a fix to any of it reaches every wall. What is THIS profile's is only the selector
// language: pg_slugs is understood by the provider; every other UPG-100 selector goes through the same
// evaluator the map uses, so the map, the list print and the card deck cannot disagree about membership.
const recordsFor = createPeopleGroupRecords({
  apiBase: () => API_BASE,
  lang: () => getRuntimeLocale() || detectLocale(),
  profileConfig,
  evaluate: (selector, records) => evaluateSelector(selector, records),
})
async function fetchListRecords(list) {
  if (!API_BASE) throw keyedError('wall.hud.noApi', 'no people-groups service is configured')
  return recordsFor(list.selector)
}

// ★ THE SHEET, GENERATED AT THE CLICK (the print standard: generate, store only previews): the zone's map
// drawn in the browser for the poster print and the packet's page 1 — data/zone-sheet-print.js, the one
// helper every UPG-100 surface prints a zone through.
const zoneSheet = makeZoneSheet({ allRecords: () => recordsFor.all(), assetsBase: () => assetsBase.value, profileConfig })

// The wall's own copy. v-html in the shared component, so the <strong> lands as markup —
// the emphasis is the point: praying for them BY NAME is the whole brief.
//
// ★ THROUGH t(), NOT A LITERAL. Measured at ?lang=ar: this intro, the heading and
// the tag rendering in English while the wall's buttons beside them were translated — the
// copy a reader reads FIRST was the untranslated part. The <strong> travels inside the
// translated string so each language can emphasise its own words, which is not something a
// wrapper around an English sentence could do.
// Guarded like every other useI18n() here: it throws on a host without vue-i18n. useOptionalT stores
// that guard once (host i18n -> catalogue -> the key) instead of a hand-rolled copy.
// No namespace: callers pass FULL keys here, exactly as the raw useI18n().t they used to get.
//
// ★ ONE BEHAVIOUR GAIN FROM WAVE 3c (4c05e589): the old path was the bare
// useI18n().t, so on a host WITH i18n a missing key rendered the raw dotted key. It now falls through.
//
// ★ AND THE humanizeKey FALLBACK IS GONE — the one deliberate departure from 4c05e589, which kept it.
// It rendered a key's last segment title-cased, so a bare host showed "Upg100 Wall Intro" where a
// whole SENTENCE exists: wrong even in English, and untranslatable because it comes from the
// identifier rather than a catalogue. It was kept on the theory that these keys were not fully
// catalogued — and that was FALSE: this file's three keys are
// present in all ELEVEN locales, 0 gaps (enumerated 2026-09-27; the only three, all string literals).
// ⚠ IT GUARDS A BARE HOST, NOT A MISSING KEY. Those are different failures, and the two had been confused.
// A product decision (2026-09-27), under the standing goal that the
// production maps be localized.
const t = useOptionalT('')

// ★ THE MARKUP IS COMPOSED HERE, so the CATALOGUE holds plain text (2026-09-27).
// vue-i18n warns "[intlify] Detected HTML in '…'" twice per tab pass, and it is right to: a translated
// string carrying <strong> is the only one in this tree that does — I measured every en catalogue area
// and upg100WallIntro is 1 of 1, so this was not a convention, it was my outlier.
//
// ⚠ WHY THE OBVIOUS FIXES DO NOT APPLY HERE. The usual suggestions — markup in the template, or
// <i18n-t> interpolation — assumes this profile renders the sentence. It does not: `intro` is a STRING
// PROP on the library PosterWall, rendered there with v-html (PosterWall.vue:955), and that component
// has no slots at all. So the markup has to arrive inside the string, and the only question is who
// builds the string. Building it HERE keeps the catalogue clean without a library change.
//
// ★ AND IT IS STRICTLY SAFER THAN WHAT IT REPLACES, which is the part worth keeping. v-html on a whole
// catalogue string TRUSTS THE CATALOGUE: any tag a translator (or a bad merge) puts in any of the 11
// locale files renders as markup. Composing here escapes each part and emits exactly one tag I control,
// so the trusted surface shrinks from "every translation of this key" to "this line".
//
// THREE PARTS, NOT A WRAPPER AROUND ONE, because the emphasis is not in the same place in every
// language. Measured across all 11 locales: each has exactly one <strong> and no other tags, and de, hi
// and zh carry real text AFTER the emphasised run (" beten.", " प्रार्थना करते हुए।", "為他們禱告。")
// where the others end on a full stop. A head+emphasis wrapper would have silently dropped those tails.
const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const intro = computed(() => {
  // The three plain-text keys come from the shared catalogue (rule 5B). Until they land, the
  // single legacy key is still the source of truth, so this renders identically before AND after: no
  // flag day, and this consumer does not have to land in step with the catalogue.
  // The total is {n}, formatted for the reader (it printed a stale 2,106 in all eleven languages).
  const a = countInSentence(t, 'upgMap.wallIntroA', upgTotal(visionFunnel), getRuntimeLocale() || detectLocale())
  const b = t('messages.upg100WallIntroEmph')
  const c = t('messages.upg100WallIntroB')
  const missing = (v, key) => !v || v === key
  // ★ THE LEGACY upg100WallIntro FALLBACK IS GONE (2026-09-27). It existed for exactly one window: the
  // three plain-text keys were landing in the shared catalogue while this consumer was already written,
  // so the branch rendered the old single markup-bearing key until they arrived. They are on main in
  // all eleven locales, so the branch is now DEAD CODE — and dead code that names a key keeps that key
  // alive: the catalogue cannot delete upg100WallIntro while this line reads it (measured).
  // A fallback whose condition can no longer be true is not safety, it is a reference.
  // If A or Emph ever went missing the per-key fallback still yields English from the en block, and
  // check:i18n-keys-exist fails the build before a reader could see it.
  const tail = missing(c, 'messages.upg100WallIntroB') ? '' : escHtml(c)
  return `${escHtml(a)}<strong>${escHtml(b)}</strong>${tail}`
})
// The display name, plain ("UPG 100 List Posters", no second "Posters"); upgMap ships only in this bundle.
const heading = computed(() => t('upgMap.wallHeading'))
const wallTag = computed(() => t('messages.upg100WallTag'))

</script>

<template>
  <PosterWall
    :items="items"
    :group-by="(item) => regionFor(item.id)"
    :instance-id="instanceId"
    :is-dark="isDark"
    :assets-base="assetsBase"
    event-name="doxa-upg-100-list:show-on-map"
    :heading="heading"
    :tag="wallTag"
    :intro="intro"
    unit="UPG"
    item-count-key="wall.listCount"
    :records="fetchListRecords"
    :iso3-names="iso3Names"
    :sheet="zoneSheet"
    :card-stocks="true"
    poster-action="print"
    preview-action="print"
    :hide-prayer-list-when-soon="true"
    download-prefix="doxa-upg-100"
    :columns-control="true"
    :min-card-px="150"
  />
  <!-- min-card-px 150: "Posters per row: 2" now SHOWS two on a phone. The shared clamp (210px) forced one at
       390 and silently overrode the select, which read 2 (2026-09-30: work like the country posters,
       which opted in first). A two-up card is ~162px, so each thumbnail is ~114px and its poster title is
       too small to read; two-up was chosen over one-up with that trade shown side by side. The action
       labels wrap (PosterWall's .pfs > .pbtn), so none clip. -->

</template>
