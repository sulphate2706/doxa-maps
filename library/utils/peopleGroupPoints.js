/**
 * peopleGroupPoints.js — SHARED (@map/utils/peopleGroupPoints.js).
 *
 * ONE mapping from the prayer API's people-group rows to the pin objects RegionCountryMap draws.
 * Extracted when the country-map bundle became the second consumer, rather than copied: the field
 * names here are not ours, they are the API's, and a copy that drifts by one key draws a map with
 * silently missing popups.
 *
 * Every field is mapped exactly as DX-life's CountryMap.vue:107-115 maps it, including the
 * has_photo GATE on the image, which is theirs: a row can carry an image_url that is a
 * placeholder, and they only show it when the flag says there is a real photo.
 *
 * Rows without finite coordinates are DROPPED, not defaulted — a pin at 0,0 is a people group in
 * the Gulf of Guinea, which is worse than an absent pin because it looks like data.
 */
/**
 * The fields this mapping needs, as the API spells them. It lives HERE, beside the mapping, because
 * the two are one contract: ask for PEOPLE_GROUP_LIST_FIELDS alone — the list the stats need — and
 * every pin still draws, every popup comes up empty, and nothing logs a thing. The popup half
 * (name, slug, rop1, religion, description, photo) is what makes it a map you can read.
 */
export const PEOPLE_GROUP_POINT_FIELDS = 'name,slug,rop1,religion,imb_people_description,image_url,has_photo'

export function peopleGroupPoints(posts, toNumber) {
  return (Array.isArray(posts) ? posts : []).map((p) => ({
    name: p.name || '', slug: p.slug || '',
    code: p.country_code?.value || '', country: p.country_code?.label || '',
    // the wagf_region VALUE (e.g. 'latin_america_&_caribbean'), which is what
    // library/colors/wagf-region.js keys its palette on
    region: p.wagf_region?.value || '',
    lng: parseFloat(p.longitude), lat: parseFloat(p.latitude),
    committed: toNumber(p.people_committed), population: toNumber(p.population),
    rop1: p.rop1?.label || '', religion: p.religion?.label || '',
    description: p.imb_people_description ?? '',
    imageUrl: (p.has_photo && p.image_url) ? p.image_url : '',
  })).filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
}
