<script setup>
/**
 * DataTable.vue — THE SHARED TABULATOR LIST VIEW.
 *
 * Renders any table produced by library/scripts/research/build-tabulator-tables.mjs:
 * a `{ meta, columns, rows }` document where `columns` IS the Tabulator column
 * model and every row value is a scalar.
 *
 * Every research finding is stored as a Tabulator table for the apps' list views,
 * organized as lists at full granularity.
 *
 * PROMOTED TO library/ ON PURPOSE. Gospel Resources, Cities with Internet and Key
 * City Posters all need the same list; three copies would drift. Same rule the
 * poster wall follows: profiles duplicate, components get promoted and parameterized.
 *
 * ═══ WHY TABULATOR IS LOADED AT RUNTIME, NOT IMPORTED ═══════════════════════
 * The build is a single-file IIFE with `inlineDynamicImports: true`, so an import
 * would base64-inline 443KB into EVERY bundle that touches this component — the
 * exact mistake that took the 100-list bundle to 6MB and blocked first paint behind
 * one parse. So the library is injected once per page from a relative assetsBase
 * path and cached by the browser across apps.
 *
 * SELF-HOSTED, NEVER A CDN. Vendored at public/assets/vendor/tabulator/ (v6.3.1).
 * A CDN request from a persecuted user's device leaks their IP to a third party —
 * that is the privacy-first rule (no third-party calls), and it is a safety rule, not a
 * preference. geo-steward vendors the same way.
 *
 * ═══ SHADOW-DOM CAVEAT (measured today, twice) ══════════════════════════════
 * Tabulator's stylesheet must be injected INTO THIS SHADOW ROOT — a <link> in the
 * host page's <head> does not cross the boundary, and the table would render
 * unstyled with no error. And `box-sizing` is NOT inherited into a shadow root from
 * the host's reset, so it is set explicitly below; without it, padding and borders
 * ADD to declared widths and columns drift.
 */
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { tStatic } from '@map/i18n/index.js'

// This component's chrome, read out of the catalogue. tStatic and not useI18n: these mount inside
// custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way in and
// takes the subtree with it. The English stays as the fallback.
const T = (key, en) => tStatic(key) || en
import { useShadowStyles } from '../../composables/useShadowStyles.js'
// A fixed;inset:0 scrim covers only the CONTENT PANE inside the cap-5 shell (contain:layout on
// .vtl-content captures the fixed containing block). Measured here: 1024x793 @ (256,107) at a
// 1280x900 viewport — the 256px rail stayed clickable behind a "modal". See the util for the
// measurements and for why 100vw/100vh and <Teleport to="body"> both fail.
import { useViewportScrim } from '../../utils/viewportScrim.js'

const props = defineProps({
  // A { meta, columns, rows } document.
  table:      { type: Object, required: true },
  assetsBase: { type: String, default: './assets' },
  isDark:     { type: Boolean, default: false },
  height:     { type: String, default: '560px' },
  // Columns to freeze on the left while scrolling horizontally.
  frozen:     { type: Number, default: 1 },
  pageSize:   { type: Number, default: 50 },
})
const emit = defineEmits(['row-click'])

// MOBILE IS A DIFFERENT TABLE, not the same table squeezed.
// MEASURED on a 390px viewport: 3,747px of content in a 352px table, first column
// FROZEN at 153px, one column 576px wide. The frozen column ate 43% of the screen
// and everything else was off-canvas — you could see a name and nothing else.
// On a phone a frozen first column hides every other column, so the table is not
// usable there.
// So on a phone: NO frozen column (it is the thing blocking the view), fewer
// columns, and every row opens a detail sheet carrying the full record.
const isMobile = ref(false)
const detail = ref(null)
// Geometry for the row-detail scrim; the .dt-scrim class still carries look and z-index.
const { scrimRef, scrimStyle } = useViewportScrim(detail)

const host = ref(null)
const tab = shallowRef(null)
const err = ref(null)
const ready = ref(false)

const base = computed(() => String(props.assetsBase || './assets').replace(/\/+$/, ''))
const meta = computed(() => props.table?.meta || {})
const rowCount = computed(() => (props.table?.rows || []).length)

