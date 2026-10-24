/**
 * countries.js — a self-contained slugifier for country links, so the grid needs
 * NO Nuxt `~~/config/countries-meta` import (unavailable outside the DX-life app).
 *
 * COPY-ONLY NOTE: DX-life's countrySlug(code, label) prefers a canonical English name
 * from a master map; here we slugify the provided label (already the localized/English
 * country label the API returns) or fall back to the code. The link target base is a
 * prop (researchUrl) so the host controls where country links point.
 */
export function countrySlug(code, fallbackLabel) {
  const src = String(fallbackLabel || code || '').trim()
  return src
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')     // any run of non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, '')          // trim leading/trailing hyphens
}
