<script setup>
/**
 * BpResearchHeader.vue — the Cat-1 Unified Research Dashboard header (nested element).
 *
 * The "search bar + dropdowns ON TOP" that drives the people-groups grid BELOW it.
 * Lifted out into its own individually-embeddable element (<bp-research-header>) so it can
 * DRIVE the cap-2 people-groups grid (or any host page's grid) via props/events.
 *
 * ── REFACTOR (card BUILD-G1-CAT4-BIG-PICTURE-DASHBOARD) ──────────────────────────
 *   The hand-rolled `<input type="search">` + the two native `<select>` dropdowns
 *   (the "glitchy search bars") are GONE. They are replaced by the SHARED, one-source
 *   controls consumed by BOTH plugins so there is no duplication:
 *     - `<SearchBar>`        (@map/components/search/SearchBar.vue)     — on top.
 *     - FOUR `<FilterDropdown>` (@map/components/search/FilterDropdown.vue) below it:
 *         Region / Block / People-Group / Religion.  (Country deliberately EXCLUDED.)
 *   These are the SAME four axes the cap-2 people-groups-grid exposes, so the header
 *   drives the real grid 1:1.
 *
 * THE CAT-1 HEADER CONTRACT
 *   - Owns a search box + the four filter dropdowns.
 *   - EMITS `research-filter` on every change — the SAME event name as before, but the
 *     payload is EXTENDED to carry the four dropdown values (the two old {region,status}
 *     synthetic facets are replaced by the four real grid axes):
 *         { query, wagfRegion, wagfBlock, rop1, religion }
 *     Emitted BOTH as a Vue emit AND as a native bubbling+composed DOM CustomEvent so a
 *     plain host page (deploy-method-3, direct-JS) hears it and can drive a standalone grid.
 *   - Accepts an optional `count` prop so the composite can reflect the live matched count
 *     back up into the header (data flows down, event flows up — no shared bus).
 *
 * DROPDOWN OPTIONS (real, faceted)
 *   The header fetches the SAME live people-groups list the cap-2 grid fetches
 *   (`${prayBaseUrl}/api/people-groups/list`, default https://pray.doxa.life) and extracts
 *   the option lists + counts for the four axes with the SAME extraction the grid uses.
 *   This keeps the grid UNTOUCHED (this plugin owns only its own folder) while giving the
 *   header dropdowns real values that match the grid exactly. If the fetch fails the header
 *   still renders (empty dropdowns degrade to search-only) — the grid remains authoritative.
 */
import { ref, reactive, watch, computed, onMounted, getCurrentInstance } from 'vue'
// SHARED search primitives (one source of truth for BOTH cap-2 grid + cap-1 dashboard).
import SearchBar from '@map/components/search/SearchBar.vue'
import FilterDropdown from '@map/components/search/FilterDropdown.vue'
import { tStatic } from '@map/i18n/index.js'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'
import { hostElement } from '@map/utils/hostElement.js'

// ★ THIS HEADER HAD NO i18n AT ALL, and it is the top of Big Picture. Every label below was an
// English literal passed as a PROP — FilterDropdown itself translates nothing, it renders what the
// caller hands it, so a perfectly localized component showed "Region" on an Arabic page. Read
// through tStatic rather than useI18n, for the reason the rest of this tree gives: these components
// mount inside custom elements that install no i18n plugin, and an unguarded useI18n() throws on
// the way in and takes the whole header with it.
//
// The grid namespace first, because this header drives the cap-2 grid and its sibling reads the
// same keys; dashboard.* second; the English literal last, so a missing key degrades to what
// shipped rather than to a key name.
const L = (key, en) => tStatic('grid.' + key) || tStatic('dashboard.' + key) || en

const props = defineProps({
  // live count of matched groups, pushed back down by the composite for display.
  count: { type: [Number, String], default: null },
  title: { type: String, default: 'Unified Research Dashboard' },
  accent: { type: String, default: '#8b5cf6' },
  // injected data host so the header builds its dropdown options from the SAME source the grid uses.
  prayBaseUrl:  { type: String, default: '' },
  languageCode: { type: String, default: '' },
  // the composite's profile-config (JSON), for its people-group LIST (library/lists/).
  profileConfig: { type: String, default: '' },
})
const emit = defineEmits(['research-filter'])

const prayBaseUrl  = computed(() => props.prayBaseUrl || 'https://pray.doxa.life')
const languageCode = computed(() => props.languageCode || '')

// ── unified filter state ─────────────────────────────────────────────────────
const query = ref('')
// the FOUR grid axes (Country deliberately excluded): Region / Block / People-Group / Religion.
const sel = reactive({ wagf_region: '', wagf_block: '', rop1: '', religion: '' })

// option lists (with faceted counts) built from the live list — the SAME shape FilterDropdown wants.
const options = reactive({ wagf_region: [], wagf_block: [], rop1: [], religion: [] })

const hasAny = computed(() => Boolean(query.value || sel.wagf_region || sel.wagf_block || sel.rop1 || sel.religion))

// ── native + Vue emit of the unified filter ──────────────────────────────────
const inst = getCurrentInstance()
const hostEl = () => hostElement(inst)
function fire() {
  const detail = {
    query: query.value,
    wagfRegion: sel.wagf_region,
    wagfBlock: sel.wagf_block,
    rop1: sel.rop1,
    religion: sel.religion,
  }
  emit('research-filter', detail)
  const el = hostEl()
  if (el && typeof el.dispatchEvent === 'function') {
    el.dispatchEvent(new CustomEvent('research-filter', { detail, bubbles: true, composed: true }))
  }
}
// fire on ANY control change (and once on mount so a driven grid starts in sync).
watch([query, () => sel.wagf_region, () => sel.wagf_block, () => sel.rop1, () => sel.religion], fire, { immediate: true })

