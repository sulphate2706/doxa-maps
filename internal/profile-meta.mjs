/**
 * profile-meta.mjs — the per-profile fields a host reads from <profile>.meta.json, in ONE place.
 *
 * generate-tree (the built manifest.json) and the dev server's /__plugin-gallery/manifest.json both call
 * this, so the dev Studio and the built Studio cannot disagree (the corner widget once never mounted in
 * dev because only the built manifest carried "widget").
 *   stage   "production" | "experimental"   default experimental
 *   heavy   true when the element holds live WebGL contexts
 *   widget  { corner } for a corner widget the Plugin Studio mounts once, fixed
 *   visibility  "team" | "public"   default team — see VISIBILITY below
 *   mobile  "desktop-only" | "larger-screens"   absent = phone-ready — see MOBILE below
 *   posterDesign  { family, name, size, mobileFriendly, labelKey?, instance? } or an array of them: the poster
 *           design(s) this profile shows, listed by Poster Design's Styles. Carried as written, ONLY when present
 *           (every other manifest keeps its bytes); check:poster-design-catalogue validates it.
 *   posterDesignLabels  GENERATED beside it: { <design name>: { <locale>: title } } for every block with a labelKey,
 *           resolved here from library/i18n/locales/<locale>/<area>.json. Poster Design's bundle ships only the
 *           catalogue areas its own code names, so a plugin's own area (upgMap, …) would be missing there and the card
 *           would read English; carrying the titles in the manifest works for any area, with no Poster Design rebuild.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'i18n', 'locales')
// A catalogue key ("area.a.b") in every locale that has it: { en: '…', ar: '…' }; {} when no locale does.
function catalogueTitles(key) {
  const [area, ...path] = String(key || '').split('.')
  const out = {}
  if (!area || !path.length || !existsSync(LOCALES)) return out
  for (const loc of readdirSync(LOCALES)) {
    const f = join(LOCALES, loc, `${area}.json`)
    if (!existsSync(f)) continue
    try {
      let o = JSON.parse(readFileSync(f, 'utf8'))
      for (const p of path) o = o && typeof o === 'object' ? o[p] : undefined
      if (typeof o === 'string' && o.trim()) out[loc] = o
    } catch { /* a locale file that does not parse names nothing */ }
  }
  return out
}
function posterDesignLabels(pd) {
  const out = {}
  for (const b of Array.isArray(pd) ? pd : [pd]) {
    if (b && typeof b.name === 'string' && typeof b.labelKey === 'string') {
      const titles = catalogueTitles(b.labelKey)
      if (Object.keys(titles).length) out[b.name] = titles
    }
  }
  return out
}

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

/**
 * ★ WHO ELSE MAY LIST THIS PLUGIN (2026-09-28). The platform dashboard reads each team's
 * own /cdn/dx-maps/manifest.json instead of one shared index, so this field is what decides whether
 * a plugin appears in ANOTHER team's library (loaded read-only from the owner's CDN).
 *
 *   "team"    listed only in the owning team's library
 *   "public"  also listed in every other team's library
 *   ABSENT    team — every manifest that exists today is private until a plugin opts in
 *
 * ★ DO NOT REACH FOR `stage` TO EXPRESS THIS. It sits right next to it in this file and reads like
 * a fit: it is maturity, not audience. Using it would hide every experimental plugin from its OWN
 * team and publish every production one to everybody — wrong in both directions at once.
 *
 * ★ AN UNKNOWN VALUE IS REFUSED, NOT DEFAULTED. Defaulting "Public" or "pubic" to team is the safe
 * direction and that is exactly what makes it dangerous: the author reads their opt-in as done, the
 * field says private, and nobody finds out until someone asks why the plugin never appeared. The
 * generator exits on it (generate-tree, "visibility" block) so a typo is a build failure, loud, at
 * the moment it is introduced.
 */
export const VISIBILITY = ['team', 'public']

