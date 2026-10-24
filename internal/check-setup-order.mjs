#!/usr/bin/env node
/**
 * check-setup-order.mjs — code that RUNS during setup must not be written below what it reads.
 *
 * Two arms, one root cause: a line's POSITION in a setup block is not the same as the MOMENT it
 * runs, and both defects below shipped because the author read the file top-to-bottom and assumed
 * the runtime would too. Both were found in a live console, in a gallery tab, on code
 * that built clean, parsed clean and passed every other gate in this tree.
 *
 * ── ARM A: IMMEDIATE-TDZ ──────────────────────────────────────────────────────────────────────
 *   research-map.vue:2427 — `ReferenceError: Cannot access '_lastFitKey' before initialization`,
 *   and the whole map blanked, because setup threw.
 *
 *   `watch(src, cb, { immediate: true })` runs cb DURING setup, at the line the watch() sits on.
 *   That watcher called applyFitSlugs(), a `function` declaration 350 lines further down — which is
 *   hoisted, so the CALL resolved fine. Its constants were not: `let _lastFitKey` and seven
 *   `const FIT_*` above it are lexical, still in their temporal dead zone, and the first read threw.
 *
 *   THE HOISTING ASYMMETRY IS THE WHOLE TRAP. A hoisted function is a promise that the NAME
 *   resolves early, not that its BODY can run early. So the dangerous edge is not "does the watcher
 *   read something below it" — that is easy to see — it is "does the watcher CALL something that
 *   reads something below it", one level of indirection away, and invisible at both ends: the
 *   watcher looks like it only touches the store, and the function looks like it only touches
 *   constants that are obviously right there beside it.
 *
 * ── ARM B: HOOK-AFTER-AWAIT ───────────────────────────────────────────────────────────────────
 *   DashboardMapPanel.vue:1233 — `onBeforeUnmount is called when there is no active component
 *   instance` (a warning, which is why it survived), and the cleanup silently never ran.
 *
 *   Every lifecycle registrar closes over Vue's CURRENT INSTANCE, which exists only while setup is
 *   on the stack. `onMounted(async () => { await initializeMap(); ...; onBeforeUnmount(teardown) })`
 *   resumes after a microtask, with no current instance — so the registration is dropped and a
 *   ResizeObserver on document.body plus a window 'resize' listener outlive the component. The
 *   failure mode is the worst kind: nothing throws, the feature works, and the leak only shows up
 *   as a studio that gets slower the more tabs the reader has visited.
 *
 *   FIX SHAPE, not just "move the line": the teardown cannot live next to the code that creates the
 *   thing, because that code is past the await. Declare the handle at setup scope and tear it down
 *   in one hook registered during setup — which is the pattern the same file already used for
 *   containerRO and attribRO, three lines away from the one that got it wrong.
 *
 * Both arms STRIP COMMENTS FIRST. This tree has been bitten five times by a check satisfied by a
 * comment quoting the code it was looking for, and this file's own header names both symbols.
 *
 * USAGE:  node internal/check-setup-order.mjs [--poison]
 * EXIT:   0 = clean, 1 = a defect, 3 = the self-test failed (the gate cannot be trusted).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const POISON = process.argv.includes('--poison')

const HOOKS = [
  'onMounted', 'onBeforeMount', 'onBeforeUnmount', 'onUnmounted', 'onUpdated', 'onBeforeUpdate',
  'onActivated', 'onDeactivated', 'onErrorCaptured', 'onRenderTracked', 'onRenderTriggered',
  'onServerPrefetch',
]
const HOOK_RE = new RegExp('\\b(' + HOOKS.join('|') + ')\\s*\\(', 'g')

/* Blank out comments and string bodies in place, so every index stays where it was. */
const blank = (m) => m.replace(/[^\n]/g, ' ')
const stripComments = (src) => src
  .replace(/<!--[\s\S]*?-->/g, blank)
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:\\'"`/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
/* Blank the TEXT of every literal while keeping `${...}` interpolations, which are code.
 * One state machine rather than three regexes, because the three quote styles nest: version 2 of
 * this gate flagged four data-tables.vue files for "ensure() reads `table`" when the only `table`
 * in ensure() is the word in `new Error(`table not found (${r.status})`)`. Prose in a template
 * literal is exactly as inert as prose in a comment, and a regex cannot tell them apart. */