// ── shared-control event handlers ────────────────────────────────────────────
function onSearch(payload) { query.value = payload?.value ?? '' }
function onFilterChange(detail) { if (detail?.name in sel) sel[detail.name] = detail.value }
function onFilterClear(detail) { if (detail?.name in sel) sel[detail.name] = '' }

function reset() {
  query.value = ''
  sel.wagf_region = ''; sel.wagf_block = ''; sel.rop1 = ''; sel.religion = ''
}

// ── build the four dropdown option lists from the SAME live list the grid fetches ──
function extractFrom(list, field) {
  const counts = new Map()
  for (const u of list) {
    const vl = u[field]
    if (!vl?.value) continue
    const existing = counts.get(vl.value)
    if (existing) existing.count++
    else counts.set(vl.value, { label: vl.label, count: 1 })
  }
  return Array.from(counts.entries())
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

async function loadOptions() {
  const url = `${prayBaseUrl.value}/api/people-groups/list?fields=name,slug,wagf_region,wagf_block,country_code,rop1,religion&lang=${languageCode.value}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    // Options come from the groups this page's people-group LIST shows (library/lists/).
    const list = await applyPeopleGroupList(Array.isArray(data.posts) ? data.posts : [], props.profileConfig)
    options.wagf_region = extractFrom(list, 'wagf_region')
    options.wagf_block  = extractFrom(list, 'wagf_block')
    options.rop1        = extractFrom(list, 'rop1')
    options.religion    = extractFrom(list, 'religion')
  } catch (error) {
    // Non-fatal: header still renders; dropdowns degrade to empty, search stays live.
    console.error('[bp-research-header] options fetch error:', error)
  }
}

onMounted(loadOptions)
</script>

<template>
  <div class="rh-root" role="banner" :style="{ '--accent': accent }">
    <div class="rh-title">
      <span class="rh-dot" aria-hidden="true"></span>
      <h1>{{ title }}</h1>
      <!-- aria-live=polite: a screen reader hears the live matched count change as the user
           searches/filters ("15 shown"). role=status keeps it an unobtrusive announcement. -->
      <span
        v-if="count !== null && count !== ''"
        class="rh-count"
        role="status"
        aria-live="polite"
      >{{ (L('n_shown', '') || tStatic('dashboard.n_shown') || '{n} shown').replace('{n}', count) }}</span>
    </div>

    <!-- SHARED SearchBar on top (replaces the hand-rolled <input type="search">). -->
    <div class="rh-search">
      <SearchBar
        :model-value="query"
        :placeholder="L('search_people_or_countries', 'Search people groups or countries…')"
        :aria-label="tStatic('aria.searchPeopleGroups') || 'Search people groups'"
        @search="onSearch"
      />
    </div>

    <!-- The FOUR SHARED FilterDropdowns (replace the two native <select>s). -->
    <div class="rh-controls">
      <FilterDropdown
        :label="L('wagf_region', 'Region')" name="wagf_region"
        :options="options.wagf_region" :value="sel.wagf_region"
        @filter-change="onFilterChange" @filter-clear="onFilterClear"
      />
      <FilterDropdown
        :label="L('wagf_block', 'Bloc')" name="wagf_block"
        :options="options.wagf_block" :value="sel.wagf_block"
        @filter-change="onFilterChange" @filter-clear="onFilterClear"
      />
      <FilterDropdown
        :label="L('rop1', 'People Group')" name="rop1"
        :options="options.rop1" :value="sel.rop1"
        @filter-change="onFilterChange" @filter-clear="onFilterClear"
      />
      <FilterDropdown
        :label="L('religion', 'Religion')" name="religion"
        :options="options.religion" :value="sel.religion"
        @filter-change="onFilterChange" @filter-clear="onFilterClear"
      />
      <button
        v-if="hasAny"
        class="rh-reset"
        type="button"
        :aria-label="tStatic('aria.resetAllFilters') || 'Reset all filters and search'"
        @click="reset"
      >{{ L('reset_all', '') || tStatic('controls.reset_all') || 'Reset' }}</button>
    </div>
  </div>
</template>

<style>
.rh-root { width: 100%; box-sizing: border-box; padding: 14px 16px;
  background: #111827; color: #e5e7eb; border-bottom: 1px solid #1f2937;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  display: flex; flex-direction: column; gap: 12px; }
.rh-title { display: flex; align-items: center; gap: 10px; }
.rh-title h1 { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.rh-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 12px var(--accent); }
.rh-count { margin-left: auto; font: 700 12px/1 ui-monospace, monospace; color: var(--accent); }
/* The search box + dropdowns are the SHARED @map controls (self-styling in the shadow root);
   these wrappers only handle layout inside the dark header. */
.rh-search { display: flex; }
.rh-controls { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; }
.rh-reset { padding: 8px 12px; background: transparent; border: 1px solid #1f2937;
  border-radius: 8px; color: #94a3b8; font-size: 13px; cursor: pointer; }
.rh-reset:hover { border-color: var(--accent); color: #e5e7eb; }
</style>
