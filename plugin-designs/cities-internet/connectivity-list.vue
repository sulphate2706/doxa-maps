<script setup>
/**
 * connectivity-list.vue — CITIES WITH INTERNET, the list/detail pane.
 *
 * @description Countries where DX people groups live, grouped by region, showing measured internet penetration
 *   and mobile coverage. Every figure carries its source, so the numbers can be audited.
 *
 * Countries where DX people groups live, grouped by region, showing measured
 * internet penetration and mobile coverage. Every figure carries its SOURCE and
 * its OBSERVATION YEAR — a number without a year is not citable.
 *
 * ═══ THE HONESTY THIS PROFILE IS BUILT AROUND ═══════════════════════════════
 * The brief asked for internet access PER CITY, with ISP and carrier names. That
 * data does not exist publicly for 175 countries. Rather than assume "the city has
 * whatever the country has" — a guess wearing a citation — every row states its
 * own resolution:
 *
 *   resolution: "country"  a national figure (World Bank, with year)
 *   resolution: "city"     an actual city measurement (none yet)
 *
 * and rows with no data say `unknown` rather than defaulting to a plausible number.
 * MEASURED: 129 of 175 countries resolved, 46 unknown. Showing the 46 as
 * "unknown" is the point of the app, not a gap in it — an unknown is a research
 * target, and a fabricated figure is a lie a reader cannot detect.
 *
 * ISP / carrier names and censorship history are NOT here. They live in reports
 * (OONI, Access Now #KeepItOn, Freedom on the Net) that are not machine-readable
 * per-country APIs. They are a cited, per-country human task — deliberately left
 * undone rather than approximated.
 *
 * PERSECUTION-SAFETY: this profile carries connectivity + population + language
 * only. It has NO gospel-resource, church or believer field and must not gain one.
 */
import { computed, inject, ref } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import data from './data/connectivity.json'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'

const profileConfig = inject('profileConfig', ref(null))

// ── UI text: library/i18n/locales/<lc>/connectivity.json (the connectivity-map pattern) ──────
// i18n is OPTIONAL: useI18n() throws on a host that never installed it, so English from the
// shipped catalog is the fallback, never a blank or a key. Region and country names are data.
// C4 wave 3b: the guard is library/composables/useOptionalT.js now, and the fallback resolves through
// tStatic — the RUNTIME LOCALE first, English as the last resort. This plugin owns that
// choice, on the same reasoning the other map plugins use: the bundle already carries
// all 11 catalogues, so a partner embedding without vue-i18n being served English is a bug, not a
// decision. The old enLookup was English-only, which is exactly what that served.
// The local fill() is gone with the guard: fillParams applies the same interpolation, except it leaves
// a placeholder for a NULL value where this fill() rendered the string "null".
const t = useOptionalT('connectivity')
// NUMERALS ARE HELD by design: a locale-following format would switch
// 'ar' to Arabic-Indic digits. Until that is decided, numbers keep the browser-default format they
// had before this pass; only the TEXT is translated.
const num = (n) => (Number(n) || 0).toLocaleString()
const isDark = computed(() => profileConfig.value?.isDark === true)

const countries = computed(() => data.countries || [])

// Sections by region, ordered by people-group count — the same "greatest need
// leads" rule the poster walls use.
const sections = computed(() => {
  const by = new Map()
  for (const c of countries.value) {
    // ★ THE RAW DATA VALUE IS THE KEY, ALWAYS. It groups the rows here AND keys the collapse state
    // (toggle/isShut below), so a translated key would reset every open section on a locale switch and
    // filter on a value no row carries — the value/label trap library/composables/useFacetAggregation.js
    // documents at OTHER_KEY. The label is projected at render instead; see regionLabel().
    // The `|| 'Other'` this used to carry was DEAD as a fix for the heading — of 175 rows in
    // connectivity.json none has a falsy region, and the one "Other" section is a row whose region IS
    // the string "Other" (United States). It stays as a data guard, not as a label: a future row with
    // no region must not key this Map on undefined. 'Other' is the sentinel that dashboard.other
    // projects, so the guard and the label agree.
    const r = c.region || 'Other'
    if (!by.has(r)) by.set(r, [])
    by.get(r).push(c)
  }
  return [...by.entries()]
    .map(([name, items]) => ({
      name,
      items: items.slice().sort((a, b) => b.people_groups - a.people_groups),
      groups: items.reduce((n, x) => n + x.people_groups, 0),
      // How much of this region is still unmeasured — the research signal.
      unknown: items.filter((x) => x.internet_access === 'unknown').length,
    }))
    .sort((a, b) => b.groups - a.groups)
})

