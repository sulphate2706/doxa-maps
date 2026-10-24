<script setup>
/**
 * @description Poster Sections: one region's posters (or every region's), as ready-made presets with their own page and embed code; the Configure preset adds a panel of choices and Copy embed for making new ones.
 *
 * poster-sections.vue — ONE parameterized profile (capability 2, like doxa-simple-map): its props pick the poster
 * type, the region ('all' = one section per region), the language, posters per row and collapsed, and it renders the
 * library's <dxm-poster-section> element for them. poster-sections.instances.json lists the presets; the build gives
 * each its own page and embed snippet. The `configure` preset adds the panel of choices and "Copy embed", a tool for
 * making new presets. Nothing here draws a poster: the sections ARE the element (registered by index.js), and Copy
 * embed shows the same attributes as text (src/embed.js, one function for both).
 */
import { computed, h, inject, ref, watch } from 'vue'
import { useOptionalI18n } from '@map/composables/useOptionalT.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { SUPPORTED_LOCALES, RTL_LOCALES, getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import { posterType, posterTypeNames } from '@map/components/poster/posterTypes.js'
import { absoluteEmbedUrl, resolveAssetsBase } from '@map/utils/embedBase.js'
import { TAG, sectionAttrs, embedSnippet } from './src/embed.js'

const profileConfig = inject('profileConfig', ref(null))
const cfg = computed(() => profileConfig.value || {})
const { t, locale: pageLocale } = useOptionalI18n('')
const pageLang = computed(() => String(pageLocale?.value || cfg.value.locale || getRuntimeLocale() || detectLocale() || 'en'))
const dir = computed(() => (RTL_LOCALES.has(pageLang.value.split('-')[0]) ? 'rtl' : 'ltr'))

// ── the choices: seeded from the preset's props, then the panel's (configure) ──────────────────────────────
const configure = computed(() => cfg.value.configure === true)
const ALL = (v) => (!v || v === 'all' ? '' : String(v))   // '' = All regions
const type = ref('country')
const scope = ref('')
const lang = ref('en')
const collapsed = ref(false)
const columns = ref(2)
watch(cfg, (c) => {
  type.value = c.type || 'country'
  scope.value = ALL(c.scope)
  const l = c.locale || pageLang.value
  lang.value = SUPPORTED_LOCALES.includes(l) ? l : 'en'
  collapsed.value = c.collapsed === true
  columns.value = Number(c.columns) || 2
}, { immediate: true })
const COLUMN_CHOICES = [1, 2, 3, 4, 5]

// The poster types the registry knows, read at runtime and again whenever the picker is opened: another bundle on
// the page may register its type later (each type's own bundle registers it). Named in the reader's language when the
// catalogue has a name for it, else by its registry name.
const types = ref(posterTypeNames())
const refreshTypes = () => { const now = posterTypeNames(); if (now.join() !== types.value.join()) types.value = now }
const typeLabel = (name) => {
  const key = `posterSections.type${name.charAt(0).toUpperCase()}${name.slice(1)}`
  const v = t(key)
  return v && v !== key ? v : name
}
// A language in its OWN name (العربية, Deutsch …), so a reader finds theirs whatever the page's language.
const langLabel = (code) => {
  try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) || code } catch { return code }
}

// The regions the chosen type offers (its adapter's scopes), each named by the type's own section title.
const adapter = ref(null)
watch(type, async (name) => { adapter.value = await posterType(name) }, { immediate: true })
const scopes = computed(() => {
  const a = adapter.value
  const list = a && typeof a.scopes === 'function' ? a.scopes() : []
  const named = list.map((key) => ({ key, label: a.title(key, t) }))
  // alphabetical in the page's language, with the catch-all last
  return named.sort((x, y) => (x.key === 'other') - (y.key === 'other') || x.label.localeCompare(y.label, pageLang.value))
})
// In the panel, a region the newly chosen type does not have falls back to All regions. A preset keeps its scope even
// before its type is registered (the element then says it has no posters, rather than silently showing another region).
watch(scopes, (list) => { if (configure.value && scope.value && list.length && !list.some((s) => s.key === scope.value)) scope.value = '' })

// ── the tags ─────────────────────────────────────────────────────────────────
// Absolute, so the pasted tags work on another website (a relative path would resolve against THAT site).
const absolute = (u) => { try { return new URL(u, document.baseURI).href } catch { return u } }
const assetsBase = computed(() => absolute(resolveAssetsBase(cfg.value)))
const scriptUrl = computed(() => absoluteEmbedUrl('poster-sections/poster-sections.js', cfg.value))
const choices = computed(() => ({
  type: type.value, scope: scope.value, scopes: scopes.value.map((s) => s.key),
  locale: lang.value, collapsed: collapsed.value, columns: columns.value, assetsBase: assetsBase.value,
}))
const snippet = computed(() => embedSnippet(choices.value, scriptUrl.value))

