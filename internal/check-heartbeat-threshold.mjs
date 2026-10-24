#!/usr/bin/env node
/**
 * check-heartbeat-threshold.mjs — THE HEARTBEAT THRESHOLD MUST COME FROM CONFIG, NOT A LITERAL.
 *
 * WHAT A HEARTBEAT ZONE IS. The top bin of the research-dashboard choropleth: the countries
 * holding the most people groups: 150 or more in each heartbeat zone.
 *
 * ★ THE DEFECT THIS CATCHES, AND WHY NOTHING ELSE COULD. The ramp's edges were a 5-stop array
 * literal — `upTo: 5, 20, 60, 150, Infinity` — sitting in DashboardMapPanel.vue. Those numbers are
 * not a property of choropleths; they are a property of THIS DATASET (~2000 people groups). Point
 * the dashboard at a 200-group dataset and every country falls in the bottom bin: the map renders
 * uniformly pale and says nothing. The 150 has to be a variable, not a static, so the dashboard can
 * be reused for other maps and other datasets. A dataset assumption wearing the costume of a constant.
 *
 * That failure is INVISIBLE to every other gate in this repo. The code is correct, it parses, it
 * builds, it renders, it throws nothing, and the screenshot looks like a map. Only the MEANING is
 * wrong. So the regression this guards is not a crash — it is someone "simplifying" the resolver
 * back into a literal because the literal is shorter, and nothing complaining.
 *
 * ★ WHY THIS GATE ASSERTS ON BEHAVIOUR AND NOT ON A GREP. The obvious gate is "fail if 150 appears
 * in DashboardMapPanel.vue". THAT GATE WOULD BE USELESS IN BOTH DIRECTIONS. It false-POSITIVES:
 * 150 legitimately appears as the DEFAULT in HEARTBEAT_DEFAULTS, which is exactly what preserves
 * today's rendering. And it false-NEGATIVES: a re-hard-coding that used 200, or that hard-coded
 * only the three lower edges, would sail straight through. Substring presence is not the property.
 *
 * The property is TWO-SIDED, and getting only one side is how this gate was wrong once already:
 *   1. DOES CHANGING THE CONFIG CHANGE THE MAP?   (configurability — assertion B)
 *   2. DOES THE SHIPPED CONFIG STILL RENDER TODAY'S MAP?   (no regression — assertion A2)
 * So this gate EXECUTES the resolver extracted from the live SFC, against BOTH synthetic configs
 * and the REAL dashboard.config.js. A literal fails (1); an edited shipped default fails (2).
 *
 * ASSERTIONS
 *   A.  THE PANEL'S FALLBACK IS INTACT — with NO config at all, the resolver yields EXACTLY the
 *       historical ramp (edges 5/20/60/150/Infinity, labels included).
 *   A2. THE SHIPPED CONFIGURATION RENDERS THAT SAME RAMP — resolved the way the RUNNING APP does,
 *       with dashboard.config.js's map.* layered on top of the panel defaults. ★ A2 IS THE
 *       ASSERTION THAT PROTECTS "TODAY'S MAP MUST NOT CHANGE", AND IT WAS MISSING AT FIRST: A
 *       alone proves only the FALLBACK, which is strictly weaker, and F below proves only that the
 *       key is DECLARED, not what it is SET TO. Measured consequence — editing the shipped config
 *       to heartbeatThreshold:999 changed the real map while this gate printed "default ramp
 *       unchanged" and exited 0. Changing the shipped ramp is now a deliberate act that must also
 *       update HISTORICAL below, in the same commit.
 *   B.  THE THRESHOLD IS LIVE — setting heartbeatThreshold to 40 and to 500 must MOVE the top edge
 *       to exactly that number and must RE-BIN the fixture's countries. This is the assertion a
 *       re-hard-coded literal fails.
 *   C.  THE LEGEND FOLLOWS THE EDGES — the top label must CONTAIN "<threshold>+" and name the
 *       heartbeat zone. A moved edge with a stale '150+' legend is confidently wrong, which is
 *       worse than no legend. Matched by property, not equality — see the note on HISTORICAL.
 *   D.  NO DEAD BINS — every bin must be reachable (`colorFor` tests `count < upTo`, so an edge of
 *       1 creates a band no count can enter: the ramp paints 4 of its 5 colours while the legend
 *       advertises 5). Found live during this card at threshold 40, and again in quantile mode.
 *   E.  EDGES ARE STRICTLY ASCENDING — a non-monotonic ramp lets an earlier bin shadow a later one.
 *   F.  THE CONFIG DECLARES IT — dashboard.config.js must carry map.heartbeatThreshold. PRESENCE
 *       ONLY; the VALUE is A2's job. These are separate on purpose, because conflating them is
 *       exactly how the 999 regression shipped past this gate.
 *
 * ── DATA ────────────────────────────────────────────────────────────────────────────────────
 * internal/fixtures/facet-one-field-rows.json — 114 REAL rows (59 countries). Not synthetic: this
 * repo deleted a synthetic fallback precisely because it produced confident wrong answers.
 *
 * ── NEGATIVE TESTS, AND EXACTLY WHAT THEY COVER ─────────────────────────────────────────────
 * `bun run check:heartbeat:self-test` runs THREE cases, each requiring the assertion that exists
 * for it to fire. Stated precisely so the next reader does not over-trust this gate:
 *
 *   [literal]         the resolver is replaced by the old hard-coded array   → must fire B
 *   [shipped-default] dashboard.config.js's heartbeatThreshold is changed    → must fire A2
 *   [shipped-mode]    dashboard.config.js flips heartbeatMode to 'quantile'  → must fire A2
 *
 * ★ THE FIRST VERSION OF THIS GATE SHIPPED WITH [literal] ONLY, and its header said it had been
 * "negative-tested" — true of that case, misleading overall. Testing that THE FEATURE WORKS (a
 * configured threshold moves the edge) is NOT testing that THE REGRESSION IS CAUGHT (the default
 * silently changing), and only the second protects the shipped map. One negative test per regression
 * claimed. A gate that cannot fail is worse than no gate — this repo has shipped one.
 *
 * NOT COVERED, deliberately: this gate reasons about BIN ASSIGNMENT and LABELS only. It says
 * nothing about the colours themselves (contrast against the pin is argued and measured in
 * DashboardMapPanel.vue) and nothing about whether the map actually PAINTS (see verify:map-paint).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PANEL = resolve(ROOT, 'plugin-designs/research-dashboard/src/components/dashboards/DashboardMapPanel.vue')
const CONFIG = resolve(ROOT, 'plugin-designs/research-dashboard/dashboard.config.js')
const FIXTURE = resolve(ROOT, 'internal/fixtures/facet-one-field-rows.json')

const SELF_TEST = process.argv.includes('--self-test')

// The historical ramp, recorded here as the frozen expectation for assertion A.
//
// ★ THE TOP LABEL IS MATCHED BY PROPERTY, NOT BY EQUALITY — a correction this gate earned on its
// FIRST RUN. It originally demanded the top label equal exactly "150+", and immediately failed
// CORRECT code: the label reads "150+ · heartbeat zone", because naming the band in the
// specified words is a requirement of this work, not a defect. An over-strict gate that fires on correct
// code gets switched off, and then the real regression walks through. So the assertion is the
// property that actually matters: the top label must CARRY THE CURRENT THRESHOLD (so a moved edge
// can never leave a stale number on the legend) and must NAME THE ZONE. Any prose around those is
// free to change without this gate objecting.
const HISTORICAL = [
  { upTo: 5, l: '1–4' }, { upTo: 20, l: '5–19' }, { upTo: 60, l: '20–59' },
  { upTo: 150, l: '60–149' }, { upTo: Infinity, l: null },
]
// The top label must contain "<threshold>+" and must say "heartbeat".
function topLabelOk(label, threshold) {
  return typeof label === 'string' && label.includes(`${threshold}+`) && /heartbeat/i.test(label)
}

// ── extract the resolver from the live SFC ──────────────────────────────────────────────────
// Sliced out of the real file rather than re-implemented: a re-implementation would keep passing
// after the shipped code regressed, which is the classic way a gate goes blind.
function resolverSource() {
  const src = readFileSync(PANEL, 'utf8')
  const a = src.indexOf('const BIN_COLORS')
  const b = src.indexOf('const BINS = computed')
  if (a < 0 || b < 0 || b <= a) {
    fail('Could not locate the heartbeat resolver in DashboardMapPanel.vue.\n' +
      '  Expected a `const BIN_COLORS` ... `const BINS = computed` region.\n' +
      '  If the ramp was moved, update this gate. If it was re-hard-coded into a literal, THAT IS THE BUG.')
  }
  return src.slice(a, b)
}

function makeResolver(mapCfg, srcOverride) {
  const body = srcOverride !== undefined ? srcOverride : resolverSource()
  // The slice calls the panel's `T(key, en)` (DashboardMapPanel.vue: `const T = (key, en) => tStatic(key)
  // || en`), which lives above the slice. Hand it the same shape answering in English, so the "names
  // the zone" assertion still reads the specified words.
  const fn = new Function('cfg', 'T', body + '\nreturn resolveBins;')
  return fn({ map: mapCfg }, (key, en) => en)
}

// ── the SHIPPED map config ──────────────────────────────────────────────────────────────────
// Read as SOURCE TEXT, not `import()`. dashboard.config.js imports '@map/…' aliases and a JSON
// module, so importing it from a bare node gate would need Vite's resolver — a dependency that
// would make this gate fragile for no benefit. The `map:` literal is a self-contained bag of
// scalars, so brace-matching and evaluating just that block reads the real shipped values with
// nothing else to resolve.
// Set by the self-test to simulate an edited dashboard.config.js WITHOUT touching the file — a
// self-test that mutated the repo could leave the tree poisoned if it crashed mid-run.
let SHIPPED_CONFIG_OVERRIDE = null
function shippedMapConfig() {
  if (SHIPPED_CONFIG_OVERRIDE) return SHIPPED_CONFIG_OVERRIDE
  const src = readFileSync(CONFIG, 'utf8')
  const at = src.search(/^\s{2}map:\s*\{/m)
  if (at < 0) {
    fail('A2. Could not find the top-level `map: {` block in dashboard.config.js.\n' +
      '   This gate must read the SHIPPED map config; if the block moved, update this gate.')
    return null
  }
  let depth = 0
  const start = src.indexOf('{', at)
  let i = start
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { i++; break } }
  }
  try {
    // eslint-disable-next-line no-eval
    return eval('(' + src.slice(start, i) + ')')
  } catch (e) {
    fail(`A2. The \`map\` block in dashboard.config.js did not evaluate: ${e.message}`)
    return null
  }
}

// ── the fixture, binned ─────────────────────────────────────────────────────────────────────
function countryCounts() {
  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const m = new Map()
  for (const r of rows) {
    const c = r.country_code
    const iso = c && c.value ? c.value : null
    if (iso) m.set(iso, (m.get(iso) || 0) + 1)
  }
  return m
}
function binIndex(count, bins) {
  if (!count) return -1
  for (let i = 0; i < bins.length; i++) if (count < bins[i].upTo) return i
  return bins.length - 1
}
function assignment(bins, counts) {
  return [...counts.entries()].sort().map(([iso, n]) => `${iso}:${n}:${binIndex(n, bins)}`).join(',')
}

const errors = []
function fail(msg) { errors.push(msg) }

function run(srcOverride) {
  errors.length = 0
  const counts = countryCounts()
  const vals = [...counts.values()]
  const resolve0 = (cfg) => makeResolver(cfg, srcOverride)(vals)

  // Compare a resolved ramp against the historical one. Shared by A and A2 so the two can never
  // drift apart — the whole defect A2 fixes was one path being asserted and the other not.
  const expectHistorical = (bins, tag, why) => {
    HISTORICAL.forEach((exp, i) => {
      const got = bins[i]
      if (!got || got.upTo !== exp.upTo) {
        fail(`${tag}. RAMP MOVED at bin ${i}: expected upTo=${exp.upTo}, got ${got ? got.upTo : '(missing)'}.\n   ${why}`)
      } else if (exp.l === null) {
        if (!topLabelOk(got.l, 150)) {
          fail(`${tag}. TOP LABEL is "${got.l}" — it must contain "150+" and name the heartbeat zone.\n   ${why}`)
        }
      } else if (got.l !== exp.l) {
        fail(`${tag}. LEGEND LABEL MOVED at bin ${i}: expected "${exp.l}", got "${got.l}".\n   ${why}`)
      }
    })
    if (bins.length !== HISTORICAL.length) fail(`${tag}. RAMP has ${bins.length} bins, expected ${HISTORICAL.length}.\n   ${why}`)
  }

  // A. THE PANEL'S FALLBACK IS INTACT — with NO config supplied at all.
  const def = resolve0({})
  expectHistorical(def, 'A', 'With no config supplied the panel must fall back to EXACTLY the historical ramp.')

  // ── A2. THE SHIPPED CONFIGURATION RENDERS THE HISTORICAL RAMP ───────────────────────────────
  // ★ THIS IS THE ASSERTION THAT PROTECTS THE SHIPPED MAP, AND IT WAS MISSING. A alone proves the
  // PANEL'S FALLBACK is intact — a strictly weaker property than "the map still looks the same",
  // because the running app resolves with dashboard.config.js's map.* layered ON TOP of that
  // fallback. Assertion F only checked that heartbeatThreshold was DECLARED, never what it was
  // SET TO. So editing the shipped config to 999 changed the real map while this gate printed
  // "default ramp unchanged" and exited 0. Measured, reproduced, and the reason A2 exists.
  //
  // A2 resolves the ramp THE WAY THE RUNNING APP DOES and requires it to equal the historical one.
  // Changing the shipped default is now a deliberate act that must also update HISTORICAL here.
  if (srcOverride === undefined) {
    const shipped = shippedMapConfig()
    if (shipped) {
      expectHistorical(
        makeResolver(shipped, srcOverride)(vals), 'A2',
        'This is the ramp dashboard.config.js ACTUALLY SHIPS (map.heartbeatThreshold=' +
          `${shipped.heartbeatThreshold}, binThresholds=${JSON.stringify(shipped.binThresholds)}, ` +
          `mode=${shipped.heartbeatMode}). Today\'s map must not change. If this move is intended, ` +
          'update HISTORICAL in this gate in the same commit.',
      )
      if (shipped.heartbeatMode && shipped.heartbeatMode !== 'fixed') {
        fail(`A2. dashboard.config.js ships heartbeatMode='${shipped.heartbeatMode}'.\n` +
          "   'fixed' is the shipped default on purpose: a data-derived ramp changes per dataset,\n" +
          '   which is right for an unknown dataset and wrong for this one, where 150 is deliberate.')
      }
    }
  }

  const baseline = assignment(def, counts)

  // B/C/D/E. THE THRESHOLD IS LIVE
  for (const t of [40, 500]) {
    const bins = resolve0({ heartbeatThreshold: t })
    const top = bins[bins.length - 1]
    const edge = bins[bins.length - 2]
    if (!edge || edge.upTo !== t) {
      fail(`B. heartbeatThreshold=${t} DID NOT MOVE THE HEARTBEAT EDGE (got ${edge ? edge.upTo : '(missing)'}).\n` +
        '   The thresholds are not coming from config — this is the re-hard-coded-literal regression.')
    }
    if (assignment(bins, counts) === baseline) {
      fail(`B. heartbeatThreshold=${t} produced the SAME bin assignment as the default over ${counts.size} real countries.\n` +
        '   The config knob is inert.')
    }
    if (!topLabelOk(top.l, t)) {
      fail(`C. LEGEND DID NOT FOLLOW THE EDGE at threshold ${t}: top label reads "${top.l}".\n` +
        `   It must contain "${t}+" and name the heartbeat zone. A moved edge with a stale number on the\n` +
        '   legend is confidently wrong, which is worse than no legend.')
    }
    bins.forEach((b, i) => {
      const lo = i === 0 ? 1 : bins[i - 1].upTo
      if (Number.isFinite(b.upTo) && b.upTo <= lo) {
        fail(`D. DEAD BIN at index ${i} (threshold ${t}): range ${lo}..<${b.upTo} can never be entered.\n` +
          '   colorFor tests `count < upTo`, so this colour stop never paints while the legend still shows it.')
      }
      if (i > 0 && b.upTo <= bins[i - 1].upTo) {
        fail(`E. NON-MONOTONIC EDGES at index ${i} (threshold ${t}): ${bins[i - 1].upTo} then ${b.upTo}.`)
      }
    })
  }

  // F. THE CONFIG DECLARES IT.
  // NOTE this is a PRESENCE check only, and presence is NOT value — A2 is what asserts the value.
  // Keeping them separate (and saying so) is deliberate: F alone once let heartbeatThreshold:999
  // ship while this gate printed "default ramp unchanged".
  const cfgSrc = readFileSync(CONFIG, 'utf8')
  if (!/heartbeatThreshold\s*:/.test(cfgSrc)) {
    fail('F. dashboard.config.js does not declare map.heartbeatThreshold.\n' +
      '   The knob must have a documented home in the dashboard config, not only a default in the panel.')
  }
  return errors.slice()
}

// ── NEGATIVE TESTS ──────────────────────────────────────────────────────────────────────────
// ★ TWO CASES, BECAUSE THERE ARE TWO DISTINCT REGRESSIONS AND THEY ARE NOT THE SAME ASSERTION.
// This gate originally shipped with case 1 only, and its header claimed it was "negative-tested".
// That was true of case 1 and MISLEADING overall: case 2 — the one that actually protects the
// "today's map must not change" requirement — was unasserted, and a one-line edit to
// dashboard.config.js changed the shipped ramp while the gate printed PASS. Verified by
// reproducing it, not by reasoning about it.
//
// The general shape, worth more than either case: testing that THE FEATURE WORKS (a configured
// threshold moves the edge) is not testing that THE REGRESSION IS CAUGHT (the default silently
// changing). A gate needs a negative test per regression it claims to prevent.
const CASES = [
  {
    id: 'literal',
    what: 'the resolver is replaced by a re-hard-coded literal ramp (configurability removed)',
    mustFire: 'B',
    apply: () => ({
      srcOverride: `
        const BIN_COLORS = ['#f8e0da', '#fccec4', '#febbad', '#ffa797', '#ff9380']
        function resolveBins() {
          return [
            { upTo: 5, c: BIN_COLORS[0], l: '1–4' }, { upTo: 20, c: BIN_COLORS[1], l: '5–19' },
            { upTo: 60, c: BIN_COLORS[2], l: '20–59' }, { upTo: 150, c: BIN_COLORS[3], l: '60–149' },
            { upTo: Infinity, c: BIN_COLORS[4], l: '150+' },
          ]
        }
      `,
    }),
  },
  {
    id: 'shipped-default',
    what: "dashboard.config.js's shipped map.heartbeatThreshold is changed (today's map moves)",
    mustFire: 'A2',
    // Simulates `sed -i 's/heartbeatThreshold: 150,/heartbeatThreshold: 999,/'` WITHOUT editing
    // the file, so a crash mid-self-test cannot leave the repo poisoned.
    apply: () => {
      SHIPPED_CONFIG_OVERRIDE = { mapStyle: 'paper', heartbeatThreshold: 999, binThresholds: [5, 20, 60], heartbeatMode: 'fixed', heartbeatQuantile: 0.1 }
      return {}
    },
  },
  {
    id: 'shipped-mode',
    what: "dashboard.config.js flips heartbeatMode to 'quantile' (ramp becomes data-derived)",
    mustFire: 'A2',
    apply: () => {
      SHIPPED_CONFIG_OVERRIDE = { mapStyle: 'paper', heartbeatThreshold: 150, binThresholds: [5, 20, 60], heartbeatMode: 'quantile', heartbeatQuantile: 0.1 }
      return {}
    },
  },
]

if (SELF_TEST) {
  let bad = 0
  for (const c of CASES) {
    SHIPPED_CONFIG_OVERRIDE = null
    const { srcOverride } = c.apply()
    const got = run(srcOverride)
    SHIPPED_CONFIG_OVERRIDE = null

    if (!got.length) {
      console.error(`SELF-TEST FAILED [${c.id}]: the gate ACCEPTED ${c.what}.\n` +
        '  A gate that cannot fail is worse than no gate.')
      bad++
      continue
    }
    if (!got.some((e) => e.startsWith(c.mustFire + '.'))) {
      console.error(`SELF-TEST FAILED [${c.id}]: rejected, but NOT via assertion ${c.mustFire}, which is the one\n` +
        `  that exists for this regression. Rejections seen:\n    ` + got.map((e) => e.split('\n')[0]).join('\n    '))
      bad++
      continue
    }
    console.log(`  ✓ [${c.id}] REJECTED via ${c.mustFire} — ${c.what}`)
    got.forEach((e) => console.log('      · ' + e.split('\n')[0]))
  }
  if (bad) { console.error(`\ncheck:heartbeat SELF-TEST FAILED — ${bad} of ${CASES.length} case(s) not caught.`); process.exit(1) }
  console.log(`\ncheck:heartbeat SELF-TEST PASS — all ${CASES.length} regression case(s) rejected by their own assertion.`)
  process.exit(0)
}

const found = run()
if (found.length) {
  console.error('check:heartbeat FAIL — the heartbeat threshold is not behaving as a variable.\n')
  found.forEach((e) => console.error('  ✗ ' + e + '\n'))
  process.exit(1)
}
console.log('check:heartbeat PASS — the SHIPPED dashboard.config.js resolves to the historical ramp ' +
  '(5/20/60/150/∞ over 59 real countries) and so does the panel fallback; heartbeatThreshold 40 and 500 ' +
  'both move the edge, relabel the legend, and re-bin the fixture; no dead or non-monotonic bins.')
