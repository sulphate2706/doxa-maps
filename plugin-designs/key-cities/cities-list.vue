<script setup>
/**
 * cities-list.vue — KEY CITIES: clusters of unengaged people-group pins.
 *
 * Clusters of people-group pins, grouped by region, each showing which groups'
 * pins fall in it and what languages they speak.
 *
 * ═══ WHAT A "KEY CITY" IS HERE — READ THIS BEFORE TRUSTING A ROW ════════════
 * A row is a CLUSTER OF PEOPLE-GROUP PINS within ~25km, not a municipal
 * boundary. The distinction is the integrity of the whole dataset.
 *
 * Each pin marks a people group, not a settlement — measured: India's 855
 * pins resolve to 625 distinct ~11km cells. So clustering them into "cities" and
 * naming those clusters ourselves would MANUFACTURE placenames, and a fabricated
 * placename in a persecution-sensitive dataset is the dangerous kind of wrong.
 *
 * What IS defensible: at ~25km, 277 of 1,646 clusters hold MORE THAN ONE people
 * group. Several distinct groups living within 25km IS a real population centre —
 * that is the only inference made. Those 277 were then named by a CITED gazetteer
 * (Nominatim/OSM, ODbL), 277/277 resolved, with 2 genuine cross-border cases
 * flagged rather than corrected.
 *
 * The remaining 1,369 single-group clusters keep place_name empty. That is an
 * honest gap, not missing work — and the UI says so rather than hiding them.
 *
 * PERSECUTION-SAFETY: locations of PEOPLE GROUPS, which is public ethnographic
 * data. No church, believer or meeting-point information, and it must not gain any.
 */
import { computed, inject, ref, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { sentenceParts, keep, ltr } from '@map/composables/useSentence.js'
import { regionLabel } from './regionLabel.js'
import { formatList } from '@map/i18n/index.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'

const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)

const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

// FETCHED AT RUNTIME, not imported. key-cities.json is 904KB and the build is a
// single-file IIFE with inlineDynamicImports:true — a static import would inline
// it and block first paint. Measured on the other two apps: static imports took
// them to 2.0MB and 2.9MB before this fix.
const table = ref({ rows: [] })
const loadErr = ref(null)   // the engine's or the server's own words: shown INSIDE a translated line
onMounted(async () => {
  try {
    const r = await fetch(`${assetsBase.value}/tables/key-cities.json`)
    if (!r.ok) throw new Error(`table not found (${r.status})`)
    table.value = await r.json()
  } catch (e) { loadErr.value = String(e.message || e) }
})

const rows = computed(() => table.value.rows || [])
const { t } = useI18n()
const named = computed(() => rows.value.filter((r) => r.named))

// Default to the NAMED population centres: a first screen of 1,369 unnamed
// single-group clusters would read as broken rather than as honest.
const filter = ref('named')
// Labels are keyCities.list.filters.<id> (the template translates them).
const FILTERS = [{ id: 'named' }, { id: 'multi' }, { id: 'all' }]

const shown = computed(() => {
  if (filter.value === 'named') return named.value
  if (filter.value === 'multi') return rows.value.filter((r) => r.is_population_centre)
  return rows.value
})