const stripStrings = (src) => {
  const out = src.split('')
  const stack = []
  let i = 0
  const blankAt = (n) => { if (src[n] !== '\n') out[n] = ' ' }
  while (i < src.length) {
    const c = src[i]
    const top = stack[stack.length - 1]
    if (top && (top.kind === 'sq' || top.kind === 'dq')) {
      if (c === '\\') { blankAt(i); if (i + 1 < src.length) blankAt(i + 1); i += 2; continue }
      if ((c === "'" && top.kind === 'sq') || (c === '"' && top.kind === 'dq') || c === '\n') { stack.pop(); i++; continue }
      blankAt(i); i++; continue
    }
    if (top && top.kind === 'tpl') {
      if (c === '\\') { blankAt(i); if (i + 1 < src.length) blankAt(i + 1); i += 2; continue }
      if (c === '`') { stack.pop(); i++; continue }
      if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'expr', depth: 0 }); i += 2; continue }
      blankAt(i); i++; continue
    }
    if (c === "'") { stack.push({ kind: 'sq' }); i++; continue }
    if (c === '"') { stack.push({ kind: 'dq' }); i++; continue }
    if (c === '`') { stack.push({ kind: 'tpl' }); i++; continue }
    if (top && top.kind === 'expr') {
      if (c === '{') top.depth++
      else if (c === '}') { if (top.depth === 0) { stack.pop(); i++; continue } top.depth-- }
    }
    i++
  }
  return out.join('')
}

/* Only the <script> half of an SFC can run at setup time; the template is a different phase. */
function scriptOf(src, file) {
  if (!file.endsWith('.vue')) return src
  const out = src.replace(/[^\n]/g, ' ').split('')
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g
  let m
  while ((m = re.exec(src))) {
    for (let i = m.index + m[0].indexOf('>') + 1; i < m.index + m[0].length - 9; i++) out[i] = src[i]
  }
  return out.join('')
}

/* Paren-match forward from the first `(` at or after `from`. Returns [open, close] or null.
 * Arm C needs this because `watch(textDir, reflectDir)` has NO inline callback, and searching for the
 * next `{` from there walks past the call entirely — the first version read the NEXT statement's
 * onMounted body and reported a getCurrentInstance() that was nowhere near a watcher. Caught by the
 * self-test, on the fixture written to prove the arm was quiet on correct code. */
function parenSpan(src, from) {
  const open = src.indexOf('(', from)
  if (open < 0) return null
  let d = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') d++
    else if (src[i] === ')' && --d === 0) return [open, i]
  }
  return null
}

/* Brace-match forward from the first `{` at or after `from`. Returns [open, close] or null. */
function braceSpan(src, from) {
  const open = src.indexOf('{', from)
  if (open < 0) return null
  let d = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d++
    else if (src[i] === '}' && --d === 0) return [open, i]
  }
  return null
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length

const namesInPattern = (pat) => String(pat)
  .replace(/[{}[\]]/g, ' ')
  .split(',')
  .map((s) => s.replace(/:[\s\S]*$/, '').replace(/=[\s\S]*$/, '').replace(/\.\.\./, '').trim())
  .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))

/* Names a span DECLARES for itself: any of these resolves locally, so reading one says nothing
 * about a binding further down the file. Version 3 of this gate flagged charts.vue for "load()
 * reads byCountry, declared at line 354" when load() destructures its OWN `byCountry` on its
 * second line — a read of a shadowing local, 220 lines away from the const it appears to name.
 * Shadowing is the normal case in this tree (short names, small helpers), not an exotic one. */