/**
 * ★ HOW A MAP BEHAVES ON A PHONE, declared once per profile (SPEC-MOBILE-FLAG). The Research Gallery
 * and the standalone leaf page both read it from here, through the manifest and the leaf's config:
 *
 *   "desktop-only"    BLOCKS on a narrow screen: the map is not mounted, a message says why
 *   "larger-screens"  ADVISES: the map opens, with a dismissible notice at its top
 *   ABSENT            phone-ready: nothing is shown
 *
 * Any other value is not coerced: check:mobile-gating fails on it, by profile, so a typo cannot
 * quietly turn a desktop-only map into a phone-ready one.
 */
export const MOBILE = ['desktop-only', 'larger-screens']

export function readProfileMeta(dir, profileName) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, `${profileName}.meta.json`), 'utf8'))
    const corner = meta?.widget?.corner
    // The plugin's own display name (label, or title / displayName): what the Plugin Studio rail calls it.
    const name = [meta?.label, meta?.title, meta?.displayName].find((v) => typeof v === 'string' && v.trim())
    return {
      stage: meta?.stage === 'production' ? 'production' : 'experimental',
      heavy: meta?.heavy === true,
      widget: CORNERS.includes(corner) ? { corner } : null,
      label: name ? name.trim() : '',
      // Where the plugin runs ("web", "desktop"…); absent = web. A desktop-only plugin is never a gallery tab.
      targets: Array.isArray(meta?.targets) ? meta.targets.filter((t) => typeof t === 'string') : null,
      visibility: VISIBILITY.includes(meta?.visibility) ? meta.visibility : 'team',
      // The declared-but-unrecognised value, kept so the generator can name it in the failure.
      // null when the key is absent (the supported way to say "team") or already valid.
      visibilityInvalid: meta?.visibility === undefined || VISIBILITY.includes(meta?.visibility)
        ? null
        : String(meta.visibility),
      mobile: MOBILE.includes(meta?.mobile) ? meta.mobile : null,
      posterDesign: meta?.posterDesign && typeof meta.posterDesign === 'object' ? meta.posterDesign : null,
    }
  } catch { return { stage: 'experimental', heavy: false, widget: null, label: '', targets: null, visibility: 'team', visibilityInvalid: null, mobile: null, posterDesign: null } }
}

/** The optional manifest keys for one profile (stage always; heavy / widget only when set). */
export function profileMetaFields(dir, profileName) {
  const m = readProfileMeta(dir, profileName)
  // visibility is emitted ONLY when it is "public": absent means team, so every manifest in the
  // tree today keeps the bytes it has and nothing becomes visible by upgrading the generator.
  return { stage: m.stage, ...(m.visibility === 'public' ? { visibility: 'public' } : {}), ...(m.label ? { label: m.label } : {}), ...(m.targets ? { targets: m.targets } : {}), ...(m.heavy ? { heavy: true } : {}), ...(m.widget ? { widget: m.widget } : {}), ...(m.mobile ? { mobile: m.mobile } : {}), ...(m.posterDesign ? { posterDesign: m.posterDesign } : {}), ...(m.posterDesign && Object.keys(posterDesignLabels(m.posterDesign)).length ? { posterDesignLabels: posterDesignLabels(m.posterDesign) } : {}) }
}

/** A bundle is production if ANY of its profiles says so. */
export const bundleStage = (profiles) => (profiles.some((p) => p.stage === 'production') ? 'production' : 'experimental')

/**
 * A bundle is public if ANY of its profiles is — because a bundle is ONE IIFE. The profiles in it
 * share a single .js, so publishing one profile publishes the file the others are compiled into;
 * there is no shape of this field that makes half a script fetchable. The per-profile key is still
 * emitted, so a reader can list only the profiles that opted in while loading the one bundle.
 */
export const bundleVisibility = (profiles) => (profiles.some((p) => p.visibility === 'public') ? 'public' : 'team')
