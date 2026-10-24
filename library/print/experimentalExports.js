/**
 * experimentalExports.js — the ONE switch for the print standard's EXPERIMENTAL rollout on map legends.
 *
 * PRODUCTION (no flag, always on): the UPG 100 list and the Regions dashboard's country posters, and the
 * Country Posters wall — those print through the standard unconditionally.
 * EXPERIMENTAL (this flag): every OTHER map whose legend already has an Export menu gets the same
 * reusable exports (the card deck; the prayer packet, full or lightweight) only while this is on, so the
 * rollout can be tried in more places and switched off in one move if it misbehaves.
 *
 * Off, in order of reach:
 *   one page     profile-config `experimentalExports: false`
 *   one visit    ?exports=off in the URL
 *   one site     window.DOXA_EXPERIMENTAL_EXPORTS = false before the maps load
 *   everywhere   EXPERIMENTAL_EXPORTS_DEFAULT below
 * A legend given `false` shows exactly the Export menu it had before the rollout.
 */
export const EXPERIMENTAL_EXPORTS_DEFAULT = true

export function experimentalExportsOn(profileConfig = null) {
  const cfg = profileConfig && typeof profileConfig === 'object' && 'value' in profileConfig ? profileConfig.value : profileConfig
  if (cfg && typeof cfg.experimentalExports === 'boolean') return cfg.experimentalExports
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('exports')
    if (q === 'off' || q === '0' || q === 'false') return false
    if (q === 'on' || q === '1' || q === 'true') return true
  } catch { /* no location (Node, a sandboxed frame): fall through */ }
  if (typeof globalThis.DOXA_EXPERIMENTAL_EXPORTS === 'boolean') return globalThis.DOXA_EXPERIMENTAL_EXPORTS
  return EXPERIMENTAL_EXPORTS_DEFAULT
}
