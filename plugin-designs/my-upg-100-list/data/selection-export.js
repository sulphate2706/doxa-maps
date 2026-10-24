// selection-export.js — what the batch selection's Copy and Export CSV buttons produce. PURE: no DOM, no
// fetch, so internal/check-batch-selection-export.mjs gates it headless.
//
// ★ WHY THE SELECTION IS EXPORTED AT ALL: when the people-group data changes, a partner redraws the zone
// boundaries on the map, exports, and hands the export to an agent, which regroups the zones and regenerates
// the posters. Without the export the maps cannot be reproduced.
//
// THE CLIPBOARD TEXT, in this order:
//   line 1  "NPL, BTN, … — {total} UUPG · #hex"      formatClipboard's line in MACHINE names (payloadName):
//                                                     data/apply-grouping.mjs parses AND resolves it, so it MUST stay first
//   line 2  "Nepal 34, Bhutan 13, …"                 the per-territory breakdown, in the reader's names
//   blank line, then the SAME CSV that Export CSV downloads (when the people groups could be detected).
//
// THE CSV: one row per people group, header first, CRLF line ends. The cells follow the library's rules
// (useCsvExport's esc): quote a cell holding , " CR or LF and double its quotes; prefix a leading = + - @
// with a single quote, so a spreadsheet never runs a name as a formula. Also a leading TAB or CR (OWASP's
// full list of formula triggers; the library's esc stops at = + - @).
import { formatClipboard } from './territory-counts.js';

export const SELECTION_CSV_COLUMNS = ['slug', 'name', 'country_code', 'population', 'territories', 'color'];

export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * @param {Array<{slug,name,country_code,population}>} records  the detected people groups
 * @param {Map<string,string[]>} territoriesBySlug  slug → the selected territories that contain it
 * @param {{color?: string}} opts  the picked selection colour ('#rrggbb' or '')
 */
