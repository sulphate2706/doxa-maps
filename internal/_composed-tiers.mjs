/**
 * _composed-tiers.mjs — the ONE place the composition tier is derived from `composes` edges.
 *
 * Shared on purpose. The generator WRITES this tier into the manifest and check-capability-derived
 * CHECKS it, and for a while each held its own copy of the rule. A rule with three ref vocabularies
 * and a self-exclusion will not stay identical in two files, and the drift has a specific shape: a
 * gate that passes a manifest the generator would refuse to write. One implementation, two callers.
 *
 * What stays independent is the DATA, which is the half worth duplicating: the generator derives from
 * the profiles it is about to emit, the gate rebuilds the same edges from the <profile>.meta.json files
 * on disk and feeds them to this function against the PUBLISHED manifest. So a manifest that no longer
 * matches its own sources still fails, while the rule itself cannot fork.
 *
 * Imports nothing — pure over the bundle rows, which is what makes it testable from either side.
 */

/**
 * Derive the composition tier from the `composes` edges, and refuse to disagree with an author.
 *
 * ★ WHY DERIVE AT ALL (2026-09-27). Tiers 3-5 were AUTHORED ONLY — discover.mjs infers just
 * `single` and `parameterized`, so a composite with no meta.json shipped as capability 1. That is not
 * hypothetical: research-dashboard did exactly that while nesting ten views, and the warning in
 * detectProfileType exists because of it. A missing file is indistinguishable from a deliberate choice.
 *
 * THE RULE, measured against all 25 bundles before it was written: a profile that composes anything is
 * cap-4 (nested-elements-mfe); if any of the things it composes is itself cap-4, it is cap-5
 * (nested-mfe-spa). Keyed per PROFILE, and refs are accepted in BOTH published forms — 'bundle/profile'
 * (doxa-maps-spa) and a bare 'bundle' (plugin-studio). Getting either of those wrong is not academic:
 * keying on the bundle derived 11 false tiers, and resolving only the slashed form demoted plugin-studio
 * from 5 to 4. With both handled: 10 composing profiles, 10 agree, 0 disagree.
 *
 * AN EXPLICIT type STAYS AUTHORITATIVE AND MUST AGREE. It is not overridden — it is CHECKED. A
 * declaration that contradicts the structure is the interesting case: either the meta is stale or the
 * composes list is, and both are worth a loud build failure rather than a silent pick between them.
 *
 * An UNRESOLVED ref is reported separately and never silently treated as "not cap-4", because a typo in
 * composes and a genuinely non-composite child look identical from here.
 */
export function deriveComposedTiers(bundles) {
  const TIER = { 'nested-mfe-spa': 5, 'nested-elements-mfe': 4, monolithic: 3, parameterized: 2, single: 1 }
  const byKey = new Map(), byName = new Map(), byElement = new Map()
  const reg = (m, k, bundle, type) => { if (!m.has(k)) m.set(k, []); m.get(k).push([bundle, type || null]) }
  for (const b of bundles) {
    for (const p of b.profiles || []) {
      byKey.set(`${b.bundle}/${p.profile}`, p.type || null)
      reg(byName, b.bundle, b.bundle, p.type)
      reg(byName, p.profile, b.bundle, p.type)
      if (p.element) reg(byElement, p.element, b.bundle, p.type)
    }
    for (const e of b.elements || []) reg(byElement, e, b.bundle, null)
  }
  // A name that covers SEVERAL profiles resolves to the HIGHEST tier among them, and both non-slashed
  // vocabularies resolve the same way. They have to: a bare bundle name and that bundle's element tag
  // both mean "this bundle", so taking the first profile for one and the highest for the other made
  // the answer depend on discovery order. gospel-resources is the case that shows it — four `single`
  // leaves and one cap-4 composite in one bundle, so "first" is a coin flip between 1 and 4, and
  // losing the 4 silently demotes whoever composes it. Highest is also the truthful reading of a
  // whole-bundle ref: nesting a bundle nests the most composed thing in it.
  const best = (rows, selfBundle) => {
    const others = rows.filter(([b, t]) => b !== selfBundle && t)
    if (!others.length) return null
    return others.sort((a, z) => (TIER[z[1]] || 0) - (TIER[a[1]] || 0))[0][1]
  }
  // ★ `composes` SPEAKS THREE VOCABULARIES, and only knowing two of them invents defects.
  // Measured on the tree: 'bundle/profile' (doxa-maps-spa), a bare 'bundle' (plugin-studio's first four
  // entries) and an ELEMENT TAG (its last three, plus big-picture and stack-demo). Resolving only the
  // first two left FIVE refs "unresolved" and reported as possible typos — they were all element tags,
  // written correctly by their authors. The data was right and the resolver was short.
  //
  // ★ AND A SELF-REFERENCE IS AN INTERNAL CHILD, NOT A NESTED PLUGIN. big-picture composes
  // 'bp-research-header', which is its OWN element (src/components/BpResearchHeader.vue). Resolving that
  // to the bundle registering it — itself, cap-4 — made big-picture look like it composes a cap-4 and
  // promoted it to cap-5. Excluding self is what keeps "nests other plugins" from meaning "has parts".
  const UNRESOLVED = Symbol('unresolved')
  const resolve = (ref, selfBundle) => {
    if (ref.includes('/')) {
      if (!byKey.has(ref)) return UNRESOLVED
      return ref.split('/')[0] === selfBundle ? null : byKey.get(ref)
    }
    if (byName.has(ref)) return best(byName.get(ref), selfBundle)
    if (byElement.has(ref)) return best(byElement.get(ref), selfBundle)
    return UNRESOLVED
  }
  const conflicts = [], unresolved = []
  for (const b of bundles) for (const p of b.profiles || []) {
    const own = p.composesOwn
    if (!own || !own.length) continue
    const kinds = own.map((ref) => {
      const k = resolve(ref, b.bundle)
      if (k === UNRESOLVED) unresolved.push(`${b.bundle}/${p.profile} -> ${ref}`)
      return k
    })
    const derived = kinds.some((k) => k === 'nested-elements-mfe') ? 'nested-mfe-spa' : 'nested-elements-mfe'
    if (!p.type) { p.type = derived; continue }
    if (p.type !== derived) conflicts.push(`${b.bundle}/${p.profile}: declared tier "${p.type}" disagrees with the "${derived}" its composes edges derive`)
  }
  return { conflicts, unresolved }
}
