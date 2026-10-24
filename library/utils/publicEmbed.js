/**
 * publicEmbed.js: the Share menu's Embed codes for THIS plugin, from the tree's PUBLIC address.
 *
 * Three codes, all for the plugin itself (its own leaf page, its own bundle + element), never for the app it is
 * nested in (Plugin Studio, Deep Research, Posterverse):
 *   URL         <base>/<bundle>/<profile>/index.html, the plugin's generated page;
 *   Iframe      <iframe src="that URL">;
 *   JavaScript  the plugin's own embed.script from the PUBLIC manifest (<base>/manifest.json), made absolute.
 *
 * ★ THE SCRIPT IS READ FROM THE PUBLIC MANIFEST, NOT BUILT HERE. The manifest's per-profile embed.script is the one
 * source of truth for the element tag, its profile-config and the page globals a plugin needs; the PUBLIC copy is the
 * release partners will load, so its tag and config match what they get. It is fetched once per base and cached
 * (the public host serves it with Access-Control-Allow-Origin: *).
 *
 * ★ NO INTEGRITY ON OUR BUNDLE. The public bundle URL is not versioned and is rebuilt in place at each release, so a
 * pinned integrity="sha384-…" would break every partner's embed at the next release. It is dropped from the copied
 * code for scripts served from the base; a versioned third-party URL (the Mapbox preload) keeps its own. Versioned
 * release URLs + SRI are a later improvement.
 */

const cache = new Map()   // base → Promise<manifest|null>

/** The tree-relative leaf path of an embedPath ('./x/y/index.html' → 'x/y/index.html'); '' for absolute or root paths. */
export function treeRelative(embedPath) {
  const p = String(embedPath || '').trim()
  if (!p || /^https?:\/\//i.test(p) || p.startsWith('/')) return ''
  return p.replace(/^\.\//, '')
}

/** The plugin's public page: <base>/<leaf>. '' when either is unknown. */
export const publicLeafUrl = (base, embedPath) => {
  const rel = treeRelative(embedPath)
  return base && rel ? base + '/' + rel : ''
}

function loadManifest(base) {
  if (!cache.has(base)) {
    // the default credentials ('same-origin'): nothing is sent to a cross-origin public host, and behind a login gate
    // a same-origin base keeps its session
    const p = fetch(base + '/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => { cache.delete(base); return undefined })   // a network failure may be retried later
    cache.set(base, p)
  }
  return cache.get(base)
}

/**
 * The plugin's JavaScript embed code from the PUBLIC manifest.
 * Resolves { code } | { missing: true } (the public site does not carry this plugin yet) | { failed: true }.
 */
export async function publicScriptCode(base, embedPath) {
  const rel = treeRelative(embedPath)
  if (!base || !rel) return { missing: true }
  const m = await loadManifest(base)
  if (m === undefined) return { failed: true }
  if (!m || !Array.isArray(m.bundles)) return { missing: true }
  const norm = (u) => String(u || '').replace(/^\.\//, '')
  const [bundle, profile] = rel.split('/')
  let hit = null
  for (const b of m.bundles) for (const pr of (b.profiles || [])) {
    if (norm(pr.iframeUrl) === rel) hit = pr
    else if (!hit && b.bundle === bundle && pr.profile === profile) hit = pr   // an instance path: its profile's code
  }
  const raw = hit && hit.embed && hit.embed.script
  if (!raw) return { missing: true }
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const code = raw
    .replace(/(\s(?:src|href)=")\.\//g, '$1' + base + '/')
    .replace(/YOUR_TREE_URL/g, base)
    .replace(new RegExp('(<script\\b[^>]*\\ssrc="' + esc + '/[^"]*")\\s+integrity="[^"]*"', 'g'), '$1')
  return { code }
}