// The caveats that must survive into the UI. A list view strips context, so any
// meta key describing a limit is surfaced rather than left in the file.
const caveats = computed(() => Object.entries(meta.value)
  .filter(([k, v]) => typeof v === 'string' && /caveat|meaning|note|boundary|measures|does_not/i.test(k))
  .map(([k, v]) => ({ key: k.replace(/_/g, ' '), text: v })))

// Load the vendored library ONCE per page, shared across every app that uses it.
let _p = null
function loadTabulator() {
  if (window.Tabulator) return Promise.resolve(window.Tabulator)
  if (_p) return _p
  _p = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `${base.value}/vendor/tabulator/tabulator.min.js`
    s.onload = () => resolve(window.Tabulator)
    s.onerror = () => reject(new Error('Tabulator failed to load — is public/assets/vendor/tabulator/ present?'))
    document.head.appendChild(s)
  })
  return _p
}

// The stylesheet has to live INSIDE the shadow root — see the caveat above.
async function injectCss(root) {
  if (!root || root.querySelector('style[data-tabulator]')) return
  try {
    const res = await fetch(`${base.value}/vendor/tabulator/tabulator.min.css`)
    if (!res.ok) return
    const el = document.createElement('style')
    el.setAttribute('data-tabulator', '')
    el.textContent = await res.text()
    root.appendChild(el)
  } catch (_) { /* unstyled beats not-rendered */ }
}

function build(Tabulator) {
  if (!host.value) return
  isMobile.value = typeof window !== 'undefined' && window.innerWidth < 700

  // On a phone show only the columns that identify a row; the rest live in the
  // detail sheet. Showing 18 columns on 390px is not "more data", it is none.
  const all = props.table?.columns || []
  const src = isMobile.value ? all.slice(0, 3) : all

  const cols = src.map((c, i) => ({
    title: c.title,
    field: c.field,
    headerFilter: c.type === 'boolean' ? 'tickCross' : 'input',
    headerFilterPlaceholder: 'filter…',
    sorter: c.type === 'number' ? 'number' : c.type === 'boolean' ? 'boolean' : 'string',
    formatter: c.type === 'boolean' ? 'tickCross' : undefined,
    // A URL column is only useful if it is clickable.
    ...(/_url$/.test(c.field) ? { formatter: 'link', formatterParams: { target: '_blank', label: () => 'open' } } : {}),
    // NEVER freeze on mobile — the frozen column IS the bug there.
    frozen: !isMobile.value && i < props.frozen,
    minWidth: isMobile.value ? 78 : (c.type === 'number' ? 90 : 120),
    // ONE maxWidth — a duplicate key silently overwrote the mobile cap and put the
    // 576px column straight back. On mobile every column is capped at 150px so no
    // single field can monopolise a 390px viewport; on desktop only the long
    // provenance strings are capped.
    maxWidth: isMobile.value ? 150
      : (/method|caveat|pools|classification/.test(c.field) ? 260 : undefined),
    widthGrow: /method|caveat|pools|source|classification/.test(c.field) ? 0 : 1,
  }))

  tab.value = new Tabulator(host.value, {
    data: props.table?.rows || [],
    columns: cols,
    height: props.height,
    // fitColumns keeps the table INSIDE the viewport on a phone instead of
    // scrolling 3,747px sideways.
    layout: isMobile.value ? 'fitColumns' : 'fitDataStretch',
    pagination: true,
    paginationSize: isMobile.value ? 20 : props.pageSize,
    paginationSizeSelector: [25, 50, 100, 250],
    movableColumns: true,
    placeholder: 'No rows',
  })
  // GRANULARITY. A row click must reveal the detail behind it (the service providers'
  // names, the actual list of gospel resources). The table flattens nested detail to scalars so Tabulator can sort
  // and filter; the FULL record is still on the row object, so the detail sheet
  // shows every field including the ones the list had to drop.
  tab.value.on('rowClick', (e, row) => {
    detail.value = row.getData()
    emit('row-click', row.getData())
  })
  tab.value.on('tableBuilt', () => { ready.value = true })
}

// Field label from the column model where possible, so the sheet reads the same
// language as the table rather than exposing raw field names.
const labelFor = (field) => (props.table?.columns || []).find((c) => c.field === field)?.title
  || field.replace(/_/g, ' ')
