<script setup>
/**
 * PinDetailCard.vue — replaces the SemanticTreeLegend when a pin is clicked.
 *
 * Per QA defining-constrained-problem1.md: "when someone clicks on a people group,
 * it converts the legend into a display section for the people groups, reusing the
 * same component slot." We don't reuse SemanticTreeLegend's component but we DO
 * reuse its CSS aesthetic (rounded card, dark theme, slide-collapse) so the swap
 * feels seamless.
 *
 * Reads `instance.pinDetail` (set by the profile when a pin click fires) and
 * shows: name, country, religion + color dot, language, all cross-system IDs
 * (IMB / JP / WCD / PEID / ROP fields), plus "Locate on map" and "Close" actions.
 *
 * Architecture: Same instance store as legend + geocoder. Closing this card
 * (X button or Esc) clears instance.pinDetail and the legend reappears.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useInstance } from '@map/composables/usePplrInstance.js'
import { LOCALES, LOCALE_NAMES } from '../utils/pplrMap.js'
import { loadNames } from '../utils/pplrData.js'
import { usePplrT } from '../composables/usePplrT.js'

const props = defineProps({
  /** Optional override — usually read from instance.pinDetail */
  pin:    { type: Object, default: null },
  /** Optional color resolver: kind→color (e.g., bloc color, religion color) */
  color:  { type: String, default: '#73A17F' },
})

const emit = defineEmits(['close', 'locate'])

const instance = useInstance()
const tr = usePplrT()   // not `t`: the names table below is already called t
const pinData = computed(() => props.pin || instance?.pinDetail.value || null)

// All 17 locale names for this PG (n_en, n_hi, n_bn, …). The popup-style
// display couldn't show all 17, so they render as their own
// scrollable section in the sidebar with "—" placeholders for missing locales.
// The 17 names no longer ride on every pin (they were two-thirds of the 23 MB points file); they
// load from pg-names.json the first time a card opens, keyed by PG code in LOCALES order.
const namesTable = ref(null)
watch(pinData, (p) => {
  if (p && !namesTable.value) loadNames().then((t) => { namesTable.value = t }).catch(() => {})
}, { immediate: true })
const locales = computed(() => {
  if (!pinData.value) return []
  const p = pinData.value
  const t = namesTable.value
  const row = t && t.names[p.code]
  return LOCALES.map((code, i) => ({
    code,
    name:  LOCALE_NAMES[code] || code,
    value: p[`n_${code}`] || (row && row[t.locales.indexOf(code)]) || null,
  }))
})

const fields = computed(() => {
  if (!pinData.value) return []
  const p = pinData.value
  const dash = v => (v == null || v === 'None' || v === '' || v === '*') ? '—' : v
  // Curated field order — most identifying first, registry IDs last
  return [
    { label: tr('pplr.popup.country'),       value: dash(p.country),  mono: false },
    { label: tr('pplr.popup.religion'),      value: dash(p.religion), mono: false },
    { label: tr('pplr.popup.language'),      value: dash(p.language), mono: false },
    { label: tr('pplr.popup.iso3Country'),   value: dash(p.iso3),     mono: true,  hidden: !p.iso3 },
    { label: tr('pplr.popup.affinityBloc'),  value: dash(p.rop1),     mono: true,  hidden: !p.rop1 },
    { label: tr('pplr.popup.peopleCluster'), value: dash(p.rop2),     mono: true,  hidden: !p.rop2 },
    { label: 'ROP25',          value: dash(p.rop3),     mono: true,  hidden: !p.rop3 },
    { label: 'PGIC GeoID',     value: dash(p.rop25),    mono: true,  hidden: !p.rop25 },
    { label: 'PEID',           value: dash(p.peid),     mono: true,  hidden: !p.peid },
    { label: 'IMB PGID',       value: dash(p.imb),      mono: true,  hidden: !p.imb },
    { label: 'Joshua Project', value: dash(p.jp),       mono: true,  hidden: !p.jp },
    { label: 'WCD',            value: dash(p.wcd),      mono: true,  hidden: !p.wcd },
  ].filter(f => !f.hidden)
})

function close() {
  if (instance) instance.pinDetail.value = null
  emit('close')
}

function locate() {
  emit('locate', pinData.value)
}

