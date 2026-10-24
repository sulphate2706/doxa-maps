/**
 * zone-title — compose a zone's DISPLAY TITLE from parts that are ALREADY translated, so adding a
 * project list costs no new translation and adding a locale costs no code change.
 *
 * THE PROBLEM. Every zone label is a hand-written English string — "Middle East
 * Core", "Malabar Coast" — so the Arabic map reads English. Hand-translating them does not scale,
 * because UPG-100 is becoming a PATTERN: Project 7000 / 4700 / 3000 / 2000 / 700 each invent their own
 * ~100 clusters, and a per-title translation is a cost paid again for every list, forever.
 * The question is how to generate a title without a new translation each time.
 *
 * ★ WHAT THE DATA ACTUALLY ALLOWS, measured before any of this was written (2026-09-27):
 *
 *   SOURCE                                   COVERAGE OF OUR DATA          FAILURE MODE
 *   country_code_label from the records API   all 175 codes, every locale   (absent field)
 *   Intl.DisplayNames({type:'region'})        all 175, every locale         THROWS on ISO-3
 *   Intl.DisplayNames({type:'language'})      213 of 2242 = 9.5%            ECHOES THE CODE
 *
 * ⚠ LANGUAGE IS NOT A USABLE TITLE SOURCE, which kills the more attractive half of the original idea.
 * `new Intl.DisplayNames(['en'],{type:'language'}).of('kfa')` returns the STRING "kfa" — it does not
 * throw — so a miss prints a raw code onto a printed poster with nothing raising a hand. And the 90.5%
 * miss is STRUCTURAL rather than a gap someone can fill: unreached peoples speak small languages by
 * definition, and CLDR carries the big ones. So this module never names a language.
 *
 * ★ AND COUNTRY NAMES COME FROM THE RECORDS, NOT FROM Intl, which was the measurement that simplified
 * the whole design. The records API already returns `country_code_label` localized by its own `lang`
 * parameter — verified live: IND is الهند / भारत / 印度 / Индия for lang=ar/hi/zh/ru, matching Intl
 * exactly. Since the packet and the page ALREADY fetch these records at the reader's locale, the
 * localized name is free and needs no ISO-3166 alpha-3 → alpha-2 mapping at all. Intl is kept only as a
 * FALLBACK for a caller who has a code and no record.
 *
 * WHICH ZONES THIS CAN AND CANNOT TITLE — stated here because a generator that silently produces a bad
 * title is worse than one that declines:
 *   TIER A  selector country_code        → one country name.                    GENERATED
 *   TIER B  selector country_codes       → 2..n country names + a joiner.        GENERATED
 *   TIER C  wagf_block / wagf_region / pg_slugs / union / affinity_bloc → null.  DECLINED
 * Tier C is 18 of our 28 zones and it cannot be done from country names: the 12 India/China zones are
 * `pg_slugs` whose every record is ONE country (measured: asia-india-kerala is 78/78 IND), so countries
 * would render "India" twelve times and could not tell "Malabar Coast" from "Northwest India" — those
 * labels are SUB-NATIONAL. Naming them needs a province/subdivision source, which Intl has none of; the
 * curated-table-vs-keep-English choice is a pending product decision. Until it is decided
 * this returns null for tier C and the caller keeps the existing label, so nothing regresses.
 *
 * THE ONLY TRANSLATED STRINGS ARE THE TWO JOINERS — `zone_join` ("{a} + {b}") and `zone_join_more`
 * ("{a} + {n} more") — in packet-strings.json, one pair per locale block. That is the entire
 * translation cost for every project list that ever uses this.
 */

/** Tier A/B selector types. Anything else is tier C and declined. */
const COUNTRY_SELECTORS = new Set(['country_code', 'country_codes'])

/**
 * The ISO-3 codes a selector names, in the order the selector lists them.
 * ⚠ ORDER IS THE AUTHOR'S, NOT ALPHABETICAL. clusters.json lists the countries of a zone with the
 * biggest/most representative first (middle-east-core starts IRN,YEM,IRQ), and that order is editorial
 * information: it is what makes "Iran + Yemen + 8 more" a better title than "Bahrain + Iran + 8 more".
 * Sorting here would discard a judgement someone already made.
 */
export function zoneCountryCodes(selector) {
  if (!selector || !COUNTRY_SELECTORS.has(selector.type)) return []
  if (selector.type === 'country_code') return selector.value ? [selector.value] : []
  return Array.isArray(selector.values) ? selector.values.filter(Boolean) : []
}

