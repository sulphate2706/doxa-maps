#!/usr/bin/env node
/**
 * check-packet-charts — the arithmetic printed on a UPG-100 packet page. Headless, no mount.
 *
 * ★ WHY THIS ONE MATTERS MORE THAN A SCREEN CHART. These figures print. A packet is handed to a
 * reader on paper: no hover, no tooltip, no correction, no redeploy. Every number the triangle and
 * the two calendars show passes through packetCharts.js, so it is asserted here against the SHIPPED
 * data rather than a fixture — the gap arms in check-list-selection taught that a fixture proves the
 * module behaves and says nothing about what we print.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  anchorPlacement, assertNested, assertOnePublisher, bracketSpan, fractionFromPercent, overlayPlacement, scatterCells, scatterSpread, overlayCaption, cellCount, shareCells, peoplePerCell, shareOfLists,
} from '../library/components/charts/packetCharts.js'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'people-groups')
const readJson = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'))
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }

const funnel = readJson('vision-funnel.json')
const byId = Object.fromEntries(funnel.steps.map((s) => [s.id, s]))
const STEPS = ['all', 'unreached', 'frontier'].map((id) => ({ id, ...byId[id] }))
const DOXA = { id: 'doxa', ...byId.doxa, within: { unreached: byId.doxa.unreached, frontier: byId.doxa.frontier } }

// ── the steps nest, and a mixed publisher is refused ────────────────────────────────────────────
ok(assertNested(STEPS) === STEPS, 'the shipped steps nest: all 12,379 > unreached 7,341 > frontier 4,754')
let threw = null
try { assertNested([{ id: 'frontier', groups: 4754 }, { id: 'unreached', groups: 7341 }]) } catch (e) { threw = e.message }
ok(!!threw && /do not nest/.test(threw) && /4754|7341/.test(threw),
  'a step LARGER than the one above it throws, naming both counts')

// ★ THE PUBLISHER HAZARD NEEDS ITS OWN DETECTOR, and writing this test is what proved it.
// I first put the Joshua-Project warning in assertNested's message. Then the assertion failed:
// 16,426 stacked on 12,379 is perfectly monotonic, so nesting arithmetic accepts it. The two are
// not the same KIND of count — peoples-by-country vs peoples — and no comparison of magnitudes can
// see that. An error message naming a cause its own code cannot detect is worse than none.
let mixed = null
try {
  assertOnePublisher([{ id: 'all', groups: 16426, source: 'joshua-project' }, { id: 'unreached', groups: 7341, source: 'imb' }])
} catch (e) { mixed = e.message }
ok(!!mixed && /mix publishers/.test(mixed) && /joshua-project/.test(mixed) && /imb/.test(mixed),
  'mixing Joshua Project and IMB steps throws and NAMES both, which nesting arithmetic cannot catch')
ok(assertNested([{ id: 'all', groups: 16426 }, ...STEPS]).length === 4,
  'CONTROL: the same mixed pair passes NESTING — proving the two checks measure different things')

// ── DOXA IS NOT A SLICE, and this is the assertion upg100 asked to be un-simplifiable ───────────
// Measured from the shipped file, not quoted: of 2,107 DOXA groups, 2,082 are unreached and 1,745
// are frontier. So 25 are not unreached at all and 362 — 17.2%, ONE GROUP IN SIX — are not frontier.
// A chart drawing DOXA as a fourth nested band inside frontier misstates one group in six, with a
// clean shape and no error of any kind. That is the whole reason overlays exist; if anyone later
// "simplifies" this back to four slices, these three assertions are what stops them.
const place = overlayPlacement(DOXA, STEPS)
ok(place.isSlice === false, 'DOXA is NOT a slice of any single step, so it must never be drawn as one')
ok(DOXA.groups - DOXA.within.frontier === 362 && Math.round(1000 * (DOXA.groups - DOXA.within.frontier) / DOXA.groups) / 10 === 17.2,
  '362 of its 2,107 groups — 17.2%, one in six — are NOT frontier, which is what a nested chart would misstate')
ok(DOXA.groups - DOXA.within.unreached === 25, 'and 25 are not unreached at all, so it is not a slice of unreached either')
ok(place.spans.join(',') === 'unreached,frontier', 'it spans unreached AND frontier, in step order, so a legend can say so')

// ── the caption carries the parts as TEXT (upg100: a printed page has no hover) ─────────────────
const cap = overlayCaption(DOXA, STEPS)
ok(cap.total === 2107 && cap.parts.length === 2, 'the caption exposes the within numbers, not only the geometry')
ok(cap.parts.map((p) => `${p.stepId}:${p.groups}`).join(' ') === 'unreached:2082 frontier:1745',
  'as inkable parts in step order — an unexplained band on paper tells a reader nothing')
ok(cap.isSlice === false, 'and the caption says it is not a slice, so the component need not decide that itself')

// ── an overlay that cannot be placed must not be DRAWN (found by reading the template) ──────────
// ★ THIS SHIPPED IN L61 AND I CAUGHT IT BY READING, NOT BY A TEST. The component computed its
// bracket with Math.min(...idx) / Math.max(...idx) over the steps an overlay touches. On an EMPTY
// list those return Infinity and -Infinity, so the bracket rendered at y=Infinity with height
// -Infinity — an invalid rect that SVG discards without a word. The overlay vanished and took its
// groups with it: no error, no gap, just a chart missing a band nobody knew to look for.
// The input is easy to get wrong because `within` is the unusual half of the API — an overlay
// written as { id, label, groups } looks complete and is unplaceable.
ok(bracketSpan(DOXA, STEPS) !== null, 'a well-formed overlay places')
ok(bracketSpan({ id: 'list', groups: 100 }, STEPS) === null,
  'an overlay with NO within returns null rather than a bracket at Infinity')
ok(bracketSpan({ id: 'list', groups: 100, within: { typo: 50 } }, STEPS) === null,
  'and so does one whose within names a step that does not exist — a typo cannot silently delete a band')
ok(bracketSpan({ id: 'list', groups: 100, within: {} }, STEPS) === null, 'an empty within too')
// NEG CONTROL: the old expression really did produce the broken geometry, so this is not theory.
const emptyIdx = []
ok(Math.min(...emptyIdx) === Infinity && Math.max(...emptyIdx) === -Infinity,
  'NEG CONTROL: Math.min/max of an empty span ARE Infinity/-Infinity, which is what drew the invisible rect')

// ── the calendars ───────────────────────────────────────────────────────────────────────────────
ok(cellCount(100, 52) === 5200, 'a 100-year life in weeks is 5,200 cells')
const share = readJson('christian-share.json')
const pct = Number(share.pctEvangelical)
ok(Number.isFinite(pct) && pct > 0, `the shipped evangelical share is a usable number (${pct})`)
// pctEvangelical is a PERCENT (0.6133 means 0.6133%), so the conversion happens HERE, at the only
// place that can see which the source meant. See the refusal in shareCells.
const cells = shareCells(100, 52, fractionFromPercent(pct))
ok(cells.filled === 32 && Math.abs(cells.exact - 31.9) < 0.15,
  `${cells.filled} cells of 5,200 are filled, from an exact ${cells.exact.toFixed(2)} — the drawn integer is a ROUNDING`)
ok(cells.exact !== cells.filled,
  'exact and filled differ, which is why the caption must print the unrounded value: 32 reads as precise when it is not')
const tiny = shareCells(100, 52, 0.00015)      // 0.78 of a cell
ok(tiny.exact < 1 && tiny.filled === 1 && tiny.roundedUpFromBelowOne === true,
  'a share too small to fill one cell is FLAGGED — drawing it as one cell says "at least one" where the data said "almost none"')
const vanishing = shareCells(100, 52, 0.00001)  // 0.05 of a cell
ok(vanishing.filled === 0 && vanishing.roundedToZero === true,
  'and a share that rounds away to nothing is flagged too, so "no cells" is never silently read as "none"')

// ★ THE PERCENT/FRACTION CONFUSION, AND THE HONEST LIMIT OF GUARDING IT. I wrote this bug: a
// `share > 1 ? share/100 : share` heuristic filled 3,189 cells of 5,200 instead of 32, a
// hundredfold error whose only symptom is a darker chart. The >1 refusal catches a percent of 1 or
// more — and CANNOT catch ours, because 0.6133 is a valid fraction AND a valid percent. Every share
// this packet prints is below 1%, since the subject is unreached peoples, so the guard is provably
// useless for the real case. It is the NAME that carries it. Both halves asserted, including the
// half that does not work, because a guard believed to cover more than it does is the worse failure.
let pctErr = null
try { shareCells(100, 52, 61.33) } catch (e) { pctErr = e.message }
ok(!!pctErr && /FRACTION/.test(pctErr), 'a percent of 1 or more is refused outright')
ok(shareCells(100, 52, pct).filled === 3189,
  'but OUR percent passes the guard silently and fills 3,189 cells — the guard cannot see this case, so the call site must name the unit')
ok(Math.abs(fractionFromPercent(pct) - 0.006133) < 1e-12 && shareCells(100, 52, fractionFromPercent(pct)).filled === 32,
  'fractionFromPercent states the unit in the source line, which is the only thing that actually prevents it')

const doxaPop = byId.doxa.population
const per = peoplePerCell(doxaPop, 100, 52)
ok(Math.round(per / 100) * 100 === 40200,
  `each cell stands for about ${Math.round(per).toLocaleString('en')} people — the figure the brief asks to be stated`)

// ── the shading is a SCATTER, which no count-based gate can see ────────────────────────────────
// ★ THIS IS THE ASSERTION THAT WAS MISSING WHEN THE BUG SHIPPED. packet-render's own comment records
// it: 32 contiguous cells fill most of row 1 of 52, so the page printed as one solid bar across the
// header — the ordinary chart the life grid exists to avoid — and the existing gate asserts only
// that the shaded COUNT is between 0 and 5,200, which is equally true of a bar and of a scatter.
// A count cannot distinguish a distribution. A visual review caught it; nothing else could have.
const picked = scatterCells(5200, 32, 'upg-100')
const spread = scatterSpread(picked, 52)
ok(spread.cells === 32, '32 shaded cells are picked, distinct')
ok(spread.rows >= 20, `they land on ${spread.rows} different rows of 100 — a SCATTER, so the eye has to hunt, which is the message`)
// NEG CONTROL: the arm must be able to fail, and the bar is the exact shape it exists to reject.
const bar = new Set(Array.from({ length: 32 }, (_, i) => i))
ok(scatterSpread(bar, 52).rows === 1,
  'NEG CONTROL: the contiguous block that actually shipped touches ONE row, so this arm can fail')

// Deterministic, because two copies of one packet must print identically, and different BETWEEN
// zones so a print run does not carry the same constellation on every sheet.
const again = scatterCells(5200, 32, 'upg-100')
ok([...picked].sort((a, b) => a - b).join() === [...again].sort((a, b) => a - b).join(),
  'the same seed gives the same cells — a packet reprints identically')
ok([...scatterCells(5200, 32, 'europe')].sort((a, b) => a - b).join() !== [...picked].sort((a, b) => a - b).join(),
  'and a different zone gives a different constellation')

// ★ GOLDEN FINGERPRINT, pinning the EXTRACTION. scatterCells was lifted verbatim out of
// packet-render.js's lifeGrid so the printed packet and the reusable chart cannot drift. I proved
// the move behaviour-preserving against the pre-refactor code over 49 seed/count combinations, but
// that probe was one-off and is gone; this is the durable half. If the algorithm is ever "tidied",
// these exact cells change and every already-printed packet stops being reproducible.
const sorted = [...picked].sort((a, b) => a - b)
ok(sorted.slice(0, 5).join(',') === '139,140,221,399,418' && sorted[sorted.length - 1] === 5196 && sorted.reduce((a, b) => a + b, 0) === 67368,
  'the exact cells match the pre-extraction implementation, so a printed packet stays reproducible')

ok(scatterCells(5200, 99999, 'x').size === 5200 && scatterCells(5200, -5, 'x').size === 0,
  'and the count is clamped both ways rather than throwing on a page mid-print')

// ── an anchor that cannot be drawn is NAMED, not dropped (same class as the bracket) ────────────
// ★ FOUND BY SWEEPING FOR THE CLASS, not by waiting for a second report. After the Infinity bracket
// I read the other two templates asking the same question — what does this expression do with an
// edge-case input? LifeCalendar matched its anchor with only an isFinite guard, so week 6000 on a
// 5,200-cell grid, a negative week, or a fractional one matched NO cell and drew nothing. On paper
// that is indistinguishable from having chosen not to mark it, which is the packet's own reason for
// leaving the anchor un-defaulted in the first place — so the silent version quietly tells the
// reader the opposite of what a missing anchor is supposed to mean.
const TOTAL_CELLS = cellCount(100, 52)
ok(anchorPlacement({ week: 0 }, TOTAL_CELLS).index === 0, 'week 0 is drawable — the first cell')
ok(anchorPlacement({ week: 5199 }, TOTAL_CELLS).index === 5199, 'and the last cell is 5,199, not 5,200')
ok(anchorPlacement({ week: 5200 }, TOTAL_CELLS).reason === 'out-of-range',
  'week 5,200 is one past the end and says so rather than drawing nothing')
ok(anchorPlacement({ week: -1 }, TOTAL_CELLS).reason === 'out-of-range', 'a negative week is named')
ok(anchorPlacement({ week: 1.5 }, TOTAL_CELLS).reason === 'not-a-whole-week', 'a fractional week is named')
ok(anchorPlacement({ week: 'soon' }, TOTAL_CELLS).reason === 'not-a-number', 'a non-numeric week is named')
// The deliberate case must stay SILENT: no anchor asked for is not an error, it is the default.
ok(anchorPlacement(null, TOTAL_CELLS).reason === null && anchorPlacement({}, TOTAL_CELLS).reason === null,
  'and NO anchor at all reports nothing — the packet supplies none on purpose, so that is not a fault')

// ── "1 of K lists", where K is unsettled and this asserts nothing about it ──────────────────────
ok(shareOfLists(1, 27).percent.toFixed(2) === '3.70' && shareOfLists(1, 29).percent.toFixed(2) === '3.45',
  'K is a prop: 27 and 29 both compute, and this check takes no side on DECISION-SHEET row 41')
ok(shareOfLists(1, 0) === null && shareOfLists(1, undefined) === null,
  'and a missing K returns null rather than printing Infinity on a page nobody can recall')

// ── the two constraints that live in a PROP DECLARATION, parsed rather than grepped ─────────────
// ★ A DEFAULT IS HOW EITHER OF THESE DIES SILENTLY. ShareCalendar refuses to name its own metric
// because the shipped figure is EVANGELICAL and the brief says "% Christian"; one `default:
// '% Christian'` added by a well-meaning edit reintroduces the exact confusion this project already
// retracted a P0 over, and nothing would look wrong. LifeCalendar's anchor is un-defaulted because
// the packet prints for a reader we do not know and shading their life is a guess presented as
// fact. Both are decisions recorded in a prop object, so the prop object is what gets asserted —
// with the parser, since a regex cannot tokenise JavaScript.
const { parse: parseSfc } = await import('@vue/compiler-sfc')
const { parse: parseJs } = await import('@babel/parser')
const CHARTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'components', 'charts')

function propNode(file, propName) {
  const src = readFileSync(join(CHARTS, file), 'utf8')
  const sfc = parseSfc(src)
  const script = sfc.descriptor.scriptSetup || sfc.descriptor.script
  const ast = parseJs(script.content, { sourceType: 'module', plugins: ['jsx'] })
  let found = null
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'CallExpression' && n.callee && n.callee.name === 'defineProps') {
      const obj = n.arguments && n.arguments[0]
      if (obj && obj.type === 'ObjectExpression') {
        for (const pr of obj.properties) {
          const key = pr.key && (pr.key.name || pr.key.value)
          if (key === propName) found = pr.value
        }
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast.program)
  return found
}
const keysOf = (node) => (node && node.type === 'ObjectExpression'
  ? node.properties.map((pr) => pr.key && (pr.key.name || pr.key.value)) : [])

const shareLabel = propNode('ShareCalendar.vue', 'shareLabel')
ok(keysOf(shareLabel).includes('required') && !keysOf(shareLabel).includes('default'),
  'ShareCalendar.shareLabel is required and has NO default, so the component cannot name its own metric')
const anchor = keysOf(propNode('LifeCalendar.vue', 'anchor'))
ok(anchor.includes('default'),
  'LifeCalendar.anchor declares a default...')
const anchorSrc = readFileSync(join(CHARTS, 'LifeCalendar.vue'), 'utf8')
ok(/anchor:\s*\{[^}]*default:\s*null/.test(anchorSrc),
  '...and that default is null — no invented age, because shading a stranger\'s life is a guess presented as fact')
// NEG CONTROL: the parser really does see a default when one is there, so the arm above can fail.
ok(keysOf(propNode('ShareCalendar.vue', 'population')).includes('default'),
  'NEG CONTROL: a sibling prop WITH a default is detected, so the shareLabel arm is not vacuous')

console.log(fails ? `\nPACKET-CHARTS: ${fails} FAIL(s)` : '\nPACKET-CHARTS: the printed numbers add up, and DOXA is not drawn as a slice')
process.exit(fails ? 1 : 0)
