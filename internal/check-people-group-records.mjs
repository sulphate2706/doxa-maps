#!/usr/bin/env bun
/**
 * check-people-group-records — the records half of the print standard (library/lists/peopleGroupRecords.js)
 * selects EXACTLY the set it is asked for, two-sided: a country selector returns that country's groups and
 * not another's, an unknown selector returns nothing (never everything), one fetch serves a language, and
 * a failed fetch is not cached. Headless, with an injected fetch. Runs under bun (lists.json is imported
 * without an import attribute, as it is inside the bundles).
 */
const { createPeopleGroupRecords, selectRecords } = await import(new URL('../library/lists/peopleGroupRecords.js', import.meta.url).href)
const rows = [
  { slug: 'a', name: 'Zeta', country_code: { value: 'TCD', label: 'Chad' }, wagf_region: { value: 'africa', label: 'Africa' } },
  { slug: 'b', name: 'Alpha', country_code: { value: 'TCD', label: 'Chad' }, wagf_region: { value: 'africa', label: 'Africa' } },
  { slug: 'c', name: 'Mid', country_code: { value: 'IND', label: 'India' }, wagf_region: { value: 'asia', label: 'Asia' } },
]
let calls = 0, fail = false
const fetchImpl = async (url) => { calls++; if (fail) return { ok: false, status: 503 }; return { ok: true, json: async () => ({ posts: rows }) } }
const R = createPeopleGroupRecords({ apiBase: () => 'http://api', lang: () => 'es', fetchImpl })
const chad = await R({ type: 'country', values: ['tcd'] })
const bySlug = await R({ type: 'pg_slugs', values: ['c'] })
const byField = await R({ type: 'field', field: 'wagf_region', values: ['asia'] })
const unknown = await R({ type: 'rop3', values: ['x'] })
const r = {
  country: chad.map((x) => x.slug).join(',') === 'b,a',                       // Chad only, sorted by name
  countryExcludesIndia: !chad.some((x) => x.slug === 'c'),
  normalized: chad[0].country_code === 'TCD' && chad[0].country_code_label === 'Chad',
  slugs: bySlug.length === 1 && bySlug[0].slug === 'c',
  field: byField.length === 1 && byField[0].slug === 'c',
  unknownSelectsNothing: unknown.length === 0,
  oneFetchPerLanguage: calls === 1,
  evaluateHook: selectRecords(rows.map((x) => ({ ...x, country_code: 'X' })), { type: 'custom' }, () => new Set(['a'])).length === 1,
}
fail = true
const R2 = createPeopleGroupRecords({ apiBase: () => 'http://api', fetchImpl })
let threw = false; try { await R2({ type: 'country', values: ['TCD'] }) } catch { threw = true }
fail = false
const retried = (await R2({ type: 'country', values: ['TCD'] })).length === 2
r.failureNotCached = threw && retried
const R3 = createPeopleGroupRecords({ apiBase: () => '', fetchImpl })
let noApi = false; try { await R3({ type: 'country', values: ['TCD'] }) } catch { noApi = true }
r.noApiRejects = noApi
console.log(r)
const pass = Object.values(r).every(Boolean)
console.log(pass ? 'PG-RECORDS: PASS' : 'PG-RECORDS: FAIL'); process.exit(pass ? 0 : 1)
