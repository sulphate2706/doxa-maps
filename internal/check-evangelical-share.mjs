#!/usr/bin/env node
/**
 * check-evangelical-share — the packet's "% evangelical" page states THIS list's share.
 *
 * The page says each box is a share of the people in this list. It used to print one DOXA-wide figure
 * in every packet. Each packet now sums its own groups from the per-group table
 * (data/people-groups/evangelical-by-slug.json), by the method the DOXA-wide figure was made with.
 *
 *   (a) ANCHOR — summed over every DOXA group, the table reproduces christian-share.json exactly, so
 *       the per-list figures and the committed figure are one method.
 *   (b) NOT A CONSTANT — two different lists give different figures. A page that printed the same
 *       number for every list would pass (a) and fail here.
 *   (c) NO DATA IS A DASH — a list with no published levels prints "—" and no percentage. Presence is
 *       tested, not finiteness: Number(null) is 0, and a finiteness guard prints "0%" for no data.
 *   (d) COVERAGE ONLY WHEN PARTIAL — the "computed over N of M groups" clause appears when some of the
 *       list's groups lack a level, and not when all have one.
 *
 * Exit 0 pass · 1 fail · 75 NOT MEASURED.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let evangelicalShareFor, createPacketRenderer, table, committed, snapshot, clusters, strings
try {
  ;({ evangelicalShareFor } = await import(join(REPO, 'library/packet/evangelicalShare.js')))
  ;({ createPacketRenderer } = await import(join(REPO, 'library/packet/packet-render.js')))
  table = JSON.parse(readFileSync(join(REPO, 'data/people-groups/evangelical-by-slug.json'), 'utf8'))
  committed = JSON.parse(readFileSync(join(REPO, 'data/people-groups/christian-share.json'), 'utf8'))
  const snap = JSON.parse(readFileSync(join(REPO, 'data/people-groups/doxa-groups-snapshot.json'), 'utf8'))
  snapshot = Array.isArray(snap) ? snap : (snap.posts || snap.groups || snap.rows || [])
  clusters = JSON.parse(readFileSync(join(REPO, 'plugin-designs/my-upg-100-list/data/clusters.json'), 'utf8'))
  strings = JSON.parse(readFileSync(join(REPO, 'library/scripts/posters/packet-strings.json'), 'utf8'))
} catch (e) {
  console.error(`EVANGELICAL-SHARE: NOT MEASURED (exit 75) — an input did not load: ${e.message}`)
  process.exit(75)
}

const fails = []
const notes = []

// (a) ANCHOR
{
  const all = evangelicalShareFor(snapshot.map((g) => ({ slug: g.slug })), table)
  const same = all.groupsMatched === committed.groupsMatched && all.population === committed.population
    && all.evangelicalPopulation === committed.evangelicalPopulation
    && Math.abs(all.pctEvangelical - committed.pctEvangelical) < 0.00005
  if (!same) fails.push(`summed over every DOXA group the table gives ${JSON.stringify({ m: all.groupsMatched, p: all.population, e: all.evangelicalPopulation, pct: all.pctEvangelical })}; christian-share.json says ${JSON.stringify({ m: committed.groupsMatched, p: committed.population, e: committed.evangelicalPopulation, pct: committed.pctEvangelical })}`)
  else notes.push(`  ok    summed over all ${all.groupsInList} DOXA groups it reproduces christian-share.json: ${all.pctEvangelical.toFixed(4)}%`)
}

// (b) NOT A CONSTANT — two lists whose members are listed by slug in the catalogue, so no API is needed
{
  const bySlugZones = (clusters.asia_lists || []).filter((z) => z.selector && z.selector.type === 'pg_slugs')
  const figures = bySlugZones.map((z) => evangelicalShareFor(z.selector.values.map((slug) => ({ slug })), table).pctEvangelical)
  const distinct = new Set(figures.map((f) => (f === null ? 'none' : f.toFixed(5)))).size
  if (bySlugZones.length < 2) fails.push('fewer than two slug-listed zones to compare — (b) cannot be measured')
  else if (distinct < 2) fails.push(`${bySlugZones.length} different lists all print the same figure — the page is a constant, not each list's share`)
  else notes.push(`  ok    ${bySlugZones.length} slug-listed lists give ${distinct} distinct figures (${Math.min(...figures.filter((f) => f !== null)).toFixed(3)}%–${Math.max(...figures.filter((f) => f !== null)).toFixed(3)}%)`)
}

// (c) + (d) THE PAGE
{
  const R = createPacketRenderer({ strings, lang: 'en' })
  const zone = { id: 'z', label: 'Z' }
  const page = (christian) => R.christianPage(zone, christian)
  const figure = (html) => ((html.match(/class="ev-pct">([^<]*)</) || [])[1] || '').trim()

  const none = page({ groupsInList: 12, groupsMatched: 0, population: 0, evangelicalPopulation: 0, pctEvangelical: null })
  if (!none) fails.push('a list with no published levels omits the page instead of printing a dash')
  else if (figure(none) !== '—') fails.push(`a list with no published levels prints "${figure(none)}" where it must print a dash`)
  else if (/\d%/.test(figure(none))) fails.push('a list with no published levels prints a percentage')
  else notes.push('  ok    no published levels: the page prints "—" and no percentage (not "0%")')

  const partial = page({ groupsInList: 10, groupsMatched: 7, population: 1000, evangelicalPopulation: 5, pctEvangelical: 0.5 })
  const whole = page({ groupsInList: 10, groupsMatched: 10, population: 1000, evangelicalPopulation: 5, pctEvangelical: 0.5 })
  const cov = strings.en.christian_coverage.replace('{matched}', '7').replace('{total}', '10')
  if (!partial.includes(cov)) fails.push(`partial coverage (7 of 10) does not state it: expected "${cov}"`)
  else if (whole.includes('computed over')) fails.push('full coverage still prints the coverage clause')
  else notes.push('  ok    coverage is stated when partial ("computed over 7 of the 10…") and absent when whole')
  // ★ PEOPLE, NOT WEEKS (2026-09-29). This page used to count the shaded boxes in weeks ("0.5% · 26 weeks")
  // because its grid is the life calendar's; a box here is a share of PEOPLE, so the legend states each
  // total in people and the grid carries no week or year axis. Both directions are asserted.
  if (figure(partial) !== '0.5%') fails.push(`a 0.5% list prints "${figure(partial)}" where it must print "0.5%"`)
  else notes.push('  ok    the share prints as a percentage alone ("0.5%")')
  const ppl = strings.en.christian_people
  if (!partial.includes(`5 ${ppl}`) || !partial.includes(`995 ${ppl}`)) {
    fails.push(`a 0.5% list of 1,000 people does not state both totals ("5 ${ppl}" who follow Jesus, "995 ${ppl}" who do not yet)`)
  } else notes.push('  ok    both totals are stated in people: 5 who follow Jesus, 995 who do not yet')
  // The grid is one SVG now (lifeGrid): its week numbers are <text class="lc-t lc-tw">, its year numbers
  // "lc-t lc-ty", and its markup names `data-weeks` as geometry, so the WORDS a reader sees are read with the
  // tags stripped.
  const axis = /class="lc-t lc-t[wy]\b/
  if (/week/i.test(partial.replace(/<[^>]+>/g, ' ')) || axis.test(partial)) fails.push('the page still counts in weeks or draws a week/year axis')
  else notes.push('  ok    no weeks and no week/year axis on the page')
  // ★ ITS SIDE LABELS ARE SHARES (2026-10-02): each 10-row block is 520 boxes, a tenth of the list's people,
  // labelled 10% ... 100% in the page's own numerals; exactly those ten, in order.
  const shares = [...partial.matchAll(/class="lc-t lc-tp[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1])
  const want = Array.from({ length: 10 }, (_, i) => `${((i + 1) * 10).toLocaleString('en')}%`)
  if (shares.join('|') !== want.join('|')) fails.push(`the people grid's side labels should read ${want.join(' ')}, got ${shares.join(' ') || 'none'}`)
  else notes.push('  ok    the people grid labels each 10-row block with its share: 10% ... 100%')
  // A TINY SHARE: the totals come from the unrounded figure. 0.004% of 1,000,000,000 is 40,000 people,
  // which must not print as 0 because the percentage rounds to 0.00.
  const tiny = page({ groupsInList: 5, groupsMatched: 5, population: 1e9, evangelicalPopulation: 40000, pctEvangelical: 0.004 })
  if (!tiny.includes(`40,000 ${ppl}`) || !/ev-pct">&lt;0\.01%</.test(tiny)) fails.push('a 0.004% share of a billion does not print 40,000 people and "<0.01%"')
  else notes.push('  ok    a share below the printed digits keeps its real total (40,000 people) and reads "<0.01%"')
  // NEG CONTROL: the life page itself keeps both axes, so the axis test above can see one when it is there,
  // and it carries no share labels, so the share test above is not satisfied by any grid.
  const life = R.lifePage(zone)
  if (!/class="lc-t lc-tw"/.test(life) || !/class="lc-t lc-ty/.test(life)) fails.push('the life page lost its week or year axis (the axis check above cannot fail)')
  if (/class="lc-t lc-tp/.test(life)) fails.push('the life page carries share labels: a week of a life is not a share of people')
}

for (const n of notes) console.log(n)
if (fails.length) {
  console.error('EVANGELICAL-SHARE: FAIL')
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('EVANGELICAL-SHARE: PASS — each packet states its own list\'s share, by the committed method, and a list without data prints a dash.')
