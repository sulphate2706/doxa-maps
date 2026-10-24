/**
 * discover.mjs — the auto-generated SPA's registry: every bundle under plugin-designs/,
 * every profile inside it, classified into a composition tier.
 *
 *   single → parameterized → monolithic → nested-elements-mfe → nested-mfe-spa
 *
 * Conventions it reads (all optional, all per bundle folder):
 *   <profile>.meta.json   {"type": "<tier>", "label": "Human name"} — the ONLY way to declare a
 *                         composite tier (monolithic / nested-elements-mfe / nested-mfe-spa).
 *   <name>.instances.json [{id, title, props}] or {"instances": [...]} — marks the bundle's
 *                         profiles PARAMETERIZED and expands one element per instance.
 * Pure + side-effect free: the dev plugin (dev-plugin.mjs) turns its result into the
 * manifest-shaped model the plugin gallery renders; any tool that needs the catalog can use it.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Composition tiers, most-composed → individual. Drives ordering + labels.
export const PROFILE_TIER = {
  'nested-mfe-spa': 0,
  'nested-elements-mfe': 1,
  'monolithic': 2,
  'parameterized': 3,
  'single': 4,
}
// Reader-facing names (validated vocabulary, see documentation/reference.md "Profile types"): the machine
// keys above stay canonical; a <profile>.meta.json may use either spelling. Pattern:
// "<attested head word>-<what the file yields>" — single-element → preset-element →
// multi-view-element → composite-element → app-shell.
export const TYPE_DISPLAY = {
  'single': 'single-element',
  'parameterized': 'preset-element',
  'monolithic': 'multi-view-element',
  'nested-elements-mfe': 'composite-element',
  'nested-mfe-spa': 'app-shell',
}
export const TYPE_ALIASES = Object.fromEntries(Object.entries(TYPE_DISPLAY).map(([k, v]) => [v, k]))
export const normalizeType = (t) => (t && PROFILE_TIER[t] != null) ? t : (TYPE_ALIASES[t] || null)
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

// Classify one profile into a type. Precedence: explicit <profile>.meta.json (machine key
// or display alias) → parameterized (the bundle ships an *.instances.json) → single (the
// simplest, default). Composite kinds are never inferred from source.
export function detectProfileType(dir, profile, ownTag, allTags, hasInstances) {
  const meta = readJsonSafe(resolve(dir, `${profile}.meta.json`))
  const declared = meta && normalizeType(meta.type)
  if (declared) return { type: declared, label: meta.label || profile }
  // Reliable auto-signals ONLY (source tag-scanning caused false positives):
  //   a bundle with an *.instances.json -> parameterized; otherwise the simplest tier, single.
  // Composite tiers (monolithic / nested-elements-mfe / nested-mfe-spa) are AUTHORED via an
  // explicit <profile>.meta.json {"type": ...} — the single source of truth (documentation/reference.md,
  // 'Profile types — the composability ladder'). See eco-dx (internal): PS001-composition-model.
  const type = hasInstances ? 'parameterized' : 'single'

  // ★ TIER-vs-COMPLEXITY WARNING — an INFERENCE FALLBACK is not a DECLARATION.
  // Hit for real 2026-09-20: research-dashboard had NO meta.json, so it fell through to
  // `single` = CAPABILITY 1 — while actually nesting TEN internal view components behind a
  // responsive shell and rendering ~1,100 elements. It is monolithic (cap-3). Nothing warned;
  // a missing file is indistinguishable from a deliberate choice, and the understatement points
  // the direction nobody audits (the manifest, the gallery and every capability claim read this).
  //
  // THE SIGNAL IS MEASURED, NOT GUESSED. Counting child .vue files under the bundle (excluding
  // its root profiles) across all 18 bundles gives: research-dashboard 10, big-picture 1, and
  // ZERO for every other bundle. The intended catch sits an order of magnitude above every other
  // sample, so this is a real gap in the data rather than a tuned cutoff.
  //
  // ONLY FIRES ON AN INFERRED TYPE — never second-guesses an explicit meta.json. doxa-research-map
  // is DECLARED monolithic with 0 child .vue files, which is perfectly legitimate: complexity can
  // live in one big file. Absence of the signal proves nothing; presence of it plus no declaration
  // is what is suspicious. WARNS rather than fails: this is a heuristic about authoring intent,
  // and the codebase's standing rule is that composite tiers are AUTHORED, not inferred.
  try {
    const childVue = countChildVue(dir)
    if (childVue >= 5) {
      console.warn(
        `[discover] ${profile}: type INFERRED as "${type}" but the bundle has ${childVue} child ` +
        '.vue components. Tier 3+ is never inferred — if this nests multiple views internally it ' +
        `is "monolithic"; if its children are independently embeddable it is "nested-elements-mfe". ` +
        `Declare it in ${profile}.meta.json {"type": ...} or this ships understated.`
      )
    }
  } catch { /* advisory only — never let the warning break a build */ }

  return { type, label: (meta && meta.label) || profile }
}

