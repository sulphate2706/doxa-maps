<!--
  posterverse.vue — the second capability-5 app shell (nested-mfe-spa): every poster plugin in one place.

  * @description Every poster plugin in one app: a vertical-tab rail of real, embeddable poster plugins.
    Tabs: UPG100 Posters, Country Posters, Poster Design, and an Experimental folder of the
    poster-related experimental plugins. The same pattern as the Research Gallery (doxa-maps-spa),
    reused rather than copied: the shared VerticalTabsLayout, bundle+profile identities resolved from
    the tree's manifest, the library's loadScriptOnce/whenTagDefined, and the same profile-config
    contract for every child.

  WHAT IS DIFFERENT FROM THE GALLERY, on purpose:
    - The rail is an ALLOW-LIST (src/tabs.js), Experimental included. The gallery's Experimental is
      "every bundle nobody placed", which here would expose the gated key-cities.
    - No MapInfo row, no hosted "?" and no shell-level phone notice. Panes do NOT carry
      data-doxa-gallery or data-doxa-help, so each child keeps its OWN info popup and its own phone
      notice (ProfileLoader / useScreenGate) instead of deferring to a host that has none.

  ONE tag, <posterverse-app>, is defined by this bundle (index.js). It never imports a child's
  components and never registers a child's tag: each child's own script does that.
-->
<template>
  <VerticalTabsLayout
    :dir="uiDir"
    :lang="uiLocale"
    :labels="layoutLabels"
    :title="headingText"
    :nav-label="tr('sec.posters')"
    :header="false"
    :home-href="homeHref || cfg.homeHref || defaultHomeHref"
    :home-label="homeLabel || cfg.homeLabel || ''"
    :groups="navGroups"
    :active="activeKey"
    @update:active="onSelect">

    <!-- Every tab mounts its plugin's real custom element into an EMPTY, Vue-unmanaged slot, after that
         bundle's script is injected once. The hint is a separate sibling, so clearing the slot can never
         remove a Vue-managed node.
         LIGHT rows (v-show) stay mounted once loaded, so switching back is instant. HEAVY rows (anything
         that owns or nests a WebGL map) are rendered with v-if and DESTROYED on deactivate, which runs the
         element's own teardown (map.remove()) and keeps the document to about one live map context. -->
    <section
      v-for="(t, i) in tabs" :key="t.id" class="pv-pane"
      :ref="el => { if (el) paneEls[i] = el; else delete paneEls[i] }"
      v-show="i === activeIndex" :hidden="i !== activeIndex">
      <template v-if="!t.heavy || i === activeIndex">
        <div class="pv-slot" :ref="el => setSlot(i, el)"></div>
        <div v-if="t.state === 'loading'" class="pv-hint">{{ tr('loading', { label: tabLabel(t) }) }}</div>
        <div v-else-if="t.state === 'error'" class="pv-hint err">
          {{ tr('loadFailed', { label: tabLabel(t) }) }}<br><small>{{ t.error }}</small>
        </div>
        <!-- No manifest means no scriptUrl, so the row can never mount: say so rather than show an empty pane. -->
        <div v-else-if="t.state === 'idle' && !t.scriptUrl && manifestError" class="pv-hint err">
          {{ tr('loadFailed', { label: tabLabel(t) }) }}<br>
          <small>{{ manifestError }}</small><br>
          <small>{{ tr('manifestHint') }}</small>
        </div>
      </template>
    </section>

    <!-- The language menu: the end of the phone bar, and the bottom of the desktop rail. A pick asks the
         host first (doxa-language-request); only an uncancelled pick reaches setLocale. -->
    <template #phone-end><ShellLanguageMenu :current="uiLocale" @switch="setLocale" /></template>
    <template #rail-end="{ collapsed }"><ShellLanguageMenu :current="uiLocale" :collapsed="collapsed" @switch="setLocale" /></template>

    <!-- The pane is the scroller (overflow-y:auto), so back-to-top follows the active pane. -->
    <BackToTopButton :target="activePaneEl" :labels="{ backToTop: tr('backToTop') }" />
  </VerticalTabsLayout>
</template>

