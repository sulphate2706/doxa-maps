<script setup>
/**
 * poster-styles.vue: every poster template the library prints, one card per configuration.
 *
 * @element poster-design
 * @description Every poster template in one grid (map sheets, the prayer packet, prayer cards, the wall
 *   panels, the map print), each card drawn from the library with sample data and named by its
 *   configuration, with "Show full details" for what an agent needs to reuse it.
 *
 * The cards ARE the poster wall's cards: this profile renders the library's PosterWall and changes two
 * things through its host seams. headerAction turns the card's "Show on map" sticker into "Show full
 * details" (there is no map here), and previewSrc draws each thumbnail from the library at view time
 * instead of reading a stored image, so a change to a template shows up here the next time it opens.
 * The catalogue itself is src/templates.js. Below it, every poster design OTHER plugins declare in their own meta
 * ("posterDesign", carried into manifest.json; src/pluginDesigns.js) gets a card in its own group: it is made by its
 * own plugin, so the card says so and "Show full details" shows that plugin's page live.
 */
import { computed, inject, onMounted, ref } from 'vue'
import PosterWall from '@map/components/poster/PosterWall.vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { absoluteEmbedUrl, resolveAssetsBase } from '@map/utils/embedBase.js'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'
import countryData from '@map/data/country-posters.json'
import { makeCountrySheet, sheetWithheld } from '@map/packet/countrySheet.js'
import { loadPacketStrings } from '@map/packet/packetStrings.js'
import { firstPageImage } from './src/pageThumb.js'
import { panelsSvgUrl } from './src/panelsSvg.js'
import { resolvePosterSize } from '@map/constants/posterSizes.js'
import { listConfigurations, FAMILY_KEYS, SAMPLE_COUNTRY_ID } from './src/templates.js'
import FullDetailsDialog from './src/FullDetailsDialog.vue'
import { loadPluginDesigns } from './src/pluginDesigns.js'
import { sizeText, declaredSizeText } from './src/sizeText.js'

const profileConfig = inject('profileConfig', ref(null))
const instanceId = computed(() => profileConfig.value?.instanceId || 'poster-design-styles')
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))
const t = useOptionalT('')

const configs = listConfigurations()
const byName = new Map(configs.map((c) => [c.name, c]))

// A card's title: the template's name, then its size. Card stocks name the stock the way the wall's own
// stock picker does (the noun translates, the size is printed as a printer's box prints it).
function stockLabel(s) {
  if (!s.noun) return s.label
  const noun = s.noun === 'postcard' ? t('wall.stockPostcard') : t('wall.stockCard')
  const dims = `${s.w} × ${s.h} in`
  return s.side ? `${noun} ${dims} (${t('wall.stockLandscape')})` : `${noun} ${dims}`
}
const labelOf = (c) => (c.stock ? `${t(c.labelKey)}: ${stockLabel(c.stock)}` : `${t(c.labelKey)}: ${sizeText(c.size, t)}`)

// Designs other plugins declare (their meta's posterDesign, via manifest.json): the built tree's manifest, or the dev
// server's. A name already in templates.js stays the library's (the check refuses the clash; the page never doubles it).
const pluginDesigns = ref([])
const byPluginName = computed(() => new Map(pluginDesigns.value.map((d) => [d.name, d])))
onMounted(async () => {
  const urls = [absoluteEmbedUrl('manifest.json', profileConfig.value), import.meta.env.DEV ? '/__plugin-gallery/manifest.json' : '']
  const { designs } = await loadPluginDesigns(urls)
  pluginDesigns.value = designs.filter((d) => !byName.has(d.name))
})
// The design's title in the reader's language: the build's per-locale titles (posterDesignLabels; any catalogue
// area), then this bundle's own catalogue, then English, then the profile's label.
const pluginTitle = (d) => {
  const lang = String(getRuntimeLocale() || detectLocale() || 'en').split('-')[0]
  if (d.titles && d.titles[lang]) return d.titles[lang]
  const v = d.labelKey ? t(d.labelKey) : ''
  if (v && v !== d.labelKey) return v
  return (d.titles && d.titles.en) || d.label
}
const pluginLabel = (d) => {
  return `${pluginTitle(d)}: ${declaredSizeText(d.size, t)}`
}