/**
 * ISO-3 → a localized country name.
 *
 * @param {string} iso3
 * @param {object} opts
 * @param {Map<string,string>} [opts.byCode]  ISO-3 → country_code_label, built from the records this
 *        page/packet already loaded AT THE READER'S LOCALE. The preferred source: no alpha-2 mapping,
 *        no second service, and it agrees with Intl where both have an answer.
 * @param {string} [opts.locale]  used only by the Intl fallback.
 * @param {(iso3:string, locale:string)=>string} [opts.countryName]  the coming library
 *        helper (localized country names, ISO-3 → ISO-2). Injected rather than imported
 *        so this module does not depend on an unlanded file; when it lands, pass it and it wins over
 *        the local Intl fallback.
 * @returns {string|null} null rather than the raw code — see below.
 */
export function countryLabel(iso3, opts = {}) {
  const code = String(iso3 || '').toUpperCase()
  if (!code) return null
  // ★ ORDER: the shared country-name helper (or Intl) FIRST, the records' label SECOND — and this order
  // is the opposite of the first version, corrected by measuring what the two sources actually say.
  // The records API returns the FORMAL country name, which is wrong for a poster header:
  //     LAO  "Lao People's Democratic Republic"   vs Intl "Laos"
  //     IRN  "Islamic Republic of Iran"           vs Intl "Iran"
  //     CHN  "People's Republic of China"         vs Intl "China"
  // 28 of our 175 country labels are long formal forms like these. The first version preferred the
  // records because they were already localized and needed no code mapping — true, and it produced
  // "Lao People's Democratic Republic" as the title of the zone whose hand-written label was "Laos",
  // i.e. a generated title WORSE than the one it replaced. Intl gives the short common form in every
  // locale, which is what a header and a 380px legend row want.
  // The records stay as the fallback because they need no alpha-2 mapping and are always present.
  if (typeof opts.countryName === 'function') {
    const n = opts.countryName(code, opts.locale || 'en')
    if (n && n !== code) return n
  }
  // ⚠ Intl REGIONS TAKE ALPHA-2 AND THROW ON ALPHA-3 — `new Intl.DisplayNames(['en'],{type:'region'})
  // .of('IND')` is a RangeError, not a miss. So a 3-letter code needs a mapping, and `alpha2` is that
  // mapping, INJECTED rather than imported: the ISO-3→ISO-2 table belongs to the library's
  // localized-country-names work and it has not landed, so this module must work without
  // it and improve when it arrives. With no mapper a 3-letter code simply falls through to the records
  // label below — the formal name, but a real localized name.
  // That THROW-vs-ECHO asymmetry with the language type is also why every lookup here ends in null
  // rather than in a code: one failure is loud, the other silent, and null normalises both.
  const two = code.length === 2 ? code
    : (typeof opts.alpha2 === 'function' ? String(opts.alpha2(code) || '').toUpperCase() : '')
  if (two.length === 2) {
    try {
      const n = new Intl.DisplayNames([opts.locale || 'en'], { type: 'region' }).of(two)
      if (n && n !== two) return n
    } catch (_) { /* not a region Intl knows */ }
  }
  // The records' own label: always localized, always present, but the FORMAL form. Second choice, not
  // no choice.
  const fromRecords = opts.byCode?.get(code)
  if (fromRecords) return fromRecords
  // ★ NEVER RETURN THE CODE. "SDN + 3 more" on a poster looks like a data bug to a reader and, worse,
  // reads as a successful translation to a gate that only checks the string is non-empty. A null makes
  // the caller fall back to the existing label, which is English but is at least a WORD.
  return null
}

/**
 * The generated title for a zone, or null if this zone is not the kind that can be generated.
 *
 * @param {object} zone      a clusters.json zone (needs .selector)
 * @param {object} strings   the resolved locale block from packet-strings.json (per-KEY fallback to en
 *                           already applied by the caller, as packet.mjs does)
 * @param {object} opts      as countryLabel, plus:
 * @param {number} [opts.maxParts=2]  how many countries to name before collapsing to "+ n more".
 *        2 by default because these titles print on a poster header and in a legend row: three names
 *        already wrap at the legend's 380px panel width in ar and hi, where the words are longer.
 * @returns {string|null}
 */
