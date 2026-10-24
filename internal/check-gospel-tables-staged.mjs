#!/usr/bin/env node
/**
 * check-gospel-tables-staged — every table the gospel map fetches is actually in the shipped tree.
 *
 * WHY THIS IS NOT check-dev-assets. That gate owns the question "does the asset pool resolve at
 * every prefix a dev page can produce", across all seven map bundles, and it does it better than
 * the gospel-only version this replaces — it tests the /__leaf/<bundle>/<profile> prefix, which
 * is the one that actually broke, and which mine never looked at. One implementation.
 *
 * What it samples, though, is the POOL: world-adm0 and country-connectivity, the files common to
 * every map. It cannot know that this leaf also fetches four gospel tables by name, so a table
 * that stopped being staged would leave that gate green and this map fetching a 404. That is the
 * only gap left once the duplicate is gone, so this covers exactly it and nothing else.
 *
 * Read from the SOURCE OF TRUTH rather than a second list: the fetch() calls in resources-map.vue
 * are parsed out of the file, so adding a table to the leaf adds it here with no edit. A list
 * maintained by hand is the field-list-goes-stale bug, which this bundle has now produced three
 * times in one day.
 *
 * Headless, filesystem only. No server, no browser.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEAF = resolve(ROOT, 'plugin-designs/gospel-resources/resources-map.vue')
const POOL = resolve(ROOT, 'public', TREE_NAME, 'assets')

const src = readFileSync(LEAF, 'utf8')
/* `${assetsBase.value}/tables/x.json` and `${assetsBase.value}/boundaries/y.geojson` */
const wanted = [...new Set(
  [...src.matchAll(/\$\{assetsBase\.value\}\/([A-Za-z0-9_\-./]+)/g)].map((m) => m[1]),
)]

if (!wanted.length) {
  console.error('GOSPEL-TABLES-STAGED: NOT MEASURED — no asset fetches found in resources-map.vue.')
  console.error('  The leaf changed shape; this check would pass vacuously, which is worse than failing.')
  process.exit(2)
}

/**
 * ⚠ A DYNAMIC FETCH RESOLVES TO A DIRECTORY, AND A DIRECTORY ALWAYS EXISTS.
 * The province layer fetches `${assetsBase}/boundaries/${PROVINCE_FILE[iso3]}`, so the parse
 * above captures the literal prefix "boundaries/" and stops at the interpolation. That path is
 * a real directory of 4,096 bytes, so it passed — proving nothing about the two files the map
 * actually asks for. A check that cannot fail is the thing this repo keeps rediscovering.
 * So a directory is never accepted as an asset, and any literal asset FILENAME mentioned in the
 * leaf is checked on its own. That covers the interpolated case without trying to evaluate it.
 */
