#!/usr/bin/env node
/**
 * check-country-map-refetch — the country map refetches when the LANGUAGE or the COUNTRY changes,
 * and not when anything else does; only the newest request may write; and the wait is visible.
 *
 * ★ THE BUGS THIS GUARDS, all three measured on country-map/country-map (production: DX Life's
 * country pages), 2026-09-29.
 *
 * 1. ANY profile-config change refetched all 2,106 records. The watch getter returned a new ARRAY
 *    literal and Vue compares a watch value with Object.is, so a fresh array always reads as
 *    changed; both computeds read the injected cfg, so the effect re-ran on every config change and
 *    the callback then fired unconditionally. MEASURED with real Vue: flipping isDark refetched,
 *    and so did a host adding pinHint. Latent waste until the composite re-forward made config
 *    writes routine -- then it fired on every locale switch upstream.
 * 2. A SLOW EARLIER RESPONSE OVERWROTE A NEWER ONE. loadPoints is async with no sequencing (0 abort
 *    or generation tokens in the file), so two in-flight runs both assigned points and the one that
 *    started first could finish last. The map then showed the PREVIOUS country's pins, with no
 *    error and nothing for the reader to notice.
 * 3. `loading` WAS WRITE-ONLY: assigned in three places, read in none, zero template references.
 *    The reader waited on an empty map -- no outline, no pins, no message -- which is
 *    indistinguishable from a country that genuinely has no people groups.
 *
 * ★ IT DRIVES THE REAL REACTIVE CHAIN WITH REAL VUE, not a re-typed copy: the same injected-cfg
 * computed, the same countryCodes/languageCode computeds, and the WATCH EXPRESSION READ OUT OF THE
 * SHIPPED SFC. A hand-copied watch would pass forever while the component drifted, and a test that
 * faked reactivity could not see bug 1 at all -- it is entirely a question of what Vue considers
 * changed.
 *
 * Exit 0 pass · 1 fail · 2 the watch could not be found in the SFC (never a silent pass).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref, computed, watch, nextTick } from 'vue'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'plugin-designs/country-map/country-map.vue')
const src = readFileSync(SRC, 'utf8')

let bad = 0
const ok = (cond, what) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`) }

// ── THE WATCH KEY, taken from the shipped file ───────────────────────────────
// Lazy, and NOT [^,]+ -- the key expression legitimately contains a comma (join(',')), which is
// what made a comma-excluding pattern report NOT MEASURED on a correct file.
const m = src.match(/watch\(\s*\(\)\s*=>\s*(.+?),\s*loadPoints\s*\)/s)
if (!m) {
  console.error('COUNTRY-MAP-REFETCH: NOT MEASURED — the watch(() => …, loadPoints) call was not found.')
  console.error('  It may have been renamed or restructured. Point this gate at it rather than deleting it:')
  console.error('  an unkeyed refetch is how this shipped the first time.')
  process.exit(2)
}
const keyExpr = m[1].trim()

// ── 1. ONLY A REAL CHANGE REFETCHES ──────────────────────────────────────────
{
  const raw = ref(JSON.stringify({ countryCodes: ['SDN'], languageCode: 'en', isDark: false }))
  const cfg = computed(() => { try { return JSON.parse(raw.value) || {} } catch { return {} } })
  const countryCodes = computed(() => {
    const v = cfg.value.countryCodes
    if (Array.isArray(v)) return v.filter(Boolean).map((c) => String(c).toUpperCase())
    if (typeof v === 'string') return v.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
    return []
  })
  const languageCode = computed(() => cfg.value.languageCode || cfg.value.locale || cfg.value.lang || 'en')

  // The SHIPPED expression, evaluated against those computeds.
  const getKey = new Function('languageCode', 'countryCodes', `return () => (${keyExpr})`)(languageCode, countryCodes)
  let fetches = 0
  watch(getKey, () => { fetches++ })
  await nextTick()

  const set = async (o) => { raw.value = JSON.stringify(o); await nextTick() }

  let n = fetches
  await set({ countryCodes: ['SDN'], languageCode: 'en', isDark: true })
  ok(fetches === n, `an unrelated key (isDark) does NOT refetch (${fetches - n} refetch(es)) — the 2,106-record bug`)

  n = fetches
  await set({ countryCodes: ['SDN'], languageCode: 'en', isDark: true, pinHint: false })
  ok(fetches === n, `an added unrelated key (pinHint) does NOT refetch (${fetches - n})`)

  n = fetches
  await set({ countryCodes: ['SDN'], languageCode: 'ar', isDark: true, pinHint: false })
  ok(fetches === n + 1, `a REAL locale change DOES refetch (${fetches - n}) — the API localises the names`)

  n = fetches
  await set({ countryCodes: ['TCD'], languageCode: 'ar', isDark: true, pinHint: false })
  ok(fetches === n + 1, `a REAL country change DOES refetch (${fetches - n})`)

  n = fetches
  await set({ countryCodes: ['TCD'], languageCode: 'ar', isDark: false, pinHint: false })
  ok(fetches === n, `flipping isDark back does NOT refetch (${fetches - n})`)

  // Equal-but-reordered is a genuine change of the list, so it may refetch; equal-and-identical must not.
  n = fetches
  await set({ countryCodes: ['TCD'], languageCode: 'ar', isDark: false, pinHint: false, extra: 1 })
  ok(fetches === n, `an unrelated key added mid-session does NOT refetch (${fetches - n})`)
}

// ── 2. ONLY THE NEWEST REQUEST WRITES ────────────────────────────────────────
// The shipped guard is a generation counter; this asserts the PROPERTY, driving two overlapping
// runs whose responses land out of order.
{
  ok(/let runId = 0/.test(src) && /const mine = \+\+runId/.test(src),
    'loadPoints takes a generation ticket')
  // ★ POSITIONAL, NOT A BARE GREP. This first read `/if \(!current\(\)\) return/` anywhere in the
  // file -- and there are TWO such guards, one before the points write and one in the catch. A
  // mutation that removed ONLY the points guard still matched the catch one, so the gate passed on
  // the reintroduced race. Found by mutation-testing this gate, which is the whole reason to do it.
  // The guard must sit immediately before the assignment it protects.
  ok(/if \(!current\(\)\) return\s*\n\s*points\.value = /.test(src),
    'the staleness guard sits immediately before the points write')
  ok(/catch \(error\) \{\s*\n\s*if \(!current\(\)\) return/.test(src),
    'and a stale FAILURE does not raise loadFailed on the current run')
  ok(/if \(current\(\)\) loading\.value = false/.test(src),
    'a stale run does not clear the spinner the current one is still using')

  // Behavioural: reproduce the guard's shape and prove out-of-order cannot win.
  let runId = 0
  let points = 'none'
  const load = async (label, delay) => {
    const mine = ++runId
    const current = () => mine === runId
    await new Promise((r) => setTimeout(r, delay))
    if (!current()) return
    points = label
  }
  const slowFirst = load('OLD-country', 40)   // started first, finishes last
  const fastSecond = load('NEW-country', 5)
  await Promise.all([slowFirst, fastSecond])
  ok(points === 'NEW-country',
    `the response that STARTED first and FINISHED last does not win (points = ${points})`)
}

// ── 3. THE WAIT IS VISIBLE ───────────────────────────────────────────────────
{
  const tpl = src.slice(src.indexOf('<template>'))
  ok(/v-if="loading"/.test(tpl), '`loading` is rendered, not write-only')
  ok(/t\('Loading results\.\.\.'\)/.test(tpl),
    'it uses the catalogue string that already exists in all eleven locales')
  ok(/v-else-if="loadFailed"/.test(tpl),
    'the failure message is else-if, so a reader never sees "loading" and "failed" at once')
  const assigns = (src.match(/loading\.value = /g) || []).length
  ok(assigns >= 2, `loading is still actually driven (${assigns} assignment(s))`)
}

if (bad) {
  console.error(`\nCOUNTRY-MAP-REFETCH: FAIL — ${bad} case(s). The country map either refetches 2,106`)
  console.error('records on unrelated config changes, lets a stale response win, or leaves the reader')
  console.error('staring at an empty map with nothing to explain it.')
  process.exit(1)
}
console.log('\nCOUNTRY-MAP-REFETCH: PASS — refetch is keyed by value, newest-writer-wins, and the wait is visible.')