function onKey(e) {
  if (e.key === 'Escape' && pinData.value) close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="pinData" class="pdc-panel" :data-theme="instance?.theme.value || 'dark'">

    <!-- Accent header bar (uses pin's color — bloc, religion, etc.) -->
    <div class="pdc-accent" :style="{ background: color }"></div>

    <!-- Title + close -->
    <div class="pdc-header">
      <span class="pdc-eyebrow">{{ tr('pplr.popup.peopleGroup') }}</span>
      <button class="pdc-close" :title="tr('pplr.ui.closeEsc')" @click="close">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <h2 class="pdc-name">{{ pinData.name || '—' }}</h2>

    <!-- Field grid + locale-names section. Single scrollable column so the
         user can see all 17 locales without clipping. -->
    <div class="pdc-fields">
      <div v-for="f in fields" :key="f.label" class="pdc-field">
        <span class="pdc-field-label">{{ f.label }}</span>
        <span class="pdc-field-value" :class="{ mono: f.mono }">{{ f.value }}</span>
      </div>

      <div class="pdc-section-divider">
        <span>{{ tr('pplr.card.nameInLocales', { n: locales.length }) }}</span>
      </div>
      <div v-for="loc in locales" :key="loc.code" class="pdc-field pdc-locale">
        <span class="pdc-field-label">{{ loc.name }} <code>{{ loc.code }}</code></span>
        <span class="pdc-field-value" :class="{ 'is-missing': !loc.value }">
          {{ loc.value || '—' }}
        </span>
      </div>
    </div>

    <!-- Footer actions -->
    <div class="pdc-actions">
      <button class="pdc-btn pdc-btn-primary" @click="locate">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path d="M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="9" r="2.5" stroke="currentColor" stroke-width="2"/>
        </svg>
        {{ tr('pplr.ui.flyToPin') }}
      </button>
      <button class="pdc-btn" @click="close">{{ tr('pplr.ui.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pdc-panel {
  position: absolute; left: 8px; top: 60px; bottom: 12px; width: 380px; z-index: 6;
  background: #161b22; border: 1px solid #30363d;
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; overflow: hidden;
}
.pdc-accent { height: 4px; flex-shrink: 0; }

.pdc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px 0;
}
.pdc-eyebrow {
  font: 600 9px ui-monospace, monospace;
  color: #73A17F; text-transform: uppercase; letter-spacing: 0.08em;
}
.pdc-close {
  background: rgba(110,118,129,0.2); border: none; border-radius: 50%;
  color: #c9d1d9; cursor: pointer;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.1s;
}
.pdc-close:hover { background: #ef4444; color: #fff; }

.pdc-name {
  margin: 4px 14px 12px;
  font: 600 17px system-ui, -apple-system, sans-serif;
  color: #e6edf3; line-height: 1.3;
}

.pdc-fields {
  flex: 1; overflow-y: auto;
  padding: 0 14px;
  display: flex; flex-direction: column; gap: 1px;
}
.pdc-fields::-webkit-scrollbar { width: 6px; }
.pdc-fields::-webkit-scrollbar-thumb { background: #21262d; border-radius: 3px; }

.pdc-field {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 6px 0;
  border-bottom: 1px solid rgba(33,38,45,0.6);
  min-height: 28px;
}
.pdc-field:last-child { border-bottom: none; }
.pdc-field-label {
  font: 11px ui-monospace, monospace; color: #6e7681;
  flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em;
  font-size: 9.5px;
}
.pdc-field-value {
  font: 12px system-ui, sans-serif; color: #c9d1d9;
  text-align: right; max-width: 65%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pdc-locale .pdc-field-value {
  /* Locales can be long (Devanagari, Amharic, etc.) — let them wrap. */
  white-space: normal; overflow: visible; text-overflow: clip;
  word-break: break-word; line-height: 1.3;
}
.pdc-locale .pdc-field-label code {
  font: 9px ui-monospace, monospace; color: #6e7681;
  margin-left: 4px;
}
.pdc-field-value.is-missing { color: #6e7681; font-style: italic; }
.pdc-section-divider {
  margin: 12px 0 4px;
  font: 600 9px ui-monospace, monospace;
  color: #73A17F;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding-bottom: 4px;
  border-bottom: 1px solid #21262d;
}
.pdc-panel[data-theme="light"] .pdc-section-divider {
  color: #3b463d; border-bottom-color: #d8dee4;
}
.pdc-panel[data-theme="light"] .pdc-locale .pdc-field-label code { color: #57606a; }
.pdc-panel[data-theme="light"] .pdc-field-value.is-missing { color: #57606a; }
.pdc-field-value.mono {
  font: 11px ui-monospace, monospace;
  background: #0d1117; border: 1px solid #21262d; border-radius: 3px;
  padding: 1px 6px;
}

.pdc-actions {
  display: flex; gap: 6px; padding: 10px 14px;
  border-top: 1px solid #21262d; flex-shrink: 0;
  background: rgba(13,17,23,0.6);
}
.pdc-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  background: #21262d; border: 1px solid #30363d; border-radius: 6px;
  color: #c9d1d9; font: 600 11px system-ui; padding: 6px 10px;
  cursor: pointer; transition: background 0.1s, border-color 0.1s;
}
.pdc-btn:hover { background: #2d333b; border-color: #484f58; }
.pdc-btn-primary {
  background: #3b463d; border-color: #92b195; color: #fff;
}
.pdc-btn-primary:hover { background: #92b195; }

@media (max-width: 640px) {
  .pdc-panel { width: 92vw; max-width: 380px; top: 64px; bottom: 8px; }
}

/* ── Light-mode palette ──────────────────────────────────────────────────── */
.pdc-panel[data-theme="light"] {
  background: #ffffff; border-color: #d0d7de;
  box-shadow: 0 6px 24px rgba(31,35,40,0.15);
}
.pdc-panel[data-theme="light"] .pdc-eyebrow { color: #3b463d; }
.pdc-panel[data-theme="light"] .pdc-close { background: rgba(208,215,222,0.5); color: #1f2328; }
.pdc-panel[data-theme="light"] .pdc-name { color: #1f2328; }
.pdc-panel[data-theme="light"] .pdc-field { border-color: rgba(208,215,222,0.6); }
.pdc-panel[data-theme="light"] .pdc-field-label { color: #57606a; }
.pdc-panel[data-theme="light"] .pdc-field-value { color: #1f2328; }
.pdc-panel[data-theme="light"] .pdc-field-value.mono {
  background: #f6f8fa; border-color: #d0d7de; color: #24292f;
}
.pdc-panel[data-theme="light"] .pdc-actions {
  border-color: #d8dee4; background: rgba(246,248,250,0.5);
}
.pdc-panel[data-theme="light"] .pdc-btn {
  background: #f6f8fa; border-color: #d0d7de; color: #1f2328;
}
.pdc-panel[data-theme="light"] .pdc-btn:hover { background: #eaeef2; border-color: #afb8c1; }
.pdc-panel[data-theme="light"] .pdc-btn-primary {
  background: #3b463d; border-color: #3b463d; color: #fff;
}
.pdc-panel[data-theme="light"] .pdc-btn-primary:hover { background: #3b463d; }
</style>
