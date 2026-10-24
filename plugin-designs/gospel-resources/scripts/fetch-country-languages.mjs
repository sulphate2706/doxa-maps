/**
 * fetch-country-languages.mjs — which languages are actually SPOKEN in a country, and by what
 * share of it.
 *
 * WHY THIS EXISTS. The bridge CANDIDATE — the "possibly a way in" offered to a group with
 * nothing — was chosen from Doxa's own pins: the language with the largest pinned population in
 * that country that has Scripture and the film. Doxa's roster is 2,107 UNREACHED groups, so that
 * is the biggest language among the unreached, which is not the language a community actually
 * shares with its neighbours. Measured: for Syenara Senufo in Mali it proposed MINIANKA, one
 * people group. Mali's actual vehicular language is Bambara, spoken by most of the country.
 *
 * Worse, the number shipped beside it read "8.8% of this country's mapped population" — a share
 * of Doxa's unreached PINS, which a reader will take for a share of the country. A percentage
 * measured against a denominator nobody can see is not a caveat, it is a wrong number.
 *
 * WHAT THIS USES. CLDR's territoryInfo, which carries, per territory, each language's share of
 * the population and whether it is official. That is the published answer to "what is spoken
 * here", maintained by Unicode, and it is the right denominator: the country.
 *
 * ⚠ PINNED, NOT `main`. cldr-json's main branch moves; a bridge recommendation changing because
 * an upstream branch advanced is not something anyone would think to look for.
 *
 * THE JOIN. CLDR speaks BCP-47, this build speaks ISO 639-3, and the two meet through the Part1
 * column of SIL's own iso-639-3 table — 184 languages carry a 639-1 code. A CLDR tag with no
 * 639-3 equivalent is dropped rather than guessed; a guess here would put a language in a
 * country on no authority at all.
 */
import { writeFileSync } from 'node:fs'
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/country-languages.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const CLDR = 'https://cdn.jsdelivr.net/npm/cldr-core@46.0.0/supplemental/territoryInfo.json'
const ISO = 'https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab'
/* Keyed by ISO3 on the way out, so the pin builder joins on the code it already has. The
   mapping comes from the SAME pinned CLDR release as the language data, rather than a second
   host with its own release cycle. */
const CODES = 'https://cdn.jsdelivr.net/npm/cldr-core@46.0.0/supplemental/codeMappings.json'

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(90000) })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.text()
}

/* Part1 (639-1) -> Id (639-3), plus the reference name, from SIL's own table. */
const tab = await get(ISO)
const toIso3 = {}
const refName = {}
for (const line of tab.split('\n').slice(1)) {
  const f = line.split('\t')
  if (f.length < 7) continue
  const [id, , , part1, , , name] = f
  if (!id) continue
  refName[id] = (name || '').trim()
  if (part1 && part1.trim()) toIso3[part1.trim()] = id.trim()
}

const codeMap = JSON.parse(await get(CODES)).supplemental.codeMappings
const alpha3 = {}
for (const [terr, v] of Object.entries(codeMap)) {
  if (/^[A-Z]{2}$/.test(terr) && v && v._alpha3) alpha3[terr] = v._alpha3
}

const cldr = JSON.parse(await get(CLDR)).supplemental.territoryInfo
const byCountry = {}
let dropped = 0
let noAlpha3 = 0
for (const [terr, info] of Object.entries(cldr)) {
  /* Two-letter territories only: CLDR also carries numeric macro-regions like 001 (World),
     which are not countries and would put "spoken in the World" into a bridge recommendation. */
  if (!/^[A-Z]{2}$/.test(terr)) continue
  const langs = []
  for (const [tag, lp] of Object.entries(info.languagePopulation || {})) {
    /* A tag like en_GB or zh_Hans carries a script or region; the base language is what a
       speaker shares with a neighbour, so it is taken and the variant dropped. */
    const base = tag.split(/[-_]/)[0]
    const iso3 = toIso3[base] || (base.length === 3 ? base : null)
    if (!iso3) { dropped++; continue }
    const pct = Number(lp._populationPercent)
    if (!Number.isFinite(pct)) continue
    langs.push({
      c: iso3,
      l: refName[iso3] || base,
      pct: Math.round(pct * 10) / 10,
      official: !!lp._officialStatus,
    })
  }
  if (!langs.length) continue
  /* Largest share first: that is the order a reader would want to judge a bridge in. */
  langs.sort((a, b) => b.pct - a.pct)
  const key = alpha3[terr]
  if (!key) { noAlpha3++; continue }
  byCountry[key] = langs
}

const countries = Object.keys(byCountry).length
if (countries < 150) {
  console.error(`COUNTRY-LANGUAGES: REFUSING TO WRITE — only ${countries} countries parsed.`)
  console.error('  A thin file would silently narrow every bridge recommendation that reads it.')
  process.exitCode = 1
} else {
  /* THROUGH THE SNAPSHOT GUARD. The 150-country floor above catches a collapse; it does not
     catch the run that parses 240 countries and loses a fifth of them. */
  const body = `${JSON.stringify({
    meta: {
      title: 'Languages spoken per country, with each share of the country',
      sources: [CLDR, ISO],
      generated: new Date().toISOString().slice(0, 10),
      countries,
      note: 'CLDR territoryInfo joined to ISO 639-3 through SIL\'s Part1 column. Percentages are ' +
        'of the COUNTRY\'s population, which is the denominator a reader assumes. A CLDR tag ' +
        'with no ISO 639-3 equivalent is dropped, never guessed.',
      cldr_tags_dropped_no_iso639_3: dropped,
      territories_dropped_no_alpha3: noAlpha3,
    },
    byCountry,
  }, null, 1)}\n`
  writeSnapshot(OUT, body, (j) => Object.keys(j.byCountry || {}).length, 'country(ies)')
  console.log(`country-languages: ${countries} countries (keyed by ISO3), ${dropped} CLDR tag(s) dropped for having no ISO 639-3, ${noAlpha3} territory(ies) with no alpha-3`)
  console.log(`wrote ${OUT}`)
}
