/**
 * pluginDesigns.js — poster designs that OTHER plugins declare, read from the tree's manifest.json.
 *
 * A poster plugin lists its designs in its OWN <profile>.meta.json, under "posterDesign" (one object, or an array):
 *
 *   "posterDesign": { "family": "regionPoster", "name": "region-poster.66x66", "size": "66x66",
 *                     "mobileFriendly": true, "labelKey": "regions.posterTitle", "instance": "africa" }
 *
 *   family          a word naming the kind of poster (camelCase or dashes)
 *   name            the design's stable configuration name, the same rule as templates.js: words joined by "." or
 *                   "-". Once shipped it is never renamed or removed (check:poster-design-catalogue's names ledger).
 *   size            what it prints at (a ladder key such as "66x66", or "letter", "a4", "phone" …)
 *   mobileFriendly  true when it reads well on a phone
 *   labelKey        optional: the card's title, a catalogue key the plugin owns; else the profile's own label
 *   instance        optional: a preset id (capability 2) whose page shows this design; else the profile's page
 *
 * The build carries the block into manifest.json (internal/profile-meta.mjs), so Poster Design lists every plugin's
 * designs without importing any plugin's code, and a plugin adding its block never makes Poster Design rebuild.
 * Pure (no Vue, no DOM), so check:poster-design-catalogue validates with the same rules the page filters by.
 */
export const NAME_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const FAMILY_RE = /^[a-z][a-zA-Z0-9-]*$/
const KEY_RE = /^[a-zA-Z][\w-]*(?:\.[\w-]+)+$/

/** The blocks a meta's posterDesign holds, as an array (one object or an array of them). */
export const blocksOf = (posterDesign) => (Array.isArray(posterDesign) ? posterDesign : posterDesign ? [posterDesign] : [])

/** What is wrong with one block, as sentences; [] when it is valid. */
export function blockProblems(b) {
  const out = []
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['is not an object']
  if (typeof b.family !== 'string' || !FAMILY_RE.test(b.family)) out.push(`family ${JSON.stringify(b.family)} is not a word`)
  if (typeof b.name !== 'string' || !NAME_RE.test(b.name) || !b.name.includes('.')) out.push(`name ${JSON.stringify(b.name)} is not a configuration name (words joined by "." or "-", with at least one ".")`)
  if (typeof b.size !== 'string' || !b.size.trim()) out.push('size is missing')
  if (typeof b.mobileFriendly !== 'boolean') out.push('mobileFriendly is not true or false')
  if (b.labelKey !== undefined && (typeof b.labelKey !== 'string' || !KEY_RE.test(b.labelKey))) out.push(`labelKey ${JSON.stringify(b.labelKey)} is not a catalogue key`)
  if (b.instance !== undefined && (typeof b.instance !== 'string' || !b.instance.trim())) out.push('instance is empty')
  const known = new Set(['family', 'name', 'size', 'mobileFriendly', 'labelKey', 'instance'])
  for (const k of Object.keys(b)) if (!known.has(k)) out.push(`unknown field "${k}"`)
  return out
}

/**
 * Every valid design in a manifest, with the page that shows it as an absolute URL (resolved against the manifest's
 * own URL, since the manifest's URLs are tree-relative). An invalid block is skipped here; the check names it.
 */
export function designsFromManifest(manifest, manifestUrl) {
  const out = []
  for (const b of (manifest && manifest.bundles) || []) {
    for (const p of b.profiles || []) {
      for (const d of blocksOf(p.posterDesign)) {
        if (blockProblems(d).length) continue
        const inst = d.instance ? (p.instances || []).find((i) => i.id === d.instance) : null
        if (d.instance && !inst) continue
        const rel = inst ? inst.iframeUrl : p.iframeUrl
        let pageUrl = rel
        try { pageUrl = new URL(rel, manifestUrl).href } catch { /* keep it as written */ }
        // titles: the labelKey resolved per locale by the build (posterDesignLabels), so any area reads translated
        out.push({ name: d.name, family: d.family, size: d.size, mobileFriendly: d.mobileFriendly, labelKey: d.labelKey || '',
          titles: (p.posterDesignLabels && p.posterDesignLabels[d.name]) || {},
          label: (inst && inst.title) || p.label || p.profile, bundle: b.bundle, profile: p.profile, instance: d.instance || '', pageUrl })
      }
    }
  }
  return out
}

/** The first manifest that answers, from a list of candidate URLs; { designs: [] } when none does. */
export async function loadPluginDesigns(urls, fetchImpl = globalThis.fetch) {
  for (const url of urls.filter(Boolean)) {
    try {
      const r = await fetchImpl(url)   // same-origin credentials (the default): a gated tree still answers
      if (!r.ok) continue
      return { url, designs: designsFromManifest(await r.json(), url) }
    } catch { /* the next candidate */ }
  }
  return { url: '', designs: [] }
}
