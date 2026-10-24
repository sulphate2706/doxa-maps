<script setup>
/**
 * PosterSectionView.vue — ONE poster section on its own: the profile behind <dxm-poster-section>.
 * It reads its settings from profile-config (type, scope, collapsible, collapsed, locale, assetsBase, columns, minCardPx, showHeader, cardAction), finds the
 * poster TYPE in posterTypes.js, and draws a PosterWall in section-only mode: the same section a wall draws (the
 * same PosterSection, the same print actions and overlay), with no wall head around it.
 */
import { computed, inject, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import PosterWall from './PosterWall.vue'
import { posterType, TYPE_REGISTERED_EVENT } from './posterTypes.js'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'

const profileConfig = inject('profileConfig', ref(null))
const cfg = computed(() => profileConfig.value || {})
const t = useOptionalT('')
const typeName = computed(() => cfg.value.type || 'country')
const adapter = ref(null)
const unknownType = ref(false)
async function resolveType(name) {
  const a = await posterType(name)
  if (name !== typeName.value) return          // the type changed while this one loaded
  adapter.value = a; unknownType.value = !a
}
watch(typeName, resolveType, { immediate: true })
// ★ A TYPE MAY ARRIVE AFTER THIS SECTION ASKED: the registry is page-global (posterTypes.js), and another bundle
// that registers the type (upg100's lists, say) can load after the bundle that defined this element. Look again
// when a registration of OUR type is announced.
const onTypeRegistered = (e) => { if (e && e.detail && e.detail.name === typeName.value && !adapter.value) resolveType(typeName.value) }
onMounted(() => { try { window.addEventListener(TYPE_REGISTERED_EVENT, onTypeRegistered) } catch (_) { /* no window */ } })
onBeforeUnmount(() => { try { window.removeEventListener(TYPE_REGISTERED_EVENT, onTypeRegistered) } catch (_) { /* no window */ } })

const lang = () => cfg.value.locale || getRuntimeLocale() || detectLocale() || 'en'
const assetsBase = computed(() => cfg.value.assetsBase || './assets')
const items = computed(() => (adapter.value ? adapter.value.items(cfg.value.scope, lang()) : []))
const title = computed(() => (adapter.value ? adapter.value.title(cfg.value.scope, t) : ''))
const actions = computed(() => (adapter.value
  ? adapter.value.actions({ assetsBase: () => assetsBase.value, apiBase: () => cfg.value.apiBaseUrl || getApiBaseUrl(), lang, profileConfig, t })
  : null))
// show-header="false" hides the section's head so a host's own layout is its header. The head is also the collapse
// toggle, so a headless section can neither collapse nor start shut (it would have no way back open).
const showHeader = computed(() => cfg.value.showHeader !== false)
const collapsible = computed(() => cfg.value.collapsible !== false && showHeader.value)
const startCollapsed = computed(() => cfg.value.collapsed === true && showHeader.value)
const groupBy = () => title.value
const collapsedBy = () => startCollapsed.value
const instanceId = computed(() => `poster-section-${typeName.value}-${String(cfg.value.scope || 'all')}`)
// card-action="dashboard": the card's sticker reads "Show dashboard" (the wall's headerAction seam, as Poster Design's
// "Show full details") and a click dispatches dxm-poster-dashboard from this element: bubbling, composed (it leaves the
// shadow root, so e.target is the <dxm-poster-section>) and cancelable. The HOST builds its own URL; the element never does.
// name is the data's English name (the type's items in 'en'), never the card's localised label. The two strings live in
// their own catalogue area (posterCard), referenced only here, so only the bundles that carry this element include it.
const DASHBOARD_EVENT = 'dxm-poster-dashboard'
const headerAction = computed(() => (cfg.value.cardAction === 'dashboard'
  ? { labelKey: 'posterCard.showDashboard', ariaKey: 'posterCard.showDashboardAria' } : null))
const wallRef = ref(null)
function onHeaderAction(item) {
  if (cfg.value.cardAction !== 'dashboard' || !item) return
  const en = adapter.value ? adapter.value.items(cfg.value.scope, 'en').find((x) => x.id === item.id) : null
  const detail = { type: typeName.value, id: item.id, iso3: item.iso3, name: (en || item).label, scope: cfg.value.scope }
  const from = wallRef.value && wallRef.value.$el
  if (from) from.dispatchEvent(new CustomEvent(DASHBOARD_EVENT, { bubbles: true, composed: true, cancelable: true, detail }))
}
// Nothing to show still SAYS so (an unknown type or scope never renders as a blank).
const noneLine = computed(() => t('poster.sectionNone', { scope: String(cfg.value.scope || '') }))
</script>

<template>
  <p v-if="unknownType || (adapter && !items.length)" class="dxm-ps-none" role="status">{{ noneLine }}</p>
  <!-- embedded: an in-flow block the PAGE scrolls (a wall alone is a full-pane scroller), so sections stack on a
       page and sit inline under a host's own heading. -->
  <PosterWall v-else-if="adapter && actions"
    ref="wallRef"
    section-only
    embedded
    :items="items"
    :group-by="groupBy"
    :section-heads="showHeader"
    :header-action="headerAction"
    @header-action="onHeaderAction"
    :collapsible="collapsible"
    :collapsed-by="collapsedBy"
    :instance-id="instanceId"
    :is-dark="cfg.isDark === true"
    :columns="cfg.columns || 0"
    :min-card-px="cfg.minCardPx || 0"
    :assets-base="assetsBase"
    :event-name="actions.eventName"
    :unit="actions.unit"
    :item-count-key="actions.itemCountKey"
    :records="actions.records"
    :sheet="actions.sheet"
    :unsupported="actions.unsupported"
    :card-stocks="actions.cardStocks"
    :download-prefix="actions.downloadPrefix"
  />
</template>
