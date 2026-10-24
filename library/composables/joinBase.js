/**
 * joinBase.js — SHARED (@map/composables/joinBase.js). Join a host-supplied base URL to a path.
 *
 * ★ WHY THIS EXISTS: `researchUrl` and `prayBaseUrl` are set by whoever embeds the element —
 * an attribute in someone else's HTML, on someone else's page. Four sites joined them by bare
 * concatenation, and RegionCountryMap's own prop comment records the contract this leaves on the
 * embedder without ever telling them:
 *
 *     Pray -> prayBaseUrl/<slug>,  Full Profile -> researchUrl<slug>
 *
 * One of those two needs a trailing slash and the other must not have one. An embedder who writes
 * research-url="https://doxa.life/research" — the spelling a human would choose — gets
 * "https://doxa.life/researchbantu-tswana": a 404 with no error anywhere, on every profile link
 * the plugin draws. The people-groups-grid case is worse, because its country link is
 * `${researchUrl}../countries/<slug>` and silently resolves one level too high without the slash.
 *
 * We cannot test what an embedder passes, so the constraint is encoded instead of documented:
 * exactly one slash between the two halves, whatever we are handed.
 *
 * Relative segments are preserved on purpose — joinBase(base, '../countries/x') keeps the '..',
 * which the browser resolves at navigation exactly as the hand-written version did.
 */
export function joinBase(base, path = '') {
  const b = String(base == null ? '' : base).replace(/\/+$/, '')
  const p = String(path == null ? '' : path).replace(/^\/+/, '')
  return p ? `${b}/${p}` : `${b}/`
}
