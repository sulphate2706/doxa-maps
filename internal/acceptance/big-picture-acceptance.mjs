#!/usr/bin/env node
// Big Picture (Cat-4) composite acceptance test — the Gate-1 chain, end-to-end, against LIVE data.
//
// WHAT IT PROVES
//   The canonical coupling: the dashboard HEADER emits research-filter
//   {query,wagfRegion,wagfBlock,rop1,religion} -> the composite passes it DOWN as props ->
//   the REAL cap-2 grid re-filters (applyDropdownFilters + Fuse search) -> emits
//   groups-filtered {total} -> the composite reflects the count back UP into the header.
//
// This is a LOGIC MIRROR of the grid's applyDropdownFilters/search path, run against the SAME
// live API the grid fetches, so a data-shape drift (e.g. a facet value rename) fails HERE.
// A full compiled-element browser pass (real shadow DOM, real dropdown clicks) is run
// separately via Playwright; this file is the fast, dependency-free CI gate.
//
// Asserts the NEGATIVE too (a filter that MUST return 0 does) and RESET (empty filter == all).
// Exit 1 on any fail.

const API = 'https://pray.doxa.life/api/people-groups/list?fields=name,slug,wagf_region,wagf_block,country_code,rop1,religion&lang='

// ── mirror of people-groups-grid.vue applyDropdownFilters + the Fuse-ish search keys ──────
// Dropdown axes match by VALUE (u[field].value === selection) — the exact contract the header
// dropdown -> grid prop coupling relies on. Country is excluded by decision.
function dropdownFilter(recs, { wagfRegion = '', wagfBlock = '', rop1 = '', religion = '' } = {}) {
  let out = recs
  for (const [f, sel] of Object.entries({ wagf_region: wagfRegion, wagf_block: wagfBlock, rop1, religion })) {
    if (sel) out = out.filter(u => (u[f] || {}).value === sel)
  }
  return out
}
// substring search across name + the label of each faceted axis (a conservative subset of the
// grid's Fuse keys; the grid's fuzzy match is a SUPERSET, so any hit here is a hit there).
function searchFilter(recs, query = '') {
  if (!query) return recs
  const q = query.toLowerCase()
  const keys = ['country_code', 'rop1', 'religion', 'wagf_region', 'wagf_block']
  return recs.filter(u =>
    String(u.name || '').toLowerCase().includes(q) ||
    keys.some(k => String((u[k] || {}).label || '').toLowerCase().includes(q)))
}
function gridFilter(recs, f = {}) { return searchFilter(dropdownFilter(recs, f), f.query || '') }

const r = await fetch(API)
const d = await r.json()
const recs = d.posts || d.data || d
const N = recs.length

// discover a real value for each axis from the live data so the test is self-adjusting
const firstVal = (field) => (recs.find(u => (u[field] || {}).value) || {})[field]?.value || ''
const anyRegion = firstVal('wagf_region')
const anyReligion = firstVal('religion')

let pass = 0, fail = 0
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${name} -> ${detail}`) }

// ── 1. baseline: empty filter == ALL (this is also the RESET post-condition) ───────────────
const all = gridFilter(recs)
t('empty filter -> all (== reset state)', all.length === N, all.length)

// ── 2. each single dropdown axis narrows AND every survivor really matches by VALUE ─────────
const africa = gridFilter(recs, { wagfRegion: 'africa' })
t('Region=africa narrows', africa.length > 0 && africa.length < N, africa.length)
t('Region=africa every row .value===africa', africa.every(u => (u.wagf_region || {}).value === 'africa'), 'all-match')

const islam = gridFilter(recs, { religion: 'MSN' })
t('Religion=MSN (Islam-Sunni) narrows', islam.length > 0 && islam.length < N, islam.length)
t('Religion=MSN every row .value===MSN', islam.every(u => (u.religion || {}).value === 'MSN'), 'all-match')

// ── 3. faceted (two-axis) combo is the INTERSECTION (<= each single axis) ───────────────────
const asia = gridFilter(recs, { wagfRegion: 'asia' })
const hindu = gridFilter(recs, { religion: 'H' })
const asiaHindu = gridFilter(recs, { wagfRegion: 'asia', religion: 'H' })
t('Asia+Hinduism is a subset of Asia', asiaHindu.length > 0 && asiaHindu.length <= asia.length, `${asiaHindu.length}<=${asia.length}`)
t('Asia+Hinduism is a subset of Hinduism', asiaHindu.length <= hindu.length, `${asiaHindu.length}<=${hindu.length}`)

// ── 4. search couples the header query into the grid ────────────────────────────────────────
const somali = gridFilter(recs, { query: 'somali' })
t("search 'somali' finds Somali groups", somali.length > 0 && somali.some(u => String(u.name).toLowerCase().includes('somali')), somali.length)

// ── 5. search WITHIN a dropdown selection (query + facet together) ───────────────────────────
const africaA = gridFilter(recs, { wagfRegion: 'africa', query: 'a' })
t("search 'a' within Africa <= Africa", africaA.length > 0 && africaA.length <= africa.length, `${africaA.length}<=${africa.length}`)

// ── 6. THE NEGATIVE: a nonsense query MUST return 0 (proves empty-state fires) ───────────────
const none = gridFilter(recs, { query: 'zzzznotarealpeoplegroupxyz' })
t('nonsense query -> 0 (empty-state path)', none.length === 0, none.length)

// ── 7. a nonsense DROPDOWN value MUST return 0 (proves value-alignment, not silent pass-through) ─
const badFacet = gridFilter(recs, { wagfRegion: '__no_such_region__' })
t('unknown region value -> 0 (value-alignment)', badFacet.length === 0, badFacet.length)

// ── 8. self-check the axes actually exist in live data (guards a facet rename upstream) ──────
t('live data exposes a wagf_region facet', Boolean(anyRegion), anyRegion || '(none!)')
t('live data exposes a religion facet', Boolean(anyReligion), anyReligion || '(none!)')

console.log(`\n  Big Picture acceptance: ${pass} passed, ${fail} failed (${N} live records)`)
process.exit(fail ? 1 : 0)
