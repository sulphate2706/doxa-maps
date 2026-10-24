// usePosterPrints.js — THE print actions every poster wall shares.
//
// ★ WHY THIS EXISTS. The poster wall was generalised into
// library/components/poster/PosterWall.vue and two bundles were migrated onto it —
// but the ORIGINAL, my-upg-100-list/poster-wall.vue (903 lines), was left behind.
// So the one wall carrying the real print actions is the one wall nothing else can
// benefit from, and the shared component's packet path is still a "coming soon"
// stub. Every print fix made in the 100-list is invisible to the three bundles on
// the shared component, and vice versa. That divergence is the bug.
//
// ── THE SEAM ────────────────────────────────────────────────────────────────
// The PRINT ACTIONS are shareable; the RECORD FETCHING is not. fetchListRecords in
// the 100-list knows the people-groups API, the selector evaluator and the pg_slugs
// special case; Key Cities and Country Posters have entirely different data shapes.
// So this composable takes a `records(item)` PROVIDER and owns everything after it:
// the HUD state machine, the in-place print frame, and the three documents.
//
// That is also what keeps the bundles honest — a wall that cannot supply records
// simply does not pass a provider, and the actions that need them stay hidden
// rather than failing at click time.
//
// ⚠ PRINTS IN PLACE, never window.open(). A popup is blockable and drops the reader
// out of the map; the shared openPrintFrame mounts a hidden same-page iframe. This
// is the mechanism asked for by name: no new browser window, the print dialog
// opening directly in the page.

