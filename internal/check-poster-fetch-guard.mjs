#!/usr/bin/env node
// check-poster-fetch-guard — a host's fallback page is never taken for a poster.
//
// ★ THE DEFECT (2026-09-29). On a drop-in host's dev server (Nuxt) a missing posters/<id>.webp
// answered 200 text/html (the app's own page), and export accepted it as the poster: a
// broken image in the print dialog. The .html source path had the same hole, where the
// rasteriser lifts whatever <svg> the page holds. library/packet/poster-fetch.js now takes a
// raster only if it is an image, and a source only if it is a poster document.
//
// Two halves:
//   1. the helper, against fake responses: every accept and every refusal;
//   2. the callers: usePosterPrints and PosterWall each carried their own copy of this fetch,
//      and a guard in one did not reach the other. Neither may fetch posters/ directly again.
// Node only: starts nothing. Exit 0 pass, 1 fail.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchPosterRaster, fetchPosterSource } from '../library/packet/poster-fetch.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fails = []
const check = (ok, what) => { if (!ok) fails.push(what) }

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
const APP_PAGE = '<!doctype html><html><body><svg><path d="M0 0"/></svg>app</body></html>'
const SOURCE = '<!doctype html><html><body><div class="stage"><svg></svg></div></body></html>'
const answer = (body, type, status = 200) => async () => new Response(body, { status, headers: type ? { 'content-type': type } : {} })

check(await fetchPosterRaster('x.webp', answer(WEBP, 'image/webp')) instanceof Blob, 'a real WebP is accepted')
check(await fetchPosterRaster('x.webp', answer(APP_PAGE, 'text/html; charset=utf-8')) === null, "a host's 200 fallback page is refused as a raster")
check(await fetchPosterRaster('x.webp', answer(WEBP, 'application/octet-stream')) instanceof Blob, 'a WebP labelled octet-stream is accepted by its bytes')
check(await fetchPosterRaster('x.webp', answer(APP_PAGE, 'application/octet-stream')) === null, 'HTML labelled octet-stream is refused')
check(await fetchPosterRaster('x.webp', answer('', 'text/plain', 404)) === null, 'a 404 is a miss')
check(await fetchPosterRaster('x.webp', async () => { throw new Error('offline') }) === null, 'a network error is a miss')
check((await fetchPosterSource('x.html', answer(SOURCE, 'text/html'))).html === SOURCE, 'a poster source is accepted')
const fallback = await fetchPosterSource('x.html', answer(APP_PAGE, 'text/html'))
check(fallback.html === null && fallback.status === 404, "a host's 200 fallback page is refused as a source, as 404")
check((await fetchPosterSource('x.html', answer('', 'text/plain', 404))).status === 404, 'a missing source reports 404')
check(await fetchPosterSource('x.html', async () => { throw new Error('offline') }).then(() => false, (e) => e.message === 'offline'),
  'a network error on the source is thrown as itself, not reported as "not found"')

// No caller fetches posters/ directly: every poster fetch goes through the helper.
for (const rel of ['library/composables/usePosterPrints.js', 'library/components/poster/PosterWall.vue', 'library/components/poster/PosterSection.vue', 'library/components/poster/PosterSectionView.vue']) {
  const src = readFileSync(join(REPO, rel), 'utf8')
  const direct = src.split('\n').filter((l) => /fetch\([^)]*posters\/[^)]*\.(webp|html)/.test(l) && !l.trim().startsWith('//'))
  check(direct.length === 0, `${rel} fetches a poster directly instead of through poster-fetch.js: ${direct.map((l) => l.trim()).join(' | ')}`)
}

if (fails.length) {
  console.error(`POSTER-FETCH-GUARD: FAIL — ${fails.length} check(s)`)
  for (const f of fails) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('POSTER-FETCH-GUARD: PASS — rasters must be images, sources must be poster documents, and every caller goes through poster-fetch.js')
