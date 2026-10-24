<script setup>
/**
 * DetailDrawer — RDASH P3: docked detail panel at the TOP of the right rail (above ChartsRail).
 * Surfaces the rich, otherwise-unused fields of a single people group (thumbnail, religion,
 * language family, praying/committed/adopted counts, engagement) the moment a row is focused
 * (bus 'focusRow') or selected (bus 'select'). Stays compact when nothing is active so the map
 * keeps its space. All CSS via useShadowStyles (scoped <style> is dropped in the defineCustomElement
 * shadow-DOM build); tokens only, 1px --rd-line border, no shadow. image_url is runtime API data,
 * not a baked asset — safe to render in an <img>.
 *
 * Config-driven (DOXA-LIB-2): the per-dashboard constants (FACET_ACC for the CSV exporter and the
 * photo test) are read from inject('dashboardConfig') instead of being hard-coded. Rendering and
 * behavior are unchanged from the source panel.
 */
import { inject, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This drawer's chrome, read out of the catalogue. tStatic and not useI18n: these components mount
// inside custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way
// in and takes the panel with it. The English stays as the fallback so a missing key degrades to
// what shipped rather than to a key name.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useCsvExport } from '@map/composables/useCsvExport.js'
import { formatCount } from '@map/utils/formatCount.js'
import { useTreeLegendLabels } from '../../composables/useTreeLegendLabels.js'
import { lbl } from '@map/composables/useFacetAggregation.js'

const dash = inject('dashboardData', null)
const bus = inject('selectionBus', null)
const cfg = inject('dashboardConfig', {})

const FACET_ACC = Object.fromEntries(Object.entries(cfg.facets || {}).map(([k, f]) => [k, f.get]))
// labelFor resolves People CODES to names in the export's provenance COMMENT line only — the data
// columns are untouched.
const { labelFor: csvLabelFor } = useTreeLegendLabels(cfg, inject('dataStore', null), inject('searchSourceId', null))
const exporter = (dash && bus)
  ? useCsvExport({ rowStore: dash.rowStore, rows: dash.rows, selectionSet: bus.selectionSet, filterSet: bus.filterSet, FACET_ACC, labelFor: csvLabelFor })
  : null

const activeSlug = ref(null)
const unsubs = []
onMounted(() => {
  if (!bus) return
  unsubs.push(bus.on('focusRow', (p) => { if (p && p.slug) activeSlug.value = p.slug }))
  unsubs.push(bus.on('select', (set) => { const arr = set ? [...set] : []; if (arr.length) activeSlug.value = arr[arr.length - 1] }))
})
onBeforeUnmount(() => { unsubs.forEach((u) => { try { u() } catch (_) {} }); unsubs.length = 0 })

const record = computed(() => {
  const s = activeSlug.value
  if (!s || !dash || !dash.rowStore || !dash.rowStore.value) return null
  return dash.rowStore.value.get(s) || null
})
// This one treats '' as missing and shows an em dash; the table does not. Preserved exactly.
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : formatCount(n))
const showPhoto = computed(() => {
  const r = record.value
  if (!r) return false
  return (cfg.detail && typeof cfg.detail.photo === 'function') ? !!cfg.detail.photo(r) : !!(r.has_photo && r.image_url)
})

// ── Pray-for + More-information affordances (parity with research-map's
//    PeopleGroupDetail). We can't reuse that component here — it hard-injects
//    the map `uiStore`, pulls vue-i18n, and expects a GeoJSON
//    `peopleGroup.properties.*` shape, none of which exist in the dashboard
//    shell (flat `record` + dashboardData/dashboardConfig injects). So we
//    mirror just its two CTAs, styled with the --rd-* tokens below.
//
// Targets stay reusable via cfg.detail.{prayUrl,moreInfoUrl,prayLabel,
// moreInfoLabel}. Each URL spec may be a function (record) => string, or a
// string template with a {slug} placeholder; defaults derive from record.slug
// and mirror research-map's prayUrl()/researchUrl().
const detailCfg = computed(() => cfg.detail || {})
function resolveUrl(spec, r, fallback) {
  if (typeof spec === 'function') { try { return spec(r) || fallback } catch (_) { return fallback } }
  if (typeof spec === 'string' && spec) return spec.replace('{slug}', encodeURIComponent(r.slug || ''))
  return fallback
}
const prayHref = computed(() => {
  const r = record.value
  if (!r) return null
  // utm_source: outbound-traffic attribution (see PeopleGroupDetail.vue) — cfg
  // override wins; default 'agwm'.
  const utmUrl = (() => { try { return new URLSearchParams(window.location.search).get('utm_source') || '' } catch (_) { return '' } })()
  const utm = encodeURIComponent(String(utmUrl || detailCfg.value.utmSource || cfg.utmSource || 'agwm'))
  const def = `https://pray.doxa.life/${encodeURIComponent(r.slug || '')}?source=doxalife&utm_source=${utm}`
  return resolveUrl(detailCfg.value.prayUrl, r, def)
})
const moreInfoHref = computed(() => {
  const r = record.value
  if (!r) return null
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://doxa.life'
  const utmUrl = (() => { try { return new URLSearchParams(window.location.search).get('utm_source') || '' } catch (_) { return '' } })()
  const utm = encodeURIComponent(String(utmUrl || detailCfg.value.utmSource || cfg.utmSource || 'agwm'))
  const def = `${origin}/research/${encodeURIComponent(r.slug || '')}/?utm_source=${utm}`
  return resolveUrl(detailCfg.value.moreInfoUrl, r, def)
})
const prayLabel = computed(() => detailCfg.value.prayLabel || T('dashboard.pray_for_group', 'Pray for this people group'))
const moreInfoLabel = computed(() => detailCfg.value.moreInfoLabel || T('dashboard.more_information', 'More information'))

