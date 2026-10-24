/**
 * letter.js — the LETTER to a reached group's believers (test round 2: UPG Neighbor is a letter
 * generator for the green dots). It names the unreached peoples that count this group among their nearest
 * reached neighbours, at ONE E-level, closest first: the same list the map draws and the CSV exports.
 *
 * Pure (no imports, so it runs anywhere): t(key, params) supplies every word (neighbor.letter.* in 11
 * locales) and fmt(n) the short population figure (nearData.fmtNum); data values (names, countries,
 * languages) are the dataset's own English, as everywhere in this plugin.
 */

export const LETTER_CAP = 30   // a letter names the closest 30; the CSV carries the whole list

/** A group's page on the global prayer movement, when it has one (the doxa list's slug). */
export const prayLink = (g) => (g && g.slug ? `https://pray.doxa.life/${encodeURIComponent(g.slug)}?source=doxalife` : '')

export function buildLetter({ group, neighbors, level, t, fmt = String }) {
  const n = neighbors.length
  const out = [
    t('neighbor.letter.greeting', { group: group.name, country: group.country }), '',
    t('neighbor.letter.intro', { n: n.toLocaleString('en-US'), level }), '',
  ]
  for (const x of neighbors.slice(0, LETTER_CAP)) {
    const g = x.g
    out.push('• ' + t('neighbor.letter.item', { name: g.name, country: g.country, pop: fmt(g.pop), language: g.langName, km: x.km.toLocaleString('en-US') }))
    const url = prayLink(g)
    if (url) out.push('  ' + t('neighbor.letter.pray', { url }))
  }
  if (n > LETTER_CAP) out.push('', t('neighbor.letter.more', { n: (n - LETTER_CAP).toLocaleString('en-US') }))
  out.push('', t('neighbor.letter.close'), '', t('neighbor.letter.sign'), '')
  return out.join('\n')
}
