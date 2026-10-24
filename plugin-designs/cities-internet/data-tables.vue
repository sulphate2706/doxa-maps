<script setup>
/**
 * data-tables.vue — the CITIES DATA list view: every research table, one tab each.
 *
 * @description Four validated research tables, one tab each, with sortable and filterable columns, CSV and JSON
 *   export, and each table's caveats rendered in the UI rather than hidden in a footnote.
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
import { useOptionalT, fillParams } from '@map/composables/useOptionalT.js'
import { tStatic } from '@map/i18n/index.js'


const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

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

const TABS = [
  { id: 'cities',     file: 'key-cities' },
  { id: 'internet',   file: 'country-connectivity' },
  { id: 'operators',  file: 'network-operators' },
  { id: 'social',     file: 'social-platforms' },
  // Messaging apps are the channel referral stats CANNOT see — WhatsApp tops 54
  // countries, Telegram 38, and neither appears in StatCounter at all.
  { id: 'messaging',  file: 'messaging-channels' },
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
    if (!r.ok) throw new Error(String(r.status))
    cache.value = { ...cache.value, [file]: await r.json() }
  } catch (_) {
    // The reader sees the shared, translated "Could not load {name}." (qualified via tStatic: this file's
    // t() would prefix connectivity.), naming the tab in their language; the status went to the console.
    const tab = TABS.find((x) => x.file === file)
    loadErr.value = fillParams(tStatic('messages.couldNotLoadNamed'), { name: tab ? t('tables.tabs.' + tab.id) : file })
  }
  finally { loading.value = false }
}
watch(current, (t) => t && ensure(t.file), { immediate: true })
const table = computed(() => cache.value[current.value?.file] || null)

useShadowStyles(
  // ★ THE TABLE MUST STAY INSIDE ITS HOST BOX — the same defect and the same fix as connectivity-list.
  // With no :host rule the element is inline with no height, and .ct (position:absolute;inset:0)
  // resolved against the partner page's positioned ancestor instead of this element. Measurement showed
  // content painting to y=1,698, which is 1,254px BELOW a 420px host box.
  // .ct already has overflow-y:auto, so containing it is enough to make the table scroll in the box.
  ':host{display:block;position:relative;width:100%;height:100%;min-height:320px}' +
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
  'doxa-cities-tables',
)
</script>

<template>
  <div class="ct" :class="{ 'is-dark': isDark }">
    <h2 class="ct-h">{{ t('connectivity.tables.title') }}</h2>
    <p class="ct-sub">{{ t('connectivity.tables.intro') }}</p>

    <div class="ct-tabs">
      <button v-for="tab in TABS" :key="tab.id" type="button"
        class="ct-tab" :class="{ on: active === tab.id }" @click="active = tab.id">
        {{ t('connectivity.tables.tabs.' + tab.id) }}<span class="ct-n" v-if="cache[tab.file]">{{ num((cache[tab.file].rows || []).length) }}</span>
      </button>
    </div>

    <!-- :key forces a fresh Tabulator per tab rather than mutating one in place;
         swapping both columns AND data on a live instance is where column state
         (frozen, widths, filters) desynchronises from the new schema. -->
    <div v-if="loadErr" class="ct-err">{{ loadErr }}</div>
    <div v-else-if="!table" class="ct-load">{{ t('connectivity.tables.loading', { name: t('connectivity.tables.tabs.' + current.id) }) }}</div>
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