/**
 * A region heading, translated. The catalogue's own English values ARE the data's region strings, so
 * the map is exact-match rather than a derived slug — `latin_america_&_caribbean` and
 * `north_america_&_non-spanish_caribbean` are not what any reasonable slug function produces, and
 * guessing them would fail silently in ten locales at once.
 *
 * ★ THE KEYS ARE WRITTEN OUT IN FULL ON PURPOSE. internal/i18n-areas.mjs bundles an area only when its
 * name appears in a reached file as a literal prefix, so the build narrows each bundle's catalogue to
 * the areas it can see. Before this, cities-internet shipped 14 areas and NOT dashboard or wall;
 * assembling these keys at runtime would have left every one of them unresolved in the shipped bundle
 * while resolving perfectly in the dev tree. Measured both ways: written out, the bundle takes 16.
 *
 * Unknown values fall through to the raw string — a region the catalogue has never heard of is data,
 * and showing it beats showing a key or a blank.
 */
const REGION_KEYS = [
  'dashboard.wagfRegion.asia',
  'dashboard.wagfRegion.middle_east',
  'dashboard.wagfRegion.latin_america_&_caribbean',
  'dashboard.wagfRegion.africa',
  'dashboard.wagfRegion.europe',
  'dashboard.wagfRegion.north_america_&_non-spanish_caribbean',
  'dashboard.wagfRegion.oceania',
  'dashboard.other',
  'wall.na',
]
/**
 * name -> key, built by asking the ENGLISH catalogue what each key says. The data's region strings are
 * the catalogue's own English values, so English is the join and it never has to be written here — which
 * also keeps this out of check:hardcoded-english, where an English phrase as an object key reads as a
 * user-visible string and is really a lookup key.
 */
// tStatic(path, 'en') — the EXPLICIT locale argument, not t(). t()'s signature is (key, params,
// plural), so t(k, 'en') would pass 'en' as params and return the RUNTIME locale's value, making the
// join key locale-dependent: the map would be built from Arabic values and match no region at all.
const REGION_KEY = Object.fromEntries(
  REGION_KEYS.map((k) => [tStatic(k, 'en'), k]).filter(([en]) => en),
)
const regionLabel = (name) => {
  const key = REGION_KEY[name]
  if (!key) return name
  const v = t(key)
  return v && v !== key ? v : name
}

const collapsed = ref({})
const isShut = (n) => !!collapsed.value[n]
const toggle = (n) => { collapsed.value = { ...collapsed.value, [n]: !collapsed.value[n] } }

const totals = computed(() => {
  const c = countries.value
  return {
    countries: c.length,
    resolved: c.filter((x) => x.internet_access !== 'unknown').length,
    unknown: c.filter((x) => x.internet_access === 'unknown').length,
    low: c.filter((x) => x.internet_access === 'no').length,
  }
})

const band = (a) => a === 'yes' ? 'ok' : a === 'partial' ? 'mid' : a === 'no' ? 'low' : 'unk'
const bandLabel = (a) => t('connectivity.list.band.' + (['yes', 'partial', 'no'].includes(a) ? a : 'unknown'))

