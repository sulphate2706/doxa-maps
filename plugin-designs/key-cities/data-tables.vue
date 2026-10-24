<script setup>
/**
 * data-tables.vue — the CITIES DATA list view: every research table, one tab each.
 *
 * Four validated Tabulator tables from the research corpora, each with
 * sortable/filterable columns, CSV+JSON export, and its caveats rendered IN the UI.
 *
 * Design intent: present all the tabulator data and trees for the various tables
 * in list format, at full granularity.
 *
 * The tables are produced by library/scripts/research/build-tabulator-tables.mjs
 * — flat scalar rows, one row per fact, validated before write.
 *
 * WHY THE CAVEATS RENDER: a list view strips context. Someone reading
 * "Internet 12.6%" needs to know it is a NATIONAL figure, and someone reading a
 * network operator needs to know an ASN holder set includes banks as well as ISPs.
 * DataTable surfaces any meta key describing a limit, so the qualification travels
 * with the data instead of living in a file nobody opens.
 */
import { computed, inject, ref, watch } from 'vue'
import DataTable from '@map/components/tables/DataTable.vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'


const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

// Tab labels are keyCities.tables.tabs.<id> (the template translates them).
const TABS = [
  { id: 'cities',    file: 'key-cities' },
  // PER-CITY languages: 30 clusters have a bridge language spoken RIGHT THERE
  // that already carries a resource while the group's own language does not.
  { id: 'langcity',  file: 'languages-per-city' },
  { id: 'languages', file: 'languages-by-country' },
  { id: 'operators', file: 'network-operators' },
  { id: 'messaging', file: 'messaging-channels' },
  // Field-access/visa data is PRIVATE (kept outside the repo — release governance):
  // publishing it could accelerate access closures. Tab removed from the
  // public build; the dataset stays available for internal analysis.
]
const active = ref('cities')
const current = computed(() => TABS.find((t) => t.id === active.value) || TABS[0])

// TABLES ARE FETCHED AT RUNTIME, NOT IMPORTED. Static imports inlined 5.1MB of
// JSON into these bundles (2.0MB and 2.9MB) because the build is a single-file
// IIFE with inlineDynamicImports:true — every view then waits on one parse. Same
// trap that took the 100-list to 6MB. Fetching per tab keeps the bundle small AND
// means a user who never opens 'Social Platforms' never downloads it.
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
const table = computed(() => cache.value[current.value?.file] || null)

useShadowStyles(
  '.ct{position:absolute;inset:0;overflow-y:auto;padding:18px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.ct.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.ct-h{margin:0 0 4px;font-size:18px;font-weight:700}' +
  '.ct-sub{margin:0 0 14px;font-size:12.5px;opacity:.72;line-height:1.5}' +
  '.ct-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}' +
  '.ct-tab{font:600 12px inherit;padding:7px 14px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit}' +
  '.ct-tab.on{background:#10b981;border-color:#10b981;color:#04241a}' +
  '.ct-load{padding:22px;text-align:center;font-size:12.5px;opacity:.6}' +
  '.ct-err{padding:11px 13px;border-radius:8px;background:rgba(220,38,38,.10);color:#a12020;font-size:12.5px}' +
  '.ct-n{font-size:10.5px;opacity:.6;margin-left:5px;font-variant-numeric:tabular-nums}',
  'doxa-keycities-tables',
)
</script>

<template>
  <div class="ct" :class="{ 'is-dark': isDark }">
    <h2 class="ct-h">{{ $t('keyCities.tables.title') }}</h2>
    <p class="ct-sub">
      {{ $t('keyCities.tables.intro') }}
    </p>

    <div class="ct-tabs">
      <button v-for="tab in TABS" :key="tab.id" type="button"
        class="ct-tab" :class="{ on: active === tab.id }" @click="active = tab.id">
        {{ $t('keyCities.tables.tabs.' + tab.id) }}<span class="ct-n" v-if="cache[tab.file]">{{ (cache[tab.file].rows || []).length.toLocaleString() }}</span>
      </button>
    </div>

    <!-- :key forces a fresh Tabulator per tab rather than mutating one in place;
         swapping both columns AND data on a live instance is where column state
         (frozen, widths, filters) desynchronises from the new schema. -->
    <div v-if="loadErr" class="ct-err" role="alert">{{ $t('keyCities.loadFailed', { detail: loadErr }) }}</div>
    <div v-else-if="!table" class="ct-load">{{ $t('keyCities.tables.loading', { name: $t('keyCities.tables.tabs.' + current.id) }) }}</div>
    <DataTable
      v-else
      :key="current.id"
      :table="table"
      :assets-base="assetsBase"
      :is-dark="isDark"
      height="600px"
    />
  </div>
</template>