const sections = computed(() => {
  const by = new Map()
  for (const r of shown.value) {
    // The RAW data value is the key (sections, :key, collapse state); only the heading is translated,
    // at render (secLabel below). 'Other' is a data guard for a row with no region: the sentinel
    // dashboard.other projects. No row has an empty region today; "Other" and "N/A" are region values.
    const k = r.region || 'Other'
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  return [...by.entries()]
    .map(([name, items]) => ({
      name,
      items: items.slice().sort((a, b) => b.people_group_count - a.people_group_count),
      groups: items.reduce((n, x) => n + x.people_group_count, 0),
    }))
    .sort((a, b) => b.groups - a.groups)
})

const collapsed = ref({})
const isShut = (n) => !!collapsed.value[n]
const toggle = (n) => { collapsed.value = { ...collapsed.value, [n]: !collapsed.value[n] } }
const fmt = (n) => (Number(n) || 0).toLocaleString()
const secLabel = (name) => regionLabel(t, name)
// A row's languages: the first three, then "and N more" when there are more, in the page's own list
// grammar (formatList: Intl.ListFormat). The cut is the list's LAST item, so a shortened list never
// reads as complete. The row's languages field is data, joined with ", " by the table builder.
const langList = (joined) => {
  const all = String(joined).split(', ').filter(Boolean)
  const shown = all.slice(0, 3)
  return formatList(all.length > 3 ? [...shown, t('keyCities.list.moreLanguages', { n: fmt(all.length - 3) })] : shown)
}
// ONE key for the caveat's sentence: the count and the gazetteer's name go in as values, the name as
// its own left-to-right island (it is a proper name, never translated), so each language orders it.
const caveatRow = computed(() => h('span', sentenceParts(
  t('keyCities.list.caveat.row', keep('n', 'source')),
  { n: fmt(named.value.length), source: ltr('Nominatim/OpenStreetMap', true) })))

useShadowStyles(
  '.kc{position:absolute;inset:0;overflow-y:auto;padding:20px 18px 44px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.kc.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.kc-h{margin:0 0 4px;font-size:19px;font-weight:700;text-align:center}' +
  '.kc-sub{margin:0 auto 14px;max-width:660px;font-size:12.5px;line-height:1.55;text-align:center;opacity:.78}' +
  '.kc-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:16px;flex-wrap:wrap}' +
  '.kc-tab{font:600 12px inherit;padding:6px 14px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit}' +
  '.kc-tab.on{background:#10b981;border-color:#10b981;color:#04241a}' +
  '.sec{max-width:1080px;margin:0 auto;padding-bottom:34px}' +
  // Sticky region header — the same TreeTable behaviour as the poster wall, so a
  // long region can be collapsed without scrolling back to its top.
  '.sec-head{position:sticky;top:0;z-index:6;background:#f6f7f9;display:flex;align-items:baseline;gap:10px;' +
  'padding:10px;margin:0 2px 10px;border-bottom:1px solid rgba(0,0,0,.10);cursor:pointer;user-select:none;' +
  'width:100%;text-align:left;border-top:0;border-left:0;border-right:0;font:inherit;color:inherit;' +
  'box-shadow:0 6px 10px -8px rgba(0,0,0,.35);border-radius:4px 4px 0 0}' +
  '.is-dark .sec-head{background:#0a1410;border-bottom-color:rgba(255,255,255,.12)}' +
  '.sec-caret{width:12px;font-size:10px;opacity:.55;transition:transform .18s}' +
  '.sec-caret.open{transform:rotate(90deg)}' +
  '.sec-name{margin:0;font-size:15px;font-weight:700}' +
  '.sec-meta{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}' +
  '.row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;' +
  'padding:9px 10px;border-bottom:1px solid rgba(0,0,0,.06)}' +
  '.is-dark .row{border-bottom-color:rgba(255,255,255,.07)}' +
  '.r-name{font-size:13.5px;font-weight:700}' +
  '.r-unnamed{font-weight:600;opacity:.55;font-style:italic}' +
  '.r-meta{font-size:11px;opacity:.66;margin-top:2px;line-height:1.45}' +
  '.r-num{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right}' +
  '.pill{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}' +
  '.pill.ok{background:rgba(16,185,129,.15);color:#0b7a5b}' +
  '.pill.mid{background:rgba(245,158,11,.16);color:#8a6414}' +
  '.pill.low{background:rgba(220,38,38,.13);color:#a12020}' +
  '.pill.unk{background:rgba(0,0,0,.07);color:#6b7280}' +
  '.is-dark .pill.unk{background:rgba(255,255,255,.10);color:#9ca3af}' +
  '.caveat{max-width:1080px;margin:16px auto 0;padding:12px 14px;border-radius:8px;' +
  'background:rgba(0,0,0,.04);font-size:11.5px;line-height:1.65;opacity:.85}' +
  '.is-dark .caveat{background:rgba(255,255,255,.06)}',
  'doxa-key-cities',
)

const band = (a) => a === 'yes' ? 'ok' : a === 'partial' ? 'mid' : a === 'no' ? 'low' : 'unk'
</script>

<template>
  <div class="kc" :class="{ 'is-dark': isDark }">
    <h2 class="kc-h">{{ $t('keyCities.list.title') }}</h2>
    <p class="kc-sub">
      {{ $t('keyCities.list.intro', { named: fmt(named.length), clusters: fmt(rows.length) }) }}
    </p>

    <div v-if="loadErr" class="caveat" role="alert">{{ $t('keyCities.loadFailed', { detail: loadErr }) }}</div>

    <div class="kc-tabs">
      <button v-for="f in FILTERS" :key="f.id" type="button"
        class="kc-tab" :class="{ on: filter === f.id }" @click="filter = f.id">
        {{ $t('keyCities.list.filters.' + f.id) }}
      </button>
    </div>

    <section v-for="sec in sections" :key="sec.name" class="sec">
      <button type="button" class="sec-head" @click="toggle(sec.name)">
        <span class="sec-caret" :class="{ open: !isShut(sec.name) }">▶</span>
        <h3 class="sec-name">{{ secLabel(sec.name) }}</h3>
        <span class="sec-meta">
          {{ $t('keyCities.list.locations', { n: sec.items.length }) }} · {{ $t('keyCities.list.peopleGroups', { n: fmt(sec.groups) }) }}
        </span>
      </button>

      <div v-show="!isShut(sec.name)">
        <div v-for="r in sec.items" :key="r.lat + ',' + r.lng" class="row">
          <div>
            <!-- An unnamed cluster says so, with its coordinates. Inventing a name
                 here is the one thing this dataset must never do. -->
            <div :class="r.place_name ? 'r-name' : 'r-unnamed'">
              {{ r.place_name || $t('keyCities.map.unnamed', { lat: r.lat, lng: r.lng }) }}
            </div>
            <div class="r-meta">
              {{ r.country }}<template v-if="r.admin_state"> · {{ r.admin_state }}</template>
              · {{ $t('keyCities.list.peopleGroups', { n: fmt(r.people_group_count) }) }}
              <template v-if="r.languages"> · {{ langList(r.languages) }}</template>
            </div>
          </div>
          <div class="r-num">{{ fmt(r.upg_population) }}</div>
          <span class="pill" :class="band(r.country_internet_access)">
            {{ r.country_internet_pct != null ? r.country_internet_pct + '%' : $t('keyCities.map.unknown') }}
          </span>
        </div>
      </div>
    </section>

    <div class="caveat">
      <b>{{ $t('keyCities.list.caveat.rowLead') }}</b> <component :is="caveatRow" />
      <br><br>
      <b>{{ $t('keyCities.map.national') }}</b> {{ $t('keyCities.list.caveat.internet') }}
      <br><br>
      {{ $t('keyCities.list.caveat.scope') }}
    </div>
  </div>
</template>