const dirLike = wanted.filter((r) => r.endsWith('/'))
const named = [...new Set(
  [...src.matchAll(/['"`]([A-Za-z0-9_\-]+\.(?:geojson|json))['"`]/g)].map((m) => m[1]),
)]
/* ⚠ AND THE EXPANSION MUST NOT CONSULT THE FILESYSTEM TO DECIDE WHAT TO EXPECT.
 * The first version only added a name if the file already existed, so deleting one simply
 * removed it from the list and the gate went green on nine assets instead of ten. Proven by
 * unstaging gb-CHN-ADM1.geojson: PASS, exit 0. The expectation has to come from the SOURCE —
 * the filenames the leaf names — so that a file the leaf asks for and the tree lacks is a
 * failure rather than a shorter list. */
for (const prefix of dirLike) {
  const ext = /boundaries\//.test(prefix) ? '.geojson' : '.json'
  for (const file of named.filter((f) => f.endsWith(ext))) wanted.push(prefix + file)
}

/**
 * ⚠ AN INTERPOLATED FILE NAME IS NOT A FILE EITHER. The field card fetches
 * `${assetsBase.value}/tables/card-${cardShard(cardSlug)}.json`, so the parse above captures "tables/card-" and
 * stops at the interpolation; read as a file it failed as "not staged" while all its shards were there. Its
 * expected set comes from the SOURCE, as the rule above says, never from the tree: every roster row the card
 * builder keeps (data/tables/doxa-people-groups.json, the same filter as build-field-cards.mjs) hashed with the
 * leaf's own cardShard. This file carries a copy of that function and fails if the leaf's copy changes, so the
 * two cannot drift apart; any other interpolated name is reported as unresolved, never passed.
 */
const SHARD_FN = 'let h = 5381 for (let i = 0; i < slug.length; i++) h = (((h << 5) + h) ^ slug.charCodeAt(i)) & 0xffffffff return ((h >>> 0) & 0xff).toString(16).padStart(2, \'0\')'
const cardShard = (slug) => {
  let h = 5381
  for (let i = 0; i < slug.length; i++) h = (((h << 5) + h) ^ slug.charCodeAt(i)) & 0xffffffff
  return ((h >>> 0) & 0xff).toString(16).padStart(2, '0')
}
function checkInterpolatedName(rel, missing) {
  if (rel !== 'tables/card-') { missing.push(`${rel} — an interpolated file name this check cannot resolve`); return }
  const leafFn = (src.match(/const cardShard = \(slug\) => \{([\s\S]*?)\n\}/) || [])[1]
  if (!leafFn || leafFn.replace(/\s+/g, ' ').trim() !== SHARD_FN) {
    missing.push('tables/card-*.json — the leaf\'s cardShard changed; update this check\'s copy (and build-field-cards.mjs) to match')
    return
  }
  let rows = []
  try { rows = JSON.parse(readFileSync(resolve(ROOT, 'data/tables/doxa-people-groups.json'), 'utf8')).rows || [] }
  catch (e) { missing.push(`tables/card-*.json — could not read the roster: ${e.message}`); return }
  const keys = [...new Set(rows.filter((r) => r && r.slug && r.mapped && r.lat != null && r.lng != null).map((r) => cardShard(r.slug)))].sort()
  if (keys.length < 20) { missing.push(`tables/card-*.json — the roster gave only ${keys.length} shard key(s); the roster changed shape`); return }
  let ok = 0, bytes = 0
  for (const k of keys) {
    const p = resolve(POOL, `tables/card-${k}.json`)
    if (!existsSync(p)) { missing.push(`tables/card-${k}.json — not staged`); continue }
    const b = statSync(p).size
    if (b < 200) { missing.push(`tables/card-${k}.json — staged but only ${b} bytes`); continue }
    ok++; bytes += b
  }
  console.log(`  ${ok === keys.length ? 'ok  ' : 'FAIL'} ${'tables/card-*.json'.padEnd(42)} ${ok}/${keys.length} shard(s) the roster needs, ${bytes} bytes`)
}

const missing = []
for (const rel of wanted) {
  if (rel.endsWith('/')) {
    /* Counted, not silently skipped: if the expansion above found nothing for this prefix the
       reader must know the interpolated fetch went unverified. */
    const found = wanted.filter((w) => w !== rel && w.startsWith(rel))
    if (!found.length) missing.push(`${rel} — a dynamic fetch this check could not resolve to a file`)
    continue
  }
  if (!/\.(?:geojson|json)$/.test(rel)) { checkInterpolatedName(rel, missing); continue }
  const p = resolve(POOL, rel)
  if (!existsSync(p)) { missing.push(`${rel} — not staged`); continue }
  const bytes = statSync(p).size
  /* A staged-but-empty file is the same outage with a friendlier face. */
  if (bytes < 200) { missing.push(`${rel} — staged but only ${bytes} bytes`); continue }
  console.log(`  ok   ${rel.padEnd(42)} ${String(bytes).padStart(9)} bytes`)
}

/* ★ THE MAP AND THE TABLE MUST READ THE SAME GEOMETRY (2026-09-26). The province layer is
   coloured in the leaf and counted by scripts/build-gospel-by-province.mjs, from two independent
   mentions of the same filenames — so a change to one silently draws provinces that disagree with
   the rows describing them. It already happened in the other direction: both read
   gb-IND-ADM1.geojson, the UPG-100 list's curated 34-unit partition, when what this table means
   by "province" is a state. Staging alone cannot catch it; both files are staged. */
const boundaryMentions = (src, re) => [...src.matchAll(re)].map((m) => m[m.length - 1]).sort()
try {
  const leafSrc = readFileSync(LEAF, 'utf8')
  const buildSrc = readFileSync(resolve(ROOT, 'plugin-designs/gospel-resources/scripts/build-gospel-by-province.mjs'), 'utf8')
  const inLeaf = boundaryMentions(leafSrc, /(?:IND|CHN): '(gb-[A-Z]{3}-ADM1[^']*\.geojson)'/g)
  const inBuild = boundaryMentions(buildSrc, /file: '(gb-[A-Z]{3}-ADM1[^']*\.geojson)'/g)
  if (!inLeaf.length || !inBuild.length) missing.push('province boundary filenames not found in the leaf or the builder — this arm would pass vacuously')
  else if (JSON.stringify(inLeaf) !== JSON.stringify(inBuild)) {
    missing.push(`the map draws provinces from [${inLeaf.join(', ')}] while the table counts them from [${inBuild.join(', ')}]`)
  } else console.log(`  ok   province geometry agrees             ${inLeaf.join(', ')}`)
} catch (e) { missing.push(`could not compare province geometry: ${e.message}`) }

if (missing.length) {
  console.error(`GOSPEL-TABLES-STAGED: FAIL — ${missing.length} of ${wanted.length} asset(s) the map fetches are not in the tree:`)
  for (const m of missing) console.error(`  ${m}`)
  console.error(`  Looked under public/${TREE_NAME}/assets. Run \`bun run tree\` after building this bundle.`)
  process.exitCode = 1
} else {
  console.log(`GOSPEL-TABLES-STAGED: PASS — all ${wanted.length} asset(s) resources-map.vue fetches are staged.`)
}