function localNames(span) {
  const out = new Set()
  const add = (pat) => { for (const n of namesInPattern(pat)) out.add(n) }
  let m
  const decl = /\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)/g
  while ((m = decl.exec(span))) add(m[1])
  const params = /\bfunction\s*[A-Za-z_$]?[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|\bcatch\s*\(([^)]*)\)/g
  while ((m = params.exec(span))) add(m[1] ?? m[2] ?? m[3])
  const bare = /\b([A-Za-z_$][\w$]*)\s*=>/g
  while ((m = bare.exec(span))) out.add(m[1])
  return out
}

/* Identifiers a span READS FROM AN OUTER SCOPE: member names, object keys and anything the span
 * declares itself are all removed, because none of them is a binding this scope has to resolve. */
function identsIn(span) {
  const local = localNames(span)
  const read = stripStrings(span)
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')            // r.slug — a property, not a binding
    .replace(/\b[A-Za-z_$][\w$]*\s*:/g, ' ')            // { padding: … } — a key, not a binding
    .match(/\b[A-Za-z_$][\w$]*\b/g) || []
  return new Set(read.filter((n) => !local.has(n)))
}

/* Top-level (column-0) lexical declarations, which are the ones a setup block resolves. `var`
 * hoists to undefined rather than throwing, so it is a different bug and not this gate's. */
function topLevelLexical(src) {
  const out = []
  const re = /^(?:const|let)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/gm
  let m
  while ((m = re.exec(src))) {
    const names = m[3] ? [m[3]]
      : String(m[1] || m[2]).split(',').map((s) => s.replace(/:.*$/, '').replace(/=.*$/, '').replace(/\.\.\./, '').trim())
    for (const n of names) if (/^[A-Za-z_$][\w$]*$/.test(n)) out.push({ name: n, at: m.index })
  }
  return out
}

/* Top-level `function NAME(...) {}` declarations — hoisted, so reachable from an immediate watcher. */
function topLevelFunctions(src) {
  const out = new Map()
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  while ((m = re.exec(src))) {
    const span = braceSpan(src, m.index)
    if (span) out.set(m[1], { at: m.index, body: src.slice(span[0], span[1] + 1) })
  }
  return out
}

// ── ARM A ────────────────────────────────────────────────────────────────────────────────────────
function armA(code) {
  const hits = []
  const lexical = topLevelLexical(code)
  const fns = topLevelFunctions(code)
  const re = /\bimmediate\s*:\s*true\b/g
  let m
  while ((m = re.exec(code))) {
    // Walk back to the watch()/watchEffect() this option belongs to: the nearest one before it.
    const before = code.slice(0, m.index)
    const start = Math.max(before.lastIndexOf('watch('), before.lastIndexOf('watchEffect('))
    if (start < 0) continue
    const span = code.slice(start, m.index)
    const reads = identsIn(span)
    // Declared BELOW the watcher = in its temporal dead zone while the immediate run is on the stack.
    for (const d of lexical) {
      if (d.at > start && reads.has(d.name)) {
        hits.push({ line: lineOf(code, start), why: `immediate watcher reads '${d.name}', declared at line ${lineOf(code, d.at)}` })
      }
    }
    // One level of indirection: a hoisted function it calls, whose own body reads something below.
    for (const [name, fn] of fns) {
      if (!reads.has(name)) continue
      const inner = identsIn(fn.body)
      for (const d of lexical) {
        if (d.at > start && inner.has(d.name)) {
          hits.push({ line: lineOf(code, start), why: `immediate watcher calls ${name}(), which reads '${d.name}', declared at line ${lineOf(code, d.at)}` })
        }
      }
    }
  }
  return hits
}

// ── ARM B ────────────────────────────────────────────────────────────────────────────────────────
function armB(code) {
  const hits = []
  const re = /\basync\b/g
  let m
  while ((m = re.exec(code))) {
    const span = braceSpan(code, m.index)
    if (!span) continue
    const body = code.slice(span[0], span[1] + 1)
    const firstAwait = body.search(/\bawait\b/)
    if (firstAwait < 0) continue
    let h
    const hre = new RegExp(HOOK_RE.source, 'g')
    while ((h = hre.exec(body))) {
      if (h.index > firstAwait) {
        hits.push({ line: lineOf(code, span[0] + h.index), why: `${h[1]}() is registered after an await, so it never attaches` })
      }
    }
  }
  return hits
}