// PRODUCTION designs first, by family. EXPERIMENTAL ones (marked in templates.js: still being designed, or no
// preview) and every other plugin's design (made by its own plugin, so drawn nowhere here) go last, in ONE
// Experimental group that starts collapsed.
const isExperimental = (id) => byPluginName.value.has(id) || byName.get(id)?.experimental === true
const experimentalHeading = computed(() => t('posterDesign.family.experimental'))
// No `count`: these are templates, not lists of people, so the sticker reads "Show full details" alone.
const items = computed(() => {
  const all = [
    ...configs.map((c) => ({ id: c.name, label: labelOf(c) })),
    ...pluginDesigns.value.map((d) => ({ id: d.name, label: pluginLabel(d) })),
  ]
  return [...all.filter((x) => !isExperimental(x.id)), ...all.filter((x) => isExperimental(x.id))]
})
const groupBy = (item) => (isExperimental(item.id) ? experimentalHeading.value : t(FAMILY_KEYS[byName.get(item.id)?.family] || FAMILY_KEYS.mapSheet))
const collapsedBy = (sec) => (sec && sec.name) === experimentalHeading.value   // PosterWall passes the section

// ── drawing a configuration from the library ──────────────────────────────────────────────────
const countryById = (id) => (countryData.countries || []).find((c) => c.id === id)
// A design whose sample country is WITHHELD (countrySheet.js: the whole-India poster, for now) shows this sentence on its
// card and is never drawn or printed: PosterWall answers `unsupported` before it draws a preview or starts a print. The
// designs stay in the catalogue, so they reappear the day the country is no longer withheld.
// A design made by another plugin is not drawn here either: its card says so, and its details show its page live.
const withheld = (item) => {
  if (byPluginName.value.has(item.id)) return t('posterDesign.fromPlugin')
  const c = byName.get(item.id)
  const sample = c && c.sample ? countryById(c.sample) : null
  return sample && sheetWithheld(sample) ? t('messages.countryPosterTooMany') : null
}
const sample = countryById(SAMPLE_COUNTRY_ID)
const recordsFor = createPeopleGroupRecords({
  apiBase: () => profileConfig.value?.apiBaseUrl || getApiBaseUrl(),
  lang: () => getRuntimeLocale() || detectLocale(),
  profileConfig,
})
// The ONE path every surface draws a country sheet through (the Country Posters wall, the Regions tab),
// so the sample carries its region hue and its "map N of M" exactly as the wall prints it.
const sheetFor = makeCountrySheet({ records: recordsFor, assetsBase: () => assetsBase.value, countries: countryData.countries || [] })
// A country's sheet at a format, through the shared path; the large side-lane sheets use their own sample (India).
const countrySheet = (format, id = SAMPLE_COUNTRY_ID) => {
  const c = countryById(id)
  return c ? sheetFor(c, format) : Promise.resolve('')
}

// The sample's people groups and the packet's words, each fetched once for the whole gallery.
const lang = () => getRuntimeLocale() || detectLocale() || 'en'
let rowsP = null
const sampleRows = () => (rowsP ||= (sample ? recordsFor({ type: 'country', values: [sample.iso3] }) : Promise.resolve([]))
  .then((r) => r || []).catch(() => { rowsP = null; return [] }))
let stringsP = null
const packetStrings = () => (stringsP ||= loadPacketStrings(assetsBase.value))