export function zoneTitle(zone, strings, opts = {}) {
  // ★ AN AFFINITY-BLOC ZONE HAS NO COUNTRY TO NAME IT, BUT IT HAS A NAME OF ITS OWN. The Deaf row
  // (affinity bloc A017) spans every region, so the country path below declines it — and the packet
  // then printed the legend's internal label, "Deaf (affinity bloc A017)", as its title. Its name is
  // translated once per language in the packet strings, keyed by bloc: zone_affinity_<rop1>. Any other
  // affinity bloc a list adds is named the same way, with one string and no code.
  const sel = zone?.selector
  if (sel && sel.type === 'affinity_bloc' && sel.rop1) {
    const name = strings && strings[`zone_affinity_${sel.rop1}`]
    return typeof name === 'string' && name.trim() ? name : null
  }
  const codes = zoneCountryCodes(zone?.selector)
  if (!codes.length) return null              // tier C — declined, caller keeps its label

  // ★ ONE COUNTRY ONLY. A multi-country zone DECLINES, exactly as tier C
  // does, and keeps its hand-written label.
  //
  // This is not a limitation of the joiner below — the joiner works. It is that A MULTI-COUNTRY ZONE
  // HAS A NAME THAT IS NOT A LIST OF ITS MEMBERS, so no assembly of country names can produce it.
  // MEASURED over all 29 zones in en/es/ar before wiring anything, and the generated title was WORSE
  // than the hand-written one it would replace — in ENGLISH TOO, so this was never a localization
  // trade-off:
  //     "Middle East Core"      would become  "Iran + Yemen + 11 more"      (2 named of 13)
  //     "Scattered / Diaspora"  would become  "Andorra + Cocos (Keeling) Islands + 2 more"
  // and no maxParts rescues it: 2 → 3 → 4 → 13 just walks toward a full 13-country enumeration.
  // "Middle East Core" names a REGION; "Scattered / Diaspora" names a KIND of zone. Country names
  // cannot say either.
  //
  // ⚠ THE GUARD IS HERE, NOT AT THE CALLER, AND THAT IS DELIBERATE. Six product call sites supply
  // this across three surfaces (the legend in upg-100-list.vue x3, posters, packets) — a caller-side
  // `codes.length === 1` test would have to be repeated six times and would drift the first time one
  // was missed, silently regressing one surface while the others stayed right. One guard, one
  // behaviour, every surface.
  //
  // What still works: tier A generates in all 11 locales at zero translation cost (Sudan / Sudán /
  // السودان). Tier B keeping its label is the SAME null-means-keep-yours contract tier C uses, so
  // this widens an existing path rather than adding a new one.
  if (codes.length > 1) return null

  const maxParts = Math.max(1, opts.maxParts ?? 2)

  const named = codes.map((c) => countryLabel(c, opts))
  // ★ ALL-OR-NOTHING ON THE NAMED HEAD. If any of the countries we would SHOW has no name, decline the
  // whole title rather than printing a partial one: a title that names two of three countries and drops
  // the third silently misinforms, and it cannot be distinguished from a correct title downstream.
  const head = named.slice(0, maxParts)
  if (head.some((n) => !n)) return null

  if (codes.length === 1) return head[0]
  if (codes.length <= maxParts) {
    // Fold left so three names read "a + b + c" using the same two-part joiner, rather than needing a
    // separate three-part string per locale.
    return head.reduce((acc, n) => fill(strings?.zone_join, { a: acc, b: n }) ?? `${acc} + ${n}`)
  }
  const rest = codes.length - maxParts
  const joined = head.reduce((acc, n) => fill(strings?.zone_join, { a: acc, b: n }) ?? `${acc} + ${n}`)
  return fill(strings?.zone_join_more, { a: joined, n: rest }) ?? `${joined} + ${rest} more`
}

/** `{a}` / `{b}` / `{n}` interpolation. Returns null on a missing pattern so the caller can default. */
function fill(pattern, params) {
  if (!pattern) return null
  return String(pattern).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m))
}

/**
 * ISO-3 → localized country label, from records the caller already has.
 * Built once per render rather than scanned per zone: 2107 records x 28 zones is 59k scans for data
 * that does not change during a render.
 */
export function countryLabelIndex(records) {
  const m = new Map()
  for (const r of records || []) {
    const cc = r?.country_code
    const label = r?.country_code_label
    if (cc && label && !m.has(cc)) m.set(String(cc).toUpperCase(), label)
  }
  return m
}
