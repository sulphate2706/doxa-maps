/**
 * The 'country' poster type: one poster per country, grouped by its WAGF region. Exactly what the Country Posters
 * wall shows for a region: the same data (country-posters.json), the same records provider, the same sheet path
 * (countrySheet.js, so a withheld country stays withheld), the same region headings.
 * scope = a region key in ANY of its spellings: DX Life's /regions slug ('latin-america-and-caribbean'), the API's
 * value ('latin_america_&_caribbean'), the wall's slug ('latin_america_&_caribbean') or the English name. They all
 * reduce to one canonical key (DX Life's slugify: no diacritics, lowercase, "&" → "and", non-alphanumerics → "-");
 * a country with no region is 'other'.
 */
import data from '@map/data/country-posters.json'
import { makeCountrySheet, largeSheet, posterWithheld, rowsWithheld } from '@map/packet/countrySheet.js'
import { createPeopleGroupRecords } from '@map/lists/peopleGroupRecords.js'
import { keyedError } from '@map/i18n/keyedError.js'
import { countryName } from '@map/utils/countryName.js'

const slug = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_')   // the wall's slug: its i18n heading key
export const regionKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other'
const TOO_MANY = 'Too many people groups to fit on one poster legibly — a solution is in progress.'
const inScope = (scope) => (c) => regionKey(c.region) === regionKey(scope)

export default {
  scopes: () => [...new Set(data.countries.map((c) => regionKey(c.region)))],
  items(scope, locale) {
    const rows = data.countries.filter(inScope(scope))
    if (/^en\b/i.test(locale || 'en')) return rows
    return rows.map((c) => ({ ...c, label: countryName(c.iso3, locale) || c.label }))
  },
  title(scope, t) {
    const region = (data.countries.find(inScope(scope)) || {}).region || String(scope || '')
    if (!region || region === 'Other') return t('dashboard.other')
    const key = `dashboard.wagfRegion.${slug(region)}`
    const v = t(key)
    return v && v !== key ? v : region
  },
  actions({ assetsBase, apiBase, lang, profileConfig, t }) {
    const recordsFor = createPeopleGroupRecords({ apiBase, lang, profileConfig })
    const sheet = makeCountrySheet({ records: recordsFor, assetsBase, countries: data.countries })
    const byId = new Map(data.countries.map((c) => [c.id, c]))
    return {
      // a whole country's withheld rows (countrySheet.js WITHHELD: India's list, packet and cards) say so, unfetched
      records: (c) => (rowsWithheld(c) ? Promise.reject(keyedError('messages.countryPosterTooMany', TOO_MANY)) : recordsFor({ type: 'country', values: [c.iso3] })),
      // the sheet gets the data's own record (English, the series index by id), as on the wall
      sheet: (card, format) => sheet(byId.get(card.id) || card, format),
      unsupported: (c) => (posterWithheld(c) || (c.unsupportedReason && !largeSheet(c)) ? t('messages.countryPosterTooMany') : null),
      unit: 'UPG', itemCountKey: 'regions.countryCount', eventName: 'doxa-country-posters:show-on-map', downloadPrefix: 'doxa-country', cardStocks: true,
    }
  },
}
