/**
 * packetCharts.js — the arithmetic behind the packet's inverted triangle and its two calendars.
 *
 * Split out of the components so the numbers can be tested without mounting anything, the same way
 * listSelection.js sits beside ListSelectorLegend.vue. Every figure a reader sees on a printed
 * packet passes through here, and a printed page cannot be corrected after it is handed out.
 */

/**
 * ★ THE STEPS MUST NEST, AND THIS REFUSES THEM WHEN THEY DO NOT.
 *
 * The triangle's whole rhetoric is containment: of all peoples, these are unreached; of those,
 * these are frontier. That reading is only honest while each step is a SUBSET of the one above,
 * and the research names a live way to break it — Joshua Project counts 16,426 peoples-by-country
 * where IMB counts 12,379, and putting JP's number on top of IMB's steps produces a funnel whose
 * first step does not contain its second (UPG100-RESEARCH-FINDINGS.md §3).
 *
 * That failure has no visual symptom. The triangle still draws, still narrows, still looks correct;
 * only the claim is wrong. So this throws rather than clamping or sorting: given a shape someone
 * will print and hand to a reader, a loud refusal beats a plausible picture.
 */
export function assertNested(steps) {
  const s = steps || []
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]
    const cur = s[i]
    if (!(cur.groups <= prev.groups)) {
      throw new Error(
        `funnel steps do not nest: "${cur.id}" has ${cur.groups} groups but sits inside "${prev.id}" with ${prev.groups}. ` +
        'A funnel claims containment, so a step can never be larger than the one above it.')
    }
    if (cur.population != null && prev.population != null && !(cur.population <= prev.population)) {
      throw new Error(
        `funnel populations do not nest: "${cur.id}" has ${cur.population} people inside "${prev.id}" with ${prev.population}.`)
    }
  }
  return s
}

/**
 * ★ ONE PUBLISHER PER FUNNEL, and this is a SEPARATE check from nesting because the numbers alone
 * cannot catch it.
 *
 * The research names mixing publishers as the live hazard: Joshua Project counts 16,426
 * peoples-by-country where IMB counts 12,379 (UPG100-RESEARCH-FINDINGS.md §3). I first wrote that
 * warning into assertNested's error message and the test proved the claim false — 16,426 on top of
 * 12,379 IS monotonic, so nesting arithmetic accepts it happily. The two counts are not the same
 * KIND of thing (peoples-by-country vs peoples), and no comparison of magnitudes can tell you that.
 *
 * So the detector has to read what the numbers are OF, not what they are. Each step declares its
 * source; if they disagree, the funnel is comparing two universes and is refused. A message that
 * names a cause its own code cannot detect is worse than no message: it sends the next reader to
 * look for the wrong thing.
 */
export function assertOnePublisher(steps) {
  const named = (steps || []).filter((s) => s && s.source)
  const sources = [...new Set(named.map((s) => String(s.source)))]
  if (sources.length > 1) {
    throw new Error(
      `funnel steps mix publishers: ${sources.join(' and ')}. A funnel claims containment, and two ` +
      'publishers count different things — Joshua Project counts peoples-by-country, IMB counts peoples — ' +
      'so one cannot be a subset of the other however the totals happen to compare. Use one source for every step.')
  }
  return steps || []
}

/**
 * ★ AN OVERLAY IS NOT A STEP, and conflating them is the error this file exists to prevent.
 *
 * DOXA is not a subset of frontier: of its 2,107 groups, 1,745 are frontier and 2,082 unreached
 * (vision-funnel.json records both). So drawing DOXA as a fourth nested band asserts a containment
 * that is false. An overlay therefore carries `within` — how much of it falls inside each step —
 * and is drawn crossing the steps rather than under them.
 *
 * Returns the overlay's position WITHOUT ever implying containment: the caller gets the parts, and
 * a `spans` list naming every step the overlay reaches into, so a legend can say so in words.
 */
export function overlayPlacement(overlay, steps) {
  const within = (overlay && overlay.within) || {}
  const ids = (steps || []).map((s) => s.id)
  const spans = ids.filter((id) => Number(within[id]) > 0)
  const inside = spans.reduce((n, id) => Math.max(n, Number(within[id]) || 0), 0)
  const total = Number(overlay && overlay.groups) || 0
  return {
    id: overlay && overlay.id,
    groups: total,
    spans,                                  // every step it reaches into, in step order
    outside: Math.max(0, total - inside),   // the part no step contains
    // True only when the overlay falls entirely inside ONE step. Anything else must not be drawn
    // as a slice, and the component asks this rather than deciding for itself.
    isSlice: spans.length === 1 && inside === total,
  }
}

/**
 * The overlay's numbers as TEXT, because a printed page has no hover.
 *
 * upg100's constraint, and it is the one that decides whether the overlay is honest or merely
 * pretty: an unexplained band crossing the triangle tells a reader nothing. The parts have to be
 * inked — "2,107 in this network — 2,082 unreached, 1,745 frontier" — or the overlay is decoration.
 * Returns the parts in step order with the labels the caller supplies; it never writes prose itself,
 * because the packet prints in every locale we ship.
 */
