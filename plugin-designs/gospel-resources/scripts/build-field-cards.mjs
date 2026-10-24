/**
 * build-field-cards.mjs — one small file per people group, for the catalyst standing with them.
 *
 * WHY. Seeing ONE group's links cost the whole map: the engine, the world boundaries, the basemap
 * tiles and the 2.3 MB pin index, all before a single link appeared. On field data that is the
 * difference between a usable tool and a picture of one. The card view fetches one shard instead.
 *
 * SHARDED BY THE FIRST TWO LETTERS OF THE SLUG, not one file per group: 2,107 files would be 2,107
 * git objects and 2,107 staged assets for no reader benefit, while a shard is ~10 KB — small enough
 * that the saving over the pin index is three orders of magnitude either way. Keyed by doxa.life's
 * own slug, which is what the share link carries.
 *
 * ⚠ THE FIELD NAMES MIRROR groupAt() IN resources-map.vue EXACTLY. The card renders through the
 * same sheet markup as a tapped pin, so any rename here silently empties a panel there rather than
 * failing loudly. No new data is invented: every value comes from the pin index, the roster or the
 * verification record, and no URL is constructed.
 */
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')
const T = (f) => JSON.parse(readFileSync(resolve(REPO, 'data/tables', f), 'utf8'))
/* ⚠ FLAT FILENAMES, NOT A SUBDIRECTORY. internal/generate-tree.mjs stages data/tables/*.json as
   FILES and throws EISDIR on a directory (measured), and that stager is shared build machinery, not
   mine to change for one plugin. So a shard is data/tables/card-<key>.json — one namespace, no
   change to anything shared, and the same one-request fetch. */
const OUT = (key) => resolve(REPO, 'data/tables', `card-${key}.json`)

const idx = T('people-group-pins.json')
const codes = idx.codes || {}
const tiers = idx.tiers || {}
const bridges = idx.bridges || {}
const cands = idx.bridgeCandidates || {}
const sun = idx.sun || {}
const roster = T('doxa-people-groups.json').rows || []
let verif = {}
try { verif = T('gospel-link-verification.json').links || {} } catch { /* state simply absent */ }

const isDeaf = (code, name) => {
  const c = codes[code]
  return !!((c && c.sg === 1) || /sign language/i.test((c && c.l) || '') || /\bDeaf\b/i.test(name || ''))
}
/* Verification state travels with the card: in the field, "this link was checked" is worth as much
   as the link. Only the state, never a re-derivation of it. */
const state = (u) => (u && verif[u] ? verif[u].state : undefined)

/* ═══ SHARDED BY A STABLE HASH, NOT BY THE FIRST LETTERS ══════════════════════════════════════
 * First two letters gave a mean shard of 11 KB and a largest of 120 KB: every "Deaf <people>" lands
 * in "de". Three letters left 110 KB, because those slugs all begin "dea" — measured, not assumed,
 * which is the only reason that was not shipped as the fix. An iterative split worked but left the
 * leaf unable to know a slug's shard without an index or several requests.
 * djb2 over the slug, low byte in hex, gives 256 even buckets the LEAF CAN RECOMPUTE — one request,
 * no index, no hot shard. The identical function lives in resources-map.vue; if either changes, the
 * card 404s loudly rather than serving the wrong group.
 */
const shardKey = (slug) => {
  let h = 5381
  for (let i = 0; i < slug.length; i++) h = (((h << 5) + h) ^ slug.charCodeAt(i)) & 0xffffffff
  return ((h >>> 0) & 0xff).toString(16).padStart(2, '0')
}

/* ═══ THE BRIDGE'S OWN LINKS TRAVEL WITH THE CARD ═════════════════════════════════════════════
 * In card mode the pin index is never fetched, so resources-map's bridgeResources() finds nothing
 * and a tier-0 card would name a way in with no way to follow it — the one thing that group's card
 * exists to give. Derived here exactly as the leaf derives it, including the FCBH text fallback,
 * because a group's readable Scripture is sometimes only on the audio record.
 */
const bridgeRes = (bb) => {
  if (!bb || !bb.c) return null
  const c = codes[bb.c]
  if (!c) return null
  const fcbhText = c.au && /text/.test(c.au.m || '') ? c.au : null
  return {
    iso: bb.c,
    language: c.l || bb.l || '',
    credit: c.cr || null,
    scripture_url: c.s || (fcbhText ? fcbhText.u : ''),
    scripture_title: c.sv || (fcbhText ? fcbhText.n : ''),
    film_url: c.f || '',
    film_title: c.fT || '',
    zume_url: c.z || '',
  }
}