// A comma-joined cell is a LIST that was flattened for the table — expand it back
// out in the detail sheet, which is the whole point of opening a row.
const asList = (v) => typeof v === 'string' && v.includes(', ') && v.length > 40
  ? v.split(', ') : null
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v)
const detailRows = computed(() => detail.value
  ? Object.entries(detail.value).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  : [])

function download(fmt) {
  try { tab.value?.download(fmt, `${(meta.value.title || 'table').replace(/\W+/g, '-').toLowerCase()}.${fmt}`) }
  catch (e) { err.value = String(e.message || e) }
}

onMounted(async () => {
  try {
    await injectCss(host.value?.getRootNode?.())
    build(await loadTabulator())
  } catch (e) { err.value = String(e.message || e) }
})
onBeforeUnmount(() => { try { tab.value?.destroy() } catch (_) {} })
watch(() => props.table, () => { try { tab.value?.replaceData(props.table?.rows || []) } catch (_) {} })

useShadowStyles(
  // ── HOUSE PALETTE OVER TABULATOR'S STOCK THEME ────────────────────────────────────
  // The vendored tabulator.min.css is Tabulator's DEFAULT theme: #333 borders, #666 rows,
  // #000 headers. MEASURED identically in all three consumers (gospel-resources,
  // cities-internet, key-cities) — row rgb(102,102,102), header rgb(51,51,51) — so every
  // table in the product shipped mid-grey while the house style is Material LIGHT.
  //
  // OVERRIDDEN BY SPECIFICITY, NOT BY ORDER. injectCss() appends the vendor sheet AFTER
  // a fetch, so it lands after these rules and would win any tie. Every selector here is
  // `.dt` + the tabulator class — two classes against the vendor's one — so it wins
  // regardless of which sheet is appended last. Re-ordering the injection would be the
  // fragile fix; specificity is the durable one.
  //
  // The dark variant is left to the vendor sheet under .dt.is-dark (three classes, so it
  // still beats these): this repo ships light only, but DataTable has other callers and
  // silently removing their dark mode is not this change's business.
  '.dt .tabulator{border:1px solid #d1d4cd;background:#fff;font-size:14px}' +
  '.dt .tabulator .tabulator-header{background:#f3f3f1;border-bottom:1px solid #d1d4cd;color:#3b463d}' +
  // FOUR classes, deliberately: the vendor's own rule is
  // `.tabulator .tabulator-header .tabulator-col` — three — and it is appended after
  // these, so a three-class override ties and LOSES. Measured: the header went #f3f3f1
  // while the columns stayed rgb(51,51,51), which is what a specificity tie looks like.
  '.dt .tabulator .tabulator-header .tabulator-col{background:#f3f3f1;' +
  'border-right:1px solid #d1d4cd;color:#3b463d}' +
  '.dt .tabulator .tabulator-header .tabulator-col.tabulator-sortable:hover{background:#e9ebe6}' +
  '.dt .tabulator .tabulator-col-title{color:#3b463d;font-weight:700}' +
  // FIVE classes: the vendor's filter-input rule is four
  // (.tabulator .tabulator-header .tabulator-col .tabulator-header-filter input) and sets
  // background:#444;color:#fff. A four-class override ties and loses, which read on screen
  // as dark boxes sitting under a light header — caught by LOOKING at it, not by the
  // computed-style probe, which was only sampling the row and the header.
  '.dt .tabulator .tabulator-header .tabulator-col .tabulator-header-filter input,' +
  '.dt .tabulator .tabulator-header .tabulator-col .tabulator-header-filter select' +
  '{background:#fff;border:1px solid #d1d4cd;border-radius:5px;color:#3b463d;padding:3px 6px}' +
  '.dt .tabulator .tabulator-row{background:#fff;color:#3b463d;border-bottom:1px solid #e6e8e3}' +
  '.dt .tabulator .tabulator-row.tabulator-row-even{background:#faf9f7}' +
  '.dt .tabulator .tabulator-row:hover{background:#e9ebe6}' +
  // unicode-bidi:plaintext: each cell takes its direction from its own first strong character, so an English
  // title in an Arabic page keeps its brackets and numbers where they belong (row 86).
  '.dt .tabulator .tabulator-row .tabulator-cell{border-inline-end:1px solid #e6e8e3;color:#3b463d;unicode-bidi:plaintext}' +
  // plaintext also resolves a cell's ALIGNMENT from its own text, so English cells left-aligned in an rtl
  // table and clipped at its left edge (L20). Align by the page's direction; the text stays isolated.
  // ⚠ STAYS PHYSICAL ON PURPOSE — do not "fix" this to text-align:end. It is already scoped to
  // :dir(rtl), so it only ever applies where right IS the trailing edge; and `end` would be resolved
  // by unicode-bidi:plaintext PER CELL, from that cell's own first strong character, which is the
  // exact behaviour this line exists to override. The logical property would silently undo the fix.
  '.dt:dir(rtl) .tabulator .tabulator-row .tabulator-cell{text-align:right}' +
  // The resource link is the point of the gospel-resources table, so it reads as a link
  // in the accent rather than as default-blue on grey.
  '.dt .tabulator .tabulator-row .tabulator-cell a{color:#4a7a52;font-weight:600}' +
  '.dt .tabulator .tabulator-footer{background:#f3f3f1;border-top:1px solid #d1d4cd;color:#3b463d}' +
  // The paginator and its "Page Size" label are coloured by three-class vendor rules, so
  // these take four. The label was rendering white on the now-light footer — invisible.
  '.dt .tabulator .tabulator-footer .tabulator-paginator{color:#3b463d}' +
  '.dt .tabulator .tabulator-footer .tabulator-paginator label{color:#3b463d}' +
  '.dt .tabulator .tabulator-footer .tabulator-paginator select{background:#fff;' +
  'border:1px solid #d1d4cd;border-radius:5px;color:#3b463d}' +
  '.dt .tabulator .tabulator-footer .tabulator-page{border:1px solid #d1d4cd;background:#fff;' +
  'color:#3b463d;border-radius:5px}' +
  '.dt .tabulator .tabulator-footer .tabulator-page.active{background:#92b195;' +
  'border-color:#92b195;color:#fff}' +
  '.dt .tabulator .tabulator-footer .tabulator-page:not(disabled):hover{background:#e9ebe6;color:#3b463d}' +
  '.dt .tabulator .tabulator-footer .tabulator-page:disabled{opacity:.45}' +
  // box-sizing is NOT inherited into a shadow root from the host reset.
  '.dt,.dt *{box-sizing:border-box}' +
  ".dt{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.dt-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}' +
  '.dt-title{font-size:15px;font-weight:700;margin:0}' +
  '.dt-count{font-size:11.5px;opacity:.6;font-variant-numeric:tabular-nums}' +
  '.dt-grain{font-size:11px;opacity:.55}' +
  '.dt-actions{margin-inline-start:auto;display:flex;gap:6px}' +
  '.dt-btn{font:600 11.5px inherit;padding:5px 11px;border-radius:6px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit}' +
  '.dt-btn:hover{background:rgba(0,0,0,.05)}' +
  '.dt-err{padding:10px 12px;border-radius:8px;background:rgba(220,38,38,.10);color:#a12020;font-size:12.5px}' +
  // Caveats are rendered, never hidden — the list view strips context otherwise.
  '.dt-caveats{margin-top:10px;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.04);' +
  'font-size:11.5px;line-height:1.6;opacity:.85}' +
  '.is-dark .dt-caveats{background:rgba(255,255,255,.06)}' +
  '.dt-cav-k{font-weight:700;text-transform:capitalize}' +
  // Row detail — bottom sheet on a phone, centred panel on desktop.
  // GEOMETRY IS SET INLINE by useViewportScrim (top/left/width/height override the inset:0 here):
  // inside the cap-5 shell, contain:layout on .vtl-content makes THIS element's fixed coordinates
  // pane-relative, so inset:0 dimmed 1024x793 @ (256,107) and left the rail clickable. The
  // declarations below are the LOOK only; do not re-add geometry here.
  '.dt-scrim{position:fixed;inset:0;z-index:1200;background:rgba(8,12,16,.55);display:flex;' +
  'align-items:flex-end;justify-content:center}' +
  '@media(min-width:700px){.dt-scrim{align-items:center}}' +
  '.dt-sheet{width:100%;max-width:560px;max-height:82vh;overflow-y:auto;background:#fff;color:#0f1419;' +
  'border-radius:14px 14px 0 0;padding:16px 18px 26px;box-shadow:0 -6px 30px rgba(0,0,0,.3)}' +
  '@media(min-width:700px){.dt-sheet{border-radius:14px}}' +
  '.is-dark .dt-sheet{background:#132019;color:#e5e7eb}' +
  '.dt-sheet-head{display:flex;align-items:center;gap:12px;margin-bottom:10px;' +
  'padding-bottom:9px;border-bottom:1px solid rgba(0,0,0,.10);font-size:15px}' +
  '.dt-close{margin-inline-start:auto;font:600 12px inherit;padding:7px 14px;border-radius:8px;cursor:pointer;' +
  // 44px is the accessible tap target; anything smaller is a miss on a phone.
  'min-height:36px;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit}' +
  '.dt-dl{display:grid;grid-template-columns:minmax(96px,34%) 1fr;gap:7px 12px;margin:0;font-size:12.5px}' +
  '.dt-dl dt{font-weight:700;opacity:.72;text-transform:capitalize}' +
  '.dt-dl dd{margin:0;word-break:break-word}' +
  '.dt-dl ul{margin:0;padding-inline-start:16px}' +
  '.dt-dl a{color:#0b7a5b;font-weight:600}' +
  '.dt-hint{font-size:11px;opacity:.6;margin:6px 0 0}' +
  '.dt-wrap{width:100%;overflow:hidden;border:1px solid rgba(0,0,0,.10);border-radius:8px}' +
  '.is-dark .dt-wrap{border-color:rgba(255,255,255,.12)}',
  'doxa-data-table',
)
</script>