export function selectionCsv(records, territoriesBySlug = new Map(), opts = {}) {
  const color = opts && typeof opts.color === 'string' ? opts.color : '';
  const rows = (records || []).map((r) => [
    r.slug, r.name, r.country_code, r.population,
    (territoriesBySlug.get(r.slug) || []).join('; '), color,
  ].map(csvCell).join(','));
  return [SELECTION_CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

// ★ LINE 1 IS A MACHINE CONTRACT: data/apply-grouping.mjs resolves every name in it, so it carries the names that
// tool resolves in EVERY UI language, never the reader's translation (an Arabic "نيبال, بوتان" was rejected:
// "unresolved territory name(s)"). A country is its ISO3 code, the only country form apply-grouping resolves for
// every country (its friendly-name table has ~15); a state or province is its shape name, already canonical; a
// zone keeps its name. The reader's own names stay on line 2, in the HUD and in the CSV.
export function payloadName(t) {
  if (t && t.kind === 'adm0') return String(t.key || '').replace(/^adm0:/, '') || t.name;
  return t ? t.name : '';
}

// apply-grouping regroups ONE kind at a time: India's states, China's provinces, or countries. A mix of kinds is
// refused ("a zone must be all-India, all-China, or all-uncovered"), and so is a legend zone's name (it is not a
// territory). Copy still copies such a selection; the flash says its first line will not regroup.
export function regroupKind(t) {
  if (!t) return 'unknown';
  if (t.kind === 'adm0') return 'uncovered';
  if (t.kind === 'adm1') return t.country === 'CHN' ? 'china' : t.country === 'IND' ? 'india' : 'unknown';
  return 'zone';
}
export function regroupable(selection) {
  const kinds = new Set((selection || []).map(regroupKind));
  return kinds.size === 1 && !kinds.has('zone') && !kinds.has('unknown');
}

/** The clipboard text: apply-grouping's line (machine names), the reader's breakdown, then the CSV after a blank line. */
export function selectionClipboard(selection, opts = {}, csv = '') {
  const color = opts && opts.color ? opts.color : '';
  const sel = Array.isArray(selection) ? selection : [];
  const line1 = formatClipboard(sel.map((t) => ({ ...t, name: payloadName(t) })), { color }).split('\n')[0];
  const line2 = formatClipboard(sel, { color }).split('\n')[1];
  const head = line1 + '\n' + line2;
  return csv ? head + '\n\n' + csv : head;
}

/**
 * `promise` if it settles within `ms`, else `marker`. A rejection still rejects (so a load failure keeps its own
 * message). Copy uses it so a stalled people-group load can never hold the territory lines hostage: those need
 * no network, and apply-grouping needs nothing else.
 */
export function settleWithin(promise, ms, marker) {
  let timer = 0;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(marker), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The error a READER sees for a failed load. One that already carries a catalogue key (keyedError: an HTTP status,
 * no service configured) passes through, because its text is already true and translated. Anything else (the
 * request aborted by our own timeout, the network gone, a body that is not JSON) arrives as the browser's raw English
 * ("signal is aborted without reason"), so it becomes `fallback(e)`, the keyed "still loading, try again" text. The
 * failed load leaves the cache, so trying again really does fetch again.
 */
export function asReaderError(e, fallback) {
  return e && e.i18nKey ? e : fallback(e);
}

/**
 * The names a selection's Prayer list and Card deck are titled by: its zones (already localized by the caller), its
 * countries, and the India states and union territories that BROUGHT people (`from`: slug → the territory names
 * that contain it). A province with no table, or a state with none listed, is not named as though it were printed.
 * ★ THE STATES WERE MISSING, and a state-only selection then had NO names: reduce() threw "Reduce of empty array"
 * at the reader. A selection that brought nobody throws `noRecords()` (the caller's keyed error) instead, so the
 * list is never empty.
 */
export function selectionTitleNames(zoneNames, territories, from, noRecords) {
  if (!from || !from.size) throw noRecords();
  const contributing = new Set([...from.values()].flat());
  const countries = territories.filter((t) => t.kind === 'adm0').map((t) => t.name);
  const states = territories.filter((t) => t.kind === 'adm1' && contributing.has(t.name)).map((t) => t.name);
  return [...zoneNames, ...countries, ...states];
}

/**
 * ★ A SELECTION TOO BIG FOR A PHONE'S PRINT. Building the document is never the problem: on a 4×-throttled phone
 * context the WHOLE selection (all 28 territories, 2,209 groups) is ready in 19.5 s as a Prayer list and 27 s as a
 * card deck. Printing it is. The print/preview path, measured as page.pdf of the same document in a browser capped
 * at 2.5 GB:
 *   905 groups (India)   54 sheets   50 MB PDF   45 s at 4×
 *   1,324 / 1,497 / 1,857 groups   75 / 83 / 101 sheets   98 / 127 / 138 MB   54-62 s at 1×
 *   2,209 groups   113 sheets   the page CRASHED (at 1× and at 4×; ~1.8 GB resident when it died)
 * A phone tab gets roughly half that memory, so the ceiling is about half the largest that finished: 1,000. India
 * alone (905) still prints on a phone; anything bigger asks for a computer, in the words Country Posters uses for
 * whole India (poster.phoneLimitAll). Copy and CSV are cheap and stay allowed.
 */
export const PHONE_GROUP_CEILING = 1000;
export function overPhoneCeiling(count, onPhone, ceiling = PHONE_GROUP_CEILING) {
  return Boolean(onPhone) && Number(count) > ceiling;
}

/** A file name a partner can recognise: the selection's label, reduced to safe characters. */
export function selectionCsvFileName(label) {
  const base = String(label || 'selection').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'selection';
  return `upg-100-${base}.csv`;
}

export default { SELECTION_CSV_COLUMNS, csvCell, payloadName, regroupKind, regroupable, selectionCsv, selectionClipboard, settleWithin, asReaderError, selectionTitleNames, PHONE_GROUP_CEILING, overPhoneCeiling, selectionCsvFileName };