const cards = new Map()
let withLink = 0, none = 0
for (const r of roster) {
  if (!r.slug || !r.mapped || r.lat == null || r.lng == null) continue
  const code = r.iso639_3 || ''
  const c = codes[code] || {}
  const tier = tiers[code] ?? r.tier ?? 0
  /* ═══ RAW INPUTS, NOT A HAND-MIRRORED OBJECT ════════════════════════════════════════════════
   * This used to copy groupAt()'s 39 fields by hand and missed `door43`, which exists only in that
   * normalizer — the sheet's `!selectedGroup.door43.length` then threw and every card rendered
   * blank. The leaf's groupFrom() is now the single normalizer for both paths, so the shard ships
   * what the map itself holds: the pin row, the code record, the country name and the two bridge
   * records. A field added to the sheet reaches the card with no edit here.
   *
   * The code record is passed WHOLE rather than picked over. It is the same object the map already
   * downloads for this language, and picking fields is exactly the mistake above.
   */
  const card = {
    row: [r.name, r.lat, r.lng, r.iso3, code, r.population || 0, tier, r.slug],
    c,
    country: r.country || r.iso3,
    bridge: bridges[`${code}|${r.iso3}`] || null,
    bridge_candidate: cands[`${code}|${r.iso3}`] || null,
    pray_url: r.pray_url || '',
    /* The bridge's own links: in card mode the pin index is never fetched, so bridgeResources()
       has no pinCodes to look them up in. Same derivation, shipped alongside. */
    _cardRes: {
      bridge: bridgeRes(bridges[`${code}|${r.iso3}`]),
      candidate: bridgeRes(cands[`${code}|${r.iso3}`]),
      alt: bridgeRes((cands[`${code}|${r.iso3}`] || {}).alt),
    },
    /* ⚠ EVERY CHIP READ "unchecked" IN CARD MODE, and that understates the work: these links ARE
       verified, but the state lives in gospel-link-verification.json which the card never fetches.
       It showed on central-sama, whose Scripture and film are both verified. The states for
       THIS group's own URLs ship with it — the state only, never a re-derivation — keyed by URL
       exactly as linkVerify is, so the sheet's existing vchip()/vtitle() work unchanged. */
    verified: (() => {
      const urls = [c.s, c.f, c.z, c.au && c.au.u, c.bv && c.bv.u, c.gp && c.gp.u, c.ga && c.ga.u,
        c.se && (c.se.u || c.se), c.sx && c.sx.u, ...(c.d || []).map((d) => d.u)]
      const out = {}
      for (const u of urls) if (u && verif[u]) out[u] = verif[u]
      return out
    })(),
    /* A Deaf group with nothing is offered SUN, exactly as the map offers it. */
    sun: tier === 0 && isDeaf(code, r.name) && sun.scripture ? { u: sun.scripture.u, t: sun.scripture.t || '' } : null,
  }
  if (tier === 0) none++; else withLink++
  const key = shardKey(r.slug)
  if (!cards.has(key)) cards.set(key, {})
  cards.get(key)[r.slug] = card
}

if (cards.size < 20) { console.error(`FIELD-CARDS: REFUSING TO WRITE — only ${cards.size} shard(s); the roster changed shape.`); process.exit(1) }
/* Stale shards from a previous roster must go, or a deleted group keeps answering. */
for (const f of readdirSync(resolve(REPO, 'data/tables'))) if (/^card-[0-9a-f]{2}\.json$/.test(f)) rmSync(resolve(REPO, 'data/tables', f))
let bytes = 0, groups = 0
for (const [key, obj] of cards) {
  const body = `${JSON.stringify(obj)}\n`
  bytes += body.length
  groups += Object.keys(obj).length
  writeFileSync(OUT(key), body)
}
const mean = Math.round(bytes / cards.size)
console.log(`field-cards: ${groups} group(s) in ${cards.size} shard(s), ${Math.round(bytes / 1024)} KB total, mean shard ${mean} B, largest ${Math.max(...[...cards.values()].map((o) => JSON.stringify(o).length))} B`)
console.log(`  ${withLink} with something in their own language, ${none} with nothing (shown honestly, with the way in)`)