function exportThis() {
  if (!exporter || !bus) return
  if (!bus.selectionSet.size && activeSlug.value) bus.toggleSelect(activeSlug.value)
  exporter.exportCsv()
}

// Dismiss the detail: clear the focused slug AND the bus selection so the pick is
// deselected everywhere (drawer + map highlight + table), mirroring research-map's
// PeopleGroupDetail close. Without this the popup had no way to close.
function clearDetail() {
  activeSlug.value = null
  if (bus && typeof bus.clearSelection === 'function') bus.clearSelection()
}

useShadowStyles(`
  .rd-detail{ box-sizing:border-box; background:var(--rd-panel,#fff); border-inline-start:1px solid var(--rd-line, #d1d4cd);
    border-bottom:1px solid var(--rd-line, #d1d4cd); padding:var(--s3,12px);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:var(--rd-ink, #3b463d); flex:0 0 auto; }
  .rd-detail .rd-dh{ display:flex; align-items:center; justify-content:space-between; gap:8px;
    font-weight:700; font-size:var(--fs-md,12px); text-transform:uppercase; letter-spacing:.5px;
    color:var(--rd-muted, #6d766e); margin-bottom:var(--s2,8px); }
  .rd-detail .rd-detail-close{ background:none; border:none; padding:2px 4px; cursor:pointer; line-height:1;
    font-size:15px; color:var(--rd-muted, #6d766e); border-radius:var(--r-md,6px); flex-shrink:0; }
  .rd-detail .rd-detail-close:hover{ color:var(--rd-ink, #3b463d); background:var(--rd-bg, #f3f3f1); }
  .rd-detail .rd-empty{ font-size:var(--fs-md,12px); color:var(--rd-muted, #6d766e); padding:var(--s1,4px) 0; }
  .rd-detail .rd-top{ display:flex; gap:var(--s3,12px); align-items:flex-start; }
  .rd-detail .rd-thumb{ width:64px; height:64px; border-radius:var(--r-md,6px); object-fit:cover; flex:0 0 auto;
    border:1px solid var(--rd-line, #d1d4cd); display:block; }
  .rd-detail .rd-ph{ width:64px; height:64px; border-radius:var(--r-md,6px); flex:0 0 auto; background:var(--rd-bg, #f3f3f1);
    border:1px solid var(--rd-line, #d1d4cd); display:flex; align-items:center; justify-content:center;
    color:var(--rd-muted, #6d766e); font-size:var(--fs-xs,10px); text-transform:uppercase; letter-spacing:.4px; }
  .rd-detail .rd-name{ font-weight:800; font-size:var(--fs-xl,16px); line-height:1.2; color:var(--rd-ink, #3b463d); }
  .rd-detail .rd-meta{ font-size:var(--fs-sm,11px); color:var(--rd-muted, #6d766e); margin-top:2px; }
  .rd-detail .rd-rows{ display:flex; flex-direction:column; gap:2px; margin-top:var(--s3,12px); }
  .rd-detail .rd-row{ display:flex; align-items:baseline; gap:var(--s2,8px); font-size:var(--fs-md,12px);
    padding:2px 0; border-bottom:1px solid var(--rd-line, #d1d4cd); }
  .rd-detail .rd-row:last-child{ border-bottom:0; }
  .rd-detail .rd-row .k{ color:var(--rd-muted, #6d766e); flex:0 0 auto; min-width:118px; }
  .rd-detail .rd-row .v{ color:var(--rd-ink, #3b463d); margin-inline-start:auto; text-align:end; font-variant-numeric:tabular-nums; }
  .rd-detail .rd-row .v .fam{ color:var(--rd-muted, #6d766e); }
  .rd-detail .rd-exp{ margin-top:var(--s3,12px); width:100%; border:0; border-radius:var(--r-md,6px); cursor:pointer;
    background:var(--rd-accent,#e67e22); color:#fff; font-weight:700; font-size:var(--fs-md,12px); padding:var(--s2,8px) var(--s3,12px); }
  .rd-detail .rd-exp:hover{ background:#d8741c; }
  .rd-detail .rd-actions{ display:flex; gap:var(--s2,8px); margin-top:var(--s3,12px); flex-wrap:wrap; }
  .rd-detail .rd-act{ display:inline-flex; align-items:center; justify-content:center; gap:6px; text-decoration:none;
    border:0; border-radius:var(--r-md,6px); cursor:pointer; font-weight:700; font-size:var(--fs-md,12px);
    padding:var(--s2,8px) var(--s3,12px); line-height:1; }
  .rd-detail .rd-act svg{ flex:0 0 auto; }
  .rd-detail .rd-act-pray{ flex:1 1 auto; background:var(--rd-pray,#73a17f); color:#fff; }
  .rd-detail .rd-act-pray:hover{ background:var(--rd-pray-hover,#5f8c6a); }
  .rd-detail .rd-act-info{ flex:0 1 auto; background:var(--rd-bg, #f3f3f1); color:var(--rd-ink, #3b463d);
    border:1px solid var(--rd-line, #d1d4cd); }
  .rd-detail .rd-act-info:hover{ background:var(--rd-panel,#fff); border-color:var(--rd-muted, #6d766e); }
`, 'rd-detaildrawer')
</script>

