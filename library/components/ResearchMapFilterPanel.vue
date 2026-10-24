<script setup>
/**
 * ResearchMapFilterPanel.vue — Multi-field filter UI for the research-map.
 *
 * Writes to mapStore.filters. The research-map profile watches that object
 * (deep) and forwards changes to useMapLayers.applyFilters() and
 * useMapClustering.applyFilters() — this component never touches the map.
 *
 * Filter shape (mirrors what useMapLayers expects):
 *   {
 *     populationMin: number | null,
 *     populationMax: number | null,
 *     engagement:    'any' | 'engaged' | 'unengaged',
 *     adoption:      'any' | 'adopted' | 'unadopted',
 *     languages:     string[]   // empty = no language filter
 *     religions:     string[]   // empty = no religion filter
 *   }
 *
 * Languages + religions options come from dataStore.facets (computed by
 * useMapData when normalizing). If facets aren't ready yet, we render a
 * placeholder so the panel never blocks initial paint.
 */
import { tStatic } from '@map/i18n/index.js'
// See ResearchMapSideMenu for why this reads the catalogue directly rather than through useI18n.
// Look in this panel's own namespace first, then the dashboard's: the same string can be authored
// in either, and a key that exists one namespace over should not silently render English. MEASURED:
// 'Any' and '0 active' were catalogued under dashboard.* while this file asked for controls.* only,
// so both fell back to English in all 11 locales while the catalogue already had them.
const L = (key, en) => tStatic('controls.' + key) || tStatic('dashboard.' + key) || en

import { inject, computed, watch, ref } from 'vue'
import { useShadowStyles } from '../composables/useShadowStyles.js'

const mapStore  = inject('mapStore')
const dataStore = inject('dataStore')

// ─── Default filter state — initialized into mapStore on mount ───────────────
const DEFAULTS = {
  populationMin: null,
  populationMax: null,
  engagement:    'any',
  adoption:      'any',
  languages:     [],
  religions:     []
}

if (mapStore && !mapStore.filters) mapStore.filters = { ...DEFAULTS }

// ─── Local two-way bindings (write through to mapStore.filters) ──────────────
const popMin = computed({
  get: () => mapStore?.filters?.populationMin ?? '',
  set: (v) => { mapStore.filters.populationMin = v === '' ? null : Number(v) }
})
const popMax = computed({
  get: () => mapStore?.filters?.populationMax ?? '',
  set: (v) => { mapStore.filters.populationMax = v === '' ? null : Number(v) }
})
const engagement = computed({
  get: () => mapStore?.filters?.engagement ?? 'any',
  set: (v) => { mapStore.filters.engagement = v }
})
const adoption = computed({
  get: () => mapStore?.filters?.adoption ?? 'any',
  set: (v) => { mapStore.filters.adoption = v }
})

// ─── Multi-select chips for language + religion ──────────────────────────────
const facets = computed(() => dataStore?.facets ?? {})
const languageOptions = computed(() => facets.value?.languages ?? [])
const religionOptions = computed(() => facets.value?.religions ?? [])

function toggleLang(name) {
  const arr = mapStore.filters.languages ?? []
  const idx = arr.indexOf(name)
  if (idx === -1) arr.push(name)
  else arr.splice(idx, 1)
  mapStore.filters.languages = [...arr]
}
function toggleRel(name) {
  const arr = mapStore.filters.religions ?? []
  const idx = arr.indexOf(name)
  if (idx === -1) arr.push(name)
  else arr.splice(idx, 1)
  mapStore.filters.religions = [...arr]
}

const langSearch = ref('')
const relSearch  = ref('')
const filteredLangs = computed(() => {
  const q = langSearch.value.trim().toLowerCase()
  return q ? languageOptions.value.filter(l => l.toLowerCase().includes(q)) : languageOptions.value
})
const filteredRels = computed(() => {
  const q = relSearch.value.trim().toLowerCase()
  return q ? religionOptions.value.filter(r => r.toLowerCase().includes(q)) : religionOptions.value
})

function isLangActive(name) { return (mapStore?.filters?.languages ?? []).includes(name) }
function isRelActive(name)  { return (mapStore?.filters?.religions ?? []).includes(name) }

// ─── Reset all ───────────────────────────────────────────────────────────────
function resetAll() {
  if (!mapStore) return
  mapStore.filters = { ...DEFAULTS, languages: [], religions: [] }
}

// ─── Active-count summary (for footer chip) ──────────────────────────────────
const activeCount = computed(() => {
  const f = mapStore?.filters ?? {}
  let n = 0
  if (f.populationMin != null) n++
  if (f.populationMax != null) n++
  if (f.engagement && f.engagement !== 'any') n++
  if (f.adoption   && f.adoption   !== 'any') n++
  if (f.languages?.length) n++
  if (f.religions?.length) n++
  return n
})

