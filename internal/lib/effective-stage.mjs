// EFFECTIVE stage: what bar a bundle should be held to, rather than what stage it declares.
//
// ★ THE GAP THIS CLOSES (sr, 2026-09-28). A gate that scopes by a bundle's OWN stage misses what a
// production reader actually sees. research-map-plus-grid is production and composes
// doxa-research-map and people-groups-grid, both declared experimental; dashboard-plus-grid is
// production and composes research-dashboard and people-groups-grid. So the code on a production
// page was being held to the experimental bar — not because anyone decided that, but because the
// scope was computed from the wrong end of the composition.
//
// THE RULE: a bundle is production-for-gating if it declares production, OR if any bundle that is
// itself production-for-gating composes it. Transitive, because composition nests.
//
// ★ THE GRAPH'S EDGES HAVE TWO SHAPES and taking one and not the other silently halves it:
// `composes` holds both bare bundle names ('doxa-research-map') and bundle/profile pairs
// ('regions-dashboard/regions-list'). The bundle is the part before the slash in either case.
//
// Shared by check:hardcoded-english and check:frozen-labels so the two cannot disagree about what
// "production" means — a disagreement that would show up as one gate passing a file the other fails,
// with neither obviously wrong.

/** The bundle a `composes` entry refers to: 'a/b' → 'a', 'a' → 'a'. */
export const composedBundle = (entry) => String(entry || '').split('/')[0]

/**
 * @param {{bundles?: Array<{bundle?: string, stage?: string, composes?: string[]}>}} manifest
 * @returns {Map<string, 'production'|'experimental'>} effective stage per bundle name
 */
export function effectiveStages(manifest) {
  const bundles = (manifest && manifest.bundles) || []
  const byName = new Map()
  for (const b of bundles) if (b && b.bundle) byName.set(b.bundle, b)

  const eff = new Map()
  for (const b of bundles) if (b && b.bundle) eff.set(b.bundle, b.stage === 'production' ? 'production' : 'experimental')

  // Walk down from every production root, marking what it composes. Repeat until nothing changes:
  // a production bundle may compose one that composes another, and a single pass would stop at the
  // first level. The visited set makes a cycle terminate rather than hang.
  let changed = true
  while (changed) {
    changed = false
    for (const [name, stage] of [...eff]) {
      if (stage !== 'production') continue
      const b = byName.get(name)
      for (const entry of (b && b.composes) || []) {
        const child = composedBundle(entry)
        if (!eff.has(child)) continue                 // composes something not in the manifest
        if (eff.get(child) === 'production') continue
        eff.set(child, 'production')
        changed = true
      }
    }
  }
  return eff
}

/** Bundle names a gate should treat as production. */
export function productionForGating(manifest) {
  return [...effectiveStages(manifest)].filter(([, s]) => s === 'production').map(([n]) => n).sort()
}

/** Why a bundle is in scope — for a report that must explain itself. */
export function stageReason(manifest, name) {
  const bundles = (manifest && manifest.bundles) || []
  const self = bundles.find((b) => b && b.bundle === name)
  if (self && self.stage === 'production') return 'declares production'
  const parents = bundles
    .filter((b) => (b.composes || []).some((e) => composedBundle(e) === name))
    .filter((b) => effectiveStages(manifest).get(b.bundle) === 'production')
    .map((b) => b.bundle)
  return parents.length ? `composed by ${parents.join(', ')}` : 'experimental'
}