// The live sections: the element itself, with exactly the attributes above. Keyed by them, so a new choice
// mounts a fresh section (a language change rebuilds its catalogue rather than patching it).
const Sections = () => h('div', { class: 'pss__sections' },
  sectionAttrs(choices.value).map((a) => h(TAG, { key: JSON.stringify(a), ...a })))

const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(snippet.value) } catch {
    const ta = document.createElement('textarea'); ta.value = snippet.value; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } finally { ta.remove() }
  }
  copied.value = true; setTimeout(() => { copied.value = false }, 1600)
}

useShadowStyles(`
.pss { box-sizing: border-box; height: 100%; overflow: auto; padding: 20px clamp(12px, 3vw, 32px) 40px; color: #3b463d;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f3f3f1; }
.pss *, .pss *::before, .pss *::after { box-sizing: border-box; }
.pss__head h2 { margin: 0; font-size: 22px; font-weight: 700; }
.pss__head p { margin: 6px 0 16px; color: #6d766e; font-size: 14px; max-width: 60ch; }
.pss__panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px 16px; align-items: end;
  background: #fff; border: 1px solid #d1d4cd; border-radius: 12px; padding: 14px 16px; }
.pss__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pss__field > span { font-size: 13px; font-weight: 600; }
.pss__field select { font: inherit; font-size: 14px; padding: 7px 8px; border: 1px solid #c3c8bf; border-radius: 8px; background: #fff;
  color: inherit; min-height: 38px; width: 100%; }
.pss__check { flex-direction: row; align-items: center; gap: 8px; min-height: 38px; }
.pss__check input { width: 18px; height: 18px; margin: 0; }
.pss__embed { margin-top: 12px; background: #fff; border: 1px solid #d1d4cd; border-radius: 12px; padding: 12px 16px; }
.pss__embed-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pss__embed h3 { margin: 0; font-size: 15px; }
.pss__embed p { margin: 2px 0 0; font-size: 13px; color: #6d766e; }
.pss__copy { font: inherit; font-size: 14px; font-weight: 600; padding: 7px 16px; border-radius: 999px; border: 1px solid #3b463d;
  background: #3b463d; color: #fff; cursor: pointer; min-height: 38px; }
.pss__copy:focus-visible, .pss__field select:focus-visible, .pss__check input:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.pss__code { display: block; width: 100%; margin-top: 10px; min-height: 84px; max-height: 220px; resize: vertical; font: 12px/1.5 ui-monospace, monospace;
  direction: ltr; text-align: left; white-space: pre; overflow: auto; border: 1px solid #d1d4cd; border-radius: 8px; padding: 8px; background: #f8f8f6; color: #1f2937; }
.pss--preset { padding-top: 12px; }
.pss--preset .pss__sections { margin-top: 0; }
.pss__sections { margin-top: 20px; display: flex; flex-direction: column; gap: 16px; }
.pss__sections > ${TAG} { display: block; }
`, 'poster-sections')
</script>

<template>
  <div class="pss" :class="{ 'pss--preset': !configure }" :dir="dir" :lang="pageLang">
    <template v-if="configure">
    <header class="pss__head">
      <h2>{{ t('posterSections.heading') }}</h2>
      <p>{{ t('posterSections.intro') }}</p>
    </header>

    <form class="pss__panel" @submit.prevent>
      <label class="pss__field">
        <span>{{ t('posterSections.type') }}</span>
        <select v-model="type" data-param="type" @focus="refreshTypes" @pointerdown="refreshTypes">
          <option v-for="n in types" :key="n" :value="n">{{ typeLabel(n) }}</option>
        </select>
      </label>
      <label class="pss__field">
        <span>{{ t('posterSections.region') }}</span>
        <select v-model="scope" data-param="scope">
          <option value="">{{ t('posterSections.allRegions') }}</option>
          <option v-for="s in scopes" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </label>
      <label class="pss__field">
        <span>{{ t('posterSections.language') }}</span>
        <select v-model="lang" data-param="locale">
          <option v-for="c in SUPPORTED_LOCALES" :key="c" :value="c" :lang="c">{{ langLabel(c) }}</option>
        </select>
      </label>
      <label class="pss__field">
        <span>{{ t('buttons.postersPerRow') }}</span>
        <select v-model.number="columns" data-param="columns">
          <option v-for="n in COLUMN_CHOICES" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <label class="pss__field pss__check">
        <input v-model="collapsed" type="checkbox" data-param="collapsed" />
        <span>{{ t('posterSections.startCollapsed') }}</span>
      </label>
    </form>

    <section class="pss__embed">
      <div class="pss__embed-row">
        <div>
          <h3>{{ t('posterSections.embed') }}</h3>
          <p>{{ t('posterSections.embedNote') }}</p>
        </div>
        <button type="button" class="pss__copy" @click="copy">{{ copied ? t('posterSections.copied') : t('posterSections.copy') }}</button>
      </div>
      <textarea class="pss__code" readonly :value="snippet" :aria-label="t('posterSections.embed')" spellcheck="false"></textarea>
    </section>
    </template>

    <Sections />
  </div>
</template>
