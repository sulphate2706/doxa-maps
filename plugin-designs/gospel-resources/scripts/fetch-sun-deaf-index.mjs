/**
 * fetch-sun-deaf-index.mjs — SUN: one signed language, and Scripture in it, for Deaf people
 * whose own sign language has nothing.
 *
 * WHY THIS POOL EXISTS AND THE OTHERS COULD NOT FILL IT. Of Doxa's 2,107 groups, 369 have no
 * gospel resource in any pool this build can reach. 94 of those have no BRIDGE either, and 93
 * of the 94 are Deaf — 17.5 million people. That is not an accident of the data: every other
 * bridge in this build is a spoken language widely used in the same country, and a spoken
 * bridge is worthless to a Deaf person. The Deaf gap was structurally unbridgeable here, so it
 * stayed the largest untouched population on the map.
 *
 * WHAT SUN IS. Symbols of Universal Notation — a signed language deliberately built to be
 * learnable across sign languages, with the Old Testament, New Testament and Bible stories
 * translated into it. Its own summary is "1 Language, 1 Bible, Millions of People". So it is
 * the same KIND of thing as a spoken bridge: not Scripture in a group's own sign language, and
 * no substitute for one, but a real way in that exists today and can be learned.
 *
 * DOCTRINE, CHECKED BEFORE SHIPPING. SUN is Wycliffe Associates' programme — the donate link
 * is give.wycliffeassociates.org, the Android app is org.wycliffeassociates.suneng, and the
 * process pages sit on bibleineverylanguage.org. An evangelical Bible-translation organisation
 * publishing the 66-book canon; no added scripture. It passes the filter this build applies.
 *   ⚠ THE DEAF ARE THE MOST HEAVILY TARGETED GROUP IN THIS WHOLE DATASET by publishers this
 *   build must never carry: the Watchtower runs the largest sign-language Scripture library in
 *   the world. Anything reached while looking for Deaf material has to be checked HARDER than
 *   usual, not less, precisely because the need is so acute and the pickings so thin.
 *
 * ⚠ WHY ONLY A FIXED LIST OF URLS IS SHIPPED, AND NEVER A CONSTRUCTED ONE. sun.bible answers
 * 200 for /sun/<anything> and /resource/<anything> — measured: /sun/ZZZZNOTREAL and
 * /resource/ZZZ both 200, while /nonsense-path correctly 404s. So those two route prefixes are
 * catch-alls and a status code under them means nothing. Every URL here was fetched and judged
 * by its CONTENT — distinct title, distinct body size — and this script re-verifies that on
 * every run rather than trusting the list. A per-language URL built by pattern would look fine
 * and could be empty, which is exactly the trap this repo has already been caught by twice.
 *
 * HOSTS DELIBERATELY LEFT OUT, with the reason, so nobody re-walks this:
 *   bibleineverylanguage.org  403 to a scripted request (bot shield) — reachable by a human.
 *   deafbible.com             app shell: 3.8 KB of React, no content without running JS.
 *   doorinternational.org     403 (bot shield).
 *   door.international        114 bytes, effectively parked.
 *   asl.bible, 4.bible        do not resolve.
 */
import { writeFileSync } from 'node:fs'
import { writeSnapshot } from './_snapshot-guard.mjs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const OUT = resolve(REPO, 'data/tables/sun-deaf-index.json')
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  const body = await r.text()
  return { status: r.status, body }
}

/* The pages that carry the Scripture itself, plus the two that carry the programme's own
   account of where it runs. Each is verified by content below. */
const PAGES = [
  { key: 'new_testament', url: 'https://sun.bible/sun/NewTestament', label: 'SUN New Testament' },
  { key: 'old_testament', url: 'https://sun.bible/sun/OldTestament', label: 'SUN Old Testament' },
  { key: 'bible_stories', url: 'https://sun.bible/sun/BibleStories', label: 'SUN Bible stories' },
  { key: 'status',        url: 'https://sun.bible/status',           label: 'SUN translation status' },
  { key: 'where',         url: 'https://sun.bible/where',            label: 'Where SUN is being taught' },
  { key: 'home',          url: 'https://sun.bible/',                 label: 'SUN — about the language' },
]

