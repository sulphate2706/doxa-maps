#!/usr/bin/env node
/**
 * fetch-arclight-share-urls.mjs — get the REAL per-language JESUS Film deep link.
 *
 * THE DEFECT THIS FIXES. We shipped https://www.jesusfilm.org/watch/?languageId=<id> for
 * 2,087 languages. MEASURED IN A BROWSER: the current site ignores that query parameter —
 * a real id and a bogus id render the same generic library page. The film was real and
 * the link did not carry anyone to it.
 *
 * Arclight's media-components endpoint returns a shareUrl per language, and that IS a
 * deep link: /watch/jesus/german-standard. It discriminates, which the old URL never did —
 * a real slug returns ~900KB carrying the media component id `1_jf-0-0` 369 times, a
 * bogus slug returns a 33KB page carrying it 0 times.
 *
 * WHY FETCHED PER LANGUAGE AND NOT DERIVED FROM THE NAME. The slug looks derivable —
 * "Pashto, Southern" -> pashto-southern — and 8 of 8 sampled names transformed correctly.
 * Eight is not 2,087, and a wrong slug is not a broken link but a link to SOMEONE ELSE'S
 * language, which is the failure this repo guards hardest against. The API is
 * authoritative, so it is asked. Rate-limited, resumable, and cached so it is asked once.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const ARC = resolve(REPO, 'data/tables/arclight-index.json')
const OUT = resolve(REPO, 'data/tables/arclight-share-urls.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const JF = '1_jf-0-0'

/**
 * ═══ TWO ARCLIGHT LANGUAGES, ONE ISO CODE — RESOLVED, WITH THE EVIDENCE ═════════════════════
 *
 * This code was SKIPPED, and the note here said resolving it meant deciding whether the ISO code
 * or the publisher's name was authoritative — "a data question for someone who can check it".
 * It has now been checked, against Arclight's own API rather than against an opinion:
 *
 *   media-languages?iso3=jos returns TWO ids
 *     7138    name "Jordanian Sign Language"   JESUS film -> arc.gt/g8wmw
 *     139080  name "Lebanese Sign Language"    (the id the roster file lists under jos)
 *   arc.gt/g8wmw redirects to .../watch/jesus.html/jordanian-sign-language.html — the publisher's
 *   own slug names the language, and a bogus arc.gt code 404s, so it discriminates.
 *
 * ⚠ AND THE OLD NOTE WAS WRONG ON A FACT. It called Lebanese Sign Language "a different language
 * (lbs)". ISO 639-3 lbs is LIBYAN Sign Language; Lebanese Sign Language has no code of its own.
 * So this is not a mis-filing to be corrected upstream — it is two Levantine varieties sharing one
 * code, which ISO does not separate. Nothing here can be "given back" to a Lebanese code, because
 * there is none, and joining 139080 to our lbs would be a NAME match on the wrong country.
 *
 * THE RULE, therefore: where several Arclight ids share an ISO code, take the one whose own NAME
 * agrees with the language this map names for that code, and record the other. The code stays
 * authoritative for the JOIN; the name only breaks a tie the code cannot. Our three jos groups are
 * Jordanian, so they get the Jordanian film and not the Lebanese variety.
 */
const OVERRIDE = {
  jos: { id: 7138, why: 'two Arclight ids carry iso3 jos (7138 Jordanian, 139080 Lebanese); 7138 is the one whose name agrees with this map\'s language for the code, and its shareUrl slug says jordanian-sign-language' },
}
const DELAY = Number(process.env.DELAY_MS || 250)

const arc = JSON.parse(readFileSync(ARC, 'utf8')).codes
const prior = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { codes: {} }
const out = { ...prior.codes }
const entries = Object.entries(arc)
let fetched = 0, cached = 0, missing = 0

