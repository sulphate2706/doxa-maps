<!--
  bless-india-posters.vue — the <bless-india-posters> element's root (PUBLIC, experimental).

  @element bless-india-posters
  @description A preview-only review board for the whole-India poster problem — fitting every one of
    India's people groups onto a single printable sheet. It generates each design attempt live from the
    current data (nothing stored) and shows it the way Poster Design's Sizes view does: the big sheet
    split into its printable sheets with the glue strips between them. The blessing — "Bless India in
    Jesus' name" and the Aaronic blessing (Numbers 6:24-26) — is printed on every poster. Experimental;
    a phone sees the preview but Print is blocked until a design is proven safe on a phone.

  Generates with the plugin's own stopgap generator (src/generators/, a copy of the renderer — no edits
  to the shared poster-render.js); attempts move onto the shared @map circularLayout module when it
  lands and the stopgap is deleted. Shows the W via the shared library PanelSheets (@map); prints the
  poster as its own document (a raster can't carry people-group photos, and a 60x96 sheet rasterised
  onto letter would be shrunk).
-->
<template>
  <div class="bip-root" :dir="dir">
    <header class="bip-top">
      <div>
        <h1>{{ t('title') }} <span class="bip-exp">{{ t('experimental') }}</span></h1>
        <p class="bip-sub">{{ t('intro') }}</p>
      </div>
      <div class="bip-actions">
        <button v-if="!isPhone" class="bip-btn" :disabled="!posterHtml || busy" @click="printPoster">
          {{ t('print') }}
        </button>
        <span v-else class="bip-phone">{{ t('desktopOnly') }}</span>
      </div>
    </header>

    <section class="bip-attempt">
      <div class="bip-meta">
        <span class="bip-name">{{ t('attempt') }}</span>
        <span class="bip-stat" v-if="stats">{{ t('stat', { groups: n(stats.placed), badges: n(stats.rangeBadges) }) }}</span>
      </div>

      <div class="bip-stage">
        <div v-if="busy" class="bip-note">{{ t('generating') }}</div>
        <div v-else-if="error" class="bip-note bip-err">{{ t('error', { msg: error }) }}</div>
        <PanelSheets
          v-else-if="svgUrl"
          v-bind="SHEETS"
          join-fill="bleed"
          :gap-in="0.75"
          :src="svgUrl"
          class="bip-panels"
        />
      </div>

      <p class="bip-photos">{{ t('photos', { real: n(realPhotos), total: n(stats ? stats.placed : 855) }) }}</p>
    </section>
  </div>
</template>

<script setup>
/**
 * bless-india-posters.vue — the <bless-india-posters> element.
 *
 * @element bless-india-posters
 * @description A preview surface for the whole-India poster problem — fitting every one of India's people groups onto a single printable sheet. Each design attempt is generated live from the current data (nothing stored) and shown as its printable sheets with the glue strips, headed "Bless India in Jesus' name" with the Numbers 6:24-26 blessing. Experimental; a phone sees the preview but Print is blocked until a design is proven safe on a phone.
 */
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import PanelSheets from '@map/components/poster/PanelSheets.vue'
import { POSTER_LADDER } from '@map/constants/posterSizes.js'
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'
import { ISO3_NAME } from '@map/data/iso3-name.js'
import seriesJson from '@map/scripts/posters/series.json'
import { generatePoster, BLESSING } from './src/generate.js'
import { loadBoundaries } from './src/boundaries.js'

// The host (a shell, or a plain embed) passes profile-config; the shells (Posterverse, the Research
// Gallery) write an ABSOLUTE assetsBase + treeBase into it. resolveAssetsBase reads that, else falls
// to the bundle's own tree root (import.meta.url, captured at script load — NOT a runtime
// deriveTreeBase(), which returns '' once document.currentScript is gone, the bug that made the
// boundaries load from /assets, the host's HTML page). Rule: load assets from the assets base.
const props = defineProps({ profileConfig: { type: [String, Object], default: '' } })
const parsedConfig = (() => {
  const c = props.profileConfig
  if (!c) return {}
  if (typeof c === 'object') return c
  try { return JSON.parse(c) } catch { return {} }
})()

