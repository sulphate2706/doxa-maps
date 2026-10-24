/**
 * ringBands.js — laying many items out in a ring of bands, as PURE FUNCTIONS: rings in, positions
 * out. No Vue, no map engine, no DOM. The set charts consume it; the Wall poster can consume the
 * same module rather than growing a second copy of the same geometry.
 *
 * THE PROBLEM IT SOLVES. layoutCenteredSet gives every group on ring N the SAME radius, so a
 * crowded ring draws as a single line of dots on one circle. The target needs more: each
 * ring is a BAND, and the groups spread evenly THROUGH their band without overlapping each other or
 * the ring's label.
 *
 * ★ DETERMINISM IS A REQUIREMENT, NOT A NICETY. Every position here is a pure function of the item's
 * own id and the ring geometry. Two renders of the same data are byte-identical, in any process, on
 * any day — so two printings of one packet can be compared sheet to sheet, and a reader who sees a
 * dot move knows the DATA moved. There is deliberately no seed parameter: a seed would rescramble
 * every dot while the data was unchanged, which on a printed artefact is unrecoverable.
 * (check:gospel-set-charts asserts the no-seed property on the components that render these.)
 *
 * ★ THE LABEL KEEP-OUT IS A PRECONDITION, NOT A NUDGE. curvedRingLabels() returns the arc its text
 * occupies, and bandFill() refuses to place a pin inside that arc. Computing them from one source is
 * what makes "pins never overlap the labels" true by construction instead of true most of the time.
 */

