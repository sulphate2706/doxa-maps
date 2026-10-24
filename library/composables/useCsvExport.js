/**
 * useCsvExport.js — ★ SHARED LIBRARY CODE (dashboard-kit landing 3). Two parameters make it
 * generic: `exportLabel` (what the file calls itself) and `sources` (who to credit), both
 * defaulting to what research-dashboard shipped. Everything else is unchanged.
 *
 * useCsvExport.js — RDASH phase 4: export-any-selection to CSV (native Blob, 0-dep).
 *
 * Priority model (plan §INTERACTION): selectionSet (explicit picks) > filterSet result (in scope) >
 * full dataset. Serializes the FULL stored record per row (flattening {value,label} -> label),
 * with a '#' provenance header line of the active chips, RFC-ish quoting, and CSV-injection
 * neutralization (leading = + - @ prefixed with a single quote). Shadow-DOM is a non-issue —
 * export touches no rendered DOM/styles.
 *
 * ── ALL-FIELDS EXPORT (card BUILD-CSV-EXPORT-MOVE-TO-TABLE-HEADER-ALL-FIELDS) ──
 * The export must carry EVERY field the API holds, not just the 8 table columns. The limit was
 * never in this file — flatten() already walks Object.keys(record). It was UPSTREAM: the store
 * loads `?fields=<sources.json defaultFields>` (24 keys, ~2.3MB) because that is all the map /
 * table / charts render. The detail endpoint exposes 67.
 *
 * So the wide record is fetched LAZILY, here, on the first export click — not at mount:
 *   - widening sources.json defaultFields would triple the payload (2.3MB -> 6.8MB) for EVERY
 *     bundle that shares that file, to serve one button;
 *   - the list endpoint honors an explicit `fields=` list, so one request returns all 67 keys
 *     for all rows (verified live: 2,107 rows x 67 keys).
 * The result is cached for the session; if the fetch fails we still export the loaded record
 * (24 fields) rather than producing nothing — degraded, never broken.
 */
import { retryFetch } from './retryFetch.js'
import { getApiBaseUrl } from '@map/api/apiBaseUrl.js'
import { inject } from 'vue'
import sourcesConfig from '@map/api/sources.json'
import { applyPeopleGroupList } from '@map/lists/peopleGroupList.js'

/**
 * The full field set for the export, in a stable, human-readable order: identity first, then
 * place, people/language/religion, then the engagement + IMB research columns. Sourced from the
 * live /detail record shape (67 keys); `exportFields` in sources.json overrides it per-source.
 */
export const EXPORT_FIELDS = [
  // identity
  'slug', 'name', 'imb_alternate_name', 'doxa_wagf_uid', 'imb_uid', 'imb_peid', 'imb_pgid',
  'joshua_project_id', 'imb_affinity_code',
  // place
  'latitude', 'longitude', 'country_code', 'region', 'wagf_region', 'wagf_block', 'wagf_member',
  'imb_subregion', 'location_description',
  // people / language
  'rop1', 'imb_reg_of_people_2', 'imb_reg_of_people_25', 'imb_reg_of_people_3',
  'primary_language', 'imb_language_family', 'imb_language_class', 'imb_language_speakers',
  'work_in_local_language', 'imb_is_indigenous',
  // religion
  'religion', 'imb_reg_of_religion_3', 'imb_reg_of_religion_4',
  // population / believers
  'population', 'imb_population_class', 'believers_count', 'evangelical_pct',
  'imb_evangelical_level', 'imb_congregation_existing',
  // prayer + engagement
  'people_praying', 'people_committed', 'committed_duration', 'adopted_by_churches',
  'adopted_by_count', 'adopted_by_names', 'engagement_status', 'status', 'reason_engaged',
  'reason_unlisted', 'global_start_date', 'workers_long_term', 'imb_church_planting',
  'disciple_and_church_multiplication',
  // scripture + media resources
  'imb_bible_available', 'imb_bible_translation_level', 'imb_bible_year_published',
  'imb_bible_stories_available', 'imb_audio_scripture_available', 'imb_gospel_recordings_available',
  'imb_jesus_film_available', 'imb_radio_broadcast_available', 'imb_total_resources_available',
  // priority indices
  'imb_gsec', 'imb_lostness_priority_index', 'imb_strategic_priority_index',
  // media / description
  'has_photo', 'image_url', 'picture_credit', 'imb_people_description',
]