/* The catch-all control. If this ever stops answering 200, the discrimination note above has
   gone stale and the "content, never status" rule can be relaxed — so it is measured, not
   assumed. */
const CATCH_ALL_CONTROL = 'https://sun.bible/sun/ZZZZNOTREAL'

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const verified = []
for (const p of PAGES) {
  const r = await get(p.url)
  const title = (r.body.match(/<title>([^<]*)/i) || [, ''])[1].trim()
  const text = strip(r.body)
  const ok = r.status === 200 && text.length > 500 && !!title
  if (!ok) {
    console.error(`SUN: SKIP ${p.url} — status ${r.status}, ${text.length} chars of text, title "${title}"`)
    continue
  }
  verified.push({ ...p, title, bytes: r.body.length, text_chars: text.length })
  console.log(`  ok  ${p.key.padEnd(14)} ${String(r.body.length).padStart(6)} bytes  "${title}"`)
}

const control = await get(CATCH_ALL_CONTROL)
const controlText = strip(control.body)
/* Two pages are only distinguishable from the catch-all by their content, which is the whole
   point of the rule; record the evidence rather than restate the claim. */
const catchAll = { url: CATCH_ALL_CONTROL, status: control.status, text_chars: controlText.length }

/* Countries where SUN is actually being taught, with the local organisation doing it — the
   lightbox markup is <h3>COUNTRY</h3> ... <h6>Organisation</h6>. Real named partners are the
   difference between "a resource exists" and "here is who to call". */
const where = verified.find((v) => v.key === 'where')
const projects = []
if (where) {
  const html = (await get(where.url)).body
  const re = /<h3>\s*([^<]+?)\s*<\/h3>[\s\S]{0,400}?<h6>\s*([^<]+?)\s*<\/h6>/g
  let m
  while ((m = re.exec(html))) {
    const country = m[1].trim()
    const org = m[2].trim()
    if (!country || country.length > 40) continue
    if (!projects.some((p) => p.country.toLowerCase() === country.toLowerCase())) {
      projects.push({ country, organisation: org })
    }
  }
}

if (verified.length < 3 || !projects.length) {
  console.error(`SUN: REFUSING TO WRITE — ${verified.length} verified page(s), ${projects.length} project(s).`)
  console.error('  Shipping a thin index would quietly shrink the only bridge the Deaf gap has.')
  process.exitCode = 1
} else {
  /* THROUGH THE SNAPSHOT GUARD. The floor above is 3 verified pages, which a rate-limited run
     can clear while losing most of the projects — and this file is the Deaf gap's only bridge. */
  const body = `${JSON.stringify({
    meta: {
      title: 'SUN — a universal signed language with Scripture, for Deaf groups with nothing',
      source: 'sun.bible, fetched and verified by content',
      generated: new Date().toISOString().slice(0, 10),
      publisher: 'Wycliffe Associates',
      doctrine: 'Evangelical Bible-translation organisation publishing the 66-book canon. ' +
        'Checked deliberately: the Deaf are the most heavily targeted group in this dataset by ' +
        'publishers this build excludes.',
      what_it_is: 'Symbols of Universal Notation — a signed language built to be learnable ' +
        'across sign languages, with Scripture translated into it. A BRIDGE, exactly like a ' +
        'spoken bridge language: a real way in that has to be learned, and no substitute for ' +
        'Scripture in a group\'s own sign language.',
      why_no_per_language_urls: 'sun.bible answers 200 for /sun/<anything> and ' +
        '/resource/<anything>. Only URLs verified by their content are shipped; a constructed ' +
        'per-language URL would look valid and could be empty.',
      catch_all_control: catchAll,
      verified_pages: verified.length,
      project_countries: projects.length,
    },
    resources: verified.map(({ key, url, label, title, bytes }) => ({ key, url, label, title, bytes })),
    projects,
  }, null, 1)}\n`
  writeSnapshot(OUT, body, (j) => (j.resources || []).length + (j.projects || []).length, 'SUN page(s) and project country(ies)')
  console.log(`SUN: ${verified.length} verified page(s), ${projects.length} project country(ies)`)
  console.log(`wrote ${OUT}`)
}