export function overlayCaption(overlay, steps) {
  const place = overlayPlacement(overlay, steps)
  const within = (overlay && overlay.within) || {}
  return {
    id: place.id,
    total: place.groups,
    parts: (steps || [])
      .filter((s) => Number(within[s.id]) > 0)
      .map((s) => ({ stepId: s.id, groups: Number(within[s.id]) })),
    // The part of the overlay that NO step contains, which is the whole reason it is not a slice.
    outside: place.outside,
    isSlice: place.isSlice,
  }
}

/**
 * Where an overlay's bracket starts and ends, or null when it cannot be placed at all.
 *
 * ★ null IS THE POINT. An overlay whose `within` is missing, empty, or names a step that does not
 * exist has no known relationship to the funnel — and "unknown" must never be drawn, because a
 * drawn bracket asserts a span. This lived inline in the component as
 * `Math.min(...idx)` / `Math.max(...idx)`, which on an empty list returns Infinity and -Infinity,
 * so the bracket rendered at y=Infinity with height -Infinity: an invalid rect that SVG discards
 * without complaint. The overlay simply vanished, and its groups vanished with it.
 *
 * It is an easy input to get wrong, too: `within` is the unusual half of the API, and an overlay
 * written as { id, label, groups } alone looks complete. So the caller gets null and the component
 * says so in ink rather than drawing nothing and calling it a chart.
 */
export function bracketSpan(overlay, steps) {
  const cap = overlayCaption(overlay, steps)
  const idx = cap.parts
    .map((part) => (steps || []).findIndex((s) => s.id === part.stepId))
    .filter((i) => i >= 0)
  if (!idx.length) return null
  return { from: Math.min(...idx), to: Math.max(...idx) }
}

/** Cells in a calendar grid. 100 years x 52 weeks is 5,200. */
export function cellCount(rows, columns) {
  return (Number(rows) || 0) * (Number(columns) || 0)
}

/**
 * How many people one cell stands for, and how many cells a share fills.
 *
 * ★ THE ROUNDED CELL COUNT IS NOT THE MEASUREMENT, so both come back. At 0.6133% of 5,200 the
 * honest number is 31.9 cells; a reader sees 32 squares and there is no way to draw 31.9. The
 * caption carries `exact` so the drawn integer never reads as precise, and `roundedUpFromBelowOne`
 * flags the one case where rounding changes the KIND of statement being made: a share small enough
 * to fill less than a single cell, drawn as one cell, says "at least one" where the data said
 * "almost none".
 */
export function shareCells(rows, columns, share) {
  const total = cellCount(rows, columns)
  const s = Number(share) || 0
  // ★ A FRACTION, NEVER A PERCENT, and it refuses rather than guessing. The shipped field is named
  // pctEvangelical and holds 0.6133 meaning 0.6133% — so the same numeral is a plausible FRACTION
  // (61.33%) and a plausible PERCENT (0.61%), and nothing in the value says which. I wrote a
  // `share > 1 ? share/100 : share` heuristic here and it silently produced 3,189 filled cells
  // instead of 32: a hundredfold error, on a printed page, with no symptom but a darker chart.
  // No heuristic can tell these apart, so the caller converts and this refuses the impossible half.
  if (s > 1) {
    throw new Error(
      `share must be a FRACTION, got ${s}. A share above 1 would be more than 100%. ` +
      'If this came from a field named pct… it is a percent — use fractionFromPercent().')
  }
  const exact = total * s
  const filled = Math.round(exact)
  return {
    total,
    exact,
    filled,
    roundedUpFromBelowOne: exact > 0 && exact < 1 && filled >= 1,
    roundedToZero: exact > 0 && filled === 0,
  }
}

/**
 * ★ THE UNIT LIVES IN THE FUNCTION NAME, because for our actual numbers no check can recover it.
 *
 * The refusal above catches a percent of 1 or more. It CANNOT catch ours: pctEvangelical is 0.6133,
 * which is a perfectly valid fraction meaning 61.33%, and a perfectly valid percent meaning 0.61%.
 * Nothing in the value distinguishes them, so every share below 1% — which is every share this
 * packet will ever print, since the whole point is unreached peoples — passes any guard silently
 * and draws a chart that is a hundred times too dark.
 *
 * So the guard is not the protection; the NAME is. Call sites read
 * `shareCells(100, 52, fractionFromPercent(data.pctEvangelical))`, where the unit is stated twice
 * and a mismatch is visible in the source line rather than in a printed packet.
 */
export function fractionFromPercent(percent) {
  return (Number(percent) || 0) / 100
}

/**
 * The FIRST n cells, in reading order — the counterpart to scatterCells.
 *
 * ★ WHY BOTH EXIST, because the difference is the whole point of the page. scatterCells answers
 * "where in a life do these weeks fall" — unknowable, so it spreads them and says so. topCells
 * answers "how much of the whole is this" — a MAGNITUDE, and a magnitude read off scattered
 * confetti cannot be compared to another magnitude at a glance. Filling from the top turns the grid
 * into a bar a reader can measure against its own frame: the same 32 cells that vanish when
 * scattered are an obvious sliver when stacked.
 *
 * Deterministic with no seed, because there is nothing to randomise — index 0..n-1. Takes the same
 * (total, n) as scatterCells so a caller can swap one for the other without reshaping anything.
 */