// ── ARM C: getCurrentInstance() ANSWERS ONLY WHILE SETUP OR A HOOK IS ON THE STACK ─────────────
//   dashboard-plus-grid.vue:303 and research-map-plus-grid.vue:152 — a live goal-(d) RTL bug.
//
//   `function reflectDir() { getCurrentInstance()?.proxy?.$el… }` was called from TWO places:
//   onMounted(reflectDir), where Vue has set the current instance and it works, and
//   watch(textDir, reflectDir), where nothing has, so the read returns null. A host that set lang=ar
//   BEFORE mount got dir=rtl; a host that switched to ar AFTERWARDS got nothing at all, and Arabic
//   rendered in a left-to-right layout.
//
//   THAT SPLIT IS WHY IT SURVIVED REVIEW. The function is not wrong, and neither caller is wrong;
//   the pairing is. Reading either line alone shows working code, and first paint — the thing anyone
//   would check — was correct. Only the later switch was broken.
//
//   SO THIS ARM MODELS VUE RATHER THAN BANNING THE CALL. Inside setup, or inside a lifecycle-hook
//   callback, getCurrentInstance() is CORRECT and must not be reported — research-map-plus-grid.vue's
//   onMounted(() => { getCurrentInstance()… }) is fine and is deliberately left alone. A gate that
//   flags working code gets ignored, and this file has already dropped five such hits today.
//   What it reports is the call reached from a watcher or an event handler, directly or through a
//   top-level function. The fix is always the same: capture the instance in setup (_selfInstance).
const HOOK_SET = new RegExp('^(?:' + HOOKS.join('|') + ')$')
function armC(code) {
  const hits = []
  const fns = topLevelFunctions(code)
  // Which top-level functions are handed to a watcher or an event registration rather than called
  // from setup? Those are the ones whose body runs with no current instance.
  const deferred = new Set()
  for (const m of code.matchAll(/\b(?:watch|watchEffect)\s*\(([\s\S]{0,400}?)\)/g)) {
    for (const id of m[1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) if (fns.has(id[1])) deferred.add(id[1])
  }
  for (const m of code.matchAll(/addEventListener\s*\(\s*'[^']*'\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    if (fns.has(m[1])) deferred.add(m[1])
  }
  for (const [name, fn] of fns) {
    if (!deferred.has(name) || !/\bgetCurrentInstance\s*\(/.test(fn.body)) continue
    hits.push({
      line: lineOf(code, fn.at),
      why: `${name}() calls getCurrentInstance(), and is handed to a watcher or an event listener — there is no current instance then, so the call returns null. Capture it in setup instead (const _selfInstance = getCurrentInstance()).`,
    })
  }
  // And the call written straight inside a watcher callback, with no function to name.
  for (const m of code.matchAll(/\b(?:watch|watchEffect)\s*\(/g)) {
    const args = parenSpan(code, m.index)
    if (!args) continue
    const brace = braceSpan(code, m.index)
    // The callback must be INSIDE this call's own argument list. Without that test the search runs on
    // to the next block in the file, which is how the first version invented a hit.
    if (!brace || brace[0] > args[1]) continue
    const span = brace
    const body = code.slice(span[0], span[1] + 1)
    // A lifecycle hook nested inside would re-establish the instance; nothing else does.
    const idx = body.search(/\bgetCurrentInstance\s*\(/)
    if (idx < 0) continue
    const before = body.slice(0, idx)
    const nestedHook = [...before.matchAll(/\b(on[A-Z]\w+)\s*\(/g)].some((h) => HOOK_SET.test(h[1]))
    if (!nestedHook) {
      hits.push({
        line: lineOf(code, span[0] + idx),
        why: 'getCurrentInstance() is called inside a watcher callback, where there is no current instance, so it returns null. Capture it in setup instead.',
      })
    }
  }
  return hits
}

const run = (src, file) => {
  /* Strings are blanked HERE, for both arms. Arm B's first version flagged useMapInstance.js:430 —
   * where the only `onBeforeUnmount` on the line is inside the text of a console.error advising a
   * caller to use one. A gate that reads prose as code cries wolf, and a crying gate gets ignored. */
  const code = stripStrings(stripComments(scriptOf(src, file)))
  return [...armA(code).map((h) => ({ ...h, arm: 'IMMEDIATE-TDZ' })), ...armB(code).map((h) => ({ ...h, arm: 'HOOK-AFTER-AWAIT' })), ...armC(code).map((h) => ({ ...h, arm: 'INSTANCE-OUTSIDE-SETUP' }))]
}

// ── self-test: both defects as they actually shipped, and the fixes, which must stay quiet ───────
const PLANTED_A = `<script setup>
const mapStore = inject('mapStore')
watch(() => cfg?.value?.externalFilters, (raw) => {
  if ('fitSlugs' in raw) applyFitSlugs(raw.fitSlugs)
}, { deep: true, immediate: true })
const FIT_MAX_ZOOM = 5.5
let _lastFitKey = ''
function applyFitSlugs(slugs) {
  const key = String(slugs)
  if (key === _lastFitKey) return
  _lastFitKey = key
  fit({ maxZoom: FIT_MAX_ZOOM })
}
</script>`
const PLANTED_B = `<script setup>
onMounted(async () => {
  await initializeMap()
  const resync = () => sync(map.value)
  window.addEventListener('resize', resync)
  onBeforeUnmount(() => { window.removeEventListener('resize', resync) })
})
</script>`
/* The same two files after the fix, plus the shapes most likely to be mistaken for the defects:
 * a NON-immediate watcher above its constants (legal — it cannot run until they exist), a hook
 * registered BEFORE an await, and a comment that names the symbol the arms search for. */
const CLEAN = `<script setup>
console.error('containerRef.value is null - call initializeMap() inside onMounted()')
async function ensure(file) { if (!ok) throw new Error(\`table not found (\${file})\`) }
async function load() { const [pins, byCountry] = await all(); tables.value = { pins, byCountry } }
watch(profileConfig, load, { immediate: true })
const byCountry = computed(() => series(tables.value))
watch(current, (t) => t && ensure(t.file), { immediate: true })
const table = computed(() => cache.value[current.value?.file] || null)
const FIT_MAX_ZOOM = 5.5
let _lastFitKey = ''
watch(() => cfg?.value?.externalFilters, (raw) => {
  if ('fitSlugs' in raw) applyFitSlugs(raw.fitSlugs)
}, { deep: true, immediate: true })
watch(() => store.other, () => { later({ maxZoom: LATE_ZOOM }) })
const LATE_ZOOM = 3
function applyFitSlugs(slugs) {
  if (String(slugs) === _lastFitKey) return
  _lastFitKey = String(slugs)
  fit({ maxZoom: FIT_MAX_ZOOM, padding: 70 })
}
// ARM C's three legal shapes. The first is the fix; the second and third are CORRECT as written and
// are the reason this arm models Vue instead of banning the call — Vue sets the current instance for
// the duration of a lifecycle hook, so a call inside one resolves. research-map-plus-grid.vue:422 is
// the third shape, and flagging it would have been this gate crying wolf on working code.
const _selfInstance = getCurrentInstance()
function reflectDir() {
  const host = _selfInstance?.proxy?.$el?.getRootNode?.()?.host
  if (host) host.setAttribute('dir', 'rtl')
}
watch(textDir, reflectDir)
const inst = getCurrentInstance()
onMounted(() => { rootEl = getCurrentInstance()?.proxy?.$el?.getRootNode?.() || null })
let scrollRO = null
onBeforeUnmount(() => { if (scrollRO) scrollRO.disconnect() })
onMounted(async () => {
  await initializeMap()
  scrollRO = new ResizeObserver(() => sync(map.value))
})
</script>`
const PLANTED_C = `<script setup>
function reflectDir() {
  const host = getCurrentInstance()?.proxy?.$el?.getRootNode?.()?.host
  if (host && textDir.value === 'rtl') host.setAttribute('dir', 'rtl')
}
onMounted(reflectDir)
watch(textDir, reflectDir)
</script>`
const blindA = run(PLANTED_A, 'x.vue').filter((h) => h.arm === 'IMMEDIATE-TDZ').length === 0
const blindB = run(PLANTED_B, 'x.vue').filter((h) => h.arm === 'HOOK-AFTER-AWAIT').length === 0
const blindC = run(PLANTED_C, 'x.vue').filter((h) => h.arm === 'INSTANCE-OUTSIDE-SETUP').length === 0
const noisy = run(CLEAN, 'x.vue')
if (blindA || blindB || blindC || noisy.length) {
  console.error('SETUP-ORDER: SELF-TEST FAILED — '
    + (blindA ? 'arm A is blind to the shipped TDZ. ' : '')
    + (blindB ? 'arm B is blind to the shipped late hook. ' : '')
    + (blindC ? 'arm C is blind to the shipped getCurrentInstance-in-a-watcher. ' : '')
    + (noisy.length ? 'false positives on the fixed code: ' + noisy.map((h) => `${h.arm} ${h.why}`).join('; ') : ''))
  process.exit(3)
}
if (POISON) { console.log('SETUP-ORDER: self-test passed (all three defects caught, every fix and legal shape quiet).'); process.exit(0) }

// ── scan ─────────────────────────────────────────────────────────────────────────────────────────
// ★ ONE TRIGGER PER ARM, DERIVED — NOT A HAND-KEPT LIST, because a stale precondition voids every
// careful thing below it and does so SILENTLY. This is the second time in one day: check:i18n-keys-exist
// skipped any file that never wrote the word "tStatic", which is how a planted poison key passed it,
// and I diagnosed that and then wrote the same hole here within the hour — arm C went in and the
// early-out still only knew about arms A and B, so BOTH files carrying the live RTL bug were skipped
// before a single arm ran. The gate reported the tree clean and the self-test stayed green, because a
// fixture is text and never meets the file filter.
// The rule this encodes: a cheap early-out is part of a gate's COVERAGE, not an optimisation, so it
// has to be written where adding an arm forces you to extend it.
const ARM_TRIGGERS = [
  /\bimmediate\s*:\s*true\b/,     // A: an immediate watcher runs during setup
  /\basync\b/,                    // B: only an async body can put a hook after an await
  /\bgetCurrentInstance\s*\(/,    // C: the instance read that answers only during setup or a hook
]
const SCANNABLE = new RegExp(ARM_TRIGGERS.map((r) => r.source).join('|'))

const ROOTS = ['plugin-designs', 'library']
const SKIP = /(^|\/)(node_modules|dist|public|\.git|fixtures)(\/|$)/
function files(dir, acc = []) {
  let entries
  try { entries = readdirSync(dir) } catch (_) { return acc }
  for (const e of entries) {
    const p = join(dir, e)
    if (SKIP.test(relative(REPO, p))) continue
    let st
    try { st = statSync(p) } catch (_) { continue }
    if (st.isDirectory()) files(p, acc)
    else if (/\.(vue|js|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}

const found = []
for (const root of ROOTS) {
  for (const f of files(resolve(REPO, root))) {
    let src
    try { src = readFileSync(f, 'utf8') } catch (_) { continue }
    if (!SCANNABLE.test(src)) continue
    for (const h of run(src, f)) found.push({ file: relative(REPO, f), ...h })
  }
}

if (!found.length) {
  console.log('SETUP-ORDER: OK — no immediate watcher reads below itself, no lifecycle hook is registered after an await, and no getCurrentInstance() is read from a watcher or a listener.')
  process.exit(0)
}
console.error(`SETUP-ORDER: ${found.length} defect(s) —`)
for (const h of found) console.error(`  ${h.arm}  ${h.file}:${h.line}  ${h.why}`)
console.error('\nARM A: move the declaration above the watcher (a hoisted function resolves its NAME early, not its BODY).')
console.error('ARM B: declare the handle at setup scope and tear it down in a hook registered BEFORE the first await.')
console.error('ARM C: capture the instance in setup (const _selfInstance = getCurrentInstance()); a call inside a hook is fine, inside a watcher it is null.')
process.exit(1)