/** Deterministic 0..1 from a string — FNV-1a. Same id, same number, forever. */
export function hash01(s) {
  let h = 2166136261
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const TAU = Math.PI * 2
/** Normalise any angle into [0, 2pi). */
const norm = (a) => ((a % TAU) + TAU) % TAU

/**
 * Is `angle` inside the arc [start, start+span]? Handles an arc that wraps past 0, which is the
 * case a naive `a >= start && a <= end` gets silently wrong for exactly one label position.
 */
export function inArc(angle, start, span) {
  if (span <= 0) return false
  if (span >= TAU) return true
  const d = norm(angle - start)
  return d <= span
}

/**
 * The label for each ring, set along the INSIDE edge of its band, text following the curve.
 *
 * Returns, per ring: the radius the text sits on, the angle it starts at, the angular span it
 * occupies, and the KEEP-OUT arc (the span plus a margin on each side) that bandFill must avoid.
 *
 * The span is derived from the text's own length: a long name needs more arc than a short one, and
 * guessing one constant for all of them is how a label ends up overlapping a pin on exactly the
 * ring with the longest name.
 */
export function curvedRingLabels(radii, textFor, {
  charWidth = 6.2,          // px per character at the chart's label size
  keepOutMargin = 0.18,     // radians of clearance on EACH side of the text
  angle = -Math.PI / 2,     // where a label starts; -pi/2 is the top of the drawing
  inset = 0.34,             // how far inside the band's outer edge the text sits (0=outer, 1=inner)
  ringGap = 24,
  // No label may take more than this share of its own circle. 0.45 leaves over half the ring for
  // pins on every radius, including the innermost, where the circumference is smallest.
  maxLabelShare = 0.45,
} = {}) {
  const out = []
  for (const { ring, r } of radii) {
    const text = String(textFor ? textFor(ring) : ring)
    // The text sits inside the band's outer edge, so it reads as belonging to THIS ring and not to
    // the gap above it.
    const labelR = r + ringGap / 2 - inset * ringGap
    // Arc length = r * angle, so the angle a string needs shrinks as the ring grows.
    //
    // ★ CAPPED, AND THE CAP IS THE WHOLE POINT ON THE INNER RINGS. Uncapped, a long name on ring 1
    // wants 5.65 rad — 96% of that small circle — which left an arc too short for a single pin, so
    // EVERY group on the innermost ring was reported unplaced and the ring drew empty. The gate
    // passed it, because "reported, not silently dropped" was satisfied; the drawing was still
    // wrong. A real curved label does not wrap a whole circle either — it TRUNCATES. So the span is
    // capped at a share of the circumference and `truncated` says when the caller must shorten the
    // text (with an ellipsis) to match what this geometry reserved.
    const arcLen = text.length * charWidth
    const wanted = labelR > 0 ? arcLen / labelR : 0
    const span = Math.min(wanted, TAU * maxLabelShare)
    const truncated = wanted > span
    // How many characters actually fit in the reserved arc, so the caller can cut the string to it.
    const fitChars = labelR > 0 ? Math.max(Math.floor((span * labelR) / charWidth), 1) : 0
    out.push({
      ring,
      r: labelR,
      text,
      angle,
      span,
      truncated,
      fitChars,
      keepOut: { start: norm(angle - keepOutMargin), span: Math.min(span + 2 * keepOutMargin, TAU) },
    })
  }
  return out
}

/**
 * Place items through their ring's band: even angular spread, non-overlapping, never inside a
 * label's keep-out arc.
 *
 * `minSep` is a SEPARATION IN THE SAME UNITS AS THE RADII — the chart's abstract units, not screen
 * pixels — because this module cannot know the zoom. The caller converts.
 *
 * OVER-FULL RINGS. If a ring cannot fit its items at minSep, the pin radius for that ring SHRINKS
 * toward `minPinFloor` before anything is dropped: a visible pin beats an unplaced one. Only when
 * the floor is reached and they still do not fit is the remainder reported as `unplaced`, with the
 * ring and the counts. Nothing is ever silently overlapped and nothing is ever silently dropped.
 */
export function bandFill(items, radii, {
  ringGap = 24,
  minSep = 7,
  minPinFloor = 2.6,
  pinRadius = 3.4,
  bandInset = 0.16,        // keep pins off the band's own edges, so rings stay legible as rings
  // ★ 'fit' (default) vs 'fill-all'. THE DIFFERENCE IS WHAT THE CHART CLAIMS, not a tuning knob.
  //
  // 'fit' keeps every pin at least minSep apart AT THE CHART'S OWN SCALE, so a ring that cannot
  // hold its groups reports the remainder as unplaced. Honest, and right for a PRINTED sheet, where
  // there is no zoom and a dot a reader cannot resolve is a dot that is not there.
  //
  // 'fill-all' places EVERY group and lets the zoom do the separating: separation is in map units,
  // so it grows with zoom. Measured on the shipped table (7,296 placeable), the worst ring is ring 1
  // at 1,190 groups in the smallest circle, separated by 8px on screen at z=4.45; ring 8 (1,932) at
  // z=3.50. The GROUP label tier already starts at 5.2, so every ring is clickable-separated before
  // the names appear. At the start zoom the band reads as a dense arc of colour rather than
  // countable dots — which is the intended appearance, and the reason a caller in this mode must
  // caption the TRUE total rather than a count that changes with zoom.
  //
  // Default stays 'fit' until row 130 is decided, so this flag changes nothing today.
  mode = 'fit',
  labels = [],
  cx = 0,
  cy = 0,
} = {}) {
  const radiusOf = new Map(radii.map((x) => [x.ring, x.r]))
  const keepOutOf = new Map(labels.map((l) => [l.ring, l.keepOut]))
  const byRing = new Map()
  for (const it of items) {
    if (!radiusOf.has(it.ring)) continue
    if (!byRing.has(it.ring)) byRing.set(it.ring, [])
    byRing.get(it.ring).push(it)
  }

  const placed = []
  const unplaced = []
  const rings = []

  for (const [ring, group] of [...byRing.entries()].sort((a, b) => a[0] - b[0])) {
    const baseR = radiusOf.get(ring)
    const half = (ringGap / 2) * (1 - bandInset)
    const keepOut = keepOutOf.get(ring)
    // The arc actually available, once the label has taken its share.
    const blocked = keepOut ? Math.min(keepOut.span, TAU) : 0
    const usable = Math.max(TAU - blocked, 0)

    // Sort by the item's own hashed angle so the ORDER is deterministic, then space them evenly
    // through the usable arc. Sorting by a hash rather than by id keeps neighbouring ids from
    // clumping together, while staying a pure function of the data.
    const sorted = [...group].sort((a, b) => hash01(a.id) - hash01(b.id) || String(a.id).localeCompare(String(b.id)))

    // ★ A BAND HAS DEPTH, SO IT HOLDS CONCENTRIC ROWS — counting one circle of pins was a 4.7x
    // undercount and it only showed on the real data. On the uniform 12-per-ring sample this module
    // was built against, every ring fitted and the model looked right. The shipped table is heavily
    // skewed (ring 8 carries 1,932 groups, ring 5 carries 100), and there the single-row count
    // placed 962 of 7,296 — it dropped 87% of the map, every drop faithfully REPORTED, which is why
    // no assertion caught it. Capacity is now summed over the rows the band's depth actually allows.
    const innerUsableR = Math.max(baseR - half, 1e-6)
    let pin = pinRadius
    const rowsAt = (p) => Math.max(Math.floor((2 * half) / Math.max(minSep, 2 * p)), 1)
    const capacityAt = (p) => {
      const sep = Math.max(minSep, 2 * p)
      const rows = rowsAt(p)
      let total = 0
      for (let k = 0; k < rows; k++) {
        // Each row sits at its own radius, so each has its own circumference — an outer row of the
        // same band legitimately holds more pins than an inner one.
        const r = Math.max(baseR - half + ((k + 0.5) * (2 * half)) / rows, 1e-6)
        total += Math.floor((usable * r) / sep)
      }
      return Math.max(total, 0)
    }
    let capacity = capacityAt(pin)
    let shrunk = false
    // SHRINK BEFORE DROPPING, to the floor and no further.
    while (capacity < sorted.length && pin > minPinFloor) {
      pin = Math.max(minPinFloor, pin - 0.1)
      capacity = capacityAt(pin)
      shrunk = true
    }

    // In 'fill-all' the ring takes everything: capacity stops being a limit and becomes a REPORT of
    // how many would have been separable at this scale, which is what tells a caller when the chart
    // needs zoom to be readable. The pins still shrink to the floor first, so the dense case is
    // drawn as small as it legibly can be rather than as overlapping full-size dots.
    const takeAll = mode === 'fill-all'
    const fitting = takeAll ? sorted : sorted.slice(0, capacity)
    const overflow = takeAll ? [] : sorted.slice(capacity)

    // Spread the ones that fit through the usable arc, stepping past the label.
    //
    // ★ PLACED ROW BY ROW, because capacity is counted row by row. A hashed radius plus one angular
    // step used to decide position; that was fine while a ring held a dozen pins and wrong as soon
    // as it held hundreds, because two pins could take nearly the same angle at nearly the same
    // radius while the capacity sum insisted there was room. Rows are assigned deterministically
    // from the item's own id, so a group still lands in the same place on every render.
    const startA = keepOut ? norm(keepOut.start + keepOut.span) : 0
    // ★ IN 'fill-all' THE ROW COUNT FOLLOWS THE POPULATION, not the pin size. Keeping the 'fit' row
    // count would pack 1,932 groups into the two rows a band's depth allows at full pin size, and
    // they would sit almost on top of each other along the arc — the single-line defect again, one
    // level down. Enough rows for the band's own depth to be shared evenly: the pins end up closer
    // than minSep at the START zoom, which is exactly what this mode accepts and what zooming
    // resolves. Capped so a ring can never ask for more rows than it has items.
    const rows = takeAll
      ? Math.max(1, Math.min(fitting.length, Math.ceil(fitting.length / Math.max(capacityAt(minPinFloor) / rowsAt(minPinFloor), 1))))
      : rowsAt(pin)
    const rowOf = []                       // how many pins ended up in each row
    for (let k = 0; k < rows; k++) rowOf.push(0)
    // Deal round-robin by the item's hashed order so every row fills evenly rather than the first
    // row taking everything and the outer rows staying empty.
    fitting.forEach((it, i) => {
      const row = i % rows
      rowOf[row]++
    })
    const rowCursor = rowOf.map(() => 0)
    fitting.forEach((it, i) => {
      const row = i % rows
      const perRow = Math.max(rowOf[row], 1)
      const r = Math.max(baseR - half + ((row + 0.5) * (2 * half)) / rows, 1e-6)
      // Each ROW gets its own even spacing across the usable arc. A half-step offset per row keeps
      // adjacent rows from lining their pins up radially, which would read as spokes rather than a
      // filled band.
      const idx = rowCursor[row]++
      // ★ THE STAGGER MUST STAY INSIDE THE USABLE ARC. Adding half a step to every odd row pushed
      // that row's last pin past the end of the arc and into the label's keep-out — measured at 7
      // pins overlapping. Staggering WITHIN the slot keeps every pin inside its own slot, so the
      // row still ends before the label begins however many pins it holds.
      const slot = usable / perRow
      const stagger = row % 2 ? 0.25 : -0.25            // a quarter slot either side of its centre
      const a = norm(startA + slot * (idx + 0.5 + stagger))
      placed.push({
        ...it,
        ring,
        row,
        angle: a,
        r,
        pin,
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
      })
    })
    for (const it of overflow) {
      unplaced.push({ ...it, ring, reason: `ring ${ring} full at the pin floor (${capacity} fit, ${sorted.length} wanted)` })
    }
    rings.push({ ring, wanted: sorted.length, fitted: fitting.length, capacity, pin, shrunk, usableArc: usable })
  }

  return { placed, unplaced, rings, cx, cy, ringGap, minSep }
}

/** Every position is inside its own band — the property the gate asserts rather than trusts. */
export function inBand(p, radii, { ringGap = 24, bandInset = 0.16 } = {}) {
  const base = radii.find((x) => x.ring === p.ring)
  if (!base) return false
  const half = (ringGap / 2) * (1 - bandInset)
  // A float comparison needs a tolerance, or a point exactly on the edge reports as outside.
  return p.r >= base.r - half - 1e-9 && p.r <= base.r + half + 1e-9
}
