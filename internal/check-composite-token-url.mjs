#!/usr/bin/env node
/**
 * check-composite-token-url — a pane composite must honour `tokenUrl`, not only `tk`.
 *
 * THE DEFECT (PM-tok, PRODUCTION-MATRIX.md:285). `tokenUrl` names a token SERVICE the element asks when
 * it was handed no key. Only ProfileLoader read it. A composite bakes its children in instead of mounting
 * them through ProfileLoader, so a composite embedded BARE — one tag on a partner's page, the entire
 * point of a composite — dropped a tokenUrl-only config: no token, "No Mapbox access token provided",
 * 0 tiles, no canvas. With an outer ProfileLoader on the page it worked, because THAT fetched and
 * published the token, so the composite was passing an exam somebody else sat.
 *
 * ★ THE EXPECTATION COMES FROM ProfileLoader, NOT FROM THE COMPOSITES. A gate that reads the files it
 * audits to decide what they should contain passes by construction (COMMON.md, twice). ProfileLoader is
 * the contract a composite REPLACES, so this reads ProfileLoader for the rule — that a tokenUrl exists
 * and is fetched only when no token is at hand — and then requires each composite to meet it. If
 * ProfileLoader ever stops doing this, that is a finding here rather than a silent green.
 *
 * ★ WHICH COMPOSITES, DEFINED BY A PROPERTY rather than a list: a bundle that already forwards the host's
 * `tk` to a baked-in child, at production stage. See the comment at the scan below.
 *
 * Source-level and headless BY DESIGN: the behavioural twin (check:composite-embed-knobs) needs a
 * browser, and this gate runs without one. Exit 0 pass · 1 fail.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = 'COMPOSITE-TOKEN-URL'
const fails = []

// ── the rule, read off the contract ────────────────────────────────────────────────────────────
const loader = readFileSync(join(ROOT, 'library/ProfileLoader.vue'), 'utf8')
// \b on BOTH sides: a bare /tokenUrl/ also matches `tokenUrlX`, so this check could not see the
// contract being renamed out from under it — caught by its own negative test, which is the only reason
// anybody would ever notice a guard that cannot fail.
if (!/\btokenUrl\b/.test(loader)) {
  fails.push('library/ProfileLoader.vue no longer mentions tokenUrl — the contract this gate derives from '
    + 'has moved. Re-read it before trusting anything below.')
}
if (!/fetchMapToken\s*\(/.test(loader)) {
  fails.push('ProfileLoader no longer calls fetchMapToken — the rule changed shape; re-derive this gate.')
}

// ── the decision itself, exercised rather than grepped ─────────────────────────────────────────
const { shouldFetchTokenUrl, readHostTokenUrl } =
  await import(resolve(ROOT, 'library/composables/host-token-url.js'))
const dec = [
  ['a tokenUrl and nothing else -> ask', { tokenUrl: 'https://t.example/token' }, true],
  ['the host pasted a key -> do NOT ask', { tokenUrl: 'https://t.example/token', token: 'pk.aaa' }, false],
  ['the page already published one -> do NOT ask', { tokenUrl: 'https://t.example/token', sharedToken: 'pk.bbb' }, false],
  ['no tokenUrl -> nothing to ask', {}, false],
]
for (const [name, input, want] of dec) {
  if (shouldFetchTokenUrl(input) !== want) fails.push(`shouldFetchTokenUrl: ${name}`)
}
if (readHostTokenUrl({ tokenUrl: 'https://t.example/t' }) !== 'https://t.example/t') fails.push('readHostTokenUrl drops a real URL')
for (const bad of [{ tokenUrl: 5 }, { tokenUrl: '' }, {}, null, undefined]) {
  if (readHostTokenUrl(bad) !== '') fails.push(`readHostTokenUrl should ignore ${JSON.stringify(bad)} — a non-string is not a URL`)
}

// ── and every composite must be wired to it ────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/dx-maps/manifest.json'), 'utf8'))
// ★ WHICH FILES, DEFINED BY A PROPERTY RATHER THAN A LIST. A composite in scope here is one that already
// forwards the host's KEY to a baked-in child — `tk: hostToken` — because the rule is simply "if you
// forward a token, forward the token SERVICE too". Deriving it that way means a third composite is
// covered the day it is written, and it cannot be skipped by forgetting to add a name here.
//
// ★ AND STAGE COMES FROM THE MANIFEST, NOT FROM AN EXEMPTION LIST. stack-demo has the same shape and is
// stage=experimental: no partner embeds it, so a tokenless map there costs a demo, not a customer. It is
// excluded by its STAGE, so promoting it to production pulls it into this gate automatically — which is
// the one moment anybody would otherwise forget.
const composites = []
for (const b of manifest.bundles || []) {
  if (b.stage !== 'production') continue
  const p = join(ROOT, 'plugin-designs', b.bundle, `${b.bundle}.vue`)
  if (!existsSync(p)) continue
  const src = readFileSync(p, 'utf8')
  if (/tk:\s*hostToken\.value/.test(src)) composites.push([`${b.bundle}.vue`, src])
}
if (composites.length < 2) {
  fails.push(`expected at least the two known production pane composites, found ${composites.length} — the `
    + 'detection stopped matching and this gate would pass while checking nothing.')
}
for (const [name, src] of composites) {
  if (!/useHostTokenUrl\s*\(/.test(src)) {
    fails.push(`${name} forwards the host's tk but never calls useHostTokenUrl(), so a bare embed with a `
      + 'tokenUrl-only config gets no token at all')
  }
  if (!/tokenUrl:\s*hostTokenUrl\.value/.test(src)) {
    fails.push(`${name} does not forward tokenUrl into its children's profile-config, so a child that `
      + "outlives the composite's fetch cannot ask for itself")
  }
}

if (fails.length) {
  console.error(`${TAG}: FAIL`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${TAG}: PASS — ${composites.length} composites read tokenUrl and forward it, and the service is asked only when no token is already at hand.`)
