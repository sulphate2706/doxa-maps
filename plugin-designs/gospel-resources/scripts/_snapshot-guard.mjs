/**
 * _snapshot-guard.mjs — refuse to replace a good catalogue snapshot with a worse one.
 *
 * THE FAILURE THIS EXISTS FOR, MEASURED, NOT IMAGINED. The FCBH fetcher read per-fileset
 * video scope for 1,666 languages and that file was committed. A later run of the same
 * script, while live.bible.is was rate-limiting, got 1,103 — and overwrote the good file
 * with the degraded one. Nothing failed, nothing warned, and the artefact silently lost a
 * third of its content. It was caught only because `git status` happened to be read.
 *
 * It is the third time this shape has appeared in this bundle:
 *   - a VERIFY_LIMIT smoke run replaced the full verification table with 30 rows;
 *   - dropping a dead link removed it from the corpus, so the next run forgot it was dead
 *     and the build put it straight back;
 *   - this one.
 * Every snapshot here is built from a NETWORK read, and a network read has a bad day. The
 * dangerous case is not the run that throws — that leaves the old file alone — it is the
 * run that half-succeeds and writes anyway.
 *
 * THE RULE: a snapshot may grow freely, and may shrink a little, but a large drop is
 * treated as a failed run rather than as news. The count compared is whatever the caller
 * says identifies the snapshot's content (languages, codes, entries).
 *
 * Deliberately NOT a hard equality check: catalogues genuinely do lose entries when a
 * publisher retires something, and a gate nobody can satisfy gets switched off. The
 * threshold is a floor on the fraction retained, and it is overridable in one obvious,
 * loud way for the case where the drop is real.
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** Default: a run that lost more than 10% of the previous snapshot is not trusted. */
const FLOOR = Number(process.env.SNAPSHOT_FLOOR || 0.9)
const FORCE = process.env.SNAPSHOT_FORCE === '1'

/**
 * @param {string} out       absolute path to write
 * @param {string} body      the serialised snapshot
 * @param {(json:any)=>number} countOf   how to count what matters in this snapshot
 * @param {string} label     what the count is, for the message
 */
export function writeSnapshot(out, body, countOf, label) {
  const next = countOf(JSON.parse(body))
  let prev = null
  try { prev = countOf(JSON.parse(readFileSync(out, 'utf8'))) } catch { prev = null }

  if (prev !== null && prev > 0 && next < prev * FLOOR) {
    const lost = prev - next
    const pct = ((100 * lost) / prev).toFixed(1)
    if (!FORCE) {
      console.error(
        `SNAPSHOT GUARD: REFUSING TO WRITE ${out}\n` +
        `  this run produced ${next} ${label}; the file on disk has ${prev}.\n` +
        `  That is ${lost} fewer (${pct}%), below the ${(FLOOR * 100).toFixed(0)}% floor.\n` +
        `  A half-finished network read looks exactly like this, and overwriting would\n` +
        `  destroy good data silently. The existing file is UNCHANGED.\n` +
        `  If the drop is real (a publisher retired entries), rerun with SNAPSHOT_FORCE=1.`,
      )
      process.exit(1)
    }
    console.warn(`SNAPSHOT GUARD: ${next} ${label} vs ${prev} on disk (${pct}% lost) — writing anyway because SNAPSHOT_FORCE=1.`)
    writeFileSync(out, body)
    return
  }

  writeFileSync(out, body)
  if (prev === null) console.log(`SNAPSHOT GUARD: no previous ${out} to compare; wrote ${next} ${label}.`)
  else if (next < prev) console.log(`SNAPSHOT GUARD: ${next} ${label} (was ${prev}) — a small drop, within the floor.`)
  else console.log(`SNAPSHOT GUARD: ${next} ${label} (was ${prev}).`)
}