<template>
  <section class="rd-detail" data-region="detail-drawer">
    <div class="rd-dh">
      <span>{{ T('dashboard.detail', 'Detail') }}</span>
      <button v-if="record" class="rd-detail-close" type="button" :aria-label="T('aria.closeDetail', 'Close detail')" data-detail-close @click="clearDetail">✕</button>
    </div>
    <div v-if="!record" class="rd-empty" data-detail-empty>{{ T('dashboard.detail_empty', 'Select a people group to see detail') }}</div>
    <template v-else>
      <div class="rd-top">
        <img v-if="showPhoto" class="rd-thumb" :src="record.image_url" :alt="record.name" data-detail-thumb />
        <div v-else class="rd-ph" data-detail-thumb>{{ T('dashboard.no_photo', 'No photo') }}</div>
        <div>
          <div class="rd-name" data-detail-name>{{ record.name || '—' }}</div>
          <div class="rd-meta">{{ lbl(record.country_code) || '—' }} · {{ lbl(record.religion) || '—' }}</div>
        </div>
      </div>
      <div class="rd-actions">
        <a v-if="prayHref" class="rd-act rd-act-pray" :href="prayHref" target="_blank" rel="noopener" :title="prayLabel" data-detail-pray>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2L10 6L14 6.5L11 9.5L11.5 14L8 12L4.5 14L5 9.5L2 6.5L6 6L8 2Z" fill="currentColor"/></svg>
          <span>{{ prayLabel }}</span>
        </a>
        <a v-if="moreInfoHref" class="rd-act rd-act-info" :href="moreInfoHref" target="_blank" rel="noopener" :title="moreInfoLabel" data-detail-moreinfo>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 6V8M8 10H8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>{{ moreInfoLabel }}</span>
        </a>
      </div>
      <div class="rd-rows">
        <div class="rd-row"><span class="k">{{ T('dashboard.language', 'Language') }}</span><span class="v">{{ lbl(record.primary_language) || '—' }}<span v-if="record.imb_language_family" class="fam"> ({{ record.imb_language_family }})</span></span></div>
        <div class="rd-row"><span class="k">{{ T('dashboard.population', 'Population') }}</span><span class="v">{{ fmt(record.population) }}</span></div>
        <div class="rd-row"><span class="k">{{ T('dashboard.people_praying', 'People praying') }}</span><span class="v">{{ fmt(record.people_praying) }}</span></div>
        <div class="rd-row"><span class="k">{{ T('dashboard.people_committed', 'People committed') }}</span><span class="v">{{ fmt(record.people_committed) }}</span></div>
        <div class="rd-row"><span class="k">{{ T('dashboard.adopted_by_churches', 'Adopted by churches') }}</span><span class="v">{{ fmt(record.adopted_by_churches) }}</span></div>
        <div class="rd-row"><span class="k">{{ T('dashboard.engagement', 'Engagement') }}</span><span class="v">{{ lbl(record.engagement_status) || '—' }}</span></div>
      </div>
      <button class="rd-exp" type="button" data-detail-export @click="exportThis">{{ T('dashboard.export_selection', 'Export this selection') }} ↓</button>
    </template>
  </section>
</template>