useShadowStyles(`
  .rm-filter { display:flex;flex-direction:column;gap:14px;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e7ebf0; }
  .rm-filter .row { display:flex;align-items:center;gap:8px; }
  .rm-filter label { font-size:11px;color:#a8b2bd;letter-spacing:.04em;text-transform:uppercase;font-weight:600; }
  .rm-filter .field { display:flex;flex-direction:column;gap:4px; }
  .rm-filter input[type=number],
  .rm-filter select,
  .rm-filter input[type=search] { background:#0f1216;border:1px solid #2c343f;color:#e7ebf0;padding:6px 8px;border-radius:5px;font-size:12px;min-width:0;flex:1; }
  /* ALL search bars = exactly 35px tall, desktop AND mobile. These side-menu
     filter search inputs are "search bar instances" too.
     box-sizing:border-box pins it to exactly 35px. */
  .rm-filter input[type=search] { height:35px;box-sizing:border-box; }
  .rm-filter input:focus,
  .rm-filter select:focus { outline:none;border-color:#7c8cf8; }
  .rm-pop-row { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
  .rm-chips { display:flex;flex-wrap:wrap;gap:5px;max-height:140px;overflow-y:auto;padding:4px 2px;border:1px solid #232a33;border-radius:5px;background:#0f1216; }
  .rm-chip { background:#232a33;border:1px solid #2c343f;color:#e7ebf0;padding:3px 8px;border-radius:11px;cursor:pointer;font-size:11px;line-height:1.4; }
  .rm-chip:hover { background:#2c343f; }
  .rm-chip.active { background:rgba(124,140,248,0.18);border-color:#7c8cf8;color:#a8b8ff; }
  .rm-empty { padding:8px;color:#a8b2bd;font-size:11px;text-align:center; }
  .rm-filter-footer { display:flex;align-items:center;justify-content:space-between;margin-top:6px; }
  .rm-pill { background:rgba(124,140,248,0.12);color:#a8b8ff;padding:2px 8px;border-radius:11px;font-size:11px;font-weight:600; }
  .rm-link-btn { background:none;border:none;color:#7c8cf8;cursor:pointer;font-size:11px;padding:0; }
  .rm-link-btn:hover { text-decoration:underline; }
  /* WCAG 2.5.8 at EVERY pointer, not only coarse: a 24x24 hit area that adds no box (the f29b8151 pattern). */
  .rm-link-btn{position:relative;}.rm-link-btn::after{content:'';position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);}
  /* WCAG 2.5.8 Target Size (Minimum), AA = 24x24 CSS px. Scoped to (pointer:coarse):
     2.5.8 governs touch ergonomics, and these are SHARED components sitting on maps this
     change does not own -- a finger gets the bigger target, the mouse keeps the density
     those owners designed. min-height states the 24 rather than deriving it from a font. */
  @media (pointer:coarse) { .rm-link-btn { min-height: 24px; } }
`, 'research-map-filter-panel')
</script>

<template>
  <div class="rm-filter">
    <!-- Population range ──────────────────────────────────────────────── -->
    <div class="field">
      <label>{{ L('population', 'Population') }}</label>
      <div class="rm-pop-row">
        <input type="number" min="0" :placeholder="L('min', 'min')" :value="popMin" @input="popMin = $event.target.value" />
        <input type="number" min="0" :placeholder="L('max', 'max')" :value="popMax" @input="popMax = $event.target.value" />
      </div>
    </div>

    <!-- Engagement / adoption status ──────────────────────────────────── -->
    <div class="field">
      <label>{{ L('engagement', 'Engagement') }}</label>
      <select :value="engagement" @change="engagement = $event.target.value">
        <option value="any">{{ L('any', 'Any') }}</option>
        <option value="engaged">{{ L('engaged', 'Engaged') }}</option>
        <option value="unengaged">{{ L('unengaged', 'Unengaged') }}</option>
      </select>
    </div>
    <div class="field">
      <label>{{ L('adoption', 'Adoption') }}</label>
      <select :value="adoption" @change="adoption = $event.target.value">
        <option value="any">{{ L('any', 'Any') }}</option>
        <option value="adopted">{{ L('adopted', 'Adopted') }}</option>
        <option value="unadopted">{{ L('unadopted', 'Unadopted') }}</option>
      </select>
    </div>

    <!-- Language multi-select ─────────────────────────────────────────── -->
    <div class="field">
      <label>{{ L('language', 'Language') }}</label>
      <input type="search" v-model="langSearch" :placeholder="L('search_languages', 'Search languages…')" />
      <div class="rm-chips">
        <span v-if="!filteredLangs.length" class="rm-empty">{{ L('no_languages', 'No languages loaded yet') }}</span>
        <button
          v-for="lang in filteredLangs"
          :key="lang"
          class="rm-chip"
          :class="{ active: isLangActive(lang) }"
          @click="toggleLang(lang)"
        >{{ lang }}</button>
      </div>
    </div>

    <!-- Religion multi-select ─────────────────────────────────────────── -->
    <div class="field">
      <label>{{ L('religion', 'Religion') }}</label>
      <input type="search" v-model="relSearch" :placeholder="L('search_religions', 'Search religions…')" />
      <div class="rm-chips">
        <span v-if="!filteredRels.length" class="rm-empty">{{ L('no_religions', 'No religions loaded yet') }}</span>
        <button
          v-for="rel in filteredRels"
          :key="rel"
          class="rm-chip"
          :class="{ active: isRelActive(rel) }"
          @click="toggleRel(rel)"
        >{{ rel }}</button>
      </div>
    </div>

    <!-- Footer: active count + reset link ─────────────────────────────── -->
    <div class="rm-filter-footer">
      <span class="rm-pill">{{ L('active_count', '{n} active').replace('{n}', activeCount) }}</span>
      <button class="rm-link-btn" @click="resetAll">{{ L('reset_all', 'Reset all') }}</button>
    </div>
  </div>
</template>