// Lightweight i18n for the plugin's OWN page chrome, so Arabic readers read Arabic (not English with
// misplaced RTL punctuation). Reads the locale the shells pass (profileConfig.locale/lang), loads the
// blessIndiaPosters.json for that language (English fallback), and sets dir for RTL scripts. Counts go
// through the locale's number format. The POSTER's blessing header/footer is the separate footer work.
const LOCALE_MSGS = import.meta.glob('../../library/i18n/locales/*/blessIndiaPosters.json', { eager: true })
const msgPath = (l) => `../../library/i18n/locales/${l}/blessIndiaPosters.json`
const urlLang = (() => { try { return new URLSearchParams(location.search).get('lang') || '' } catch { return '' } })()
const docLang = (() => { try { return document.documentElement.lang || '' } catch { return '' } })()
const lang = String(parsedConfig.locale || parsedConfig.lang || urlLang || docLang || 'en').split('-')[0].toLowerCase()
const EN = (LOCALE_MSGS[msgPath('en')] || {}).default || {}
const MSGS = (LOCALE_MSGS[msgPath(lang)] || {}).default || EN
const dir = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi'].includes(lang) ? 'rtl' : 'ltr'
const nf = (() => { try { return new Intl.NumberFormat(lang) } catch { return new Intl.NumberFormat('en') } })()
const n = (x) => nf.format(Number(x) || 0)
const t = (key, vars) => {
  let s = (MSGS[key] != null ? MSGS[key] : EN[key] != null ? EN[key] : key)
  if (vars) for (const [k, v] of Object.entries(vars)) s = String(s).split(`{${k}}`).join(v)
  return s
}

const SHEETS = POSTER_LADDER['60x96'].sheets           // { sheetW:60, sheetH:36, count:3, direction, joinIn:6 }
const seriesDef = (seriesJson && seriesJson.country) || {}

const isPhone = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches

const busy = ref(true)
const error = ref('')
const svgUrl = shallowRef('')
const posterHtml = shallowRef('')
const stats = ref(null)
const realPhotos = ref(151)
let blobUrl = ''

async function build() {
  busy.value = true; error.value = ''
  try {
    const recordsFor = createPeopleGroupRecords({ apiBase: () => getApiBaseUrl(), lang: () => 'en' })
    const [records, boundaries] = await Promise.all([
      recordsFor({ type: 'country', values: ['IND'] }),
      loadBoundaries(resolveAssetsBase(parsedConfig)),
    ])
    const { html, svg, stats: s, count } = await generatePoster({
      records, ...boundaries, seriesDef, iso3Name: ISO3_NAME, format: '60x96c4b',
      // The poster's own header is a phrase (not scripture), so localize it to the reader's language;
      // the footer verse stays the English PD blessing until the per-locale strict-PD sourcing lands.
      blessing: { ...BLESSING, header: t('posterHeader') },
    })
    posterHtml.value = html
    stats.value = s
    realPhotos.value = records.filter((r) => typeof r.image_url === 'string' && !/no-photo/.test(r.image_url)).length || 151
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    svgUrl.value = blobUrl
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    busy.value = false
  }
}

function printPoster() {
  if (!posterHtml.value) return
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open(); w.document.write(posterHtml.value); w.document.close()
  const go = () => { try { w.focus(); w.print() } catch {} }
  if (w.document.readyState === 'complete') setTimeout(go, 300); else w.onload = () => setTimeout(go, 300)
}

onMounted(build)
onBeforeUnmount(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })
</script>

<style>
.bip-root { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1c1c17; background: #f7f4ec; padding: 20px; box-sizing: border-box; min-height: 100%; }
.bip-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid #d9d2c2; padding-bottom: 14px; margin-bottom: 18px; }
.bip-top h1 { font-size: 22px; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
.bip-exp { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #b23b2e; border: 1px solid #b23b2e; border-radius: 999px; padding: 2px 8px; }
.bip-sub { margin: 0; max-width: 64ch; font-size: 13px; color: #55503f; }
.bip-actions { display: flex; align-items: center; }
.bip-btn { background: #1c1c17; color: #f7f4ec; border: 0; border-radius: 6px; padding: 9px 14px; font-size: 13px; cursor: pointer; }
.bip-btn:disabled { opacity: .5; cursor: default; }
.bip-phone { font-size: 12.5px; color: #b23b2e; max-width: 24ch; text-align: right; }
.bip-attempt { max-width: 820px; margin: 0 auto; }
.bip-meta { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: #55503f; margin-bottom: 8px; }
.bip-name { font-weight: 700; color: #1c1c17; }
.bip-stage { background: #efe9db; border: 1px solid #e4ddcc; border-radius: 10px; padding: 16px; min-height: 240px; display: flex; align-items: center; justify-content: center; }
.bip-panels { width: 100%; max-width: 560px; margin: 0 auto; }
.bip-note { color: #55503f; font-size: 14px; }
.bip-err { color: #b23b2e; }
.bip-photos { font-size: 12px; color: #6b6450; margin-top: 10px; max-width: 70ch; }
</style>
