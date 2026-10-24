<script setup>
/**
 * poster-design-mfe.vue: Poster Design as ONE two-tab element, Styles and Sizes.
 *
 * @element poster-design
 * @description Poster Design: every poster template (Styles) and every poster size (Sizes) side by side,
 *   drawn from the library, each named by its configuration so it can be handed to an agent.
 *
 * The same shape as country-posters-mfe and upg-100-mfe, on purpose: the pane-wrapper layout, the
 * library's ViewSelect for the tabs, each pane its own element with its own ProfileLoader, and one
 * ShareButton sharing THIS composite. Nothing here is poster-specific; the two tabs are the two profiles
 * poster-styles and poster-sizes, each also embeddable alone.
 */
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { buildPaneColumn, PANE_GRID_STYLES } from '@map/layouts/pane-wrapper/pane-wrapper.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import ViewSelect from '@map/components/ViewSelect.vue'
import ShareButton from '@map/components/map-controls/ShareButton.vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'

const t = useOptionalT('')
const cfg = inject('profileConfig', ref(null))
const uiStore = inject('uiStore', null)
const isDark = computed(() => !!uiStore?.isDark)

const TAG = 'poster-design'
const instanceId = computed(() => cfg.value?.instanceId || 'poster-design-mfe')

const spec = computed(() => ({
  id: 'poster-design-mfe',
  tag: TAG,
  config: { instanceId: instanceId.value },
  // ORDER LIVES IN at[0]: buildPaneColumn sorts by it while ViewSelect renders this array as written,
  // so the two must agree.
  panes: [
    { id: 'styles', label: t('posterDesign.tab.styles'), at: [0, 0], config: { profile: 'poster-styles' } },
    { id: 'sizes', label: t('posterDesign.tab.sizes'), at: [1, 0], config: { profile: 'poster-sizes' } },
  ],
  paneHint: false,
}))

const stage = ref(null)
const view = ref(cfg.value?.view === 'sizes' ? 'sizes' : 'styles')
let column = null
let offScroll = null

// Page-level keys a pane inherits from this element's host, by KEY LIST (a pane's own profile and
// instanceId always win, since pane.config is spread last).
const INHERITED_PAGE_KEYS = ['assetsBase', 'apiBaseUrl', 'tokenUrl', 'dataSource', 'locale', 'lang', 'isDark', 'provider', 'list']

function paneElement(pane) {
  const el = document.createElement(TAG)
  const host = cfg.value || {}
  const inherited = {}
  for (const k of INHERITED_PAGE_KEYS) if (host[k] !== undefined && host[k] !== null && host[k] !== '') inherited[k] = host[k]
  if (inherited.locale === undefined && inherited.lang !== undefined) inherited.locale = inherited.lang
  el.setAttribute('profile-config', JSON.stringify({ ...inherited, ...spec.value.config, ...pane.config }))
  return el
}

// `inert` on the pane the reader is not looking at, as the other two-tab composites do: the panes are
// stacked in one scroll column, so the hidden one is still full-size geometry.
function markActivePane(activeId) {
  if (!column || !activeId) return
  for (const pane of column.panes) {
    const el = column.mountEl(pane.id)
    if (!el) continue
    if (pane.id === activeId) el.removeAttribute('inert')
    else el.setAttribute('inert', '')
  }
}
function go(id) {
  view.value = id
  column?.scrollTo(id)
  markActivePane(id)
}

onMounted(() => {
  if (!stage.value) return
  column = buildPaneColumn(spec.value, { host: stage.value })
  if (!column) return
  for (const pane of column.panes) if (pane.config) column.mountEl(pane.id)?.appendChild(paneElement(pane))
  markActivePane(column.current() || view.value)
  offScroll = column.onScroll(() => {
    const cur = column.current()
    if (cur && cur !== view.value) view.value = cur
    if (cur) markActivePane(cur)
  })
  if (view.value !== 'styles') go(view.value)
})
onBeforeUnmount(() => { offScroll?.(); column?.destroy(); column = null })

const SHARE_EMBED_PATH = 'poster-design/poster-design-mfe/index.html'

useShadowStyles(PANE_GRID_STYLES + `
:host{ display:block; width:100%; height:100%; min-height:420px; }
.pdmfe{
  --ui-bg:#ffffff; --ui-bg-elevated:#f3f3f1; --ui-bg-accented:#f3f3f1;
  --ui-border:#d1d4cd; --ui-text:#3b463d; --ui-text-muted:#6d766e; --ui-primary:#92b195;
  --header:56px;
  position:absolute; inset:0; display:flex; flex-direction:column; min-height:0;
  background:var(--ui-bg); color:var(--ui-text);
  font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
}
.pdmfe .hdr{
  flex:0 0 var(--header); height:var(--header); position:relative;
  display:flex; align-items:center; justify-content:flex-end; padding:0 12px;
  background:var(--ui-bg); border-bottom:1px solid var(--ui-border);
}
.viewsel{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
.pdmfe .stage{ position:relative; flex:1 1 auto; min-height:0; }
.pane > .pane-mount > *{ position:absolute; inset:0; width:100%; height:100%; display:block; }
`, 'poster-design-mfe')
</script>

<template>
  <div class="pdmfe">
    <header class="hdr">
      <ViewSelect :views="spec.panes" :current="view" :legend="t('tabs.selectView')" :label="t('tabs.views')" @select="go" />
      <!-- A HEADER button, so the header form: a rounded square (Big Picture's DashboardTopBar uses the same). -->
      <ShareButton :is-dark="isDark" :embed-path="SHARE_EMBED_PATH" shape="rounded-square" />
    </header>
    <div class="stage" ref="stage"></div>
  </div>
</template>