/** Count .vue files BELOW a bundle dir (its root profiles do not count as nested views). */
function countChildVue(dir) {
  let n = 0
  const walk = (d, depth) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = resolve(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (depth > 0 && e.name.endsWith('.vue')) n++
    }
  }
  walk(dir, 0)
  return n
}

export function discoverSpaRegistry(root = REPO_ROOT) {
  const APP_DIR = resolve(root, 'plugin-designs')
  const bundles = []
  if (!existsSync(APP_DIR)) return bundles
  const dirs = readdirSync(APP_DIR).sort().filter(n => {
    const d = resolve(APP_DIR, n)
    return statSync(d).isDirectory() && n !== 'template-bundle' && existsSync(resolve(d, 'index.js'))
  })
  // First pass: every bundle's element tag (needed for composite detection).
  const tagOf = {}
  for (const n of dirs) {
    try {
      const m = readFileSync(resolve(APP_DIR, n, 'index.js'), 'utf8').match(/customElements\.define\(\s*['"]([^'"]+)['"]/)
      if (m) tagOf[n] = m[1]
    } catch { /* ignore */ }
  }
  const allTags = Object.values(tagOf)
  for (const n of dirs) {
    const dir = resolve(APP_DIR, n), tag = tagOf[n]
    if (!tag) continue
    const files = readdirSync(dir)
    const instFile = files.find(f => /\.instances\.json$/i.test(f))
    const rawInst = instFile ? readJsonSafe(resolve(dir, instFile)) : null
    const instances = Array.isArray(rawInst) ? rawInst : (rawInst && Array.isArray(rawInst.instances) ? rawInst.instances : null)
    const hasInstances = !!(instances && instances.length)
    // The table's data API (its top-level apiBaseUrl), baked per instance as generate-tree does.
    const instApi = rawInst && !Array.isArray(rawInst) && typeof rawInst.apiBaseUrl === 'string' ? rawInst.apiBaseUrl : ''
    const items = []
    for (const profile of files.filter(f => f.endsWith('.vue')).map(f => f.replace(/\.vue$/, '')).sort()) {
      const t = detectProfileType(dir, profile, tag, allTags, hasInstances)
      if (t.type === 'parameterized' && hasInstances) {
        // Expand the parameterized table into one element PER preconfigured instance.
        for (const inst of instances) {
          items.push({ profile, id: inst.id || inst.title || profile, label: inst.title || inst.id || profile, type: 'parameterized', props: inst.props || {}, apiBaseUrl: instApi })
        }
      } else {
        items.push({ profile, id: profile, label: t.label, type: t.type, props: null })
      }
    }
    if (!items.length) continue
    // Sort by composability tier ONLY (stable) so parameterized instances keep their
    // declared table order — e.g. Prayer Map stays first, as the landing view.
    items.sort((a, b) => (PROFILE_TIER[a.type] ?? 9) - (PROFILE_TIER[b.type] ?? 9))
    const bestTier = Math.min(...items.map(i => PROFILE_TIER[i.type] ?? 9))
    bundles.push({ bundle: n, tag, items, bestTier })
  }
  bundles.sort((a, b) => a.bestTier - b.bestTier || a.bundle.localeCompare(b.bundle))
  return bundles
}