<script>
import { defineComponent, inject } from 'vue'
import VerticalTabsLayout from '@map/layouts/VerticalTabsLayout.vue'
import BackToTopButton from '@map/components/BackToTopButton.vue'
import ShellLanguageMenu from '@map/components/ShellLanguageMenu.vue'
import { saveLocale } from '@map/layouts/app-wrapper-material/languages.js'
import { loadScriptOnce, whenTagDefined } from '@map/utils/embedScript.js'
import { readViewKeys, writeViewKeys, onAddressChange, urlOwnerOf, ownAddress } from '@map/composables/useViewAddress.js'
import { translate, LOCALES } from './src/strings.js'
import { SECTIONS, TABS, resolveTabs } from './src/tabs.js'

// The host page's language by the ladder every nested map uses: ?lang= / ?locale=, then <html lang>.
// '' when the page says nothing. Never navigator.language: a browser's language must not override the
// language of the page the shell is embedded in.
function detectHostLocale() {
  try {
    const q = new URLSearchParams(location.search)
    const fromUrl = (q.get('lang') || q.get('locale') || '').split('-')[0].toLowerCase()
    if (LOCALES.includes(fromUrl)) return fromUrl
  } catch { /* no window */ }
  try {
    const fromHtml = (document.documentElement.lang || '').split('-')[0].toLowerCase()
    if (LOCALES.includes(fromHtml)) return fromHtml
  } catch { /* no document */ }
  return ''
}

const freshTab = (d) => ({ ...d, tag: d.tag || '', scriptUrl: d.scriptUrl || '', heavy: !!d.heavy, mounted: false, state: 'idle', error: '' })

