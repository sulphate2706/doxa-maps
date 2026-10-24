<!--
  StudioTree.vue — the plugin studio's rail: an EXPLORER TREE, imitating VS Code's Explorer.

  ★ WHY IMITATE, NOT INVENT: the studio nests every plugin, and
    composites nest composites — a hierarchy too deep and too repetitive to hand-roll as tabs. The
    leader for exactly this problem is the VS Code Explorer (researched against VS Code's views UX
    guidelines, its tree settings, Storybook's sidebar and the WAI-ARIA APG Tree View pattern). What is
    copied:
      - collapsible SECTIONS with sticky uppercase headers (VS Code views)      → CAP 5 … CAP 1
      - twisty on the LEFT, space reserved on leaves so labels line up
      - one-line rows: label + a muted DESCRIPTION                              → the element tag
      - indent guides, always on (renderIndentGuides "always")
      - a FILTER box on top (VS Code tree find, Storybook search): matches plus their parents
      - one view action only — Collapse all ("be careful not to add too many actions")
      - AUTO-REVEAL: opening a plugin by click, URL hash or restored tab expands and scrolls to it
      - the ACTIVITY BAR when the rail is slim: one icon per section, click → rail opens at it
      - APG keyboard: ↓/↑ move, → open / first child, ← close / parent, Home/End, Enter activates,
        type a letter to jump
    Composites start FOLDED (a deep tree of nested plugins is hard to navigate open); the open/closed
    state is remembered per page, as VS Code remembers expansion.

  ★ ONE TREE, SECTIONS AS LEVEL-1 NODES. VS Code's section headers are separate pane buttons; here they
    are treeitems at aria-level 1 so arrow keys walk the whole rail in one pass instead of stopping at
    every section border. Plugins are level 2+, a composite's parts one level deeper each.

  ★ A REPEATED CHILD IS NOT A SECOND PLUGIN. A part row (people-groups-grid under dashboard-plus-grid)
    TARGETS the one canonical row: choosing it opens the same pane and highlights every copy. That is
    what keeps "name the one element that is broken" possible with repeats on screen.

  Rendered as a CHILD of the <plugin-studio> custom element, inside its shadow root, through
  VerticalTabsLayout's #rail slot. Child-SFC <style> is dropped by Vue in a custom element, so the CSS
  is injected with useShadowStyles; the <style> block below is the same CSS for dev — keep in sync.
-->
<template>
  <!-- SLIM RAIL = the activity bar: one icon per capability section in the strip that stays visible. -->
  <div v-if="collapsed" class="st-activity">
    <button v-for="s in sections" :key="s.id" type="button" class="st-act"
      :class="{ active: s.id === activeSectionId }"
      :aria-label="str('openSection', { cap: s.badge || 'CAP ' + s.cap, label: s.label })"
      @click="openSectionFromActivity(s.id)">
      <span class="st-act-ic" aria-hidden="true" v-html="svg(s.icon)"></span>
      <span class="st-act-n" aria-hidden="true">{{ s.short || s.cap }}</span>
    </button>
  </div>

  <div v-else class="st">
    <div class="st-bar">
      <label class="st-find">
        <span class="st-find-ic" aria-hidden="true" v-html="svg('search')"></span>
        <input ref="find" type="search" class="st-find-in" v-model="query" :placeholder="str('filterPlaceholder')"
          :aria-label="str('filterPlaceholder')" @keydown="onFindKey" />
      </label>
      <button type="button" class="st-tool" :aria-label="str('collapseAll')" :title="str('collapseAll')" @click="collapseAll">
        <span aria-hidden="true" v-html="collapseAllSvg"></span>
      </button>
    </div>

    <div class="st-tree" role="tree" :aria-label="str('treeLabel')" @keydown="onTreeKey">
      <div v-for="item in visible" :key="item.id"
        :ref="el => setRow(item.id, el)"
        role="treeitem"
        :aria-level="item.level"
        :aria-expanded="item.expandable ? String(isOpen(item)) : null"
        :aria-selected="item.section ? null : String(item.target === active)"
        :tabindex="item.id === focusId ? 0 : -1"
        :class="rowClass(item)"
        :style="{ '--st-depth': item.depth }"
        :title="item.title || null"
        @click="onRowClick(item)"
        @focus="focusId = item.id">
        <template v-if="item.section">
          <span class="st-twisty" aria-hidden="true" v-html="chev"></span>
          <span class="st-cap">{{ item.badge }}</span>
          <span class="st-sec-label">{{ item.label }}</span>
          <span class="st-count">{{ item.count }}</span>
        </template>
        <template v-else>
          <span v-for="g in item.depth" :key="g" class="st-guide" :style="{ '--st-g': g - 1 }" aria-hidden="true"></span>
          <span v-if="item.expandable" class="st-twisty" aria-hidden="true" v-html="chev" @click.stop="toggle(item)"></span>
          <span v-else class="st-twisty-sp" aria-hidden="true"></span>
          <span class="st-ic" aria-hidden="true" v-html="svg(item.icon)"></span>
          <span class="st-label">{{ item.label }}</span>
          <span class="st-part" v-if="item.part">{{ str('part') }}</span>
          <span class="st-desc">{{ item.desc }}</span>
          <span class="st-count" v-if="item.expandable">{{ item.kids }}</span>
        </template>
      </div>
      <p class="st-empty" v-if="query && !visible.length">{{ str('noMatch', { query }) }}</p>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { icon as localIcon } from '@map/layouts/app-wrapper-material/icons.js'

const ST_CSS = '' +
  '.st { display:flex; flex-direction:column; margin:0 -12px; }' +
  '.st-bar { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:6px; padding:8px 12px 8px; background:#ffffff; }' +
  '.st-find { flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:6px; height:30px; padding:0 8px; border:1px solid #d1d4cd; border-radius:8px; background:#f3f3f1; color:#6d766e; }' +
  '.st-find:focus-within { border-color:#92b195; background:#ffffff; }' +
  '.st-find-ic { display:inline-flex; } .st-find-ic svg { width:14px; height:14px; }' +
  '.st-find-in { flex:1 1 auto; min-width:0; border:0; outline:0; background:none; font:inherit; font-size:13px; color:#3b463d; }' +
  '.st-tool { flex:0 0 auto; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:8px; background:none; color:#6d766e; cursor:pointer; }' +
  '.st-tool:hover { background:#f3f3f1; color:#3b463d; } .st-tool:focus-visible { outline:2px solid #92b195; outline-offset:-2px; }' +
  '.st-tool svg { width:16px; height:16px; }' +
  '.st-tree { display:flex; flex-direction:column; padding:0 0 8px; outline:0; }' +
  '.st-row { position:relative; display:flex; align-items:center; gap:6px; height:28px; box-sizing:border-box; padding-block:0; padding-inline:calc(8px + var(--st-depth) * 14px) 10px; font-size:13px; color:#3b463d; cursor:pointer; white-space:nowrap; user-select:none; outline:0; }' +
  '.st-row:hover { background:#f3f3f1; }' +
  '.st-row:focus-visible { box-shadow:inset 0 0 0 1px #92b195; }' +
  '.st-row.active { background:rgba(146,177,149,.24); }' +
  '.st-row.active::after { content:""; position:absolute; inset-inline-start:0; top:4px; bottom:4px; width:3px; border-start-end-radius:3px; border-end-end-radius:3px; background:#92b195; }' +
  '.st-row.alias.active { background:rgba(146,177,149,.12); }' +
  '.st-sec { position:sticky; top:46px; z-index:2; height:30px; margin-top:6px; background:#ffffff; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#6d766e; border-top:1px solid #eceee9; }' +
  '.st-sec:first-child { margin-top:0; border-top:0; }' +
  '.st-sec:hover { background:#ffffff; color:#3b463d; }' +
  '.st-cap { flex:0 0 auto; font:700 10px/1 system-ui,sans-serif; letter-spacing:.3px; padding:3px 6px; border-radius:999px; background:#92b195; color:#1d2a1f; }' +
  '.st-sec-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }' +
  '.st-twisty, .st-twisty-sp { flex:0 0 16px; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; color:#6d766e; }' +
  '.st-twisty svg { width:14px; height:14px; transition:transform .12s ease; }' +
  '.st-row[aria-expanded="true"] > .st-twisty svg { transform:rotate(90deg); }' +
  '.st:dir(rtl) .st-twisty svg { transform:scaleX(-1); } .st:dir(rtl) .st-row[aria-expanded="true"] > .st-twisty svg { transform:rotate(90deg); }' +
  '.st-ic { flex:0 0 16px; display:inline-flex; color:#6d766e; } .st-ic svg { width:16px; height:16px; }' +
  '.st-row.active .st-ic { color:#5f8a63; }' +
  '.st-label { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }' +
  // flex-basis 0 on the DESCRIPTION: it only gets what the name leaves over, so the name is never
  // ellipsised to make room for the tag (VS Code truncates the description first, too).
  '.st-desc { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; font:11px/1 ui-monospace,Menlo,monospace; color:#8a928b; }' +
  '.st-part { flex:0 0 auto; font:600 9px/1 system-ui,sans-serif; text-transform:uppercase; letter-spacing:.3px; padding:2px 4px; border:1px solid #92b195; border-radius:4px; color:#5f8a63; }' +
  '.st-count { flex:0 0 auto; margin-inline-start:auto; min-width:18px; text-align:right; font-size:11px; font-weight:500; letter-spacing:0; color:#6d766e; }' +
  '.st-guide { position:absolute; top:0; bottom:0; inset-inline-start:calc(15px + var(--st-g) * 14px); border-inline-start:1px solid #dfe2db; pointer-events:none; }' +
  '.st-row:hover > .st-guide { border-inline-start-color:#c4c8c0; }' +
  '.st-empty { margin:12px; font-size:13px; color:#6d766e; }' +
  '.st-activity { display:flex; flex-direction:column; gap:4px; }' +
  '.st-act { position:relative; display:flex; align-items:center; justify-content:center; width:48px; height:44px; margin-inline-start:172px; padding:0; border:0; border-radius:10px; background:none; color:#6d766e; cursor:pointer; }' +
  '.st-act:hover, .st-act.active { background:#f3f3f1; color:#3b463d; }' +
  '.st-act:focus-visible { outline:2px solid #92b195; outline-offset:-2px; }' +
  '.st-act-ic { display:inline-flex; } .st-act-ic svg { width:20px; height:20px; }' +
  '.st-act-n { position:absolute; right:6px; bottom:5px; font:700 9px/1 system-ui,sans-serif; color:#5f8a63; }'

const COLLAPSE_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><line x1="8.5" y1="12" x2="15.5" y2="12"/></svg>'
const EN = {
  filterPlaceholder: 'Filter plugins', collapseAll: 'Collapse all', noMatch: 'No plugin matches “{query}”.',
  treeLabel: 'Plugins by capability', openSection: 'Open {cap}, {label}', part: 'part'
}
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'

// A node is the CANONICAL row of a plugin when the rail says so (canonical: true); older models without
// the flag used depth 0 for that. A bundle FOLDER is not a plugin, and neither is a repeated part.
const isCanonical = (n) => (n.canonical !== undefined ? !!n.canonical : n.depth === 0)
const isAlias = (n) => (n.canonical !== undefined ? !n.canonical && !n.folder : n.depth > 0)

export default defineComponent({
  name: 'StudioTree',
  props: {
    // [{ id, cap, label, icon, nodes: [{ id, parent, depth, label, desc, icon, target, kids, part, title }] }]
    // nodes are in display order (a parent before its children), depth 0 = a plugin in its section.
    sections: { type: Array, default: () => [] },
    active: { type: String, default: '' },
    collapsed: { type: Boolean, default: false },
    pick: { type: Function, default: null },
    expand: { type: Function, default: null },
    // The host's localised strings (plugin-studio passes studio.json values); English fallbacks below.
    strings: { type: Object, default: () => ({}) }
  },
  emits: ['select'],
  setup() { useShadowStyles(ST_CSS, 'studio-tree') },
  data() {
    const saved = this.readState()
    return {
      query: '',
      focusId: '',
      // Sections default OPEN, nodes default CLOSED; only deviations are stored.
      secClosed: saved.sec || {},
      nodeOpen: saved.node || {},
      chev: CHEV,
      collapseAllSvg: COLLAPSE_ALL
    }
  },
  computed: {
    byId() {
      const m = new Map()
      for (const s of this.sections) for (const n of s.nodes) m.set(n.id, n)
      return m
    },
    q() { return this.query.trim().toLowerCase() },
    // Filter mode (VS Code tree find): a node stays if it matches, or if something under it matches —
    // so a match is always shown WITH the path to it. Everything is expanded while filtering.
    kept() {
      if (!this.q) return null
      const keep = new Set()
      for (const s of this.sections) {
        for (const n of s.nodes) {
          const hit = n.label.toLowerCase().includes(this.q) || String(n.desc || '').toLowerCase().includes(this.q)
          if (!hit) continue
          keep.add(n.id)
          let p = n.parent
          while (p) { keep.add(p); p = this.byId.get(p) && this.byId.get(p).parent }
        }
      }
      return keep
    },
    // The flat, ordered list of rows actually on screen — what arrow keys walk.
    visible() {
      const out = []
      for (const s of this.sections) {
        const nodes = this.kept ? s.nodes.filter(n => this.kept.has(n.id)) : s.nodes
        if (this.kept && !nodes.length) continue
        out.push({
          id: 'sec:' + s.id, section: true, sectionId: s.id, level: 1, depth: 0, expandable: true,
          cap: s.cap, badge: s.badge || 'CAP ' + s.cap, label: s.label, title: s.title || '', count: s.nodes.filter(n => n.depth === 0).length
        })
        if (!this.kept && this.secClosed[s.id]) continue
        for (const n of nodes) {
          if (!this.kept && !this.ancestorsOpen(n)) continue
          out.push({ ...n, sectionId: s.id, level: n.depth + 2, expandable: !!n.kids, alias: isAlias(n) })
        }
      }
      return out
    },
    activeSectionId() {
      for (const s of this.sections) if (s.nodes.some(n => isCanonical(n) && n.target === this.active)) return s.id
      return ''
    }
  },
  watch: {
    // AUTO-REVEAL (explorer.autoReveal): whenever the active plugin changes — a click, a URL hash, a
    // restored last tab — make its canonical row visible and scroll it into view.
    active: { handler() { this.reveal() }, immediate: true },
    sections() { this.reveal() },
    query(v) { if (v && this.visible.length) this.focusId = this.visible[0].id }
  },
  methods: {
    svg(name) { return name ? localIcon(name) : '' },
    str(key, vars) {
      let v = this.strings[key] || EN[key] || key
      if (vars) for (const k in vars) v = v.split('{' + k + '}').join(String(vars[k]))
      return v
    },
    storageKey() { return 'dx-studio-tree:' + ((typeof location !== 'undefined' && location.pathname) || '') },
    // Guarded: storage THROWS in private mode / under policy, and a throw here would blank the studio.
    readState() { try { return JSON.parse(window.localStorage.getItem(this.storageKey()) || '{}') || {} } catch (_) { return {} } },
    saveState() { try { window.localStorage.setItem(this.storageKey(), JSON.stringify({ sec: this.secClosed, node: this.nodeOpen })) } catch (_) { /* storage unavailable */ } },
    ancestorsOpen(n) {
      let p = n.parent
      while (p) { if (!this.nodeOpen[p]) return false; p = this.byId.get(p) && this.byId.get(p).parent }
      return true
    },
    isOpen(item) {
      if (this.kept) return true
      return item.section ? !this.secClosed[item.sectionId] : !!this.nodeOpen[item.id]
    },
    setOpen(item, open) {
      if (item.section) this.secClosed = { ...this.secClosed, [item.sectionId]: !open }
      else this.nodeOpen = { ...this.nodeOpen, [item.id]: open }
      this.saveState()
    },
    toggle(item) { if (item.expandable) this.setOpen(item, !this.isOpen(item)) },
    collapseAll() {
      this.nodeOpen = {}
      this.saveState()
      const a = this.visible.find(i => !i.section && i.target === this.active && isCanonical(i))
      if (a) this.focusId = a.id
    },
    rowClass(item) {
      return {
        'st-row': true,
        'st-sec': !!item.section,
        active: !item.section && item.target === this.active,
        alias: !!item.alias
      }
    },
    setRow(id, el) { if (!this._rows) this._rows = {}; if (el) this._rows[id] = el; else delete this._rows[id] },
    // Choosing a plugin opens it in the pane (through the layout's pick, which also closes the mobile
    // drawer). It does NOT unfold the row: a reader clicks UPG 100 List to see UPG 100 List, not every
    // element inside it. Only the twisty (or → / ←) folds and unfolds. A part with no page of its own
    // opens the composite it lives in.
    activate(item) {
      if (item.section) { this.toggle(item); return }
      if (!item.target) return
      if (this.pick) this.pick(item.target); else this.$emit('select', item.target)
    },
    onRowClick(item) { this.focusId = item.id; this.activate(item) },
    focusRow(id) {
      if (!id) return
      this.focusId = id
      this.$nextTick(() => { const el = this._rows && this._rows[id]; if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }) } })
    },
    // APG Tree View keyboard model.
    onTreeKey(e) {
      const list = this.visible
      if (!list.length) return
      const i = Math.max(0, list.findIndex(x => x.id === this.focusId))
      const cur = list[i]
      const parentRowId = (it) => it.section ? '' : (it.parent || ('sec:' + it.sectionId))
      switch (e.key) {
        case 'ArrowDown': this.focusRow((list[i + 1] || cur).id); break
        case 'ArrowUp': this.focusRow((list[i - 1] || cur).id); break
        case 'Home': this.focusRow(list[0].id); break
        case 'End': this.focusRow(list[list.length - 1].id); break
        case 'ArrowRight':
          if (!cur.expandable) break
          if (!this.isOpen(cur)) this.setOpen(cur, true)
          else if (list[i + 1] && list[i + 1].level > cur.level) this.focusRow(list[i + 1].id)
          break
        case 'ArrowLeft':
          if (cur.expandable && this.isOpen(cur) && !this.kept) this.setOpen(cur, false)
          else this.focusRow(parentRowId(cur))
          break
        case 'Enter': case ' ': this.activate(cur); break
        default:
          // Type-ahead: jump to the next row whose name starts with the typed character.
          if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ch = e.key.toLowerCase()
            const order = list.slice(i + 1).concat(list.slice(0, i + 1))
            const hit = order.find(x => String(x.label).toLowerCase().startsWith(ch))
            if (hit) this.focusRow(hit.id)
            break
          }
          return
      }
      e.preventDefault()
    },
    onFindKey(e) {
      if (e.key === 'Escape') { this.query = ''; e.preventDefault() }
      else if (e.key === 'ArrowDown' && this.visible.length) { this.focusRow(this.visible[0].id); e.preventDefault() }
    },
    reveal() {
      if (!this.active || !this.sections.length) return
      let row = null
      for (const s of this.sections) {
        row = s.nodes.find(n => isCanonical(n) && n.target === this.active)
        if (row) { if (this.secClosed[s.id]) { this.secClosed = { ...this.secClosed, [s.id]: false }; this.saveState() } break }
      }
      // A closed bundle folder whose own target IS this plugin already stands for it: highlight the folder,
      // don't unfold it. Otherwise open the folder(s) above the plugin, or it cannot be seen.
      if (row) {
        for (let p = row.parent; p;) {
          const pn = this.byId.get(p)
          if (!pn) break
          if (pn.target === this.active && !this.nodeOpen[p]) { row = pn; break }
          p = pn.parent
        }
      }
      if (row) {
        let p = row.parent, opened = false
        while (p) { if (!this.nodeOpen[p]) { this.nodeOpen = { ...this.nodeOpen, [p]: true }; opened = true } p = this.byId.get(p) && this.byId.get(p).parent }
        if (opened) this.saveState()
      }
      if (!row) return
      if (!this.focusId || !this.byId.has(this.focusId) || this.byId.get(this.focusId).target !== this.active) this.focusId = row.id
      this.$nextTick(() => { const el = this._rows && this._rows[row.id]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) })
    },
    openSectionFromActivity(id) {
      if (this.secClosed[id]) { this.secClosed = { ...this.secClosed, [id]: false }; this.saveState() }
      if (this.expand) this.expand()
      this.$nextTick(() => this.focusRow('sec:' + id))
    }
  }
})
</script>