// A card deck exactly as the wall prints one (usePosterPrints printCardDeck: createCardRenderer(...).buildDeck):
// the whole deck is the document, its first card the thumbnail.
async function cardDeck(stockId) {
  const [rows, strings, { createCardRenderer }] = await Promise.all([sampleRows(), packetStrings(), import('@map/packet/card-render.js')])
  if (!rows.length) return null
  const R = createCardRenderer({ strings, lang: lang(), stock: stockId })
  return { html: R.buildDeck(sample, rows), page: '.card', width: R.W, height: R.H }
}
// A packet's PAGE 1, its map page, from the same renderer and the same map sheet the wall's packet uses
// (the sample's map-only 'packet' sheet, lifted by the renderer). Only page 1 is built: it is what the
// thumbnail shows, and it needs nothing the later pages need (descriptions, the evangelical share).
async function packetDocument(variant) {
  const [rows, strings, { createPacketRenderer }, sheetHtml] = await Promise.all([
    sampleRows(), packetStrings(), import('@map/packet/packet-render.js'), countrySheet('packet'),
  ])
  if (!rows.length) return null
  const R = createPacketRenderer({ strings, lang: lang() })
  const mapSvg = sheetHtml ? R.liftMap(sheetHtml) : ''
  const doc = R.buildPacket(sample, rows, new Map(), mapSvg, null, null, variant, null)
  return { html: doc, page: '.sheet', width: R.W, height: R.H, firstPageOnly: true }
}
// A multi-sheet poster as its panels, from the shared ladder's sheets for that size.
function panels(sizeKey) {
  const size = resolvePosterSize(sizeKey)
  return size ? { image: panelsSvgUrl(size.sheets) } : null
}
// A UPG100 zone's sheet, from the library copy of UPG100's zone code: ALL the records (a zone's pins depend on which
// earlier zone claimed a group first, as on UPG100's own wall), the list from this page's config. Loaded on first use.
let zoneSheetFn = null
async function zoneSheet(format, zoneId) {
  if (!zoneSheetFn) {
    const { makeZoneSheet } = await import('@map/packet/upg100Zones/zone-sheet-print.js')
    zoneSheetFn = makeZoneSheet({ allRecords: () => recordsFor.all(), assetsBase: () => assetsBase.value, profileConfig })
  }
  return zoneSheetFn({ id: zoneId }, format)
}
const ctx = { countrySheet, cardDeck, packetDocument, panels, zoneSheet }

// The printed document's size, measured when it is drawn: what "file size" means in the details.
// render() answers a poster's HTML (a map sheet) or a document { html, page, width, height } (a deck, a packet).
const fileBytes = ref({})
async function renderDocument(name) {
  const c = byName.get(name)
  if (!c || !c.render) return null
  const out = await c.render(ctx)
  if (out && out.image) return out
  const html = typeof out === 'string' ? out : out && out.html
  if (!html) return null
  if (!(out && out.firstPageOnly)) fileBytes.value = { ...fileBytes.value, [name]: new Blob([html]).size }
  return out
}

// previewSrc: the thumbnail. A map sheet is rasterised at a quarter scale (a 1500px sheet becomes ~375px,
// the card's size), and a render that comes out blank is refused, so the card shows "preview unavailable"
// rather than a black rectangle. A document's first page is drawn as it prints (src/pageThumb.js).
async function previewSrc(item) {
  const out = await renderDocument(item.id)
  if (!out) return null
  if (out.image) return out.image
  if (typeof out === 'object') return firstPageImage(out.html, out)
  const { rasterPoster, looksRendered } = await import('@map/packet/poster-raster.js')
  const blob = await rasterPoster(out, { scale: 0.25 })
  if (!(await looksRendered(blob))) return null
  return URL.createObjectURL(blob)
}

// The card's print button prints THIS configuration: the format the wall asks for is ignored on purpose,
// because the card already names its size. A card deck prints whole, as the wall prints it. A packet is
// built here only as far as its page 1, so it is NOT offered for printing from this card: printing a
// packet missing its later pages would misrepresent the template.
async function sheet(item) {
  const out = await renderDocument(item.id)
  if (!out || out.image || (typeof out === 'object' && out.firstPageOnly)) return ''
  return typeof out === 'string' ? out : out.html
}

