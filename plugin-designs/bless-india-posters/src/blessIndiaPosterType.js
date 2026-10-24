/**
 * blessIndiaPosterType.js — the 'blessIndia' poster type (adapter) for <dxm-poster-section> + the
 * Poster Design catalogue. The attempts are our whole-India poster designs; each generates live from
 * the India people-group records (nothing stored). sheet(card, format) returns the poster HTML. The
 * plugin's own page (bless-india-posters.vue) shows the W via PanelSheets and prints as a document;
 * this adapter lets the standard poster section/catalogue list and offer the same designs.
 */
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { ISO3_NAME } from '@map/data/iso3-name.js'
import seriesJson from '@map/scripts/posters/series.json'
import { generatePoster } from './generate.js'
import { loadBoundaries } from './boundaries.js'

const seriesDef = (seriesJson && seriesJson.country) || {}
const GEN = { '60x96': '60x96c4b', '66x66': '66x66c4b' }
const ATTEMPTS = [{ id: 'range-badge-60x96', iso3: 'IND', size: '60x96', label: 'Bless India — range badges (60×96)' }]
const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 767px)').matches

export default {
  items() { return ATTEMPTS },
  title(scope, t) { return (t && t('blessIndiaPosters.title')) || 'Bless India Posters' },
  actions({ assetsBase, apiBase, lang, profileConfig, t }) {
    const recordsFor = createPeopleGroupRecords({ apiBase, lang, profileConfig })
    const sheet = async (card, format) => {
      const genFormat = GEN[format] || GEN['60x96']
      const records = await recordsFor({ type: 'country', values: ['IND'] })
      const b = await loadBoundaries(assetsBase)
      const { html } = await generatePoster({ records, ...b, seriesDef, iso3Name: ISO3_NAME, format: genFormat })
      return html
    }
    return {
      records: () => recordsFor({ type: 'country', values: ['IND'] }),
      sheet,
      unsupported: () => (isPhone() ? ((t && t('blessIndiaPosters.desktopOnly')) || 'Desktop only for now.') : null),
      unit: 'UPG', itemCountKey: 'blessIndiaPosters.count', eventName: 'bless-india:show-on-map', downloadPrefix: 'bless-india', cardStocks: true,
    }
  },
}
