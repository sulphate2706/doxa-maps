<script setup>
import { inject, ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

const profileConfig = inject('profileConfig', null)
const treeType = computed(() => profileConfig?.value?.treeType || null)

// One tree per category. Each parent has exactly 2 children to
// keep the visual pattern obvious. Lang tree intentionally shows one language
// WITH dialects and one WITHOUT (to convey "not every language has dialects").
const TREES = [
  {
    id: 'rop',
    title: 'ROP Tree',
    color: '#a78bfa',
    levels: ['Affinity Bloc', 'People Cluster', 'ROP25', 'ROP3 × Country'],
    // 1 bloc → 2 clusters → 2 ROP25 each → 2 PGICs each (2·2·2 fan-out, 8 rows)
    examples: [
      ['Arab Peoples', 'Maghrebi Arab',  'Algerian Arab',  'Algerian Arab in Algeria'],
      ['',             '',               '',               'Algerian Arab in France'  ],
      ['',             '',               'Moroccan Arab',  'Moroccan Arab in Morocco' ],
      ['',             '',               '',               'Moroccan Arab in Spain'   ],
      ['',             'Levantine Arab', 'Lebanese Arab',  'Lebanese Arab in Lebanon' ],
      ['',             '',               '',               'Lebanese Arab in USA'     ],
      ['',             '',               'Syrian Arab',    'Syrian Arab in Syria'     ],
      ['',             '',               '',               'Syrian Arab in Germany'   ],
    ],
    systems: [
      { label: 'PPLR',           color: '#58a6ff', fields: ['ROP1Code · ROP1Name', 'ROP2Code · ROP2Name', 'ROP25Code · ROP25Name', 'GeoID · Code · Name'] },
      { label: 'Joshua Project', color: '#f59e0b', fields: ['—', '—', 'JoshuaProjectCode (PGID)', 'PGID · JoshuaProjectName'] },
      { label: 'IMB',            color: '#f43f5e', fields: ['—', '—', 'IMBPeopleCode', 'PEID · IMBPeopleName'] },
      { label: 'WCD',            color: '#10b981', fields: ['—', '—', 'WorldChristianDatabaseCode', 'WCDPRN · wcdName'] },
    ],
  },
  {
    id: 'lang',
    title: 'Lang Tree',
    color: '#06b6d4',
    levels: ['Lang Family', 'Language', 'Dialect / Variety'],
    // 1 family → 2 languages — first has 2 dialects, second has 0 (✕ marker)
    examples: [
      ['Arab (Arabic)', 'Egyptian Arabic',  'Egyptian: Cairene' ],
      ['',              '',                 'Egyptian: Saidi'   ],
      ['',              'Standard Arabic',  '✕ No dialects'     ],
    ],
    systems: [
      { label: 'PPLR',            color: '#58a6ff', fields: ['Family · aROP3byCountry', 'langCd (3-char ROL) · aLanguage', 'langCd (ROL-GRN, 9-char) · aLanguage'] },
      { label: 'aLanguage scale', color: '#14b8a6', fields: ['—', '7,270 language records', '534 dialect records'] },
      { label: 'Joshua Project',  color: '#f59e0b', fields: ['—', 'PrimaryLanguageName · ROL3', 'LanguageClass'] },
      { label: 'IMB',             color: '#f43f5e', fields: ['—', '—', '—'] },
    ],
  },
  {
    id: 'admin',
    title: 'Admin Tree',
    color: '#22c55e',
    levels: ['Admin 1', 'Admin 2', 'Admin 3', 'Admin 4'],
    // 1 country → 2 provinces → 2 parishes each → 2 villages each
    // Generic, non-US example: a Pacific-island parish/village hierarchy
    examples: [
      ['Vanuatu', 'Tafea Province',  'Tanna Parish',      'Whitesands village'],
      ['',        '',                '',                  'Lenakel village'   ],
      ['',        '',                'Aniwa Parish',      'Itonga village'    ],
      ['',        '',                '',                  'Imanaka village'   ],
      ['',        'Penama Province', 'Pentecost Parish',  'Loltong village'   ],
      ['',        '',                '',                  'Melsisi village'   ],
      ['',        '',                'Ambae Parish',      'Lolovenue village' ],
      ['',        '',                '',                  'Lolopuepue village'],
    ],
    systems: [
      { label: 'GADM / OSM',  color: '#22c55e', fields: ['NAME_1 / admin_level=4', 'NAME_2 / admin_level=6', 'NAME_3 / admin_level=8', 'NAME_4 / admin_level=10'] },
      { label: 'PPLR',        color: '#58a6ff', fields: ['ISOAlpha3 / ROG', '—', '—', 'Lat/Lon → spatial join'] },
      { label: 'WHOSIS',      color: '#f59e0b', fields: ['ISO3', 'Subdivision', '—', '—'] },
    ],
  },
]

const visibleTrees = computed(() => TREES)

// Title cell spans: header row + example rows + separator row only.
// System rows reuse col 0 for their own system-name label.
function titleRowspan(tree) {
  return 2 + tree.examples.length   // 1 header + N examples + 1 separator
}

function rowBg(ri) {
  return ri % 2 === 0 ? '#0d1117' : '#0a0e14'
}

// ── SVG cubic-bezier tree-line overlay ───────────────────────────────────────
const wrapRefs  = {}
const treePaths = ref({})
const svgSizes  = ref({})

function setWrapRef(el, id) { if (el) wrapRefs[id] = el }

function buildPaths(tree) {
  const wrap = wrapRefs[tree.id]
  if (!wrap) return
  const wRect = wrap.getBoundingClientRect()
  if (!wRect.width) return

  svgSizes.value[tree.id] = { w: Math.ceil(wRect.width), h: Math.ceil(wrap.scrollHeight) }

  const exRows = wrap.querySelectorAll('tr.ex-row')
  const cRects = []
  exRows.forEach(row => {
    const cells = row.querySelectorAll('td.ex-cell')
    const rowRects = []
    cells.forEach(cell => {
      const r = cell.getBoundingClientRect()
      rowRects.push({
        cx: (r.left + r.right) / 2 - wRect.left,
        cy: (r.top  + r.bottom) / 2 - wRect.top,
      })
    })
    cRects.push(rowRects)
  })

  const paths = []
  const nRows = tree.examples.length
  const nCols = tree.levels.length

  for (let c = 1; c < nCols; c++) {
    let parentRow = null
    let siblings  = []

    const flush = () => {
      if (parentRow === null || !siblings.length) return
      const pR = cRects[parentRow]?.[c - 1]
      if (!pR) return
      for (const sr of siblings) {
        const sR = cRects[sr]?.[c]
        if (!sR) continue
        const dx = (sR.cx - pR.cx) * 0.45
        paths.push(`M ${pR.cx} ${pR.cy} C ${pR.cx + dx} ${pR.cy} ${sR.cx - dx} ${sR.cy} ${sR.cx} ${sR.cy}`)
      }
      parentRow = null
      siblings  = []
    }

    for (let r = 0; r < nRows; r++) {
      if (tree.examples[r][c - 1] !== '') { flush(); parentRow = r }
      if (tree.examples[r][c] !== '' && parentRow !== null) siblings.push(r)
    }
    flush()
  }

  treePaths.value[tree.id] = paths
}

let resizeObs = null
onMounted(async () => {
  await nextTick()
  for (const tree of visibleTrees.value) buildPaths(tree)
  resizeObs = new ResizeObserver(() => {
    for (const tree of visibleTrees.value) buildPaths(tree)
  })
  for (const id of Object.keys(wrapRefs)) resizeObs.observe(wrapRefs[id])
})
onBeforeUnmount(() => resizeObs?.disconnect())
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Semantic tree reference</h1>
      <p>Classification hierarchies used in PPLR. Each column = one depth level. Dots mark node presence. System rows show API field names per external system.</p>
    </header>

    <!-- 2×2 grid: ROP · Lang · Admin · placeholder -->
    <div class="trees-grid">
      <div v-for="tree in visibleTrees" :key="tree.id" class="tree-cell">
        <div class="tree-table-wrap" :ref="el => setWrapRef(el, tree.id)">

          <!-- SVG cubic-bezier tree-line overlay -->
          <svg
            v-if="treePaths[tree.id]?.length"
            class="tree-lines-svg"
            :width="svgSizes[tree.id]?.w"
            :height="svgSizes[tree.id]?.h"
            :viewBox="`0 0 ${svgSizes[tree.id]?.w} ${svgSizes[tree.id]?.h}`"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              v-for="(d, i) in treePaths[tree.id]"
              :key="i"
              :d="d"
              :stroke="tree.color"
              stroke-width="1.5"
              stroke-opacity="0.55"
              fill="none"
              stroke-linecap="round"
            />
          </svg>

          <table>
            <colgroup>
              <!-- col 0: title/system-name column — fixed narrow width -->
              <col class="col-label" />
              <!-- level columns: equal share of remaining space -->
              <col v-for="_ in tree.levels" :key="_" class="col-level" />
            </colgroup>
            <tbody>
              <!-- ── Header row: level titles ── -->
              <tr>
                <!--
                  Title cell spans only header + examples + separator.
                  System rows reuse this column for their system-name label.
                -->
                <td
                  class="tree-title-cell"
                  :rowspan="titleRowspan(tree)"
                  :style="{ color: tree.color, borderRight: '2px solid ' + tree.color }"
                >{{ tree.title }}</td>
                <th
                  v-for="lvl in tree.levels"
                  :key="lvl"
                  class="level-hdr"
                  :style="{ color: tree.color }"
                >{{ lvl }}</th>
              </tr>

              <!-- ── Example rows: concrete labels (not just dots) ── -->
              <tr
                v-for="(row, ri) in tree.examples"
                :key="'ex' + ri"
                class="ex-row"
                :style="{ background: rowBg(ri) }"
              >
                <td
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="ex-cell example-cell"
                  :class="{
                    'example-cell--filled': cell !== '',
                    'example-cell--nodialect': cell.startsWith('✕')
                  }"
                  :title="cell"
                >{{ cell }}</td>
              </tr>

              <!-- ── Separator: "API field names" section ── -->
              <tr class="sys-sep-row">
                <td :colspan="tree.levels.length" class="sys-sep-cell">API field names per external system</td>
              </tr>

              <!-- ── System rows: system name (col 0) + field names (cols 1+) ── -->
              <tr
                v-for="sys in tree.systems"
                :key="sys.label"
                class="system-row"
              >
                <td class="system-name-cell" :style="{ color: sys.color }">{{ sys.label }}</td>
                <td
                  v-for="(field, fi) in sys.fields"
                  :key="fi"
                  class="system-field-cell"
                  :class="{ 'system-field-cell--dash': field === '—' }"
                >{{ field }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 4th cell: invitation to discover more hidden trees in the data.
           The 3 trees on the left are what we've found so far. The "?" is the
           open question — what other one-to-many semantic structures hide in
           PPLR? Each new tree found gets promoted into a real cell. -->
      <div class="tree-cell tree-discover">
        <div class="discover-mark" aria-hidden="true">?</div>
        <h2 class="discover-title">What other semantic trees<br>are hiding in the data?</h2>
        <p class="discover-body">
          The three trees here are what we've mapped so far. The goal is to find
          all of them. If you spot a one-to-many hierarchy in PPLR, JP, IMB or
          WCD that isn't represented yet, add it as the 4th cell.
        </p>
        <ul class="discover-hints">
          <li><span>Migration corridors?</span> origin → diaspora pathways</li>
          <li><span>Religious sub-streams?</span> denomination → tradition → school</li>
          <li><span>Engagement status tiers?</span> unreached → unengaged → unevangelized</li>
          <li><span>Translation lineage?</span> source language → script → orthography</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* All 4 cells must fit in the viewport without scroll.
   .page is now a flex column that fills the profile; .trees-grid takes the
   remaining height with two equal rows. Each cell hides overflow so a
   text-heavy cell (the discovery "?" cell) cannot make its row taller than
   the trees on the other side. */
.page {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #161b22;
  color: #e6edf3;
  font-family: system-ui, -apple-system, sans-serif;
  padding: 10px 14px 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.page-header { flex-shrink: 0; }
.page-header h1 {
  font-size: 13px; font-weight: 600; color: #79c0ff; margin: 0 0 2px;
  letter-spacing: 0.01em;
}
.page-header p {
  font-size: 10.5px; color: #adbac7; max-width: 720px; line-height: 1.4; margin: 0 0 8px;
}

/* ── 2×2 grid — fills the leftover viewport height ── */
.trees-grid {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 8px;
}
.tree-cell {
  min-width: 0; min-height: 0;
  background: #1c2128;
  border: 1px solid #373e47;
  border-radius: 8px;
  padding: 6px 8px;
  box-shadow: 0 3px 10px rgba(0,0,0,0.22);
  /* Cells were hiding field columns. Allow per-cell
     scrolling instead — full content stays visible inside its tile. */
  overflow: auto;
  display: flex; flex-direction: column;
}
.tree-cell::-webkit-scrollbar { width: 6px; height: 6px; }
.tree-cell::-webkit-scrollbar-thumb { background: #484f58; border-radius: 3px; }

/* ── Table+SVG container: scrolls horizontally if columns don't fit (field
   columns are never hidden just to keep cells slim) ── */
.tree-table-wrap {
  position: relative;
  overflow-x: auto;
  overflow-y: visible;
}
.tree-table-wrap::-webkit-scrollbar { height: 6px; }
.tree-table-wrap::-webkit-scrollbar-thumb { background: #484f58; border-radius: 3px; }

/* ── SVG overlay ── */
.tree-lines-svg {
  position: absolute; top: 0; left: 0;
  pointer-events: none; z-index: 2; overflow: visible;
}

/* ── Table: fixed layout so columns share space evenly within the grid cell ── */
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  position: relative;
  z-index: 1;
}

/* Label column: wide enough for longest label ("ALANGUAGE SCALE" ≈ 15 chars at 9px mono) */
col.col-label { width: 72px; }
/* Level columns: share remaining space equally */
col.col-level { width: auto; }

/* ── Tree title cell: spans header + examples + separator (slim) ── */
.tree-title-cell {
  background: #22272e;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-align: center;
  font-weight: 700;
  font-size: 10px;
  padding: 6px 0;
  border: 1px solid #373e47;
  vertical-align: middle;
}

/* ── Level headers (slim) ── */
.level-hdr {
  background: #22272e;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.05em;
  font-weight: 700;
  color: #cdd9e5;
  padding: 5px 4px;
  text-align: center;
  border: 1px solid #373e47;
  white-space: normal;
  word-break: break-word;
  vertical-align: bottom;
}

/* ── Example cells: now show concrete labels (slim) ── */
.example-cell {
  font: 10px system-ui, sans-serif;
  padding: 3px 5px;
  border: 1px solid #2d333b;
  background: #1c2128;
  color: #6e7681;
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.example-cell--filled {
  color: #cdd9e5;
  font-weight: 500;
}
.example-cell--nodialect {
  color: #ef4444; font-style: italic;
}

/* ── Separator row (slim) ── */
.sys-sep-row { background: #22272e; }
.sys-sep-cell {
  font: 700 8.5px ui-monospace, monospace;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #79c0ff;
  padding: 4px 6px;
  border: 1px solid #373e47;
  border-top: 2px solid #4d586a;
  white-space: normal;
}

/* ── System rows (slim) ── */
.system-row { background: #1c2128; }
.system-row:nth-child(even) { background: #22272e; }
.system-name-cell {
  font: 700 9px ui-monospace, monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #adbac7;
  padding: 4px 5px;
  border: 1px solid #373e47;
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
}
.system-field-cell {
  font: 9.5px ui-monospace, monospace;
  color: #cdd9e5;
  padding: 4px 6px;
  border: 1px solid #373e47;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  vertical-align: top;
}
.system-field-cell--dash { color: #545d68; }

/* ── Discovery cell (the 4th cell) — sized to match the others, NOT taller ── */
.tree-discover {
  justify-content: center; align-items: center;
  gap: 6px; padding: 10px 12px;
  text-align: center;
  overflow: hidden;
}
.discover-mark {
  font: 700 56px system-ui, -apple-system, sans-serif;
  color: #73A17F; line-height: 0.85;
  text-shadow: 0 4px 14px rgba(115,161,127,0.3);
  margin: 0;
}
.discover-title {
  margin: 2px 0 0;
  font: 600 12px system-ui, sans-serif;
  color: #e6edf3; line-height: 1.25;
}
.discover-body {
  margin: 2px 0 0;
  font: 10.5px system-ui, sans-serif;
  color: #adbac7; line-height: 1.4;
  max-width: 38ch;
}
.discover-hints {
  list-style: none; margin: 4px 0 0; padding: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
  font: 9.5px system-ui, sans-serif;
  color: #8b949e; text-align: left;
  width: 100%;
}
.discover-hints li {
  padding: 3px 6px;
  border-left: 2px solid #30363d;
  border-radius: 0 4px 4px 0;
  background: rgba(115,161,127,0.04);
  line-height: 1.3;
}
.discover-hints li span {
  display: block;
  font-weight: 600; color: #cdd9e5;
}

</style>
