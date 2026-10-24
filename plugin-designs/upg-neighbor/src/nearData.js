/**
 * nearData.js — the near-neighbors dataset (data/tables/near-neighbors.json, built by
 * scripts/build-near-neighbors.mjs), fetched ONCE per page and shared by both views.
 *
 * The file is column-packed and dictionary-encoded to keep it small; decode() turns a row back into
 * a plain object once, on load, so the views work with ordinary objects.
 */
import { resolveAssetsBase } from '@map/utils/embedBase.js'

// E-scale colours, one meaning everywhere in this plugin: the nearer the culture, the stronger green.
export const E_COLORS = { 1: '#0f7a3d', 2: '#34a853', 3: '#9aa7b4' }
export const UNREACHED = '#e11d48'
export const REACHED = '#16a34a'     // a reached group's own dot (2%+ evangelical)
export const SELECTED = '#f59e0b'
export const NAVY = '#002e6e'

let shared = null   // one promise per page: switching views never refetches

export function loadNearData(profileConfig) {
  if (shared) return shared
  const cfg = profileConfig?.value || profileConfig || {}
  const url = cfg.nearDataUrl || `${resolveAssetsBase(cfg)}/tables/near-neighbors.json`
  shared = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then(decode)
    .catch((e) => { shared = null; throw e })   // a failed load may be retried by the next mount
  return shared
}

function decode(raw) {
  const { cols, dict, rows, links, bridges, meta } = raw
  const groups = rows.map((r, i) => {
    const g = { i }
    cols.forEach((c, j) => { g[c] = dict[c] ? dict[c][r[j]] : r[j] })
    g.reached = !!g.reached
    return g
  })
  const neighborsOf = (u) => (links[u.i] || []).map(([ri, e, km, same]) => ({ g: groups[ri], e, km, same: !!same }))
  const pLevel = (u) => { const ls = links[u.i]; return ls && ls.length ? Math.min(...ls.map((l) => l[1])) : 0 }
  const unreached = groups.filter((g) => !g.reached)
  // THE OTHER DIRECTION: for a REACHED group, the unreached groups that list it among their nearest reached
  // neighbors. Built from the same links, so both directions always agree. It is NOT every unreached group
  // near it: each unreached group keeps only its closest few reached neighbors per E-level.
  const reachedBy = new Map()
  for (const [ui, ls] of Object.entries(links)) for (const [ri, e, km, same] of ls) {
    if (!reachedBy.has(ri)) reachedBy.set(ri, [])
    reachedBy.get(ri).push({ g: groups[+ui], e, km, same: !!same })
  }
  for (const list of reachedBy.values()) list.sort((a, b) => (a.e - b.e) || (a.km - b.km))
  const unreachedNeighborsOf = (r) => reachedBy.get(r.i) || []
  const reached = groups.filter((g) => g.reached)
  for (const u of unreached) {
    u.p = pLevel(u)
    // centered-set ring (src/rings.js): u.ring 1-10 arrives as a column (-1 = unplaced; reached rows carry 0, the centre); ringNeighbor = the reached group that sets it
    u.ringNeighbor = u.ringNb >= 0 ? groups[u.ringNb] : null
  }
  const bridgeList = bridges.map((b) => {
    const rs = b.reached.map((i) => groups[i]), us = b.unreached.map((i) => groups[i])
    return {
      lang: b.lang, langName: rs[0]?.langName || us[0]?.langName || b.lang,
      believers: b.believers, unreachedPop: b.unreachedPop,
      res: { bible: !!b.res[0], film: !!b.res[1], audio: !!b.res[2], radio: !!b.res[3] },
      reached: rs, unreached: us,
      reachedCountries: [...new Set(rs.map((g) => g.country))].sort(),
      unreachedCountries: [...new Set(us.map((g) => g.country))].sort(),
    }
  })
  return { meta, groups, unreached, reached, neighborsOf, unreachedNeighborsOf, bridges: bridgeList }
}

// Accent-insensitive search text for a group.
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function fmtNum(n) {
  n = Number(n) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K'
  return String(Math.round(n))
}

// CSV download that works from inside a shadow root (the anchor is appended to document.body).
export function downloadCsv(filename, header, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  downloadText(filename, [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n', 'text/csv')
}

// Any text file, UTF-8 with a BOM (so Windows editors read Arabic, Hindi and Chinese correctly).
export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.style.display = 'none'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
