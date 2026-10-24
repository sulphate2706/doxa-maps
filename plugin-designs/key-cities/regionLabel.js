/**
 * regionLabel.js — Key Cities' region headings, translated at RENDER.
 *
 * The same fix as cities-internet's list (87a168195), for the same reason. key-cities.json has no row
 * with an empty region (1,646 rows): "Other" and "N/A" are region VALUES, and every heading printed its
 * raw English data string, in every locale. The data's nine region strings are the catalogue's own
 * English values (dashboard.wagfRegion.*, dashboard.other, wall.na), so the English catalogue is the
 * join, and no English has to be written here.
 *
 * THE RAW VALUE STAYS THE KEY. A caller groups rows, keys its sections and keeps its collapse state by
 * the data's own string, and only the heading it prints goes through regionLabel(). Translating where
 * the rows are grouped would reset every open section on a language switch.
 *
 * THE KEYS ARE WRITTEN OUT IN FULL. The build ships a translation area only when its name appears in a
 * reached file as a literal prefix (internal/i18n-areas.mjs); keys assembled at runtime would resolve
 * in the dev tree and not in the shipped bundle.
 */
import { tStatic } from '@map/i18n/index.js'

const REGION_KEYS = [
  'dashboard.wagfRegion.asia',
  'dashboard.wagfRegion.middle_east',
  'dashboard.wagfRegion.latin_america_&_caribbean',
  'dashboard.wagfRegion.africa',
  'dashboard.wagfRegion.europe',
  'dashboard.wagfRegion.north_america_&_non-spanish_caribbean',
  'dashboard.wagfRegion.oceania',
  'dashboard.other',
  'wall.na',
]
// English value -> key. tStatic(key, 'en') with the EXPLICIT locale: the join must not follow the page.
const REGION_KEY = Object.fromEntries(REGION_KEYS.map((k) => [tStatic(k, 'en'), k]).filter(([en]) => en))

/**
 * A region's heading in the page's language, through the caller's own translator `t` (so it follows a
 * language switch). A region the catalogue does not know is data, and is shown as it is.
 */
export function regionLabel(t, name) {
  const key = REGION_KEY[name]
  if (!key) return name
  const v = t(key)
  return v && v !== key ? v : name
}