<style>
/* Mirror of ST_CSS above (dev / light-DOM readability). Keep the two in sync. */
.st { display:flex; flex-direction:column; margin:0 -12px; }
.st-bar { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:6px; padding:8px 12px 8px; background:#ffffff; }
.st-find { flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:6px; height:30px; padding:0 8px; border:1px solid #d1d4cd; border-radius:8px; background:#f3f3f1; color:#6d766e; }
.st-find:focus-within { border-color:#92b195; background:#ffffff; }
.st-find-ic { display:inline-flex; } .st-find-ic svg { width:14px; height:14px; }
.st-find-in { flex:1 1 auto; min-width:0; border:0; outline:0; background:none; font:inherit; font-size:13px; color:#3b463d; }
.st-tool { flex:0 0 auto; width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:8px; background:none; color:#6d766e; cursor:pointer; }
.st-tool:hover { background:#f3f3f1; color:#3b463d; } .st-tool:focus-visible { outline:2px solid #92b195; outline-offset:-2px; }
.st-tool svg { width:16px; height:16px; }
.st-tree { display:flex; flex-direction:column; padding:0 0 8px; outline:0; }
.st-row { position:relative; display:flex; align-items:center; gap:6px; height:28px; box-sizing:border-box; padding-block:0; padding-inline:calc(8px + var(--st-depth) * 14px) 10px; font-size:13px; color:#3b463d; cursor:pointer; white-space:nowrap; user-select:none; outline:0; }
.st-row:hover { background:#f3f3f1; }
.st-row:focus-visible { box-shadow:inset 0 0 0 1px #92b195; }
.st-row.active { background:rgba(146,177,149,.24); }
.st-row.active::after { content:""; position:absolute; inset-inline-start:0; top:4px; bottom:4px; width:3px; border-start-end-radius:3px; border-end-end-radius:3px; background:#92b195; }
.st-row.alias.active { background:rgba(146,177,149,.12); }
.st-sec { position:sticky; top:46px; z-index:2; height:30px; margin-top:6px; background:#ffffff; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#6d766e; border-top:1px solid #eceee9; }
.st-sec:first-child { margin-top:0; border-top:0; }
.st-sec:hover { background:#ffffff; color:#3b463d; }
.st-cap { flex:0 0 auto; font:700 10px/1 system-ui,sans-serif; letter-spacing:.3px; padding:3px 6px; border-radius:999px; background:#92b195; color:#1d2a1f; }
.st-sec-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.st-twisty, .st-twisty-sp { flex:0 0 16px; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; color:#6d766e; }
.st-twisty svg { width:14px; height:14px; transition:transform .12s ease; }
.st-row[aria-expanded="true"] > .st-twisty svg { transform:rotate(90deg); }
.st:dir(rtl) .st-twisty svg { transform:scaleX(-1); } .st:dir(rtl) .st-row[aria-expanded="true"] > .st-twisty svg { transform:rotate(90deg); }
.st-ic { flex:0 0 16px; display:inline-flex; color:#6d766e; } .st-ic svg { width:16px; height:16px; }
.st-row.active .st-ic { color:#5f8a63; }
.st-label { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.st-desc { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; font:11px/1 ui-monospace,Menlo,monospace; color:#8a928b; }
.st-part { flex:0 0 auto; font:600 9px/1 system-ui,sans-serif; text-transform:uppercase; letter-spacing:.3px; padding:2px 4px; border:1px solid #92b195; border-radius:4px; color:#5f8a63; }
.st-count { flex:0 0 auto; margin-inline-start:auto; min-width:18px; text-align:right; font-size:11px; font-weight:500; letter-spacing:0; color:#6d766e; }
.st-guide { position:absolute; top:0; bottom:0; inset-inline-start:calc(15px + var(--st-g) * 14px); border-inline-start:1px solid #dfe2db; pointer-events:none; }
.st-row:hover > .st-guide { border-inline-start-color:#c4c8c0; }
.st-empty { margin:12px; font-size:13px; color:#6d766e; }
.st-activity { display:flex; flex-direction:column; gap:4px; }
.st-act { position:relative; display:flex; align-items:center; justify-content:center; width:48px; height:44px; margin-inline-start:172px; padding:0; border:0; border-radius:10px; background:none; color:#6d766e; cursor:pointer; }
.st-act:hover, .st-act.active { background:#f3f3f1; color:#3b463d; }
.st-act:focus-visible { outline:2px solid #92b195; outline-offset:-2px; }
.st-act-ic { display:inline-flex; } .st-act-ic svg { width:20px; height:20px; }
.st-act-n { position:absolute; right:6px; bottom:5px; font:700 9px/1 system-ui,sans-serif; color:#5f8a63; }
</style>