// ── "Show full details" ───────────────────────────────────────────────────────────────────────
const open = ref(null)
const openLabel = computed(() => (!open.value ? '' : open.value.design ? pluginLabel(open.value.design) : labelOf(byName.get(open.value.name))))
// A plugin's design opens in the same dialog, as a configuration: its renderer is the plugin's page, and the dialog
// shows that page live.
function showDetails(item) {
  const d = byPluginName.value.get(item.id)
  open.value = d
    ? { name: d.name, size: declaredSizeText(d.size, t), settings: { family: d.family, mobileFriendly: d.mobileFriendly, ...(d.instance ? { preset: d.instance } : {}) },
        renderer: `plugin-designs/${d.bundle}/${d.profile}.vue`, pageUrl: d.pageUrl, design: d }
    : byName.has(item.id) ? { ...byName.get(item.id), size: sizeText(byName.get(item.id).size, t) } : null
}

const heading = computed(() => t('posterDesign.styles.heading'))
// PosterWall renders the intro as HTML, so plain catalogue text is escaped first.
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const intro = computed(() => escHtml(t('posterDesign.styles.intro')))

// Child components' <style> blocks are dropped by defineCustomElement, so this profile carries the
// dialog's CSS too. The floor sits on :host, where a shell that sizes its pane can override it.
useShadowStyles(`
:host{display:block;width:100%;height:100%;min-height:420px}
.pd-styles{position:absolute;inset:0;min-height:0}
.pd-dialog{box-sizing:border-box;border:1px solid #d1d4cd;border-radius:12px;padding:20px 22px;max-width:min(560px,calc(100vw - 32px));
  width:100%;color:#3b463d;background:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
  box-shadow:0 12px 40px rgba(8,12,16,.25)}
.pd-dialog::backdrop{background:rgba(8,12,16,.55)}
.pd-dialog__title{margin:0 0 14px;font-size:18px;font-weight:700;line-height:1.3}
.pd-dialog__list{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0}
.pd-dialog__list dt{color:#6d766e;font-weight:600}
.pd-dialog__list dd{margin:0;min-width:0;overflow-wrap:anywhere}
.pd-dialog__list code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f3f1;border-radius:4px;padding:1px 5px}
.pd-dialog__name{font-weight:700}
.pd-dialog__copy,.pd-dialog__close{font:inherit;border-radius:8px;border:1px solid #d1d4cd;background:#f3f3f1;color:#3b463d;
  padding:4px 10px;cursor:pointer;margin-inline-start:8px}
.pd-dialog__note{margin:14px 0 0;color:#6d766e}
.pd-dialog__agent{margin:14px 0 0;padding:10px 12px;border-radius:8px;background:#f3f3f1;border-inline-start:4px solid #92b195}
.pd-dialog__actions{display:flex;justify-content:flex-end;margin:16px 0 0}
.pd-dialog__live{margin:14px 0 0}
.pd-dialog__frame{display:block;width:100%;height:min(60vh,520px);border:1px solid #d1d4cd;border-radius:8px;background:#f3f3f1}
.pd-dialog__open{display:inline-block;margin-top:8px;color:#3b463d;font-weight:600}
.pd-dialog__close{margin:0;background:#92b195;border-color:#92b195;color:#fff;font-weight:600;padding:6px 16px}
@media (max-width:480px){.pd-dialog__list{grid-template-columns:1fr}.pd-dialog__list dd{margin-bottom:6px}}
`, 'poster-design-styles')
</script>

<template>
  <div class="pd-styles">
    <PosterWall
      :items="items"
      :group-by="groupBy"
      :instance-id="instanceId"
      :assets-base="assetsBase"
      :heading="heading"
      :intro="intro"
      unit=""
      item-count-key="posterDesign.templateCount"
      :collapsible="true"
      :collapsed-by="collapsedBy"
      :header-action="{ labelKey: 'posterDesign.showFullDetails', ariaKey: 'posterDesign.showFullDetailsAria' }"
      :preview-src="previewSrc"
      :unsupported="withheld"
      :sheet="sheet"
      :hide-prayer-list-when-soon="true"
      download-prefix="doxa-poster-design"
      @header-action="showDetails"
    />
    <FullDetailsDialog :config="open" :label="openLabel" :file-bytes="open ? (fileBytes[open.name] ?? null) : null" @close="open = null" />
  </div>
</template>