for (let i = 0; i < entries.length; i++) {
  const [code, v] = entries[i]
  if (out[code] !== undefined) { cached++; continue }
  /* An override replaces the ROSTER's id, not the result: the shareUrl is still fetched from the
     API for that id, so a wrong override cannot invent a link. */
  const id = OVERRIDE[code] ? OVERRIDE[code].id : v.id
  try {
    const r = await fetch(`https://api.arclight.org/v2/media-components/${JF}/languages/${id}`, { headers: { 'User-Agent': UA } })
    if (r.ok) {
      const d = await r.json()
      // https, always: the API returns http:// and a plain-http link in a field context
      // is a downgrade nobody asked for.
      const u = String(d.shareUrl || '').replace(/^http:\/\//, 'https://')
      if (u) { out[code] = u; fetched++ } else missing++
    } else if (r.status !== 404) {
      /* ONLY A 404 MEANS "THE JESUS COMPONENT HAS NO ENTRY FOR THIS LANGUAGE". A 429, a 500
       * or a blip means we do not know yet, and the fallback below must not run on it.
       * Measured: the first version treated ANY non-ok as "no JESUS Film" and wrote Magdalena
       * over Jordanian Sign Language, which HAS the JESUS Film at arc.gt/g8wmw — a transient
       * failure silently downgrading a language to a different film. Left undefined so the
       * next run retries it. */
      missing++
    } else {
      /* ═══ THE JESUS FILM COMPONENT DOES NOT CARRY EVERY LANGUAGE THE ROSTER COUNTS ═══
       *
       * counts.featureFilm >= 1 says a FEATURE exists in this language. It does not say the
       * feature is JESUS. For five codes this endpoint 404s, and the build was falling back
       * to the retired ?languageId= URL — unverifiable by fetch, and labelled "JESUS Film"
       * on a language the JESUS component has no entry for. Measured 2026-09-25:
       *   ars  Arabic, Najdi     -> The Savior                    (8 groups, film was their ONLY resource)
       *   gjk  Kachi Koli        -> Magdalena — Director's Cut
       *   mzn  Mazanderani       -> Magdalena — Director's Cut
       *   lia  Limba, West-Central -> NO component at all
       *   jos  Jordanian Sign Language -> the JESUS Film after all, at arc.gt/g8wmw
       *
       * So ask what feature this language actually has. A real JESUS Film Project feature in
       * someone's own language is worth shipping — dropping ars would have pushed 8 groups
       * into the gap while a gospel film exists in their language — but it must be shipped
       * UNDER ITS OWN NAME. This bundle already refuses to call Open Bible Stories Scripture;
       * calling The Savior the JESUS Film is the same lie.
       *
       * Same publisher, so the doctrinal screen is unchanged: these are JESUS Film Project
       * features, the catalogue the brief names explicitly. Nothing outside it is taken.
       *
       * `null` is recorded when no feature exists, and the pin build DROPS the film rather
       * than falling back to a URL nobody can check. */
      let alt = null
      try {
        const c = await fetch(`https://api.arclight.org/v2/media-components?languageIds=${id}&limit=25`, { headers: { 'User-Agent': UA } })
        if (c.ok) {
          const cj = await c.json()
          const feature = (cj._embedded?.mediaComponents || []).find((m) => m.subType === 'featureFilm')
          if (feature) {
            const fr = await fetch(`https://api.arclight.org/v2/media-components/${feature.mediaComponentId}/languages/${id}`, { headers: { 'User-Agent': UA } })
            if (fr.ok) {
              const fd = await fr.json()
              const fu = String(fd.shareUrl || '').replace(/^http:\/\//, 'https://')
              if (fu) alt = { u: fu, t: feature.title || feature.mediaComponentId }
            }
          }
        }
      } catch { /* fall through to null */ }
      out[code] = alt
      if (alt) fetched++; else missing++
    }
  } catch { missing++ }
  // The CHECKPOINT write is deliberately unguarded: this script resumes from the existing
  // file as a cache, so `out` starts full and only grows. It cannot shrink, which is the
  // thing the guard exists to catch. The FINAL write below is guarded like every other
  // snapshot.
  // CHECKPOINT-WRITE-OK
  if (fetched % 100 === 0 && fetched) {
    writeFileSync(OUT, JSON.stringify({ _note: 'Per-language JESUS Film deep links (shareUrl) from Arclight media-components. Partial write; rerun to resume.', generated: new Date().toISOString().slice(0, 10), codes: out }))
    console.log(`  ... ${i + 1}/${entries.length}  fetched=${fetched} cached=${cached} missing=${missing}`)
  }
  await new Promise((r) => setTimeout(r, DELAY))
}
writeSnapshot(OUT, JSON.stringify({
  _note: 'Per-language JESUS Film Project deep links (shareUrl) from Arclight media-components. A STRING is the JESUS Film (component 1_jf-0-0). An OBJECT {u,t} is a different JESUS Film Project feature in that language — the JESUS component has no entry for it — and t is the real title, which the surfaces must show instead of "JESUS Film". null means no feature exists and the film is dropped rather than linked to the retired ?languageId= URL, which nothing can verify.',
  generated: new Date().toISOString().slice(0, 10),
  /* COUNTED, NOT NAMED. withShareUrl used to be Object.keys(out).length, which counts the nulls
     and the alternative-feature objects too — so a file holding one null reported every language
     as having a shareUrl, and the previous run reported 2,087 of them while jos was absent
     entirely. Each state is now counted as what it is. */
  stats: {
    languages: entries.length,
    recorded: Object.keys(out).length,
    jesusFilm: Object.values(out).filter((v) => typeof v === 'string').length,
    otherFeature: Object.values(out).filter((v) => v && typeof v === 'object').length,
    noFeature: Object.values(out).filter((v) => v === null).length,
    notAnswered: missing,
  },
  codes: out,
}), (j) => Object.keys(j.codes || {}).length, 'Arclight shareUrl codes')
console.log(`DONE  languages ${entries.length}  JESUS film ${Object.values(out).filter((v) => typeof v === 'string').length}  other feature ${Object.values(out).filter((v) => v && typeof v === 'object').length}  no feature ${Object.values(out).filter((v) => v === null).length}  not answered ${missing}`)