<template>
  <div class="dt" :class="{ 'is-dark': isDark }">
    <div class="dt-head">
      <h3 class="dt-title">{{ meta.title || 'Data' }}</h3>
      <span class="dt-count">{{ rowCount.toLocaleString() }} rows</span>
      <span v-if="meta.grain" class="dt-grain">· {{ meta.grain }}</span>
      <span class="dt-actions">
        <button type="button" class="dt-btn" @click="download('csv')">{{ T('tables.csv', 'CSV') }}</button>
        <button type="button" class="dt-btn" @click="download('json')">{{ T('tables.json', 'JSON') }}</button>
      </span>
    </div>

    <div v-if="err" class="dt-err">{{ err }}</div>
    <div class="dt-wrap"><div ref="host"></div></div>
    <!-- The English tail is isolated left-to-right, so under rtl its full stop stays at its end (row 86). -->
    <p class="dt-hint">{{ T('tables.tap_row_hint', 'Tap any row for its full detail') }}<bdi v-if="!isMobile" dir="ltr"> — every field, including the lists the table flattens.</bdi><template v-else>.</template></p>

    <!-- ROW DETAIL — a bottom sheet on mobile, a panel on desktop. Carries EVERY
         field, including the ones the list view has to hide or flatten. -->
    <div v-if="detail" ref="scrimRef" :style="scrimStyle" class="dt-scrim" @click.self="detail = null">
      <div class="dt-sheet" role="dialog" :aria-label="T('aria.rowDetail', 'Row detail')">
        <div class="dt-sheet-head">
          <strong>{{ detail[(table?.columns || [])[0]?.field] || T('aria.rowDetail', 'Row detail') }}</strong>
          <button type="button" class="dt-close" @click="detail = null">{{ T('buttons.close', 'Close') }}</button>
        </div>
        <dl class="dt-dl">
          <template v-for="[k, v] in detailRows" :key="k">
            <dt>{{ labelFor(k) }}</dt>
            <dd>
              <a v-if="isUrl(v)" :href="v" target="_blank" rel="noopener">{{ v }}</a>
              <ul v-else-if="asList(v)"><li v-for="(x, i) in asList(v)" :key="i">{{ x }}</li></ul>
              <span v-else>{{ v === true ? 'yes' : v === false ? 'no' : v }}</span>
            </dd>
          </template>
        </dl>
      </div>
    </div>

    <div v-if="caveats.length" class="dt-caveats">
      <div v-for="c in caveats" :key="c.key">
        <!-- A caveat is English prose from the table's meta: isolated ltr so its punctuation stays put under rtl. -->
        <bdi dir="ltr"><span class="dt-cav-k">{{ c.key }}:</span> {{ c.text }}</bdi>
      </div>
    </div>
  </div>
</template>