useShadowStyles(
  // ★ THE LIST MUST STAY INSIDE ITS HOST BOX. This element had NO :host rule, so a custom element
  // falls back to display:inline with no height of its own, and .ci below — position:absolute;inset:0
  // — resolved against whatever the PARTNER page happened to have positioned. The result was measured
  // on a partner page: content painting to y=16,799, which is 16,355px BELOW a 420px host box.
  // display:block gives it a box; position:relative makes that box the containing block .ci resolves
  // against; height:100% lets a definite-height slot decide; min-height is the floor for an AUTO-height
  // host, which grows to fit instead of collapsing to nothing. .ci already carries overflow-y:auto, so
  // once it is contained the list SCROLLS inside the box rather than overflowing it — no new scroll
  // container is needed, only a host for the one that is already there.
  // Pattern: regions-list.vue:408, plus the position:relative that connectivity-map needed (60cb4ff18).
  ':host{display:block;position:relative;width:100%;height:100%;min-height:320px}' +
  '.ci{position:absolute;inset:0;overflow-y:auto;padding:20px 18px 44px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.ci.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.ci-h{margin:0 0 4px;font-size:19px;font-weight:700;text-align:center}' +
  '.ci-sub{margin:0 auto 18px;max-width:640px;font-size:12.5px;line-height:1.55;text-align:center;opacity:.75}' +
  '.ci-tot{display:flex;gap:14px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}' +
  '.ci-chip{font-size:11.5px;padding:4px 11px;border-radius:999px;background:rgba(0,0,0,.06);font-weight:600}' +
  '.is-dark .ci-chip{background:rgba(255,255,255,.10)}' +
  '.sec{max-width:1080px;margin:0 auto;padding-bottom:34px}' +
  // Same sticky-header pattern as the poster wall: the region stays visible while
  // its countries scroll, so you can collapse without scrolling back up.
  '.sec-head{position:sticky;top:0;z-index:6;background:#f6f7f9;display:flex;align-items:baseline;gap:10px;' +
  'padding:10px 10px 8px;margin:0 2px 10px;border-bottom:1px solid rgba(0,0,0,.10);cursor:pointer;' +
  'user-select:none;width:100%;text-align:left;border-top:0;border-left:0;border-right:0;font:inherit;color:inherit;' +
  'box-shadow:0 6px 10px -8px rgba(0,0,0,.35);border-radius:4px 4px 0 0}' +
  '.is-dark .sec-head{background:#0a1410;border-bottom-color:rgba(255,255,255,.12)}' +
  '.sec-caret{display:inline-block;width:12px;font-size:10px;opacity:.55;transition:transform .18s}' +
  '.sec-caret.open{transform:rotate(90deg)}' +
  '.sec-name{margin:0;font-size:15px;font-weight:700}' +
  '.sec-meta{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}' +
  '.row{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:center;' +
  'padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.06)}' +
  '.is-dark .row{border-bottom-color:rgba(255,255,255,.07)}' +
  '.r-name{font-size:13.5px;font-weight:600}' +
  '.r-sub{font-size:11px;opacity:.6}' +
  '.r-num{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;min-width:72px}' +
  '.pill{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}' +
  '.pill.ok{background:rgba(16,185,129,.15);color:#0b7a5b}' +
  '.pill.mid{background:rgba(245,158,11,.16);color:#8a6414}' +
  '.pill.low{background:rgba(220,38,38,.13);color:#a12020}' +
  // UNKNOWN is styled as a NEUTRAL research target, not an error. It is honest
  // missing data, and the app's job is to make it visible rather than hide it.
  '.pill.unk{background:rgba(0,0,0,.07);color:#6b7280}' +
  '.is-dark .pill.unk{background:rgba(255,255,255,.10);color:#9ca3af}' +
  '.src{max-width:1080px;margin:8px auto 0;font-size:11px;line-height:1.6;opacity:.6;text-align:center}',
  'doxa-cities-internet',
)
</script>

<template>
  <div class="ci" :class="{ 'is-dark': isDark }">
    <h2 class="ci-h">{{ t('connectivity.list.title') }}</h2>
    <p class="ci-sub">
      {{ t('connectivity.list.intro') }} <strong>{{ t('connectivity.list.introStrong') }}</strong>
    </p>

    <div class="ci-tot">
      <span class="ci-chip">{{ t('connectivity.list.countries', { n: num(totals.countries) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.measured', { n: num(totals.resolved) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.unknown', { n: num(totals.unknown) }) }}</span>
      <span class="ci-chip">{{ t('connectivity.list.low', { n: num(totals.low) }) }}</span>
    </div>

    <section v-for="sec in sections" :key="sec.name" class="sec">
      <button type="button" class="sec-head" @click="toggle(sec.name)">
        <span class="sec-caret" :class="{ open: !isShut(sec.name) }">▶</span>
        <!-- The LABEL is translated; :key, toggle() and isShut() above and below keep the raw
             sec.name, so collapse state survives a locale switch. -->
        <h3 class="sec-name">{{ regionLabel(sec.name) }}</h3>
        <span class="sec-meta">
          {{ t('connectivity.list.sectionMeta', { countries: num(sec.items.length), groups: num(sec.groups) }) }}
          <template v-if="sec.unknown"> · {{ t('connectivity.list.unmeasured', { n: num(sec.unknown) }) }}</template>
        </span>
      </button>

      <div v-show="!isShut(sec.name)">
        <div v-for="c in sec.items" :key="c.iso3" class="row">
          <div>
            <div class="r-name">{{ c.country }}</div>
            <div class="r-sub">
              {{ t('connectivity.list.rowMeta', { groups: num(c.people_groups), locations: num(c.clusters) }) }}
              <template v-if="c.multi"> · {{ t('connectivity.list.centres', { n: num(c.multi) }) }}</template>
            </div>
          </div>
          <div class="r-num">
            <template v-if="c.internet_pct !== null && c.internet_pct !== undefined">
              {{ c.internet_pct }}%
              <div class="r-sub">{{ c.internet_year }}</div>
            </template>
            <template v-else>—</template>
          </div>
          <div class="r-num">
            <template v-if="c.mobile_per_100 !== null && c.mobile_per_100 !== undefined">
              {{ c.mobile_per_100 }}
              <div class="r-sub">{{ t('connectivity.list.mobPer100') }}</div>
            </template>
            <template v-else>—</template>
          </div>
          <span class="pill" :class="band(c.internet_access)">{{ bandLabel(c.internet_access) }}</span>
        </div>
      </div>
    </section>

    <p class="src">{{ t('connectivity.list.source') }}</p>
  </div>
</template>