export function topCells(total, n) {
  const TOTAL = Math.max(0, Number(total) || 0)
  const count = Math.max(0, Math.min(TOTAL, Math.round(Number(n) || 0)))
  const picked = new Set()
  for (let i = 0; i < count; i++) picked.add(i)
  return picked
}

/**
 * ★ WHICH cells are shaded, deterministically — LIFTED VERBATIM from packet-render.js's lifeGrid so
 * there is ONE implementation rather than a component and a renderer that drift.
 *
 * The algorithm and the reasoning are not mine; both are carried across intact. Two properties the
 * packet depends on, and the second is the one that cost a shipped page:
 *
 * DETERMINISTIC, never Math.random(): the same packet must print identically every time, or two
 * copies of one zone disagree and neither is reproducible. FNV-1a over the seed feeds a mulberry32
 * PRNG, so the pattern is stable per zone and different BETWEEN zones, which also stops every packet
 * in a print run carrying the same constellation.
 *
 * SCATTERED, NOT STACKED. The original comment reasoned that a contiguous run would read better;
 * the render showed the opposite — 32 contiguous cells fill most of row 1 of 52, so the page printed
 * as one solid bar across the header, the ordinary chart the life grid exists to avoid. The message
 * is rarity: 32 boxes lost among 5,200, and the eye has to hunt for them. Scattering IS the point.
 *
 * ⚠ AND NO GATE COULD SEE IT — the existing check asserts the shaded COUNT is between 0 and 5,200,
 * which is equally true of a scatter and of a bar. A count cannot distinguish a distribution. That
 * is why scatterSpread() below exists and why check-packet-charts asserts the shape, not the total.
 */
export function scatterCells(total, n, seed = '') {
  const TOTAL = Math.max(0, Number(total) || 0)
  const count = Math.max(0, Math.min(TOTAL, Math.round(Number(n) || 0)))
  let h = 2166136261
  const key = String(seed)
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  const rand = () => {
    h |= 0; h = (h + 0x6D2B79F5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // Partial Fisher-Yates over the index space: n distinct cells without shuffling all 5,200.
  const idx = []
  for (let i = 0; i < TOTAL; i++) idx.push(i)
  const picked = new Set()
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(rand() * (TOTAL - k))
    const t = idx[k]; idx[k] = idx[j]; idx[j] = t
    picked.add(idx[k])
  }
  return picked
}

/**
 * How spread out a shading is, so a gate can tell a scatter from a bar.
 *
 * `rows` is how many distinct grid rows the shaded cells touch. A contiguous block of 32 in a
 * 52-wide grid touches 1; a scatter of 32 over 5,200 touches close to 32. That single number is the
 * difference between the page that was asked for and the one that shipped.
 */
export function scatterSpread(picked, columns) {
  const cols = Number(columns) || 1
  const rows = new Set()
  for (const i of picked) rows.add(Math.floor(i / cols))
  return { cells: picked.size, rows: rows.size }
}

/**
 * Where an anchor week sits in the grid, or a reason it does not.
 *
 * ★ SAME SILENT-DROP CLASS AS THE FUNNEL'S INFINITY BRACKET, found by sweeping for it rather than
 * waiting for it. The component matched the anchor by comparing a cell index to Number(anchor.week)
 * with only an isFinite guard, so week 6000 on a 5,200-cell grid, a negative week, or a fractional
 * one matched NO cell and drew nothing — the anchor the caller asked for simply was not there, with
 * no error and no gap. On a printed page that is indistinguishable from "we chose not to mark it".
 *
 * Returns { index } when it can be drawn, or { index: -1, reason } when it cannot, so the component
 * can say so instead of silently omitting it.
 */
export function anchorPlacement(anchor, total) {
  if (!anchor || anchor.week == null) return { index: -1, reason: null }   // no anchor asked for
  const w = Number(anchor.week)
  if (!Number.isFinite(w)) return { index: -1, reason: 'not-a-number' }
  if (!Number.isInteger(w)) return { index: -1, reason: 'not-a-whole-week' }
  if (w < 0 || w >= (Number(total) || 0)) return { index: -1, reason: 'out-of-range' }
  return { index: w, reason: null }
}

/** People per cell, for the caption the brief asks for explicitly. */
export function peoplePerCell(population, rows, columns) {
  const total = cellCount(rows, columns)
  if (!total) return 0
  return (Number(population) || 0) / total
}

/**
 * "1 of K lists = N%". K is unsettled (27 or 29, DECISION-SHEET row 41), so it is a prop and this
 * asserts nothing about its value — it only refuses a division that would print Infinity or NaN on
 * a page nobody can recall.
 */
export function shareOfLists(index, total) {
  const k = Number(total) || 0
  if (k <= 0) return null
  return { index: Number(index) || 0, total: k, percent: 100 / k }
}