export default defineComponent({
  name: 'Posterverse',
  // The host's attributes stay on the host: an inline style copied onto the layout root beats the
  // layout's own rules (a styled host once collapsed a nested map to 76px).
  inheritAttrs: false,
  components: { VerticalTabsLayout, BackToTopButton, ShellLanguageMenu },
  props: {
    treeBase: { type: String, default: '' },
    profileConfig: { type: [String, Object], default: '' },
    // Not `title`: that is a native HTMLElement property, and defineCustomElement maps props to attributes.
    heading: { type: String, default: 'Posterverse' },
    tokenUrl: { type: String, default: '' },
    tk: { type: String, default: '' },
    // The language, inherited from the host (canonical prop). profile-config.locale / lang also work.
    language: { type: String, default: '' },
    apiBaseUrl: { type: String, default: '' },
    // The engine for every nested map: 'maplibre' or 'mapbox'. Unset = each map's own ladder.
    provider: { type: String, default: '' },
    // Which tab opens first, by row id (src/tabs.js). Also ?tab= on the page URL.
    tab: { type: String, default: '' },
    // The host's "Back to homepage" link, drawn by VerticalTabsLayout directly above Collapse (the top of
    // the drawer on a phone). Also accepted as profile-config.homeHref / homeLabel. With no URL from the host,
    // the link goes to the DOXA site in the shell's language (defaultHomeHref).
    homeHref: { type: String, default: '' },
    homeLabel: { type: String, default: '' },
  },
  emits: ['tab-change'],
  setup() {
    return { injectedBase: inject('pvTreeBase', '') }
  },
  data() {
    return {
      paneEls: {},
      activeIndex: 0,
      manifestError: '',
      // The directory the manifest answered from (trailing slash). Tree-relative scriptUrls resolve
      // against THIS, which differs from the document under the dev server.
      manifestBase: '',
      // The manifest's `runtime` block (the build's apiBaseUrl + public token), for foreign-page embeds.
      runtime: {},
      hostLang: detectHostLocale(),
      // A language picked in THIS session through the menu, and the host's language value it was picked
      // over. The pick wins only while that value is unchanged; the saved choice (loadLocale) is never
      // read, since it falls back to the browser's language and would override the host page.
      localPick: '',
      pickBase: null,
      // Until the manifest lands, the rail shows the rows that are expected to exist; provisional rows
      // appear only once the manifest proves their bundle is in this tree.
      tabs: TABS.filter((d) => !d.provisional).map(freshTab),
    }
  },
  computed: {
    cfg() {
      let pc = this.profileConfig
      if (typeof pc === 'string') { try { pc = pc ? JSON.parse(pc) : {} } catch { pc = {} } }
      return pc && typeof pc === 'object' ? pc : {}
    },
    // The tree root with a trailing slash: host override, then the base index.js derived from its own
    // <script> URL, then '' (relative: sibling bundle folders are one level up).
    base() {
      const raw = String(this.treeBase || this.cfg.treeBase || this.injectedBase || '').trim()
      return raw ? raw.replace(/\/+$/, '') + '/' : ''
    },
    // The tree's asset pool, ABSOLUTE, for every child. Without it a nested element climbs to a sibling
    // pool the publisher does not ship.
    assetsBase() {
      const v = String(this.cfg.assetsBase || '').trim()
      if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v.replace(/\/+$/, '')
      return this.manifestBase ? this.manifestBase.replace(/\/+$/, '') + '/assets' : ''
    },
    headingText() { return String(this.cfg.heading || this.heading || '').trim() || 'Posterverse' },
    // The language the host passed: the `language` prop, else profile-config language / locale / lang.
    hostLanguage() { return String(this.language || this.cfg.language || this.cfg.locale || this.cfg.lang || '').trim() },
    // Language precedence: this session's menu pick (while the host's value is the one it was made over),
    // then what the host says, then the host page's own language, then English.
    effectiveLocale() {
      if (this.localPick && this.hostLanguage === this.pickBase) return this.localPick
      return (this.hostLanguage || this.hostLang || 'en').split('-')[0].toLowerCase()
    },
    uiLocale() { return LOCALES.includes(this.effectiveLocale) ? this.effectiveLocale : 'en' },
    // "Back to homepage" with no host to name one (a standalone page, the published tree): the DOXA site, in the
    // shell's language. A host's home-href, or profile-config.homeHref, always wins.
    defaultHomeHref() { return 'https://doxa.life' + (this.uiLocale && this.uiLocale !== 'en' ? '/' + this.uiLocale : '') },
    uiDir() { return this.uiLocale === 'ar' ? 'rtl' : 'ltr' },
    layoutLabels() {
      const out = {}
      for (const k of ['toggleList', 'openViews', 'expandList', 'collapseList', 'collapse', 'home']) out[k] = this.tr(k)
      return out
    },
    effectiveProvider() {
      const p = String(this.provider || this.cfg.provider || '').trim().toLowerCase()
      return (p === 'maplibre' || p === 'mapbox') ? p : ''
    },
    activeKey() { const t = this.tabs[this.activeIndex]; return t ? t.id : '' },
    activePaneEl() { return this.paneEls[this.activeIndex] || null },
    // The grouped rail: SECTIONS projected over the rows that exist. An empty section is omitted.
    navGroups() {
      return SECTIONS.map((g) => ({
        key: g.key,
        label: this.tr(g.i18n),
        icon: g.icon,
        folder: !!g.folder,
        open: g.open,
        rows: this.tabs.filter((t) => t.section === g.key).map((t) => ({
          key: t.id, label: this.tabLabel(t), sub: this.tabSub(t), icon: t.icon,
          badge: g.folder ? this.tr('lab') : undefined,
        })),
      })).filter((g) => g.rows.length)
    },
  },
  watch: {
    // A language change REMOUNTS: not every child re-reads its config live, but a fresh element reads
    // the new locale at mount. Hidden mounted panes are reset so their next open is fresh too.
    effectiveLocale() {
      const reset = (i, t) => {
        try { const slot = this._slots && this._slots[i]; if (slot) slot.innerHTML = '' } catch { /* reset anyway */ }
        t.mounted = false; t.state = 'idle'; t.error = ''
      }
      this.tabs.forEach((t, i) => { if (t.mounted && i !== this.activeIndex) reset(i, t) })
      const t = this.tabs[this.activeIndex]
      if (!t || !t.mounted) return
      reset(this.activeIndex, t)
      this.mountElement(this.activeIndex)
    },
    tab(id) { if (id) this.onSelect(id) },
    // A host that sets a new language takes over again: the session pick is dropped.
    hostLanguage(v) { if (v !== this.pickBase) { this.localPick = ''; this.pickBase = null } },
  },
  mounted() {
    this.watchHostLang()
    // Paint the rail at once; the manifest completes the rows in the background and re-drives the mount.
    // First paint is a REPLACE, so a reload or a shared link keeps the tab without adding a Back step. If the
    // address names a tab that only arrives with the manifest (a provisional row), write nothing yet: writing
    // tab 0 here would overwrite the link, and applyManifest's own first-paint replace writes the honoured tab.
    const want = this.requestedTab()
    const known = !want || this.tabs.some((t) => t.id === want)
    this.select(this.initialIndex(), { firstPaint: true, fromHistory: !known })
    // A nested plugin's choice inside a tab (?pane=, ?place=) reaches the address through the owner: recorded
    // only while this page owns its address, never a tab switch, and the event stops here.
    this._offOwn = ownAddress(this.$el, () => urlOwnerOf(this.cfg))
    // Back / Forward re-apply the tab from the address and never write (writing would lose Forward).
    this._offAddress = onAddressChange(({ tab }) => {
      const i = this.tabs.findIndex((t) => t.id === tab)
      this.select(i >= 0 ? i : 0, { fromHistory: true })
    })
    this.loadManifest()
  },
  beforeUnmount() {
    if (this._langObs) { this._langObs.disconnect(); this._langObs = null }
    if (this._offAddress) { this._offAddress(); this._offAddress = null }
    if (this._offOwn) { this._offOwn(); this._offOwn = null }
  },
  methods: {
    tr(key, params) { return translate(this.uiLocale, key, params) },
    // The menu's 'switch': no host cancelled the request, so the shell switches itself.
    setLocale(code) {
      this.pickBase = this.hostLanguage
      this.localPick = code
      saveLocale(code)
    },
    tabLabel(t) { return this.tr('tab.' + t.id) },
    tabSub(t) { return t.section === 'experimental' ? this.tr('experimentalSub') : this.tr('sub.' + t.id) },
    setSlot(i, el) { if (el) this._slots = Object.assign(this._slots || {}, { [i]: el }) },
    watchHostLang() {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
      this._langObs = new MutationObserver(() => { this.hostLang = detectHostLocale() })
      this._langObs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    },
    requestedTab() {
      let q = ''
      try { q = readViewKeys(location.search).tab } catch { /* non-browser */ }
      // On a page whose address this shell owns, the URL (a reload, a shared link) beats a baked cfg.tab, or the
      // first-paint replace would overwrite the link with the default. Elsewhere the host's config leads.
      const order = urlOwnerOf(this.cfg) ? [this.tab, q, this.cfg.tab] : [this.tab, this.cfg.tab, q]
      return String(order.find((v) => v) || '').trim()
    },
    initialIndex() {
      const i = this.tabs.findIndex((t) => t.id === this.requestedTab())
      return i >= 0 ? i : 0
    },
    // Read the manifest once. Candidates, in order:
    //   1. <tree>/manifest.json (same origin);
    //   2. <tree>/doxa-maps-spa/manifest.json, the byte-identical copy generate-tree writes for the
    //      Research Gallery. The live static layer sends CORS headers only inside a tree folder, not
    //      on the root manifest, so a partner page's script embed reads this copy FIRST;
    //   3. /<tree>/manifest.json, the built tree as the dev server serves it (at the ROOT). NOT /public/<tree>/:
    //      the dev server treats a /public/… request as SOURCE and injects an import into each built IIFE, which
    //      then fails as a classic script ("Cannot use import statement outside a module").
    // Script URLs always resolve against the tree ROOT, never the copy's folder.
    loadManifest() {
      const dirOf = (u) => { try { return new URL(u, location.href).href.replace(/[^/]*$/, '') } catch { return '' } }
      const rootUrl = this.resolve('manifest.json')
      const root = { url: rootUrl, root: dirOf(rootUrl) }
      const copy = { url: this.resolve('doxa-maps-spa/manifest.json'), root: root.root }
      let crossOrigin = false
      try { crossOrigin = new URL(rootUrl, location.href).origin !== location.origin } catch { /* relative = same */ }
      const candidates = crossOrigin ? [copy, root] : [root, copy]
      const devFallback = '/' + __DOXA_TREE_NAME__ + '/manifest.json'
      if (!candidates.some((c) => c.url === devFallback)) candidates.push({ url: devFallback, root: dirOf(devFallback) })
      const tried = []
      const attempt = (i) => {
        if (i >= candidates.length) {
          this.manifestError = 'manifest.json not found (tried ' + tried.join(', ') + ')'
          console.error('[posterverse] ' + this.manifestError + ' — every tab is composed from it.')
          return
        }
        const { url, root: treeRoot } = candidates[i]
        tried.push(url)
        return fetch(url, { credentials: 'same-origin' })
          .then((r) => { if (!r || !r.ok) throw new Error(url + ' → HTTP ' + (r ? r.status : '?')); return r.json() })
          .then((m) => {
            if (!m) throw new Error(url + ' → empty')
            this.manifestError = ''
            this.manifestBase = treeRoot || ''
            this.applyManifest(m)
          })
          .catch(() => attempt(i + 1))
      }
      try { attempt(0) } catch { /* no fetch (non-browser): fail soft */ }
    },
    // Replace the provisional rail with the rows this tree actually ships, keep the active row by id,
    // and re-drive the mount that could not run before its scriptUrl existed.
    applyManifest(m) {
      this.runtime = (m && m.runtime && typeof m.runtime === 'object') ? m.runtime : {}
      this.applyPageGlobals()
      const activeId = this.activeKey
      this.tabs = resolveTabs(m, (msg) => console.warn(msg)).map(freshTab)
      const want = this.requestedTab()
      const w = !this._honouredTab && want ? this.tabs.findIndex((t) => t.id === want) : -1
      const i = this.tabs.findIndex((t) => t.id === activeId)
      this._honouredTab = true
      this.select(w >= 0 ? w : (i >= 0 ? i : 0), { firstPaint: true })
    },
    onSelect(key) {
      const i = this.tabs.findIndex((t) => t.id === key)
      if (i !== -1) this.select(i)
    },
    // A tree-relative ref resolves against the manifest's own directory (then the tree base, then '../').
    // An absolute or rooted ref is returned untouched: prefixing a rooted dev ref makes a path that exists nowhere.
    resolve(ref) {
      const raw = String(ref)
      if (/^(https?:)?\/\//.test(raw) || raw.startsWith('/')) return raw
      const r = raw.replace(/^\.\//, '')
      if (this.manifestBase) return this.manifestBase.replace(/\/+$/, '') + '/' + r
      if (this.base) return this.base.replace(/\/+$/, '') + '/' + r
      return '../' + r
    },
    // The tab is written to the address by the ONE owner (urlOwner in profile-config: 'app' on our own pages,
    // 'host' when a host's router writes, absent on a partner's page = read only). A reader's choice is a push;
    // first paint is a replace; Back / Forward never write.
    select(i, { fromHistory = false, firstPaint = false } = {}) {
      const prevIndex = this.activeIndex
      this.activeIndex = i
      // Release the outgoing heavy pane first, so at most one live map context exists at a time.
      if (prevIndex !== i && prevIndex >= 0) {
        const prev = this.tabs[prevIndex]
        if (prev && prev.heavy && prev.mounted) this.releaseTab(prevIndex, prev)
      }
      const t = this.tabs[i]
      if (!t) return
      // Tell the host which plugin is showing (CustomEvent 'tab-change', detail[0] = { id, label }).
      if (prevIndex !== i || !this._announced) { this._announced = true; this.$emit('tab-change', { id: t.id, label: this.tabLabel(t) }) }
      if (!fromHistory) writeViewKeys({ tab: t.id }, { owner: urlOwnerOf(this.cfg), push: !firstPaint, el: this.$el })
      if (!t.scriptUrl) return   // applyManifest selects again once the manifest lands
      // A heavy tab's slot exists only after its v-if subtree renders, so mount on the next tick.
      if (!t.mounted) this.$nextTick(() => { if (this.activeIndex === i) this.mountElement(i) })
    },
    releaseTab(i, t) {
      try { const slot = this._slots && this._slots[i]; if (slot) slot.innerHTML = '' } catch { /* reset either way */ }
      if (this._slots) delete this._slots[i]
      t.mounted = false; t.state = 'idle'; t.error = ''
    },
    // THE ONE profile-config every nested element receives (the Research Gallery's contract).
    childConfig(t) {
      const pc = { profile: t.profile || t.id, instanceId: 'pv-' + t.id }
      if (this.effectiveLocale) pc.locale = this.effectiveLocale
      const tk = this.tk || this.cfg.tk || this.runtime.token
      if (tk) pc.tk = tk
      if (this.tokenUrl || this.cfg.tokenUrl) pc.tokenUrl = this.tokenUrl || this.cfg.tokenUrl
      if (this.effectiveProvider) pc.provider = this.effectiveProvider
      if (this.base) pc.treeBase = this.base
      if (this.assetsBase) pc.assetsBase = this.assetsBase
      // The host owns its URL, hash and title: a nested plugin must not write them.
      pc.urlSync = false
      // The plugin's own name for its print header: this tab's localized label.
      pc.mapTitle = this.tabLabel(t)
      return pc
    },
    // Page globals a generated leaf page bakes and a foreign host does not. Set ONLY when the page has
    // not set them: the host's own value always wins. MAP_APP_API_URL has no profile-config path, and
    // a composite's inner maps read MAP_TOKEN / MAP_PROVIDER rather than their parent's config.
    applyPageGlobals() {
      if (typeof window === 'undefined') return
      const api = String(this.apiBaseUrl || this.cfg.apiBaseUrl || this.runtime.apiBaseUrl || '').trim()
      if (api && !window.MAP_APP_API_URL) window.MAP_APP_API_URL = api.replace(/\/+$/, '')
      const tk = this.tk || this.cfg.tk || this.runtime.token
      if (tk && !window.MAP_TOKEN) window.MAP_TOKEN = tk
      if (this.effectiveProvider && !window.MAP_PROVIDER) window.MAP_PROVIDER = this.effectiveProvider
    },
    // Inject the bundle's script once, wait for its TAG to register (onload fires even when a dev module
    // fails to execute), then create the element in the pane's empty slot.
    mountElement(i) {
      const t = this.tabs[i]
      t.mounted = true
      t.state = 'loading'
      loadScriptOnce(this.resolve(t.scriptUrl)).then(() => whenTagDefined(t.tag)).then(() => {
        try {
          // Deactivated (and released) while its script loaded: mounting now would leak a map context.
          if (t.heavy && this.activeIndex !== i) { t.mounted = false; t.state = 'idle'; return }
          const slot = this._slots && this._slots[i]
          if (!slot) { t.state = 'error'; t.error = 'no slot'; return }
          slot.innerHTML = ''
          const el = document.createElement(t.tag)
          el.setAttribute('profile-config', JSON.stringify(this.childConfig(t)))
          // Also as a plain attribute: an element without a ProfileLoader reads tree-base as a prop.
          if (this.base) el.setAttribute('tree-base', this.base.replace(/\/+$/, ''))
          // FIXED-VIEWPORT (the default): pin the element to the pane. min-height:0 is load-bearing: a
          // child's own floor (420-600px on these plugins) otherwise wins over height:100% and the pane
          // scrolls the whole plugin. SCROLL rows (t.scroll, a natural-height page) are NOT pinned: they
          // take their natural height and the pane (overflow-y:auto) scrolls them.
          el.style.cssText = t.scroll
            ? 'display:block;position:static;width:100%;height:auto;'
            : 'display:block;position:absolute;inset:0;width:100%;height:100%;min-height:0;'
          slot.appendChild(el)
          t.state = 'ready'
        } catch (e) {
          t.state = 'error'
          t.error = 'mount failed: ' + ((e && e.message) || String(e))
        }
      }).catch((e) => {
        t.state = 'error'
        t.error = (e && e.message) || String(e)
      })
    },
  },
})
</script>

<style>
/* The element is its own containing block with a real height, so the layout (.vtl, position:absolute)
   stays inside the box the host placed it in. A host's own height or --posterverse-height overrides it. */
:host { display: block; position: relative; height: var(--posterverse-height, 85vh); min-height: 480px; }
/* Shadow DOM isolates selectors, not inheritance: reset the host page's typography at the box. */
:host {
  font-size: 16px; line-height: normal; font-weight: 400; font-style: normal; font-variant: normal;
  font-stretch: normal; letter-spacing: normal; word-spacing: normal; text-transform: none;
  text-align: start; text-indent: 0; text-shadow: none; white-space: normal; hyphens: manual;
  visibility: visible; cursor: auto;
}
:host([hidden]) { display: none; }
/* The pane fills the layout's content area and owns the scroll. --profile-min-h:0 opts every child out of
   ProfileLoader's 100dvh floor, which measures the viewport while this pane measures its host. */
.pv-pane { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; --profile-min-h: 0; }
.pv-slot { position: relative; min-height: 100%; }
.pv-hint {
  position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
  color: #6d766e; font-size: 13px; padding: 20px;
}
.pv-hint.err { color: #b3261e; }
.pv-hint small { color: #6d766e; }
</style>