/**
 * @param {(facetKey:string, value:*) => *} [labelFor] display-only projection for the provenance
 *   stamp. The People facets key by CODE (dashboard.config.js:54-57), so without it the header
 *   reads `affinity_bloc=A012` — a code on a user-facing surface, the same bug the filter chip had.
 *   Optional: omitted, the stamp falls back to the raw value, so existing callers keep working.
 *   It is applied to the COMMENT LINE ONLY — never to a data column (see buildCsv).
 */
export function useCsvExport({ rowStore, rows, selectionSet, filterSet, FACET_ACC, dataOpts = {}, labelFor = null,
  // ★ THE TYPED SEARCH NARROWS THE EXPORT TOO. Optional rows->rows transform, so a caller that does not
  // pass it behaves exactly as before. Without it the export ignored the search box completely: with no
  // facet filter and no selection, pickRows() fell through to EVERY row, so a reader who typed "Bhutan"
  // and saw 13 rows downloaded all 2,107. Not applied to an explicit selection — picking rows by hand
  // outranks a text filter, which is the documented priority model, and the reader can see what they picked.
  searchFilter = null,
  // What this export calls itself, and who to credit for the data. Defaults keep every existing
  // caller's file identical to the byte.
  exportLabel = 'Research Dashboard', sources = '',
  // ★ FOUR OPTIONS ADDED BY THE KIT'S FIRST REAL CONSUMER (the gospel-internet dashboard, 2026-09-27). Each one is a
  // pray-tools assumption this file was making silently; each default is exactly what
  // research-dashboard already did, so Big Picture's file is unchanged to the byte. A second
  // consumer is the only thing that finds these — they could not be seen as assumptions
  // while there was one caller.
  //
  // columns: the EXACT column set and order to export. Default = today's behaviour (the canonical
  //   EXPORT_FIELDS order, then any other key the API returned). Its spec asks for the VISIBLE
  //   columns, and projecting rows before handing them over — its workaround — loses the ordering
  //   this file exists to impose.
  columns = null,
  // wide: fetch the ALL-FIELDS record before writing. Default true = today's behaviour. A
  //   static-table dashboard has nothing to widen FROM, so the fetch is a wasted network call that
  //   would also pollute its rows with pray-tools fields.
  wide = true,
  // filename / hookPrefix: what the downloaded file is called, and the window hooks a browser gate
  //   reads. Defaults are the existing literals, and that matters — __rdash* names are read
  //   elsewhere in this tree, so changing the default would break checks that have nothing to do
  //   with this landing.
  filename = 'research-dashboard.csv', hookPrefix = '__rdash',
  // keyOf: how a row identifies itself, for matching a narrow row to its wide twin and for reading
  //   the selection. Default = `slug || id`, which is what this file assumed. config.data.primaryKey
  //   is the config-level spelling of the same thing; the two were flagged as a pair, and they should agree.
  keyOf = (r) => r && (r.slug || r.id),
  // Defaulted so a caller that predates D1 keeps working exactly as before rather than throwing.
  // ★ THE DEFAULT IS ARRAY-AWARE, because it is the LIVE path, not a legacy shim. A filterSet value is
  // an array once two values are selected (spec D1), and `a(r) === ['Hinduism','Islam']` is false for
  // every row — so the export silently produced a file matching NOTHING the moment a reader picked a
  // second value. Measured: DashboardDataTable and DashboardDetailDrawer both rely on this default
  // (only useDashboardShell passes its own), so two of the three live callers exported an empty set.
  // OR within a key, the same rule bus.rowMatchesFilters applies, so the CSV agrees with the screen.
  // Single-value behaviour is unchanged: one value takes exactly the path it always did.
  rowMatches = (r, ACC) => Object.keys(filterSet).every((k) => {
    const a = ACC[k]
    if (!a) return true
    const want = filterSet[k]
    return Array.isArray(want) ? want.some((v) => a(r) === v) : a(r) === want
  }) }) {
  // slug -> wide API record, filled by the lazy all-fields fetch below.
  let wideStore = null
  let widePromise = null
  // The map's people-group LIST (library/lists/). Every caller runs in setup, where inject works.
  let profileConfig = dataOpts.profileConfig || null
  if (!profileConfig) { try { profileConfig = inject('profileConfig', null) } catch (_) { /* outside setup */ } }

  /**
   * Fetch the FULL field set for every row, once per session. Same endpoint + base-URL
   * resolution the row store uses (shared sources.json / getApiBaseUrl), only with an explicit
   * `fields=` covering all of EXPORT_FIELDS instead of the render-sized defaultFields.
   */
  function fetchWideRows() {
    // Nothing to widen FROM without a source, and nothing asked for when wide is off. Returning a
    // resolved null rather than throwing keeps exportCsvAsync's single call site unchanged.
    if (!wide || !(dataOpts && dataOpts.source)) return Promise.resolve(null)
    if (widePromise) return widePromise
    widePromise = (async () => {
      const sourceId = dataOpts.source || sourcesConfig.activeSource
      const src = sourcesConfig?.sources?.[sourceId] || {}
      const fields = (Array.isArray(src.exportFields) && src.exportFields.length) ? src.exportFields : EXPORT_FIELDS
      const bulk = src.endpoints?.bulk || '/api/people-groups/list'
      const lang = src.queryParams?.lang || 'en'
      const url = `${getApiBaseUrl()}${bulk}?fields=${fields.join(',')}&lang=${lang}`
      const res = await retryFetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`export list HTTP ${res.status}`)
      const json = await res.json()
      // Only the groups of this page's people-group LIST (library/lists/) are exported.
      const raw = await applyPeopleGroupList(Array.isArray(json) ? json : (json.posts || json.data || json.results || []), profileConfig)
      const map = new Map()
      for (const r of raw) { const k = keyOf(r); if (k) map.set(k, r) }
      wideStore = map
      return map
    })().catch((e) => { widePromise = null; throw e })   // let a later click retry
    return widePromise
  }

  // Swap a loaded (narrow) row for its wide twin when the all-fields fetch has landed.
  function widen(r) {
    if (!wideStore) return r
    const w = wideStore.get(keyOf(r))
    return w ? { ...r, ...w } : r
  }

  function pickRows() {
    const narrow = (list) => (typeof searchFilter === 'function' ? searchFilter(list) : list)
    if (selectionSet && selectionSet.size) {
      return [...selectionSet].map((s) => rowStore.value.get(s)).filter(Boolean)
    }
    const keys = Object.keys(filterSet)
    if (keys.length) {
      // The bus's own predicate, handed in by the shell — the exporter must select the same rows
      // the reader is looking at, and a private copy of the rule is how an export starts
      // disagreeing with the screen it was taken from.
      return narrow((rows.value || []).filter((r) => rowMatches(r, FACET_ACC)))
    }
    return narrow(rows.value || [])
  }
  function scopeLabel() {
    if (selectionSet && selectionSet.size) return `selection (${selectionSet.size})`
    return Object.keys(filterSet).length ? 'filter result' : 'all'
  }
  // {value,label} -> label; arrays -> ' | '-joined cell (picture_credit / adopted_by_names arrive as
  // arrays of objects, so a bare JSON.stringify would dump unreadable braces into the sheet).
  function cell(v) {
    if (v === null || v === undefined) return v
    if (Array.isArray(v)) return v.map((x) => cell(x)).filter((x) => x !== '' && x !== null && x !== undefined).join(' | ')
    // `link` last: a picture_credit entry can be {link,text} with a null text — fall through to the
    // URL rather than dumping raw JSON braces into the cell.
    if (typeof v === 'object') return v.label ?? v.value ?? v.text ?? v.name ?? v.link ?? JSON.stringify(v)
    return v
  }
  function flatten(r) {
    const o = {}
    for (const k of Object.keys(r)) o[k] = cell(r[k])
    return o
  }
  // Quote if the field has , " CR LF; double internal quotes; neutralize a leading = + - @ TAB or CR (CSV
  // injection: OWASP's full list of formula triggers, since a spreadsheet can strip a leading TAB/CR and then
  // read the = that follows as a formula).
  function esc(v) {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  function buildCsv() {
    const picked = pickRows().map(widen).map(flatten)
    // Column order: the canonical EXPORT_FIELDS order first (so the sheet reads identity → place →
    // people → engagement → resources), then any key the API returned that the list doesn't name.
    // Union across rows, because a null-valued field can be absent on an individual record.
    // An explicit `columns` is taken AS GIVEN — order included, and without filtering to keys that
    // happen to be present. A column the reader can see must appear in the file even when every row
    // in this particular scope has it empty; dropping it would make the export's shape depend on the
    // filter, which is the opposite of what a column picker promises.
    const present = picked.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set }, new Set())
    const cols = Array.isArray(columns) && columns.length
      ? columns.slice()
      : [...EXPORT_FIELDS.filter((k) => present.has(k)), ...[...present].filter((k) => !EXPORT_FIELDS.includes(k))]
    // Provenance stamp — a HUMAN-READABLE COMMENT line, so People codes are resolved to names
    // here exactly as the filter chips do. This is the ONLY place labelFor() is applied: the data
    // columns below are built from the API record via flatten()/cell() and are untouched, because
    // a consumer's formulas and downstream joins key on whatever those columns already emit.
    const chips = Object.entries(filterSet)
      .map(([k, v]) => `${k}=${labelFor ? labelFor(k, v) : v}`)
      .join(' | ') || 'none'
    // ★ THE PROVENANCE LINE IS PARAMETERISED (dashboard-kit landing 3), and it is the one piece of
    // this exporter that was never generic. "Research Dashboard" is this dashboard's name, and the
    // line said nothing about WHERE the data came from — which is the thing a provenance line is for.
    // A partner opening a CSV can see the scope and the filters and still not know who to cite.
    // `sources` is appended only when a caller supplies it, so today's output is byte-for-byte
    // unchanged; the gospel-internet spec asks for exactly this (its tables carry their own meta.sources).
    const provenance = `# ${exportLabel} export — scope: ${scopeLabel()}; filters: ${chips}; rows: ${picked.length}`
      + (sources ? `; sources: ${sources}` : '')
    // ★ THE PROVENANCE LINE GOES LAST, NOT FIRST — that one position was the whole "glitched CSV".
    // Reported 2026-09-22: a CSV exported directly, with no edits, looked a little glitched out.
    //
    // MEASURED with a strict RFC-4180 parser against this exact generator. EVERYTHING ELSE IS CORRECT
    // and must not be "fixed" on suspicion:
    //     line 0 ... 1 column   "# Research Dashboard export — scope: ..."
    //     line 1 ... N columns  slug,name,religion,...
    //     rows   ... N columns each, ZERO with a wrong column count
    //   embedded commas, embedded double quotes AND embedded newlines all survive the round trip, so
    //   esc() is genuinely RFC-4180 (quote when , " CR LF appear; double the internal quotes). The
    //   file is comma-separated, not tab-separated — the tabs in the pasted report were a terminal's
    //   rendering, not the bytes.
    //
    // The defect is purely POSITIONAL: every spreadsheet importer treats the FIRST line as the header.
    // So the scope sentence became the column names, the real header became data row 1, and a 1-column
    // line above a 68-column table is exactly what "glitched" looks like on screen.
    //
    // Moving it BELOW the data keeps the provenance — which is deliberate and load-bearing, since it
    // records WHICH FILTERS produced the file, the difference between a dataset and an anecdote —
    // while making line 1 the header. A trailing 1-column line lands as a final row with one populated
    // cell: obvious to a human, harmless to a formula, and it cannot destroy the column mapping.
    const lines = [cols.map(esc).join(','), ...picked.map((r) => cols.map((c) => esc(r[c])).join(',')), provenance]
    return lines.join('\r\n')
  }
  // Last-export status for UI feedback (toast). The platform gem-frame iframe is sandboxed WITHOUT
  // `allow-downloads`, so the native <a download> is silently blocked there — CLIPBOARD is the robust
  // primary path (the iframe `allow`s clipboard-write); native download still works outside a sandbox.
  const lastExport = { rows: 0, clipboard: false, downloaded: false, at: 0, fields: 0, wide: false }
  function exportCsv() {
    const csv = buildCsv()
    const rows = pickRows().length
    // The header is now line 1 — the '#' provenance comment moved to the END of the file so that a
    // spreadsheet reads the real column row first (see buildCsv). This index had to move WITH it:
    // reading line 2 would have counted the columns of DATA ROW 1, which is usually the same number,
    // so it would have looked correct and been wrong — the quiet kind of breakage a positional change
    // leaves behind.
    const fields = (csv.split('\r\n')[0] || '').split(',').length
    try { if (typeof window !== 'undefined') window[hookPrefix + 'LastCsv'] = csv } catch (_) { /* verify hook */ }
    let clipboard = false, downloaded = false
    // 1) clipboard — works inside the sandboxed gem-frame iframe (the guaranteed path)
    try { if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(csv).catch(() => {}); clipboard = true } } catch (_) { /* no clipboard */ }
    // 2) native file download — works when NOT in a download-blocked sandbox
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none'
      document.body.appendChild(a); a.click(); downloaded = true
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove() } catch (_) {} }, 200)
    } catch (_) { /* download blocked — clipboard above already has it */ }
    Object.assign(lastExport, { rows, clipboard, downloaded, fields, wide: !!wideStore, at: (typeof performance !== 'undefined' ? performance.now() : 0) })
    try { window[hookPrefix + 'ExportStatus'] = { rows, clipboard, downloaded, fields, wide: !!wideStore } } catch (_) {}
    return { csv, rows, clipboard, downloaded, fields, wide: !!wideStore }
  }

  /**
   * The UI entry point: guarantee the ALL-FIELDS record before writing the file.
   *
   * Why this is async but exportCsv() stays sync — navigator.clipboard.writeText() needs the
   * TRANSIENT USER ACTIVATION of the click, and awaiting a network round-trip spends it. So the
   * first click on a cold cache resolves the wide rows and then writes: the download path always
   * works, and the clipboard path is re-attempted. Once cached (every later click) the await
   * settles in a microtask, activation survives, and clipboard works as before.
   * A failed fetch still exports the loaded 24-field record — degraded, never nothing.
   */
  async function exportCsvAsync() {
    try { await fetchWideRows() } catch (_) { /* fall back to the loaded record */ }
    return exportCsv()
  }

  // Let the UI warm the cache (e.g. on hover/mount) so the first real click is already wide.
  function prefetchExportFields() { try { return fetchWideRows() } catch (_) { return null } }

  return { exportCsv, exportCsvAsync, buildCsv, pickRows, scopeLabel, lastExport, prefetchExportFields, EXPORT_FIELDS }
}
