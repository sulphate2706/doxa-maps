/**
 * tabs.js — WHICH plugins Posterverse shows, and how each row is resolved from the tree's manifest.
 *
 * Pure data + pure functions (no Vue), so the shell and its headless check read the same list.
 *
 * ★ THE WHOLE RAIL IS AN ALLOW-LIST, the Experimental folder included. The Research Gallery fills its
 *   Experimental folder with every bundle nobody placed (a deny-list catch-all). Copied here, that rule
 *   would show every research map, including key-cities, which is GATED and must never be exposed.
 *   So every row Posterverse can ever paint is named below, and a bundle that is not named never
 *   appears, whatever the manifest holds.
 *
 * ★ A ROW WHOSE BUNDLE IS NOT IN THE TREE IS PRUNED, not painted dead. That is how a row can be listed
 *   before its plugin lands: mark it `provisional: true` and it stays invisible until a bundle of that id
 *   exists. Its owner confirms the ids; change the `bundle`/`profile` here to match, never the row `id`
 *   (the id is the stable key for ?tab= links). A new row's `composes` entry lands in the same push as
 *   its bundle (check:posterverse-shelf arm D).
 *
 * ★ MOUNT THE COMPOSITE, NOT A LEAF. The profile named here is the one that mounts. my-upg-100-list and
 *   country-posters each ship a leaf map, a leaf wall and the capability-4 composite of the two; the
 *   composite is the plugin as its owner designed it (and it is what makes Posterverse capability 5).
 */

// The rail's sections, in order. Experimental is a collapsible folder, like the gallery's, but it starts
// OPEN: the gallery's closed folder sits at the foot of a long rail, while Posterverse has one short
// section above it, so a closed folder sat mid-drawer with empty space below and read as a caption with
// nothing under it (measured at 390: the heading at y 335 in an 800px drawer, ~500px empty below).
// Open, its plugins show like any section's rows; a reader can still collapse it.
export const SECTIONS = [
  { key: 'posters', i18n: 'sec.posters', icon: 'poster' },
  { key: 'experimental', i18n: 'sec.experimental', icon: 'flask', folder: true, open: true },
]

// Every row Posterverse can show, in rail order.
export const TABS = [
  { id: 'upg-100', section: 'posters', icon: 'list', bundle: 'my-upg-100-list', profile: 'upg-100-mfe' },
  { id: 'country-posters', section: 'posters', icon: 'map', bundle: 'country-posters', profile: 'country-posters-mfe' },
  { id: 'poster-design', section: 'posters', icon: 'poster', bundle: 'poster-design', profile: 'poster-design-mfe' },
  { id: 'wall-of-people-groups', section: 'experimental', icon: 'flask', bundle: 'wall-of-people-groups', profile: 'wall-of-people-groups' },
  { id: 'bible-posters', section: 'experimental', icon: 'flask', bundle: 'bible-posters', profile: 'bible-posters' },
  // Its root is a natural-height page of poster cards, so it mounts unpinned (`scroll`) and the pane scrolls it.
  { id: 'bless-india-posters', section: 'experimental', icon: 'flask', bundle: 'bless-india-posters', profile: 'bless-india-posters', scroll: true },
]

// Bundles that must never be a Posterverse row. The allow-list above already excludes them; this set
// makes the exclusion an ASSERTION (check-posterverse-shelf.mjs fails if a row ever names one), so a
// later edit cannot add one by accident.
export const NEVER = new Set(['key-cities', 'posterverse', 'doxa-maps-spa', 'plugin-studio'])

// Elements that own or NEST a WebGL map, so their pane is DESTROYED on deactivate rather than hidden
// (browsers keep ~8-16 live contexts and silently kill the oldest). Taken from the Research Gallery's
// measured HEAVY_ELEMENTS for the tags this rail shows; any profile the manifest marks `isMap` is
// treated as heavy too, so a new map row is bounded without an edit here.
const HEAVY_TAGS = new Set(['my-upg-100-list-map', 'country-posters-map'])

/**
 * Complete each row from the manifest: the bundle's scriptUrl and the profile's element tag. A row
 * whose bundle is absent from this tree, or that ships no script, is left out (pruned).
 * Returns the resolved rows in rail order.
 */
export function resolveTabs(manifest, warn = () => {}) {
  const bundles = (manifest && Array.isArray(manifest.bundles)) ? manifest.bundles : []
  const byBundle = Object.fromEntries(bundles.map((b) => [b && b.bundle, b]))
  const out = []
  for (const d of TABS) {
    if (NEVER.has(d.bundle)) continue
    const b = byBundle[d.bundle]
    if (!b) continue
    const profiles = Array.isArray(b.profiles) ? b.profiles : []
    let p = profiles.find((x) => x && x.profile === d.profile)
    if (!p) {
      // The named profile is gone (renamed, or a provisional id guessed wrong). Degrade to the profile
      // named like the bundle, then the first, and say so: a quiet fallback is how a composite row
      // once showed a bare leaf.
      p = profiles.find((x) => x && x.profile === d.bundle) || profiles[0]
      if (!p) continue
      warn(`[posterverse] ${d.bundle} has no profile "${d.profile}"; row "${d.id}" opens "${p.profile}" instead`)
    }
    const tag = p.element || (Array.isArray(b.elements) && b.elements[0]) || d.bundle
    const scriptUrl = b.scriptUrl || p.scriptUrl || ''
    if (!scriptUrl) continue
    out.push({
      ...d,
      tag,
      scriptUrl,
      profile: p.profile,
      heavy: HEAVY_TAGS.has(tag) || !!p.isMap,
    })
  }
  return out
}