import { retryFetch } from './retryFetch.js'
import { ref } from 'vue';
import { printDocument } from './printInPlace.js';
import { fetchPosterRaster, fetchPosterSource } from '../packet/poster-fetch.js';
import { keyedError, errorText } from '../i18n/keyedError.js';
// The packet/card text, fetched from the served tree at print time (English bundled as the fallback).
import { loadPacketStrings } from '../packet/packetStrings.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * THE PRINT STANDARD — one call gives any map the poster, the card deck, the prayer list and the
 * prayer packet (full or lightweight) for ANY item: a zone, a country, or a custom list of people.
 * An item is `{ id, label }`; everything specific to the host arrives through the options below,
 * and every one except `records` is optional (an absent option drops only what depends on it).
 *
 * @param {object} opts
 *   records    async (item) => rows[]   — REQUIRED for the list, deck and packet. A row is one people
 *                                         group: { name, slug, population, religion, country_code (ISO3),
 *                                         image_url }. `slug` is the people-groups slug the evangelical
 *                                         and near-neighbour tables join on.
 *   lang       () => string             — the app locale; every print follows it.
 *   label      (item) => string
 *   stock      () => string             — card stock id (see card-render.js STOCK).
 *   state      ref                      — the host's HUD state ref, when it renders its own HUD.
 *   strings    () => Promise<object>    — the packet/card catalog; defaults to the served, pinned
 *                                         packet-strings.json (packet/packetStrings.js, English fallback).
 *   sheet      async (item, format) => html — a map SHEET the host generates now (posterSheets.js
 *                                         generateSheet): 'letter' for the poster print (a vector page),
 *                                         'packet' for the packet's page 1. Tried FIRST by both.
 *   PAGE 1'S MAP, first that yields wins (after `sheet`):
 *   mapImage   async (item) => url      — a map the host GENERATES (a live map's raster / data: URL).
 *   assetsBase () => string             — where a STORED sheet lives (posters/<id>.html), lifted.
 *   iso3Names  () => {ISO3: name}       — the table a stored sheet was labelled from, so its country
 *                                         names print in the packet's language.
 *   DATA PAGES, each omitted when its source is absent:
 *   christian  () => {pctEvangelical…}  — overrides the per-list evangelical share computed from rows.
 *   sets       () => near-neighbour table — the bounded/centered sets page (full packet only).
 *   posterUrl  (item) => string|null    — a pre-rendered poster image, when one exists.
 */
export function usePosterPrints(opts = {}) {
  // ⚠ ACCEPT the caller's state ref when it has one. A wall that renders its OWN
  // exportState while these actions write to a private ref shows no progress and
  // swallows errors — the mechanism works and the feedback does not. Owning a ref
  // here is only the standalone default.
  const exportState = opts.state || ref(null);
  const busy = () => exportState.value !== null;

  const label = opts.label || ((item) => item?.label || item?.id || '');
  const lang = opts.lang || (() => 'en');
  const stock = opts.stock || (() => 'poker');
  // ★ THE HUD SPEAKS THE READER'S LANGUAGE. Every kind and progress message this composable sets is shown
  // in the host's HUD (a dialog a screen reader announces) and was English in every locale. A host that
  // passes `t` (key, params, count) — PosterWall passes its plural-aware translator — gets them
  // localized at the source; without one they stay English, exactly as before. Counts pass their number
  // so each locale picks its own plural form.
  const tr = (key, en, params = null, n = undefined) => {
    const fillEn = () => String(en).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
    if (typeof opts.t !== 'function') return fillEn();
    const v = opts.t(key, params || {}, n);
    return v && v !== key ? v : fillEn();
  };

  const set = (item, kind, phase, message, pct) => {
    exportState.value = { label: label(item), kind, phase, message, pct };
  };
  const done = (item, kind) => {
    set(item, kind, 'done', tr('wall.hud.printOpened', 'print dialog opened'), 100);
    setTimeout(() => { exportState.value = null; }, 900);
  };
  const fail = (item, kind, e) => {
    // a keyed error (keyedError.js) in the reader's language; anything else as its own message
    set(item, kind, 'error', errorText(e, (k, p) => tr(k, k, p)).slice(0, 140), 0);
  };
  function dismiss() {
    const s = exportState.value;
    exportState.value = null;
    try { if (s && typeof s.cancel === 'function') s.cancel(); } catch (_) { /* already gone */ }
  }

  // ★ EVERY DOCUMENT THIS COMPOSABLE PRINTS LEAVES THROUGH HERE (poster, list, card deck, packet). printDocument
  // opens the in-place frame exactly as before, except on a phone, where it prints the PAGE (printInPlace.js says
  // why). A phone whose tap has expired by the time the document is ready gets phase 'ready' with an `action` for a
  // Print button, when the host renders one (opts.tapToPrint); `cancel` removes the document if the reader leaves.
  async function deliver(html, item, kind) {
    const how = await printDocument(html, {
      onNeedsTap: opts.tapToPrint ? (printNow, cancel) => {
        exportState.value = {
          label: label(item), kind, phase: 'ready', message: tr('wall.hud.readyToPrint', 'ready to print'), pct: 100,
          action: () => { exportState.value = null; printNow(); }, cancel,
        };
      } : null,
      // the shared Print bar (a host without tapToPrint) speaks the reader's language too
      labels: { print: tr('wall.hud.printNow', 'Print'), close: tr('buttons.close', 'Close') },
    });
    if (how !== 'needs-tap') done(item, kind);
  }

  async function rows(item) {
    if (typeof opts.records !== 'function') {
      throw new Error('this wall supplies no records provider');
    }
    const r = await opts.records(item);
    if (!r || !r.length) throw keyedError('wall.hud.noRecords', 'that list has no people groups to print');
    return r;
  }

  // ── 1. THE POSTER ─────────────────────────────────────────────────────────
  // Prefers the pre-rendered image; falls back to rasterising the poster's own
  // HTML in the browser, which is what lets the repo stop shipping 41 MB of webp.
  // ★ THIS IS THE WALL'S posterAction='print' PATH, PROMOTED. It was a private function in
  // PosterWall.vue, which meant the MAP LEGEND's own "print this list's poster" had no way to
  // reach it — and the legend had grown a fourth implementation instead: a hand-rolled
  // `<a download>` of the .webp. That was wrong twice over. It silently downloads a file,
  // which is ruled out explicitly (no silent file download as the default action), and it has
  // NO fallback, so on the 27 lists whose .webp does not ship it simply
  // saved a 404.
  //
  // Two guards below were each learned the hard way and MUST survive any future move:
  //   1. a THROWN fetch is a MISS, not an error (blocked/offline/refused reject rather than
  //      returning !ok). Letting it escape skips the rasterise fallback entirely — measured
  //      during the wall migration, when check-poster-print-fallback went PASS -> FAIL with 0
  //      .html requests.
  //   2. a blank raster must fail LOUDLY. An SVG inside an <img> is an isolated document, so a
  //      missing stylesheet paints every fill black with no error at all.
  //
  // `assetsBase` is the seam: the wall and the map profile resolve their own base, and this
  // stays ignorant of where a bundle serves its posters from.
  async function printPoster(item) {
    if (busy()) return;
    const kind = tr('wall.hud.kindPoster', 'Poster');
    const base = opts.assetsBase ? opts.assetsBase() : null;
    const id = item?.id ?? item;
    set(item, kind, 'fetch', tr('wall.hud.fetchingPoster', 'fetching the poster'), 25);
    try {
      // ★ GENERATED FIRST (the print standard: generate at the click, store only previews). A host
      // that can draw the sheet now (opts.sheet -> packet/posterSheets.js) prints it as a VECTOR page on
      // letter paper — no stored file involved. The stored image and HTML remain the fallback for a host
      // that cannot generate, and a generation that fails falls through to them rather than to nothing.
      if (opts.sheet) {
        set(item, kind, 'render', tr('wall.hud.generatingPoster', 'generating the poster'), 35);
        const html = await Promise.resolve().then(() => opts.sheet(item, 'letter')).catch(() => '');
        if (html) {
          set(item, kind, 'save', tr('wall.hud.openingPrint', 'opening the print dialog'), 80);
          await deliver(html, item, kind);
          return;
        }
      }
      // An explicit posterUrl still wins — it is how a caller points at a poster that is not
      // <base>/posters/<id>.webp at all.
      const direct = opts.posterUrl ? opts.posterUrl(item) : null;
      const webp = direct || (base ? `${base}/posters/${id}.webp` : null);
      // Only a real image counts: a host's 200 fallback page is a miss (poster-fetch.js).
      const raster = webp ? await fetchPosterRaster(webp) : null;
      if (raster) { await deliverPoster(raster, item, kind); return; }
      if (!base) throw keyedError('wall.hud.noPoster', 'no poster is available for this list');
      // NO PRE-RENDERED IMAGE? GENERATE IT. The .webp posters are ~41MB across a tree and are
      // not shipped by default; the HTML is the SOURCE and is smaller than the image it makes.
      set(item, kind, 'render', tr('wall.hud.generatingPoster', 'generating the poster'), 45);
      const source = await fetchPosterSource(`${base}/posters/${id}.html`);
      if (!source.html) throw keyedError('wall.hud.posterNotFound', 'poster not found ({status})', { status: source.status });
      const { rasterPoster, looksRendered } = await import('@map/packet/poster-raster.js');
      const blob = await rasterPoster(source.html, { scale: 2 });
      if (!(await looksRendered(blob))) throw keyedError('wall.hud.posterBlank', 'the generated poster came out blank');
      await deliverPoster(blob, item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  // A 3ft SQUARE on a PORTRAIT sheet must fit by its SHORTER axis: scaling to the full page
  // WIDTH makes it taller than the printable height and it overflows onto a second page.
  // Constrain both axes and let object-fit letterbox it.
  const posterObjectUrls = [];
  async function deliverPoster(blob, item, kind) {
    set(item, kind, 'save', tr('wall.hud.openingPrint', 'opening the print dialog'), 80);
    const url = URL.createObjectURL(blob);
    posterObjectUrls.push(url);
    const title = `${opts.downloadPrefix || 'doxa'} — ${label(item)}`;
    await deliver(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>@page{size:letter portrait;margin:12mm}'
      + 'html,body{margin:0;height:100%;background:#fff}'
      + 'body{display:flex;align-items:center;justify-content:center}'
      + 'img{max-width:100%;max-height:100vh;object-fit:contain;display:block}'
      + '@media print{body{height:auto}'
      + 'img{width:auto;max-width:100%;max-height:100%;object-fit:contain}}</style></head>'
      + `<body><img src="${url}" alt="${esc(label(item))}"></body></html>`,
      item, kind,
    );
  }

  // ── 2. THE LIST ───────────────────────────────────────────────────────────
  // The FIRST option, and what the whole app is about: the list itself as a
  // print-paginated table with a prayer checkbox per row.
  async function printList(item, { columns, title } = {}) {
    if (busy()) return;
    const kind = tr('wall.hud.kindList', 'List');
    set(item, kind, 'fetch', tr('wall.hud.fetchingRecords', 'fetching records'), 30);
    try {
      const data = await rows(item);
      const cols = columns || [
        { key: 'name', head: 'Name', cls: 'c-name' },
        { key: 'country_code_label', head: 'Country' },
        { key: 'population', head: 'People', cls: 'c-num', num: true },
        { key: 'religion_label', head: 'Religion' },
      ];
      const head = cols.map((c) => `<th>${esc(c.head)}</th>`).join('') + '<th class="c-pray">✓</th>';
      const body = data.map((r) => '<tr>' + cols.map((c) => {
        const raw = r[c.key] ?? r[`${c.key}_label`] ?? '—';
        const v = c.num && Number.isFinite(Number(raw))
          ? Number(raw).toLocaleString(lang()) : raw;
        return `<td${c.cls ? ` class="${c.cls}"` : ''}>${esc(v)}</td>`;
      }).join('') + '<td class="c-pray">□</td></tr>').join('');

      set(item, kind, 'render', tr('wall.hud.layingOutRows', 'laying out {n} rows', { n: data.length }, data.length), 70);
      const docTitle = title || `${label(item)} — ${data.length}`;
      await deliver(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>`
        + '<style>'
        + '@page{size:letter portrait;margin:14mm 12mm}'
        + 'html,body{margin:0;background:#fff;color:#0f1419;'
        + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"
        + '.hd{margin-bottom:14px}.hd h1{margin:0 0 3px;font-size:18px}'
        + '.hd p{margin:0;font-size:11px;color:#5b6672}'
        + 'table{width:100%;border-collapse:collapse;font-size:11px}'
        + 'thead th{text-align:left;border-bottom:2px solid #0f1419;padding:5px 6px;'
        + 'font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}'
        + 'tbody td{padding:5px 6px;border-bottom:1px solid #e3e6ea}'
        + '.c-name{font-weight:600}.c-num{font-variant-numeric:tabular-nums}'
        + '.c-pray{width:26px;text-align:center;font-size:13px}'
        + 'tbody tr{break-inside:avoid}'
        + '</style></head><body>'
        + `<div class="hd"><h1>${esc(docTitle)}</h1>`
        + `<p>${data.length} entries · pray for them by name</p></div>`
        + `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
        + '</body></html>',
        item, kind,
      );
    } catch (e) { fail(item, kind, e); }
  }

  // ── 3. THE CARD DECK ──────────────────────────────────────────────────────
  // One card per PAGE at the chosen stock, so the print dialog shows CARDS rather
  // than letter paper. The geometry lives in the shared card renderer.
  async function printCardDeck(item) {
    if (busy()) return;
    const kind = tr('wall.hud.kindCardDeck', 'Card Deck');
    set(item, kind, 'fetch', tr('wall.hud.fetchingRecords', 'fetching records'), 30);
    try {
      const data = await rows(item);
      const [{ createCardRenderer }, strings] = await Promise.all([
        import('../packet/card-render.js'),
        opts.strings ? opts.strings() : loadPacketStrings(opts.assetsBase ? opts.assetsBase() : null),
      ]);
      set(item, kind, 'render', tr('wall.hud.layingOutCards', 'laying out {n} cards', { n: data.length }, data.length), 70);
      const R = createCardRenderer({ strings, lang: lang(), stock: stock() });
      await deliver(R.buildDeck(item, data), item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  // ── 4. THE PRAYER PACKET ──────────────────────────────────────────────────
  // The full booklet: map one-pager, people groups 20-per-page with photos, the 12
  // prayer points, the prayer wheel. Shares the renderer with the build-time
  // generator (library/packet/packet-render.js), so a printed packet and a
  // generated one cannot diverge.
  //
  // The MAP PAGE is optional by design: `mapSvg` is supplied by the caller because
  // only the bundle knows where its posters are served from. If it cannot be
  // fetched the packet still prints — a cover without the map beats no packet.
  // `funnel` is the page-2 narrowing data (see packet-render.funnelPage). It is passed THROUGH
  // untouched: this composable does not know how a host defines its lists, and deriving the counts
  // here would make a second source of truth for numbers the Vision Card already publishes.
  // `variant` selects WHICH packet ('full' | 'lightweight' — packet-render's VARIANTS). It defaults
  // to 'full', so every existing caller keeps printing exactly what it prints today.
  // The poster's <svg>, lifted into the packet's map page. Exported-shape helper so the lift is
  // unit-testable against a real generated poster without a fetch.
  // ★ DELEGATES TO THE RENDERER. This used to carry its own copy of the page-1 wrapper (250px down,
  // scale 0.62), one of three identical copies; packet-render.js liftMap is now the only one.
  function liftPosterSvg(html, R, labelFor = null) {
    return R.liftMap(html, { labelFor });
  }

  // The map's country names in the packet's language (packet/mapLabels.js). The sheet is drawn in
  // English from the generator's ISO3 -> name table, and that table is PLUGIN data this library cannot
  // import, so the host supplies it (opts.iso3Names, a loader). Without it, or in English, or on any
  // failure: null, and the sheet prints exactly as drawn. The wall path had no such seam, so a zh
  // packet printed from the wall kept INDIA, CHINA … on page 1 while the list's own path relabelled.
  async function mapLabelFor() {
    if (!opts.iso3Names) return null;
    try {
      const [iso3Name, { makeCountryLabelFor }, countryName] = await Promise.all([
        Promise.resolve().then(() => opts.iso3Names()),
        import('../packet/mapLabels.js'),
        import('../utils/countryName.js').then((m) => m.countryName || m.default),
      ]);
      return makeCountryLabelFor({ iso3Name, countryName, lang: lang() });
    } catch (_) { return null; }
  }

  // The first page-1 map sheet this bundle serves, in the renderer's preference order (the map-only
  // vertical sheet, then the poster). '' when none is reachable — the packet still prints, and page 1
  // says the map is missing.
  async function fetchMapSheet(base, id, R) {
    for (const file of R.mapSheetFiles(id)) {
      try {
        const res = await fetch(`${base}/posters/${file}`, { cache: 'force-cache' });
        if (!res.ok) continue;
        const html = await res.text();
        // A 200 that is not a map sheet (an SPA fallback page) lifts to '' — keep looking.
        if (R.liftMap(html)) return html;
      } catch (_) { /* try the next file */ }
    }
    return '';
  }

  async function printPacket(item, { mapSvg = '', funnel = null, variant = 'full' } = {}) {
    if (busy()) return;
    const kind = tr('wall.hud.kindPacket', 'Prayer Packet');
    set(item, kind, 'fetch', tr('wall.hud.fetchingGroups', 'fetching people groups'), 30);
    try {
      const data = await rows(item);
      // `christian` is the evangelical share behind the packet's %-evangelical page — of THIS packet's
      // own groups, summed from the per-group table (evangelicalShare.js), because the page says each
      // box is a share of the people in this list. It used to be one DOXA-wide figure in every packet.
      // Same seam as strings: a host may still supply its own figure (opts.christian), which wins.
      // `nearTable` feeds the FULL packet's bounded/centered sets page. Same seam as strings and
      // christian: a host that can reach the served asset pool supplies a loader (opts.sets), and a
      // host that cannot simply prints a packet without that page — setsPage's ''-without-data rule.
      // .catch(() => null): the sets page is the one page whose absence must never block a print.
      const [{ createPacketRenderer }, { buildPacketSets }, { evangelicalShareFor }, strings, hostChristian, evTable, nearTable] = await Promise.all([
        import('../packet/packet-render.js'),
        import('../packet/packetSets.js'),
        import('../packet/evangelicalShare.js'),
        opts.strings ? opts.strings() : loadPacketStrings(opts.assetsBase ? opts.assetsBase() : null),
        opts.christian ? opts.christian() : Promise.resolve(null),
        opts.christian ? Promise.resolve(null)
          : import('../../data/people-groups/evangelical-by-slug.json').then((m) => m.default || m).catch(() => null),
        opts.sets ? Promise.resolve().then(() => opts.sets()).catch(() => null) : Promise.resolve(null),
      ]);
      // No table and no host figure: null, and the page is omitted — never a DOXA-wide stand-in.
      const christian = hostChristian || evangelicalShareFor(data, evTable);
      // ★ THE DESCRIBER IS COMPOSED HERE AND INJECTED, because this is the BROWSER path and only it
      // can reach the Vite-only pieces. packet-render.js runs under Node too (the offline generator),
      // where importing describeGroup's country resolver would be fatal — it resolves through the
      // `@map/` alias and imports JSON without an import attribute. So the renderer takes `describe`
      // the same way it takes `strings`, and each host supplies the one it can build.
      // ⚠ Loaded with `.catch(() => null)` rather than awaited unconditionally: a packet that cannot
      // resolve its describer must still PRINT, degrading to the metadata line. The description is
      // the widest column on the page, but it is not worth failing the whole packet for.
      const describe = await Promise.all([
        import('../packets/describeGroup.js').then((m) => m.describeGroup).catch(() => null),
        import('../utils/countryName.js').then((m) => m.countryName || m.default).catch(() => null),
      ]).then(([describeGroup, countryName]) => (describeGroup
        ? (g) => describeGroup(g, lang(), { strings, countryName: countryName || undefined })
        : null));
      const R = createPacketRenderer({ strings, lang: lang(), describe });
      // Photos stay as URLs. The Node generator base64-inlines them so its file is
      // self-contained offline; in a browser the print frame fetches them, and
      // inlining ~95 images client-side would stall the tab for no gain.
      const photos = new Map(
        data.filter((g) => g.image_url).map((g) => [g.slug, g.image_url]),
      );
      set(item, kind, 'render', tr('wall.hud.printingGroups', 'printing {n} people groups', { n: data.length }, data.length), 70);
      // The join runs over the SAME rows the packet prints, so the sets page cannot describe a
      // different population than the profile table beside it.
      // ── DEFAULT SUPPLIERS for hosts that pass nothing — the wall printed a packet MISSING two
      // of its five card pages (no map, no triangle) because only the legend path supplied them.
      // A capability behind an argument nobody passes is a feature that never runs.
      // The funnel default states ONLY the steps: listCount/unassigned stay absent, so funnelPage
      // omits the share line rather than printing a denominator that is wrong under ?list=…
      // (the measured off-by-30 class). Half a fraction is not a fact.
      if (!funnel) {
        funnel = await import('../../data/people-groups/vision-funnel.json')
          .then((m) => { const raw = m.default || m; return raw && Array.isArray(raw.steps) && raw.steps.length ? { steps: raw.steps } : null })
          .catch(() => null);
      }
      // PAGE 1'S MAP, in order: the caller's explicit mapSvg; then a map the HOST GENERATES
      // (opts.mapImage(item) -> an image URL / data: URL of its live map, e.g. a country map that has
      // no stored sheet); then this bundle's own stored sheet. A failed or empty mapImage falls through
      // to the sheet, and a packet with neither says so on page 1 rather than printing it blank.
      // A sheet the host GENERATES now (opts.sheet, the map-only 'packet' format) comes before any
      // image or stored sheet, and its drawn country names relabel like a stored sheet's.
      // `item.mapId` names the sheet when it is not the item's own id (a custom list built from one
      // zone prints that zone's map); `mapId: null` says the item has no sheet (a multi-zone selection),
      // so nothing is generated or fetched and page 1 says the map is missing.
      const mapId = item && 'mapId' in item ? item.mapId : item?.id;
      if (!mapSvg && opts.sheet && mapId) {
        const target = mapId === item?.id ? item : { ...item, id: mapId };
        const html = await Promise.resolve().then(() => opts.sheet(target, 'packet')).catch(() => '');
        if (html) mapSvg = R.liftMap(html, { labelFor: await mapLabelFor() });
      }
      if (!mapSvg && opts.mapImage) {
        const src = await Promise.resolve().then(() => opts.mapImage(item)).catch(() => null);
        mapSvg = src ? R.mapFromImage(src) : '';
      }
      if (!mapSvg && opts.assetsBase && mapId) {
        const [sheet, labelFor] = await Promise.all([fetchMapSheet(opts.assetsBase(), mapId, R), mapLabelFor()]);
        mapSvg = liftPosterSvg(sheet, R, labelFor);
      }
      const sets = nearTable ? buildPacketSets(data, nearTable) : null;
      await deliver(R.buildPacket(item, data, photos, mapSvg, funnel, christian, variant, sets), item, kind);
    } catch (e) { fail(item, kind, e); }
  }

  return { exportState, dismiss, printPoster, printList, printCardDeck, printPacket };
}
