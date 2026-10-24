// packet-render.js — THE prayer packet renderer, shared by both callers.
//
// ★ ONE RENDERER, TWO CALLERS. The packet is produced in two places:
//   - library/scripts/posters/packet.mjs   (build time, Node, writes files)
//   - the UPG-100 legend's Export > Prayer packet action (click time, browser)
// Both import THIS module, so a change to a page lands in both. That is the design:
// reuse the existing print actions rather than grow a fourth implementation.
//
// It is pure: no fs, no process, no DOM. Everything it needs is passed in —
// strings, language, the zone, its groups, photos, and the map SVG. That is what
// lets the same code run under Node and in a browser tab.
//
// PAGE ORDER IS THE PRODUCT SPEC — change it only when the spec does, and update THIS comment in
// the same commit (it has gone stale twice; buildPacket's own comment is the authoritative copy):
//   1        the map one-pager
//   2        the inverted triangle (funnel)
//   3        the life calendar   4  the %-evangelical grid     (full detail only)
//   5..n     the people groups, 20 per page, with photos
//   then     the bounded/centered sets (full only), the prayer WHEEL, the 12 prayer POINTS
//
// I18N: every human-readable string comes from packet-strings.json. A new language
// is a NEW BLOCK there, never a code change, and fallback is PER KEY so a
// half-finished translation renders its finished keys instead of blanking.

// Right-to-left locales. Kept as data rather than a per-language flag in the
// catalog: script direction is a property of the LANGUAGE, not of a translation,
// so a new Arabic-script locale is one entry here and not a schema change.
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

// Scripts with no coverage in the packet's Georgia/Palatino/serif stack, mapped to
// the vendored face that does cover them. MEASURED by rendering each script at 48px
// and reading the PIXELS: Latin, Cyrillic, Arabic and CJK all shape correctly with
// system fonts; DEVANAGARI renders as tofu boxes.
// ⚠ A width heuristic got this exactly backwards — it reported Arabic and Chinese
// broken and Hindi fine, because Devanagari tofu boxes happen to match real glyph
// advance. Never infer glyph coverage from measurements; look at the pixels.
const DEVANAGARI_ALSO = "'Noto Sans Devanagari','Mangal','Nirmala UI','Kohinoor Devanagari'";
const SCRIPT_FONT = {
  // `also`: the Devanagari faces a device commonly has, named after the vendored one, so a print whose caller
  // supplies no fontData still lands on a real Devanagari face rather than on whatever the browser falls to.
  hi: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2', also: DEVANAGARI_ALSO },
  mr: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2', also: DEVANAGARI_ALSO },   // Marathi, same script
  ne: { family: 'Noto Serif Devanagari', dir: 'noto-serif-devanagari',
        file: 'noto-serif-devanagari-400-devanagari.woff2', also: DEVANAGARI_ALSO },   // Nepali, same script
};

// The set LAYOUTS (gospel's figures, promoted to library/ by regions). Imported rather than injected
// because — unlike describeGroup's country resolver — these have ZERO imports of their own and run
// under plain node, so they cannot break `node internal/check-*.mjs`. Verified by importing and
// CALLING them, not by reading them. They return data; the SVG is ours.
import { layoutBoundedSet, boundedSetTally } from '../components/charts/boundedSet.js'
import { layoutCenteredSet, ringTally, ringRadii, RING_MAX } from '../components/charts/centeredSet.js'
import { bandFill } from '../components/charts/ringBands.js'
import { peoplePerCell } from '../components/charts/packetCharts.js'

// `describe` is INJECTED at the same seam as `strings`, and deliberately not imported. This module
// has (almost) no imports on purpose: the SAME file runs under Node for the offline generator and
// under Vite for the browser print frame. describeGroup itself is portable, but its country resolver
// (library/utils/countryName.js) is reachable only through the Vite `@map/` alias and imports JSON
// without an import attribute — fine inside a bundle, fatal to `node internal/check-*.mjs`. So the
// CALLER composes the describer and passes it in:
//     describe: (g) => describeGroup(g, lang, { strings, countryName })
// A missing `describe` degrades to the metadata line rather than throwing. The packet must not fail
// to print because one column has no describer.
export function createPacketRenderer({ strings, lang = 'en', fontData = null, describe = null }) {
  const EN = strings.en;
  const L = strings[lang] || {};
  const t = (k) => (L[k] !== undefined ? L[k] : EN[k]);
  const tr = (k) => ((L.rhythms || {})[k] !== undefined ? L.rhythms[k] : EN.rhythms[k]);
  // ⚠ PER-POINT, PER-FIELD — never `L.points || EN.points`. That expression reads as a
  // whole-block fallback and behaves as one only when the key is ABSENT; when a translator
  // has done SOME of the 12 it is TRUNCATING, because a 3-element array is truthy. Measured
  // 2026-09-24 with a partial block: the packet rendered a page headed "12 Prayer Points"
  // containing THREE — points 4..12 silently gone, including the Mark 5 passage point 4
  // prints in full. Nothing was blank and no error was raised, so it looked translated.
  // A half-finished translation is the NORMAL state of a language in progress, and
  // "a new language is a NEW BLOCK, never a code change" only holds if a partial block
  // degrades per key. English fixes the LENGTH (12) and supplies every missing field.
  const LP = Array.isArray(L.points) ? L.points : [];
  const POINTS = EN.points.map((en, i) => {
    const loc = LP[i];
    if (!loc || typeof loc !== 'object') return en;
    // Field-level merge: a point translated for `text` but not `sub` keeps the English
    // `sub` rather than losing it. refs/n/print_passage stay authoritative from English —
    // they are structure and scripture addresses, not prose.
    return { ...en, ...Object.fromEntries(Object.entries(loc).filter(([, v]) => v !== undefined && v !== '')) };
  });
  // Point 4's reading list, merged the same way: English fixes the length and the scripture addresses,
  // a locale supplies only the names (a partial block keeps the English name for the rest).
  const LH = Array.isArray(L.point4_heart) ? L.point4_heart : [];
  const HEART = (EN.point4_heart || []).map((en, i) => ({ ...en, who: (LH[i] && LH[i].who) || en.who }));
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const flat = (v) => (v && typeof v === 'object' ? (v.label ?? v.value ?? '') : (v ?? ''));

  // ── SHEET GEOMETRY — the letter-portrait sheet, same as the poster format ───
  const W = 1500, H = 1941;         // CSS px; 8.5x11 at width 1500
  const PAGE_W_IN = 8.5;
  const SCALE = (PAGE_W_IN * 96 / W).toFixed(6);   // print scale: one sheet = one page
  const M = 60, HEAD = 90;                          // margins + running header
  // ★ THE PROFILE TABLE (brief A1, item 1): ~20 per page, picture | generated localized
  // description | three prayer checkboxes. This replaces the 2-column card grid with 20 FULL-WIDTH
  // ROWS. PER_PAGE stays 20, so this is a change of LAYOUT SHAPE, NOT OF PAGINATION — which is what
  // lets check-packet-render's dropped-groups assertion (sheets === 1 + … + ceil(cards/PER_PAGE) + 2)
  // keep passing unrelaxed. That assertion exists to catch SILENTLY DROPPED PEOPLE GROUPS and its own
  // comment refuses a ±1 tolerance, so a rewrite that needed it loosened would be the wrong rewrite.
  const ROWS = 20, PER_PAGE = ROWS;
  const COLS = 1;
  // ★ THE THREE PRAYER COLUMNS, three questions in this order:
  //   1 did I bless them
  //   2 Jesus, what do you want me to KNOW about them
  //   3 Jesus, what do you want me to DO for them
  // The headings ARE the questions, asked of Jesus in the reader's own voice: "What to know" and "What to
  // do" did not say who was being asked. A TALLY cell per group per question, not a tick box: the list is
  // prayed through again and again (see the pace table), so a cell counts every time, where a tick could
  // only say "once". Printed on the row so the packet is a WORKING sheet rather than a reference.
  // Deliberately three and not more — the brief is one hour with God, and a fourth column turns a
  // prayer aid into a form.
  const PRAY_COLS = ['pray_blessed', 'pray_know', 'pray_do'];
  const GUT = 14;
  const CW = (W - 2 * M - GUT * (COLS - 1)) / COLS;   // 1380px — the full row width
  const CH = (H - 2 * M - HEAD - GUT * (ROWS - 1)) / ROWS;  // 73.25px — the row height
  // ⚠ ZERO SLACK IS THE FINDING, NOT THE REASSURANCE. 20 rows of 73.25 + 19 gutters fill the page to
  // exactly the 60px bottom margin. A description wrapping to THREE lines needs ~74px and overflows
  // the row by ~1px, which on a printed sheet is a silently clipped descender or a pushed row. The
  // answer is not a taller row — 20 rows must fit one page — it is the fit ladder below.
  const PHOTO = Math.min(CH - 8, 64);                 // the picture column: square, row-height-capped
  // The three checkbox cells. Each holds a box plus its short label; sized so all three fit beside
  // the description without the labels wrapping in the longest locale we ship.
  // The tally cells no longer carry their question under each box: the three questions head the table ONCE
  // per page (.pray-head), so a cell is all tally room. 84 -> 116 gives every box more of it and the heads a
  // readable 15px (three short lines; at 96px they were three tiny ones).
  const PRAY_CELL = 160;
  // The question heads above the first row of every page, and the first page's explanation (the intro,
  // the blessing, the band) in a reserved block, so the first page holds FD_FIRST rows and the rest 20.
  // FD_TOP_H is MEASURED: with a 100-group list the tallest locales' block uses 612px (es fr pt de it ro ru hi;
  // en 591, ar 507, zh 513), so 640 keeps 28px; with the 62px head row the first page holds 11 rows. check:packet-render fails a block
  // whose content outgrows it (the block clips rather than overlap the rows, so only a measurement sees it).
  const PRAY_HEAD_H = 62, FD_TOP_H = 720;
  const FD_ROWS_TOP = M + HEAD + FD_TOP_H + PRAY_HEAD_H;
  const SET_PANEL = 660;                              // one square sets panel: two + a 40px gap fit 1380px
  const SET_SOLO = 960;                               // one chart per page: a large square, centred
  // ★ MEASURED FILL, 2026-09-29: at 960px the single-chart pages ended 60-69% of the way down the sheet
  // (525-702px of blank paper below). The chart is an SVG, so it scales: the bounded set has nothing
  // under it and takes nearly the full 1380px row; the centered set keeps room for its ring legend.
  const SET_SOLO_W = { bounded: 1320, centered: 1240 };
  const PRAY_W = PRAY_CELL * PRAY_COLS.length;        // 252px
  // What is left is the description — the widest column on the page, and the point of the table.
  // For comparison an ENTIRE card in the old 2x10 grid was 683px wide; the description alone is 50%
  // wider than that, because a generated sentence needs the width a name and two metadata lines did not.
  const DESC_W = CW - PHOTO - PRAY_W - GUT * 2;       // ~1024px

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // ⚠ `lang` (the factory parameter), never a module-level LANG — and never
  // process.env.LANG, which is the SHELL's POSIX locale ("en_US.UTF-8"): not a valid
  // BCP-47 tag, and it throws inside toLocaleString.
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString(lang) : '—');

  const sheet = (inner, cls = '') =>
    `<div class="sheet ${cls}">${inner}</div>`;

  // The script font for THIS language, if it needs one. `fontData` is a base64
  // woff2 the caller supplies: the packet must stay a SELF-CONTAINED file that
  // prints offline (the Node generator writes standalone HTML with no server, and
  // photos are already inlined for the same reason), so a URL would break exactly
  // where the packet is most used. Absent fontData, the rule is simply omitted and
  // the stack falls back to serif — a legible wrong font beats a broken document.
  const SF = SCRIPT_FONT[lang] || null;
  const fontFace = (SF && fontData)
    ? `@font-face{font-family:'${SF.family}';font-style:normal;font-weight:400;`
      + `font-display:swap;src:url(data:font/woff2;base64,${fontData}) format('woff2')}`
    : '';
  // Prepend the script face to EVERY element's stack in one rule rather than
  // editing 22 hardcoded Georgia declarations. The browser falls through per
  // CHARACTER, so Latin text in a Hindi packet still renders in Georgia.
  const scriptStack = SF
    ? `.sheet,.sheet *{font-family:'${SF.family}',${SF.also ? SF.also + ',' : ''}Georgia,'Palatino Linotype',serif !important}`
    : '';

  function css() {
    return `
    ${fontFace}
    ${scriptStack}
    @page{size:letter portrait;margin:0}
    html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{position:relative;width:${W}px;height:${H}px;background:#f7f4ec;overflow:hidden;
           page-break-after:always;break-after:page}
    .sheet:last-child{page-break-after:auto;break-after:auto}
    .hd{position:absolute;left:${M}px;top:46px;font:700 30px Georgia,'Palatino Linotype',serif;color:#1b1a17}

    /* ── LIFE CALENDAR (pages 2 and 3) ─────────────────────────────────────
       5,200 cells must fit one sheet and still read as countable boxes. 52 columns
       is fixed by the DATA (weeks in a year), so the cell size is derived from the
       printable width rather than chosen: (1500 - 2*60) / 52 = 26.5px per column,
       leaving a 21px box with a 2px gap. Measured, not eyeballed — a hardcoded box
       size that happened to fit at one margin would break the moment M changed. */
    .pg-head{margin:0 0 10px}
    .pg-kicker{font:700 15px Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#8a8577}
    .pg-h1{margin:2px 0 0;font:700 40px Georgia,serif;color:#1b1a17}
    .pg-lede{margin:0 0 22px;max-width:1180px;font:400 19px/1.5 Georgia,serif;color:#413d35}
    /* ⚠ THE CELLS ARE RECTANGLES, NOT SQUARES, and that is forced by the sheet rather than chosen.
       52 columns is fixed by the data (weeks in a year) and 100 rows by the product's "100 year life" framing,
       so both dimensions are given and only the SHAPE is free. Squares would need
       (1380/52)=26.5px per side x 100 rows = 2,654px of grid in 1,521px of printable height — it
       overflows the page by 1.7x. Caught by computing the height before rendering rather than by
       looking at an overflowing PDF. 13px rows put 100 rows in 1,300px with room for the legend. */
    /* ★ SUPERSEDED BY THE PRINTED LIFE CALENDAR'S LAYOUT (2026-09-29). Squares now, because the grid no
       longer stretches to the page width: 11px boxes on a 14px pitch make 100 rows + 9 decade rules
       ~1,500px tall and 52 columns ~730px wide, centred in a frame like the Module 1 sheet.
       Height budget, measured on paper not guessed: head+lede end near y=210, the frame is ~1,560px,
       the legend and foot ~80px, which lands above the ${H - M}px margin with room to spare. */
    .pg-head-c,.pg-lede-c{text-align:center;margin-inline:auto}
    .lc-frame{width:max-content;margin:0 auto;padding:10px 3px;border:1.5px solid #3b463d;background:#fff}
    /* The life grid is one SVG (lifeGrid): two paths of boxes, hairlines between decades, small numbers. */
    .lc-svg{display:block}
    .lc-svg .lc-off{fill:#fff;stroke:#8f8a78;stroke-width:1}
    .lc-svg .lc-on{fill:#c9a13b;stroke:#a8832a;stroke-width:1}
    .lc-svg .lc-reached{fill:#2f6d4f;stroke:#2f6d4f;stroke-width:1}
    .lc-svg .lc-rule{stroke:#3b463d;stroke-width:1.6}
    .lc-svg .lc-rule-q{stroke:#cfc8b4;stroke-width:1;stroke-dasharray:3 3}
    .lc-svg .lc-t{font:700 18px Georgia,serif;fill:#3b463d}
    .lc-svg .lc-big{font-size:20px;fill:#1b1a17}
    .lc-c{display:block;box-sizing:border-box;width:22px;height:11px;border:1px solid #8f8a78;background:#fff}
    /* Jesus' 33 years: warm gold, the one shading on the life page. */
    .lc-on{background:#c9a13b;border-color:#a8832a}
    /* The shaded share on the %-evangelical grid is the REACHED share, so it takes the accent colour and the
       unshaded majority stays quiet — the visual weight belongs to what is still waiting. */
    .lc-reached{background:#2f6d4f;border-color:#2f6d4f}
    .lc-legend{display:flex;justify-content:center;gap:34px;margin:16px 0 0;font:400 17px Georgia,serif;color:#413d35}
    .lc-legend i{display:inline-block;vertical-align:-1px;margin-inline-end:8px}
    .lc-per{margin:8px 0 0;text-align:center;font:600 16px Georgia,serif;color:#413d35}
    .lc-foot{margin:12px auto 0;max-width:1180px;text-align:center;font:400 14px Georgia,serif;color:#6f6a5c}
    .sheet-map-poster{background:#fff}
    /* ⚠ THE FLOW PAGES HAD NO PADDING. .sheet is a bare box, and the pages laid out in flow (the life
       calendar, the % grid, the sets) started their heading at the sheet's very edge, where a printer's
       unprintable margin cuts it. Every flow page now keeps the same margin the absolute pages do. */
    .sheet-flow{box-sizing:border-box;padding:${M + 12}px ${M}px ${M}px}
    /* ── THE LIGHTWEIGHT WORKSHEET ── white paper, one header row per page, rows sized to tick. */
    .sheet-worksheet{background:#fff}
    .ws-top{display:flex;justify-content:space-between;margin:0 0 14px;font:400 15px Georgia,serif;color:#8a8577}
    .ws-h1{font-size:34px}
    .ws-intro{margin:8px 0 20px;max-width:1180px;font:400 22px/1.5 Georgia,serif;color:#413d35}
    .ws-head,.ws-row{display:grid;grid-template-columns:58px ${WS_PHOTO}px 1fr repeat(${PRAY_COLS.length},${WS_TALLY_W}px);align-items:center;column-gap:8px}
    /* The tally headings are questions of two short lines; text-wrap:balance breaks them evenly in every
       language ("What do you / want me to know?") instead of leaving one word on a last line. */
    .ws-head{align-items:end;padding:0 0 8px;border-bottom:2px solid #3b463d;font:700 15.5px/1.25 Georgia,serif;color:#6f6a5c;text-align:center}
    .ws-head span{text-wrap:balance}
    .ws-head span:nth-child(3){text-align:start}
    .ws-ph{display:block;width:${WS_PHOTO}px;height:${WS_PHOTO}px;box-sizing:border-box;border-radius:3px;object-fit:cover}
    .ws-ph.nophoto{border:1px solid #d6d0c0;background:#f2efe6;display:flex;align-items:center;justify-content:center;
                   font:italic 11px Georgia,serif;color:#a89f8c;text-align:center;padding:3px}
    .ws-row{height:${WS_ROW}px;box-sizing:border-box;border-bottom:1px solid #e2ddd0}
    .ws-n{font:700 19px Georgia,serif;color:#8a8577;text-align:end;padding-inline-end:10px}
    .ws-name{min-width:0}
    .ws-name b{display:block;font:700 26px/1.2 Georgia,serif;color:#1b1a17;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ws-name small{display:block;font:400 18px/1.3 Georgia,serif;color:#6f6a5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ws-name small.ws-desc{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;
                   font:400 ${WS_DESC_PX}px/1.3 Georgia,serif;margin-top:2px}
    /* A TALLY cell: room for several groups of five marks, not a box for one tick. */
    .ws-box{justify-self:center;width:${WS_TALLY_W - 10}px;height:${WS_ROW - 22}px;box-sizing:border-box;border:1.5px solid #b0a993;border-radius:6px;background:#fff}
    .ws-foot{position:absolute;left:0;right:0;bottom:50px;text-align:center;font:400 12px Georgia,serif;color:#a89f8c}
    /* The first page's description and pace table: quiet type, one rule per section, nothing boxed. */
    .ws-sec{margin:0 0 6px;font:700 14px Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#8a8577}
    /* THE EXPLANATION BAND (explainBand): ruled above and below like the poster's header band, three columns
       between short rules; the third is exactly the table's tally block, so its example sits over the cells. */
    .xb-bless{margin:0 0 14px}
    .xb-lead{margin:0 0 4px;font:400 19px/1.45 Georgia,serif;color:#413d35}
    .xb{display:grid;column-gap:40px;border-top:1.5px solid #c9bfa4;border-bottom:1.5px solid #c9bfa4;padding:14px 0 12px;margin:0 0 16px}
    .xb-col{position:relative;min-width:0}
    .xb-col + .xb-col::before{content:'';position:absolute;inset-inline-start:-20px;top:4px;bottom:4px;border-inline-start:1px solid #d6ccb4}
    .xb-p{margin:0 0 6px;font:400 16px/1.4 Georgia,serif;color:#413d35}
    .xb .ws-pace-t{font-size:15px;table-layout:auto}
    .xb .ws-pace-t td.xb-word{white-space:nowrap}
    .xb .ws-pace-t th,.xb .ws-pace-t td{padding:3px 6px;border-bottom:1px solid #e2ddd0;text-align:start;font-size:15px;line-height:1.3}
    .xb .ws-pace-t th{font-weight:700;color:#1b1a17}
    .xb .ws-pace-t .xb-word{font-weight:700;color:#6d766e}
    .xb .ws-cols li{font-size:16px;line-height:1.4;margin:0 0 7px}
    .xb-ex-head,.xb-ex-row{display:grid}
    .xb-ex-head{align-items:end;padding:0 0 6px;border-bottom:2px solid #3b463d;font:700 13px/1.2 Georgia,serif;color:#6f6a5c;text-align:center}
    .xb-ex-head span{text-wrap:balance;padding:0 2px}
    .xb-ex-row{padding:8px 0}
    .xb-cell{justify-self:center;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:1.5px solid #b0a993;border-radius:6px;background:#fff}
    .xb-cell-ws{width:${WS_TALLY_W - 10}px;height:${WS_ROW - 22}px}
    .xb-cell-fd{width:${PRAY_CELL - 12}px;height:${Math.round(CH - 22)}px}
    .xb-marks{height:60%;max-width:92%;stroke:#3b463d;stroke-width:2.6;stroke-linecap:round;fill:none}
    .xb-ex-note{margin-top:4px;font-size:14px;color:#6f6a5c}
    /* The prayer themes and scenes above the twelve points: a thin numbered list, ruled off below. */
    .pt-themes{margin:0 0 10px;padding:0 0 6px;border-bottom:1.5px solid #c9bfa4}
    .pt-th-h{font:400 var(--pt-th,19px)/1.3 Georgia,serif;color:#413d35}
    .pt-th-h b,.pt-sc-h b{font:700 var(--pt-thb,20px) Georgia,serif;color:#1b1a17;letter-spacing:.02em}
    .pt-th-i{font-style:italic;color:#6d766e}
    .pt-th-list{display:flex;flex-wrap:wrap;gap:1px 20px;margin:2px 0 0;padding:0;list-style:none;font:400 var(--pt-th,19px)/1.3 Georgia,serif;color:#3b3226}
    .pt-n{display:inline-block;min-width:1.3em;font-weight:700;color:#7a3b2e}
    .pt-sc-r{font:600 var(--pt-scr,18px) Georgia,serif;color:#7a3b2e}
    .ws-cols{margin:0;padding:0;list-style:none}
    .ws-cols li{margin:0 0 6px;font:400 19px/1.45 Georgia,serif;color:#413d35}
    .ws-cols li b{color:#1b1a17}
    .ws-bless{margin:6px 0 4px;padding:2px 0;padding-inline-start:18px;border-inline-start:3px solid #d8cfb5;
              font:italic 20px/1.45 Georgia,serif;color:#2b2924}
    .ws-bless cite{display:block;margin-top:2px;font:400 14px Georgia,serif;font-style:normal;color:#8a8577}
    .ws-refs{white-space:nowrap;overflow:hidden;font:400 16px/1.4 Georgia,serif;color:#6f6a5c}
    .ws-wheel{margin:4px 0 14px;font:italic 18px/1.45 Georgia,serif;color:#413d35}
    .ws-pace-lead{margin:0 0 6px;font:400 18px/1.45 Georgia,serif;color:#413d35}
    .ws-pace-t{width:100%;border-collapse:collapse;table-layout:fixed;text-align:center;font:400 17px/1.3 Georgia,serif;color:#413d35}
    .ws-pace-t th{padding:6px 4px;border-bottom:1.5px solid #3b463d;font:700 17px/1.25 Georgia,serif;color:#1b1a17}
    .ws-pace-t td{padding:5px 4px;border-bottom:1px solid #e2ddd0}
    .ws-pace-t .ws-pace-word td{font-weight:700;color:#6d766e}
    .ws-pace-t .ws-pace-best{background:#f3efe3}
    .ws-pace-note{margin:6px 0 16px;font:400 15px/1.4 Georgia,serif;color:#6f6a5c}
    /* Upright, not italic, in scripts with no true italic: a slanted Arabic, Chinese or Devanagari line is a
       synthesized oblique, which reads as a rendering fault rather than as emphasis. */
    .ws-bless:lang(ar),.ws-wheel:lang(ar),.ws-bless:lang(zh),.ws-wheel:lang(zh),.ws-bless:lang(hi),.ws-wheel:lang(hi){font-style:normal}
    /* Arabic SCRIPTURE (the blessing, Mark 5) names real Arabic faces before the generic serif: Georgia has no
       Arabic, so each Arabic letter falls to the first named face the device has, instead of to whatever
       system font the browser picks, which on one test machine had no glyph for a letter the Van Dyck text
       used. The text itself now uses only common letters (_meta.note_on_blessing); this is the second guard.
       Scoped to the scripture blocks, so no other page's measured fit moves. */
    .ws-bless:lang(ar),.p4-passage:lang(ar),.p4-passage:lang(ar) *{font-family:Georgia,'Palatino Linotype','Noto Naskh Arabic',Amiri,'Traditional Arabic',Tahoma,serif !important}

    /* ── THE BOUNDED + CENTERED SETS (back matter) ──────────────────────────
       Two figures side by side. The SVGs carry no width/height — they scale to their
       column through the viewBox, which is what keeps gospel's boundary gap intact:
       the gap lives in the LAYOUT's coordinates and scaling the viewBox cannot
       compress it, whereas nudging r or spread would. */
    /* ★ ONE PAGE, TWO SQUARE PANELS SIDE BY SIDE (2026-09-29, after the Module 1 "list of 100"
       sheet, which closes on BOUNDED SET | CENTERED SET as two squares). Each panel is a framed square
       with its heading on top; the ring legend runs under both at full width. */
    .set-row{display:flex;gap:40px;justify-content:center;align-items:stretch;margin-top:30px}
    .set-panel{width:${SET_PANEL}px;flex:0 0 auto;box-sizing:border-box;border:1.5px solid #3b463d;
               background:#fff;padding:18px 18px 16px;text-align:center}
    .set-h{margin:0;font:700 26px Georgia,serif;letter-spacing:.06em;text-transform:uppercase;color:#1b1a17}
    .set-sub{margin:4px 0 8px;font:italic 17px Georgia,serif;color:#6f6a5c}
    .set-svg{display:block;width:100%;height:auto}
    .set-ring{fill:none;stroke:#b8453a;stroke-width:3}
    .set-band-a{fill:#f1eee4;stroke:#b9b2a0;stroke-width:1}
    .set-band-b{fill:#fff;stroke:#b9b2a0;stroke-width:1}
    .set-band-out{fill:none;stroke:#b9b2a0;stroke-width:1;stroke-dasharray:5 5}
    .set-num{fill:#fff;stroke:#8f8a78;stroke-width:1}
    .set-num-t{font:700 12px Georgia,serif;fill:#3b463d;text-anchor:middle;dominant-baseline:central}
    .set-in{fill:#2f6d4f;stroke:#fff;stroke-width:1}
    .set-out{fill:#9d977f;stroke:#fff;stroke-width:1}
    /* The centre is Christ: a cross at the heart of both figures, over a soft gold disc. */
    .set-core{fill:#fbf3dc;stroke:#c9a13b;stroke-width:2}
    .set-cross rect{fill:#7a4f1d;stroke:#fff;stroke-width:2;paint-order:stroke}
    .set-cap{margin:10px 0 0;font:400 16px Georgia,serif;color:#413d35}
    /* The legend names EVERY ring, numbered as the figure numbers them, so a reader can read the scale
       from the same dialect outward to the language family — including rings this list leaves empty. */
    .set-row-solo .set-panel{width:${SET_SOLO}px}
    .set-solo-bounded .set-panel{width:${SET_SOLO_W.bounded}px}
    .set-solo-centered .set-panel{width:${SET_SOLO_W.centered}px}
    .set-solo-centered + .set-legend, .set-solo-centered ~ .set-legend{max-width:${SET_SOLO_W.centered}px}
    .set-legend{margin:26px auto 0;max-width:${SET_SOLO}px}
    .set-legend-h{font:700 17px Georgia,serif;color:#1b1a17;margin:0 0 8px}
    .set-legend-p{margin:0 0 10px;font:400 16px/1.45 Georgia,serif;color:#413d35}
    .set-rings{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;column-gap:40px;
               row-gap:6px;font:400 16px Georgia,serif;color:#413d35}
    .set-rings li{display:flex;align-items:center;gap:10px}
    .set-rings .ring-n{flex:0 0 24px;height:24px;border-radius:50%;border:1px solid #8f8a78;background:#fff;
               font:700 12px/22px Georgia,serif;text-align:center;color:#3b463d;box-sizing:border-box}
    .set-rings .ring-c{margin-inline-start:auto;font-weight:700;color:#1b1a17}

    /* ── THE THREE PRAYER COLUMNS, now a HORIZONTAL strip at the end of each row ──────────
       They were a vertical stack in the old 683x160 card. In a ${CW}x${CH.toFixed(0)} ROW there is no
       vertical room for three stacked labels, so the three cells sit side by side, each
       ${PRAY_CELL}px wide, with the box above its label. inset-inline-end (not right) so the strip
       still mirrors under dir=rtl with the rest of the row. */
    .pray-cols{position:absolute;inset-inline-end:0;top:50%;transform:translateY(-50%);
               display:flex;flex-direction:row;gap:0}
    .pray-col{width:${PRAY_CELL}px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;
              gap:3px;font:400 10px Georgia,serif;color:#6f6a5c;text-align:center;line-height:1.15}
    /* A tally cell above its question, as on the worksheet: wide and short, for a few groups of marks. */
    .pray-box{display:inline-block;width:${PRAY_CELL - 12}px;height:${Math.round(CH - 22)}px;box-sizing:border-box;border:1.5px solid #b0a993;border-radius:5px;background:#fff;flex:0 0 auto}
    /* The three questions, ONCE per page, over the tally cells' own columns. */
    .pray-head{position:absolute;inset-inline-end:${M}px;display:grid;grid-template-columns:repeat(${PRAY_COLS.length},${PRAY_CELL}px);
               height:${PRAY_HEAD_H - 6}px;align-items:end;font:700 15px/1.2 Georgia,serif;color:#6f6a5c;text-align:center}
    .pray-head span{text-wrap:balance;padding:0 0 5px;border-bottom:2px solid #3b463d}
    /* Page 1 of the Full detail list: the explanation, then the head row and the rows right under it (listPages). */
    .fd-first{position:absolute;left:${M}px;top:${M + HEAD}px;width:${CW.toFixed(0)}px}
    .fd-top{max-height:${FD_TOP_H}px;overflow:hidden}
    .fd-rows{position:relative}
    .fd-rows .pray-head{inset-inline-end:0}
    .hd-r{position:absolute;right:${M}px;top:54px;font:400 19px Georgia,serif;color:#8c8170}
    /* ⚠ box-sizing:border-box IS LOAD-BEARING HERE, NOT HOUSEKEEPING. Without it the row's height
       is the CONTENT box and the padding + border are added OUTSIDE it, so the row renders taller
       than the geometry that positions it — a rendered row measured 81px against a 73.25px model, and because
       the row's top still advances by CH the rows then overlap their successors by the difference. The stack
       still fitted the sheet (it ended 8px INTO the 60px bottom margin rather than on it), which is
       exactly why this was invisible without a measurement: nothing clipped and nothing overflowed
       the page. With border-box the declared height IS the rendered height. */
    .card{position:absolute;box-sizing:border-box;display:flex;gap:${GUT}px;align-items:center;
          border-bottom:1px solid #e2ddd0;padding-bottom:6px;overflow:hidden}
    .card img,.card .nophoto{width:${PHOTO.toFixed(0)}px;height:${PHOTO.toFixed(0)}px;flex:0 0 auto;border-radius:3px}
    .card img{object-fit:cover}
    .card .nophoto{border:1px solid #d6d0c0;background:#f2efe6;display:flex;align-items:center;
                   justify-content:center;font:italic 9px Georgia,serif;color:#a89f8c;text-align:center;padding:3px}
    /* The description cell. A FIXED width rather than flex:1, because the fit ladder's character
       budget is computed against exactly this number — if the cell could stretch, the budget would
       be describing a width the cell no longer has. */
    .d-cell{width:${DESC_W.toFixed(0)}px;flex:0 0 auto;min-width:0;overflow:hidden}
    .nm{font:700 15px Georgia,serif;color:#1b1a17;line-height:1.15}
    .d-tx{font-family:Georgia,serif;color:#413d35;line-height:1.25;margin-top:2px}
    .d-fb{font:400 13px Georgia,serif;color:#6d766e;margin-top:2px}
    .mt{font:400 17px Georgia,serif;color:#6d766e}
    /* FINE PRINT — product decision: attribution minimal, fine print small. */
    /* ≥ 0.25in above the sheet's bottom edge (44px on letter): at 22px the credit line sat 0.14in from the edge,
       inside the band a printer cannot ink. */
    .fine{position:absolute;left:0;right:0;bottom:50px;text-align:center;
          font:400 13px Georgia,serif;color:#a89f8c}
    /* THE MAP IS MISSING, and this says so where the map would have been.
       ⚠ Centred in the SAME region the map occupies, not tucked into the fine print: a reader
       comparing two packets must be able to see at a glance which one lost its illustration.
       Quiet, not alarming — it is a missing picture in an otherwise complete document, so it reads
       as a caption rather than an error. No border and no icon for the same reason: on a printed
       page an error box costs ink and implies the whole packet is suspect. */
    .map-missing{position:absolute;left:${M}px;right:${M}px;top:50%;transform:translateY(-50%);
          text-align:center;font:italic 19px Georgia,serif;color:#a89f8c}
    /* PRINT. The sheet is authored at ${W}px wide while @page is physical, so without
       a rescale the browser maps ${W}px -> 15.6in and TILES one sheet over many pages.

       ⚠ Use zoom, NOT transform:scale(). They look identical on screen and behave
       completely differently under pagination:
         transform  is paint-time  — the element still RESERVES its full ${H}px layout
                    box, so the paginator walks ${H}px of content and breaks it across
                    two sheets, inking only the top of the first. Measured: 8 sheets
                    came out as 16 PDF pages. Negative margins do NOT fix this — they
                    collapse the outer space, not the fragmentation box.
         zoom       is layout-time — the box itself becomes ${(PAGE_W_IN*96).toFixed(0)}px
                    wide, so pagination sees the scaled size. Measured: 1 page/sheet.
       Verified by _probe-pagecount.mjs (transform 2, transform+margins 2, zoom 1). */
    @media print{
      html,body{width:${(PAGE_W_IN * 96).toFixed(0)}px;margin:0;padding:0}
      .sheet{width:${W}px;height:${H}px;zoom:${SCALE};
             page-break-after:always;break-after:page}
      .sheet:last-child{page-break-after:auto;break-after:auto}
    }`;
  }

  // Lift the poster's stylesheet so the inlined map keeps its palette and map rules,
  // dropping only the rules that would fight the packet's own page shell.
  //
  // Comments are stripped FIRST and deliberately: generate.mjs's CSS comments are long
  // prose that contains braces and selector-like text, so any brace-counting or
  // selector regex run over the raw source mis-parses them as rules. Strip, then split.
  function mapCss(posterHtml) {
    const block = posterHtml.match(/<style>([\s\S]*?)<\/style>/);
    if (!block) return '';
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');

    // Drop @media (the poster's own print-scaling rules, which do not apply here).
    // Depth-aware because @media bodies nest a further level of braces.
    let out = '', depth = 0, i = 0;
    while (i < css.length) {
      if (css.startsWith('@media', i)) {
        let d = 0, started = false;
        while (i < css.length) {
          if (css[i] === '{') { d++; started = true; }
          else if (css[i] === '}') { d--; if (started && d === 0) { i++; break; } }
          i++;
        }
        continue;
      }
      out += css[i++];
    }

    // Drop document-level rules: these style the POSTER page, not the map, and would
    // override the packet's background, box-sizing and stage geometry.
    const DOC = /(^|,)\s*(html|body|\*|\.stage)\s*$/;
    return out.split('}')
      .map((r) => {
        const at = r.indexOf('{');
        if (at < 0) return '';
        const sel = r.slice(0, at).trim();
        if (!sel) return '';
        // :root must be KEPT — it carries the palette the map's var()s resolve against.
        if (sel !== ':root' && sel.split(',').some((s) => DOC.test(s.trim()) || /^(html|body|\*|\.stage)$/.test(s.trim()))) return '';
        return `${sel}{${r.slice(at + 1).trim()}}`;
      })
      .filter(Boolean).join('\n');
  }

  // ── PAGE 1'S MAP: ONE LIFT FOR EVERY CALLER ─────────────────────────────────
  // ★ THIS EXISTED THREE TIMES. usePosterPrints.js, upg-100-list.vue and packet.mjs each lifted the
  // poster's <svg> with the same hardcoded wrapper: 250px down, scaled to 0.62. Three copies of a
  // layout decision is how page 1 drifts between the browser print and the offline packets the first
  // time one of them is tuned — so the decision lives here, once, and all three call it.
  //
  // It places TWO kinds of sheet, told apart by the sheet itself rather than by the caller:
  //   · a MAP-ONLY sheet (generate.mjs FORMAT=packet, root <svg data-sheet="map-only">): the same
  //     1500x1941 as this page, with its top band left EMPTY for the title mapPage draws. It covers
  //     the whole page, scaled only enough that its label columns — which start SHEET_INSET px inside
  //     the sheet — land on the same M margin every other packet page keeps, so no printer's
  //     unprintable edge can clip a name.
  //   · any other sheet (a 3x4 or 3x3 POSTER, the fallback when no map-only sheet was generated):
  //     THE WHOLE PAGE, aspect preserved, inside the packet's white margin M. A poster carries its own
  //     kicker and title, so page 1 draws nothing over it (mapPage): it used to fit the poster UNDER a
  //     second title block, which printed two headers and shrank the map to 663x884 of the page.
  // Returns '' for input with no <svg>, which mapPage turns into the missing-map notice.
  // The files a zone's page-1 map may come from, BEST FIRST: the map-only vertical sheet
  // (generate.mjs FORMAT=packet), then the poster. Every fetcher — the browser composable, the
  // UPG-100 profile, the offline generator — walks this list, so the preference exists once.
  const mapSheetFiles = (id) => [`${id}.packet.html`, `${id}.html`];
  const SHEET_INSET = 34;          // generate.mjs SHEET_EDGE (26) + 8: where a sheet's label columns begin
  // ── THE MAP'S OWN LABELS, IN THE PACKET'S LANGUAGE ──────────────────────────
  // A map sheet is generated once, in English. In a translated packet its country names are replaced
  // on the way in (labelFor: see mapLabels.js), and the map's privacy line, which is word for word this
  // catalogue's privacy_note, takes this language's version.
  // ★ A WIDTH GUARD, because the generator placed every label and then removed any that would collide,
  // measuring the ENGLISH name. A translation is fitted into that same box: estimated wider, it shrinks
  // in proportion, so it can never reach a neighbour the English name did not. Tracking (0.1em on the
  // capitals) is dropped for scripts without capitals — it breaks Arabic joining.
  // Estimates are relative (translation against the English it replaces, same font), which is all a
  // fit needs; per-script advances are deliberately generous.
  const advance = (ch, tracked) => {
    if (/\s/.test(ch)) return 0.3;
    if (/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/.test(ch)) return 1.0;       // CJK
    if (/[\u0600-\u06ff]/.test(ch)) return 0.55;                                    // Arabic
    if (/[\u0900-\u097f]/.test(ch)) return 0.65;                                    // Devanagari
    return 0.64 + (tracked ? 0.1 : 0);                                              // Latin/Cyrillic capitals
  };
  const cased = (str) => /[A-ZÀ-ÞА-ЯЁ]/.test(str);
  const estimate = (str) => [...String(str).replace(/&[a-z#0-9]+;/g, 'x')].reduce((a, ch) => a + advance(ch, cased(str)), 0);
  // A replacement text never runs wider than the English it replaces: shrink by the width ratio, and
  // drop the tracking for scripts without case (tracked Arabic breaks its joins).
  const fit = (en, tr, px) => {
    const k = Math.min(1, estimate(en) / Math.max(estimate(tr), 1e-6));
    const style = [];
    if (k < 1) style.push(`font-size:${(px * k).toFixed(1)}px`);
    if (!cased(tr)) style.push('letter-spacing:0');
    return style.join(';');
  };
  const withStyle = (attrs, style) => (!style ? attrs
    : /\sstyle="/.test(attrs) ? attrs.replace(/\sstyle="([^"]*)"/, (q, v) => ` style="${v};${style}"`)
    : `${attrs} style="${style}"`);
  function relabelSheet(svg, css, labelFor) {
    const base = Number((css.match(/\.ctry-name\{[^}]*font-size:([\d.]+)px/) || [])[1]) || 15;
    let out = svg.replace(/<text([^>]*class="ctry-name(?:-halo|-own)?"[^>]*)>([^<]*)<\/text>/g, (whole, attrs, text) => {
      const tr = labelFor(text);
      return tr ? `<text${withStyle(attrs, fit(text, tr, base))}>${tr}</text>` : whole;
    });
    const enPrivacy = esc(EN.privacy_note || ''), privacy = esc(t('privacy_note') || '');
    if (enPrivacy && privacy && privacy !== enPrivacy) {
      out = out.replace(/<text([^>]*class="attrib(?:-halo)?"[^>]*)>([^<]*)<\/text>/g, (whole, attrs, text) => (text === enPrivacy
        ? `<text${withStyle(attrs, fit(text, privacy, Number((css.match(/\.attrib\{[^}]*font-size:([\d.]+)px/) || [])[1]) || 11))}>${privacy}</text>` : whole));
    }
    return out;
  }

  function liftMap(posterHtml, { labelFor = null } = {}) {
    const html = String(posterHtml || '');
    const m = html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/);
    if (!m) return '';
    const root = m[0].match(/^<svg\b[^>]*>/)[0];
    const vb = root.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
    // ⚠ NOT EVERY <svg> IS A MAP SHEET. A host that answers a missing file with 200 and an HTML page
    // (an SPA fallback) hands back a document whose first <svg> is an icon, and lifting that would
    // print a 24px logo as the zone map. Every sheet generate.mjs writes is at least 1500x1500, so
    // anything without a viewBox of map-sheet size is refused and page 1 says the map is missing.
    if (!vb || Number(vb[1]) < 1000 || Number(vb[2]) < 1000) return '';
    const sw = Number(vb[1]), sh = Number(vb[2]);
    const mapOnly = /\bdata-sheet="map-only"/.test(root);
    let s, x, y;
    if (mapOnly) {
      s = Math.min(1, (W / 2 - M) / (sw / 2 - SHEET_INSET), (H / 2 - M) / (sh / 2 - SHEET_INSET));
      x = (W - sw * s) / 2; y = (H - sh * s) / 2;
    } else {
      s = Math.min((W - 2 * M) / sw, (H - 2 * M) / sh);
      x = (W - sw * s) / 2; y = (H - sh * s) / 2;
    }
    // The root's own width/height would pin it at authored size; the wrapper sets the size instead,
    // and the viewBox (default preserveAspectRatio, meet) scales the drawing to it.
    const sized = m[0].replace(root, root.replace(/\s(width|height)="[^"]*"/g, '').replace(/^<svg\b/, '<svg width="100%" height="100%"'));
    // No relabeller (an English packet) leaves the sheet exactly as drawn.
    // ⚠ dir="ltr" on the wrapper: the artwork is laid out left-to-right, and in an Arabic packet it
    // inherited the page's rtl — punctuation jumped to line starts, key/value columns collided and
    // whole blocks were pushed off the sheet. The packet's own title stays rtl; the lifted sheet does not.
    const svg = typeof labelFor === 'function' ? relabelSheet(sized, html, labelFor) : sized;
    return `<style>${mapCss(html)}</style>`
      + `<div class="map-sheet" dir="ltr" data-map-kind="${mapOnly ? 'map-only' : 'poster'}" data-map-scale="${s.toFixed(4)}"`
      + ` style="position:absolute;left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;`
      + `width:${(sw * s).toFixed(1)}px;height:${(sh * s).toFixed(1)}px">${svg}</div>`;
  }

  // A map the HOST drew (a live map's raster, a data: URL or any image URL) placed as page 1 exactly
  // as a poster sheet is: the whole page inside the white margin, aspect kept. This is the seam for a
  // map that is GENERATED rather than stored, so a host with no posters/<id>.html still prints page 1.
  // '' for an empty or non-image source, which mapPage turns into the missing-map notice.
  function mapFromImage(src) {
    const s = String(src || '').trim();
    if (!/^(data:image\/|https?:\/\/|\/|\.{0,2}\/)/.test(s)) return '';
    return `<div class="map-sheet" dir="ltr" data-map-kind="poster" data-map-scale="1"`
      + ` style="position:absolute;left:${M}px;top:${M}px;width:${W - 2 * M}px;height:${H - 2 * M}px">`
      + `<img src="${esc(s)}" alt="" style="width:100%;height:100%;object-fit:contain"></div>`;
  }

  // ── PAGE 1: the map one-pager ───────────────────────────────────────────────
  // Lightweight by design — a one-page map showing the geography with all the pins,
  // explicitly NOT the poster. The poster remains
  // its own artefact (generate.mjs); this is the packet's cover.
  // ★ IT SAYS WHICH SET IT BELONGS TO. A partner holding one packet must be able to tell it is one of
  // the UPG 100 lists, not a stand-alone leaflet — hence the series line. The count is READ from
  // `funnel.listCount` (the caller counts its own catalogue), never typed here, and the line is
  // omitted when the caller cannot supply it: a page that cannot state a true number leaves it out.
  // ⚠ THE MAP IS DRAWN FIRST, the title and fine print after. A map-only sheet covers the whole page
  // and begins with a paper-coloured background rect, so a title drawn BEFORE it was painted over.
  // A poster names itself in English (its kicker and "Unengaged of <zone>"). In another language the
  // page's ONLY header is that one, so it is swapped for the packet's own kicker and zone title, fitted
  // to the English width like every other lifted label. English prints the poster exactly as drawn.
  function posterHeadInLang(svg, zone) {
    if (String(lang || 'en').split('-')[0].toLowerCase() === 'en') return svg;
    const plain = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const kicker = esc(t('map_page_kicker') || ''), title = esc(zone.label || zone.id || '');
    // The poster's OWN kicker size, read from its stylesheet (lifted with the sheet) — a guessed size larger
    // than the real one made the fit ENLARGE a translation instead of capping it at the English width.
    const kickerPx = Number((svg.match(/\.h1over\{[^}]*font-size:([\d.]+)px/) || [])[1]) || 19;
    let out = svg;
    if (kicker) {
      out = out.replace(/<text([^>]*class="h1over"[^>]*)>([^<]*)<\/text>/, (whole, attrs, text) =>
        `<text${withStyle(attrs, fit(text, kicker, kickerPx))}>${kicker}</text>`);
    }
    if (title) {
      out = out.replace(/<text([^>]*class="h1"[^>]*)>([\s\S]*?)<\/text>/, (whole, attrs, inner) => {
        const px = Number((attrs.match(/font-size="([\d.]+)"/) || [])[1]) || 56;
        return `<text${withStyle(attrs, fit(plain(inner), title, px))}>${title}</text>`;
      });
    }
    return out;
  }

  function mapPage(zone, groups, mapSvg, funnel = null) {
    // ★ A POSTER IS PAGE 1 BY ITSELF (2026-09-29): the map fills the page inside a white margin,
    // under its own title only. Drawing the packet's title over it as well printed TWO headers and
    // shrank the map to fit beneath them. The set it belongs to is the triangle page's job.
    if (mapSvg && /data-map-kind="poster"/.test(mapSvg)) {
      return sheet(posterHeadInLang(mapSvg, zone), 'sheet-map sheet-map-poster');
    }
    const count = groups.length;
    const k = Number(funnel && funnel.listCount);
    const series = Number.isFinite(k) && k > 0
      ? `<div class="map-series" style="font:600 19px Georgia,serif;letter-spacing:1px;color:#8c8170;margin-top:12px">
          ${esc(fill(t('map_page_series'), { k: num(k) }))}</div>`
      : '';
    return sheet(`
      ${mapSvg || missingMapNotice()}
      <div style="position:absolute;left:${M}px;top:${M}px;right:${M}px;text-align:center">
        <div style="font:600 21px Georgia,serif;letter-spacing:3px;color:#8c8170">${esc(t('map_page_kicker'))}</div>
        <div style="font:700 56px Georgia,serif;color:#1b1a17;margin-top:8px">${esc(zone.label || zone.id)}</div>
        <div style="font:italic 24px Georgia,serif;color:#6d766e;margin-top:10px">
          ${esc(fill(t('map_page_sub'), { count: num(count) }))}</div>
        ${series}
      </div>
      <div class="fine">${esc(t('privacy_note'))}</div>`, 'sheet-map');
  }

  /**
   * What page 1 shows when the zone map could not be loaded.
   *
   * ★ THE POINT IS THAT IT SAYS SOMETHING. `${mapSvg}` interpolated an empty string, so a failed
   * map fetch and a successful render were BYTE-INDISTINGUISHABLE in the printed PDF: a cover with
   * a title, a subtitle, a privacy footnote, and 600 bytes of nothing where the map belongs. The
   * packets read as undeveloped, and this page is why — the packet WAS built, and its first page
   * silently lost its content.
   *
   * ⚠ THE SILENCE IS UPSTREAM AND DELIBERATE, WHICH IS WHY THE FIX BELONGS HERE. The browser path
   * (usePosterPrints.js) wraps the poster fetch in `catch (_) { /* a cover without the map beats no
   * packet *\/ }`, and that judgement is RIGHT — a missing map must not cost the reader 20 pages of
   * people to pray for. But "degrade" and "degrade silently" are different things, and only the
   * renderer knows the map is absent at the moment it draws the page.
   *
   * MEASURED, and it was not a rare edge: until the dx-maps config turned posterSources on, the tree
   * shipped NO posters/ directory (generate-tree gates it behind posterSources/bundlePosters, both
   * default false). Over live HTTP against the served tree: previews/sudan.webp 200,
   * boundaries/world-adm0-web.geojson 200, posters/sudan.html 404, so EVERY packet's page 1 was blank.
   * The sources ship now (check:poster-print-fallback asserts it); this notice is for any build
   * that turns them off, and for a fetch that fails anyway.
   *
   * Why a notice and not a thrown error: the packet is still worth printing, and a partner holding
   * it should be able to SEE that one illustration is missing rather than wonder whether the
   * project ships half-finished documents. This is the fail-loud half of fail-soft.
   */
  function missingMapNotice() {
    return `<div class="map-missing">${esc(t('map_unavailable'))}</div>`;
  }

  // ── PAGE 2: the funnel — how this list was narrowed out of every people group ─
  //
  // WHY THIS PAGE EXISTS. The packets go to ALL partners for
  // the largest prayer campaign, and a partner holding one list needs to see where their list sits
  // in the whole. The narrowing IS the argument: 12,379 people groups on earth, 7,341 of them
  // unreached, 4,754 frontier, 2,107 on this network's list, and N of those in the reader's hand.
  //
  // ★ IT RENDERS NUMBERS IT DID NOT COMPUTE, ON PURPOSE. Every count is READ from the caller's
  // `funnel` object, which comes from data/people-groups/vision-funnel.json — the file
  // library/scripts/people-groups/build-vision-funnel.mjs generates from the IMB CSV and the live
  // DOXA list, and which ALREADY feeds the Vision Card. Recomputing them here would create a second
  // source of truth for the same fact, and the two would drift into "two honest surfaces that
  // disagree" — each internally consistent, together telling a reader the project cannot count.
  // If a number is wrong, it is wrong in the generator, and it is wrong in the Vision Card too.
  //
  // ⚠ NO STEP IS HARDCODED AND NEITHER IS THE NUMBER OF STEPS. `funnel.steps` is walked as given,
  // so when the `list` prop lands (Tier A: profile-config.list / ?list= /
  // window.MAP_LIST, default 'doxa') and the 7k / 4.7k / 700 lists plug in, their own step chains
  // render with no change here. A step whose id has no string falls back to the id itself rather
  // than rendering blank.
  //
  // ⚠ K AND N ARE READ AT RENDER TIME, NEVER TYPED. Measured 2026-09-26: the brief said "~30 lists
  // of 50-100" and the catalogue says K=27 with counts from 8 to 118 — west-africa 118,
  // asia-india-rajasthan 116, uncovered-scatter 8. Only about half sit inside 50-100, so this page
  // never claims that band; it states the share the data can defend. K=27 includes the two residual
  // buckets: provisional, pending a product decision.
  //
  // ⚠ "NUMERALS UNTOUCHED" IS ABOUT DIGITS, NOT GROUPING, and those are two properties. The digits
  // were verified and the rest assumed. The rendered hi sheet, measured, showed Indian grouping —
  // "8,28,85,63,969 लोग" (lakh/crore, 2-2-3) rather than Western 3-3-3. That is CORRECT hi-IN
  // formatting, so changing it would be worse than leaving it, and the real risk was never the
  // grouping itself but INCONSISTENCY: the same number printed two ways in one document.
  // Measured 2026-09-26, and it is consistent: num() is the ONLY formatter in this renderer, so the
  // funnel's populations and the people-group cards' populations group identically. Confirmed against
  // the rendered hi packet — card populations 1,70,000 / 3,37,000 / 8,10,000 are Indian-grouped like
  // the funnel's. (Only values at or above 100,000 can distinguish the two systems at all; my first
  // check classified "1,400" and read a mismatch that did not exist.)
  //
  // ⚠ NUMERALS STAY WESTERN. num() is toLocaleString(lang), and for the bare `ar`/`hi` tags CLDR's
  // default numbering system is `latn` — verified: 12,379 and 2,107 in both. Arabic-Indic digits
  // need an explicit -u-nu-arab, which nothing here asks for. The brief requires numerals untouched,
  // and reusing num() is also what keeps the funnel's digits identical to every other packet page.
  function funnelPage(zone, groups, funnel) {
    if (!funnel || !Array.isArray(funnel.steps) || !funnel.steps.length) return '';
    const steps = funnel.steps;
    // The Vision Card's type: this page is drawn in that card's look (see THE TRIANGLE below).
    const SANS = "'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";

    // THIS list, the step the reader is holding. `groups.length` is the packet's own row count, so
    // the page cannot disagree with the pages that follow it.
    const mine = groups.length;
    // ⚠ THE DENOMINATOR MUST BE THE LIST THE PACKET IS ACTUALLY DRAWN FROM, and it is an EXPLICIT
    // input for that reason. An earlier version fell back to the last funnel step
    // (`funnel.listTotal ?? steps[last].groups`), which is 2,107 — DOXA's list. That is right today
    // because every map shows DOXA, and it becomes WRONG the moment the universal `list` prop lands
    // (library/lists/peopleGroupList.js): under ?list=frontier a Tier A map shows the
    // DOXA groups that are ALSO frontier, which library/lists/README.md records at 1,753. The
    // page would have printed "N of the 2,107" with total confidence while the map showed a different
    // set — a faithful proxy that silently changes meaning when a new path appears, which is the same
    // family as inferring "did it work" from a field that only answers "did it isolate".
    //
    // So a caller that knows the active list says so. A caller that does not gets NO SHARE LINE rather
    // than a plausible wrong one: `mine` is always trustworthy (it is this packet's own row count) but
    // a percentage needs both terms, and half a fraction is not a fact.
    const total = Number(funnel.listTotal) || 0;
    const pct = total ? (100 * mine / total) : 0;
    // ⚠ A SHARE MUST NEVER ROUND TO ZERO — zero reads as "this packet covers none of them", which is
    // false for every list. Measured against the real catalogue (counts 1..118 of 2,107): one decimal
    // gave the single-group fixture "0.0%" when the true value is 0.0475%. So: integer at or above
    // 10%, one decimal from 1%, two below that, then strip trailing zeros so 0.9967 prints "1" rather
    // than "1.00". Verified across 1, 2, 8, 20, 21, 43, 95, 118 and 300 groups.
    const pctStr = pct >= 10
      ? String(Math.round(pct))
      : pct.toFixed(pct >= 1 ? 1 : 2).replace(/\.?0+$/, '');

    // ⚠ THE SHARE HAS TWO CLAUSES AND THEY ARE PROVABLE SEPARATELY. "1 of K lists" needs the zone
    // catalogue, which only describes the DEFAULT list; "{pct}% of the {total}" needs only this
    // packet's own row count and the active list's total, both of which are always known. A first
    // version suppressed the whole line whenever listCount was absent, which threw away a true
    // statement to avoid an unprovable one — the same over-correction as defaulting the unassigned
    // count to 0, in the opposite direction.
    const share = !total ? '' : `<div class="funnel-share" style="font:700 19px/1.35 ${SANS};color:#3b463d;margin-top:10px">
           ${esc(funnel.listCount
             ? fill(t('funnel_share'), { k: num(funnel.listCount), pct: pctStr, total: num(total) })
             : fill(t('funnel_share_pct'), { pct: pctStr, total: num(total) }))}</div>`;
    // ⚠ THE FOOTNOTE IS TWO INDEPENDENT FACTS AND ONLY ONE IS ALWAYS KNOWABLE. Provenance ("counts
    // from X, captured Y") holds for every list; coverage ("N of the M are not yet in any list") is a
    // fact about the UPG-100 zone catalogue, which partitions DOXA and nothing else. The first version
    // filled it with `funnel.unassigned ?? 0`, so a non-default list would have printed
    // "0 of the 1,745 are not yet in any list" — a confident falsehood, and the zero makes it read as
    // a completeness claim rather than a missing measurement.
    // So an unknown coverage drops to the provenance-only string rather than defaulting the number.
    // ⚠ NOT BY SPLITTING THE TRANSLATED SENTENCE on punctuation: hi ends with "।" and zh with "。",
    // and parsing translated prose for structure is the same trap as reading a localized page header
    // positionally (see check-packet-render's "PARSE THE NUMBERS, NEVER THE WORD ORDER").
    const imbSrc = funnel.sources && funnel.sources.imb;
    const foot = !imbSrc ? '' : esc(
      Number.isFinite(Number(funnel.unassigned))
        ? fill(t('funnel_foot'), {
            imb_pub: imbSrc.publisher || '',
            imb_date: imbSrc.captured || '',
            unassigned: num(funnel.unassigned),
            total: num(total),
          })
        : fill(t('funnel_foot_source'), {
            imb_pub: imbSrc.publisher || '',
            imb_date: imbSrc.captured || '',
          }),
    );

    // ★ THE READER'S OWN STEP IS PART OF THE FUNNEL, NOT A FOOTER — it is the triangle's TIP below.
    // (Measured in print on the first version: a detached "43 · are in THIS packet" line sat alone
    // at the foot of the sheet with no shape of its own, so the funnel never visibly narrowed to it.)
    // ★ A NON-DEFAULT LIST GETS ITS OWN STEP, so the narrowing does not jump from one list's total to
    // another list's packet. The four IMB steps stay true under every list — they are global counts,
    // unaffected by which list the reader holds — but the LAST one is DOXA's 2,107, and going straight
    // from it to "71 in THIS packet" implies DOXA is the parent set of the reader's rows. It is not:
    // under ?list=frontier-500k the parent is that list's own DOXA-side total. packetFunnel supplies
    // it as listTotal + listLabel when the active list is not the default; when it IS the default,
    // listTotal equals the DOXA step and inserting it would repeat the row.
    // ⚠ AND IT IS OMITTED WHEN IT WOULD REPEAT A NUMBER ALREADY ON THE PAGE — either the DOXA step
    // above it (the default list, where listTotal IS that step) or the reader's row below it. Measured:
    // under ?list=frontier-500k the whole list is 71 DOXA groups and a Laos packet drawn from it holds
    // all 71, so the page rendered "71 -> 71", two identical bars reading as a funnel that narrows to
    // nothing. A step that repeats its neighbour is not a step.
    const lastImb = (steps[steps.length - 1] || {}).groups;
    // ⚠ THE LIST'S LABEL IS TRANSLATED HERE, NOT TAKEN FROM THE DATA. The rendered hi packet,
    // measured 2026-09-26: "Project 4700: frontier people groups" sat among Devanagari labels in a
    // Latin serif face, because it comes verbatim from library/lists/lists.json, which carries ONE
    // label per list and has no locale dimension at all. The same would happen in all ten non-English
    // locales, and the gate passed because it counts rows, not the row's language.
    //   packet-strings.json is the packet's OWN catalogue and the place this belongs — a new language
    // is a new block there, never a code change — so funnel_list_<id> supplies it and falls back to
    // the data's English label for any list this catalogue has not met. The numeric designation stays
    // ("Project 4700" / "4700 计划"): it names the campaign, while "frontier people groups" is prose.
    // That is the same line check-i18n-never-translated draws around "UUPGs".
    const listLabel = funnel.listId
      ? (t(`funnel_list_${funnel.listId}`) ?? funnel.listLabel)
      : funnel.listLabel;
    const ownStep = (listLabel && total && total !== lastImb && total !== mine)
      ? [{ groups: total, population: null, label: listLabel, tint: true }]
      : [];
    const allRows = [
      ...steps.map((s, i) => ({
        id: s.id,
        frontier: s.frontier,
        groups: s.groups,
        population: s.population,
        label: t(`funnel_${s.id}`) !== undefined ? t(`funnel_${s.id}`) : s.id,
        // The network's own list is the hinge between "the world" and "yours" — tint it, and tint
        // the reader's row below it the same, so the last two read as one thought. With a
        // non-default list the hinge moves down to that list's own row instead.
        tint: i === steps.length - 1 && !ownStep.length,
      })),
      ...ownStep,
      { groups: mine, population: null, label: t('funnel_this'), tint: true, mine: true },
    ];
    // ── THE TRIANGLE ─────────────────────────────────────────────────────────
    // ★ ONE INVERTED TRIANGLE, IN THE VISION CARD'S LOOK. The page used to stack a serif number, a
    // label and a proportional bar per row, centred into a loose funnel. It now reads as the Vision
    // Card continued downward: the card's steps are the TOP of the triangle (every people group,
    // the unreached, the frontier, this network's list), and it narrows to the UPG 100 packets that
    // divide that list and, at the tip, the groups in THIS packet. The card's palette (#dfe7df
    // darkening to #3b463d as it narrows), its sans type and its 800-weight numbers carry over.
    //
    // ⚠ TIER WIDTHS ARE GEOMETRIC, NOT PROPORTIONAL. Proportional width is the Vision Card's "true
    // funnel", and it cannot hold here: the last counts are 2,107, 28 and ~100 against 12,379, so
    // proportional tiers would be hairlines no number fits in. The SHAPE says "narrowing to one
    // packet"; the NUMBERS say how much, and where two sets genuinely nest the caption states the
    // step removed, so the proportion is never implied by the drawing.
    //
    // ⚠ A STEP IS SUBTRACTED ONLY WHERE THE SETS NEST. all ⊃ unreached ⊃ frontier; the network's
    // list does NOT sit inside frontier (most of its groups are frontier, not all), so it gets the
    // Vision Card's own note — how many of its groups are frontier — instead of a false "− N".
    //
    // ⚠ THE PACKETS TIER COUNTS PACKETS, NOT PEOPLE GROUPS, and its caption says so. It appears only
    // when the caller supplies listCount: a list the zone catalogue does not describe has no packet
    // count to state, and the page omits a number it cannot prove rather than print a plausible one.
    const NESTS = { unreached: 'all', frontier: 'unreached' };
    const k = Number(funnel.listCount);
    const packetsTier = Number.isFinite(k) && k > 0
      ? [{ groups: k, population: null, packets: true,
          label: fill(t('funnel_packets'), { total: num(total || lastImb) }) }]
      : [];
    const tiers = [...allRows.filter((r) => !r.mine), ...packetsTier, ...allRows.filter((r) => r.mine)];
    const n = tiers.length;

    // Geometry. The triangle keeps to the start side and its captions take the other; in a
    // right-to-left language the whole page mirrors (X) and the captions anchor on the right.
    const rtl = RTL.has(lang);
    const X = (x) => (rtl ? W - x : x);
    const T_TOP = 262, T_BOT = 1540, TW = 900, T_LEFT = M + 20, CX = T_LEFT + TW / 2, GAP_T = 10;
    const th = (T_BOT - T_TOP - GAP_T * (n - 1)) / n;
    const half = (y) => (TW / 2) * (T_BOT - y) / (T_BOT - T_TOP);
    // ★ THE VISION CARD'S OWN STOPS, walked piecewise. Its first three steps are exactly #dfe7df /
    // #c3d5c4 / #a8c3aa and its last is #3b463d; the two between are continued in the same greens. A
    // straight blend from the lightest to the darkest was tried first and ran through desaturated
    // greys — measured on the rasterised tiers, the middle of the triangle read as grey, not green.
    const STOPS = [[0xdf, 0xe7, 0xdf], [0xc3, 0xd5, 0xc4], [0xa8, 0xc3, 0xaa], [0x7f, 0xa1, 0x84], [0x56, 0x73, 0x5b], [0x3b, 0x46, 0x3d]];
    const tone = (i) => {
      const f = (n === 1 ? 1 : i / (n - 1)) * (STOPS.length - 1);
      const lo = Math.min(STOPS.length - 2, Math.floor(f)), u = f - lo;
      return STOPS[lo].map((c, j) => Math.round(c + (STOPS[lo + 1][j] - c) * u));
    };
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    // ★ THE NUMERAL'S INK IS WHICHEVER CONTRASTS MORE — white or the card's #3b463d — by the WCAG
    // ratio, not a fixed luminance cut. The cut left the 2,107 tier's dark numerals on a mid-green
    // at barely 2:1; picking by ratio cannot fall into the middle band where neither was chosen well.
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const ink = (c) => (ratio(c, [255, 255, 255]) >= ratio(c, [0x3b, 0x46, 0x3d]) ? '#ffffff' : '#3b463d');

    let shapes = '';
    let caps = '';
    tiers.forEach((r, i) => {
      const ya = T_TOP + i * (th + GAP_T), yb = ya + th;
      const ha = half(ya), hb = half(yb);
      const c = tone(i);
      const pts = [[CX - ha, ya], [CX + ha, ya], [CX + hb, yb], [CX - hb, yb]]
        .map(([x, y]) => `${X(x).toFixed(1)},${y.toFixed(1)}`).join(' ');
      shapes += `<polygon class="funnel-tier${r.mine ? ' funnel-tier-mine' : ''}" points="${pts}" fill="${hex(c)}"/>`;

      // The number sits INSIDE its tier when it fits there at a readable size, and leads the caption
      // when it does not — at the tip the tier narrows to a point, so the reader's own count is always
      // set beside it, large, rather than squeezed into the apex.
      const numStr = num(r.groups);
      const yNum = ya + th * 0.46;
      const room = 2 * half(yNum) - 28;
      const fs = Math.min(r.mine ? 64 : 58, room / (0.6 * numStr.length));
      const inside = fs >= 30;
      const numCls = `funnel-n${r.mine ? ' funnel-mine' : ''}`;
      if (inside) {
        shapes += `<text class="${numCls}" x="${X(CX).toFixed(1)}" y="${yNum.toFixed(1)}" text-anchor="middle"`
          + ` dominant-baseline="middle" font-family="${SANS}" font-weight="800" font-size="${fs.toFixed(0)}"`
          + ` fill="${ink(c)}">${numStr}</text>`;
      }

      // Presence, not finiteness: Number(null) is 0, and a deliberate "no population" marker must not
      // print as "0 people". A zero is suppressed too — a people group with no people is not a fact.
      const popN = (r.population === null || r.population === undefined || r.population === '')
        ? null : Number(r.population);
      const pop = (popN !== null && Number.isFinite(popN) && popN > 0)
        ? `<div style="font:400 16px ${SANS};color:#6d766e;margin-top:3px">${num(popN)} ${esc(t('funnel_people'))}</div>`
        : '';
      const prev = i > 0 ? tiers[i - 1] : null;
      const step = prev && r.id && NESTS[r.id] === prev.id && Number(prev.groups) > Number(r.groups)
        ? `<div class="funnel-eq" style="font:400 15px ${SANS};color:#8a938b;margin-top:3px">− ${num(Number(prev.groups) - Number(r.groups))}</div>`
        : '';
      const note = r.id === 'doxa' && Number.isFinite(Number(r.frontier)) && Number(r.frontier) > 0
        ? `<div style="font:400 15px ${SANS};color:#8a938b;margin-top:3px">${esc(fill(t('funnel_doxa_note'), { frontier: num(r.frontier) }))}</div>`
        : '';
      const capX = CX + ha + 30;               // just outside the tier's widest (top) edge
      caps += `<div class="funnel-cap${r.mine ? ' funnel-mine-row' : ''}" style="position:absolute;top:${ya.toFixed(0)}px;`
        + `height:${th.toFixed(0)}px;${rtl ? 'right' : 'left'}:${capX.toFixed(0)}px;width:${(W - M - capX).toFixed(0)}px;`
        + `display:flex;flex-direction:column;justify-content:center;text-align:start">`
        + (inside ? '' : `<div class="${numCls}" style="font:800 ${r.mine ? 58 : 44}px ${SANS};color:#3b463d;line-height:1">${numStr}</div>`)
        + `<div style="font:700 ${r.mine ? 24 : 21}px/1.25 ${SANS};color:#3b463d${inside ? '' : ';margin-top:4px'}">${esc(r.label)}</div>`
        + pop + step + note + (r.mine ? share : '')
        + `</div>`;
    });

    return sheet(`
      <div style="position:absolute;left:${M}px;top:56px;right:${M}px;text-align:start">
        <div style="font:700 14px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:#6d766e">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#92b195;margin-inline-end:9px;vertical-align:1px"></span>${esc(t('funnel_kicker'))}</div>
        <div class="funnel-title" style="font:800 44px/1.15 ${SANS};color:#3b463d;margin-top:12px">${esc(t('funnel_title'))}</div>
        <div style="font:400 19px/1.5 ${SANS};color:#6d766e;margin-top:8px;max-width:1100px">${esc(t('funnel_intro'))}</div>
      </div>
      <svg class="funnel-triangle" width="${W}" height="${H}" style="position:absolute;left:0;top:0" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>
      ${caps}
      <div class="fine">${foot}</div>`);
  }

  // ── LIFE CALENDAR: 100 years x 52 weeks = 5200 boxes ────────────────────────
  //
  // Page 2 is a life calendar: the years of a human life, in weeks. Page 3 is the same calendar used
  // for the average percentage of Christians in the DOXA people groups. ONE grid,
  // TWO readings — which is the whole point. A percentage drawn as a bar is an abstraction a reader
  // has to translate; drawn on the grid they have just understood as their OWN LIFE, it is the same
  // 5200 boxes they were looking at a page earlier.
  //
  // ★ 5,200 IS NOT ROUNDED OR CHOSEN FOR LAYOUT: 100 years x 52 weeks, a 100-year life in weeks.
  // Everything else here is derived from it, so the two pages cannot
  // drift apart into two grids that merely look alike.
  // ★ LAID OUT LIKE THE PRINTED LIFE CALENDAR (the Module 1 "Life Calendar in Weeks" sheet, which this
  // page is asked to imitate): square boxes, week numbers across the top, the year down the
  // side, a thin rule between decades, the whole grid framed and centred on the page. The earlier grid
  // stretched 52 columns across the full width, so its boxes were flattened rectangles with no axes.
  //
  // ★ SHADED FROM THE TOP, IN READING ORDER (2026-09-29: the highlighted boxes start from
  // the top). This grid used to SCATTER the shaded boxes, a choice made from a contact sheet in which a
  // contiguous run looked like a bar; the opposite has now been asked for, and the grid is the
  // product's picture. Filling from the top also makes the two pages read the same way: Jesus' 33 years
  // are the first rows of a life, and the evangelical share is the first boxes of the same life.
  // ★ people:true DRAWS THE SAME BOXES WITH NO WEEK OR YEAR NUMBERS, for a page where a box is a share
  // of PEOPLE rather than a week of a life (the knows-Christ page): an axis numbered in weeks and years
  // there would describe a unit the page is not using. Its side labels state each 10-row block's share.
  // ★ ONE PICTURE, NOT 5,200 BOXES (2026-10-02). The grid was 5,200 bordered HTML boxes in a CSS grid, twice
  // in the full packet: heavy to lay out and to hold in a phone's memory. It is now ONE inline SVG per page whose
  // boxes are two <path>s (the empty weeks and the shaded ones, a square subpath each): the same 100 x 52 boxes,
  // vector on paper, a handful of nodes in the page. Both pages use the SAME geometry (LC), so the people grid
  // has exactly the life grid's shape; it simply prints no week or year numbers, since its box is a share of
  // people. data-* attributes state what is drawn, and the gates read the subpaths back, box by box.
  // ★ FULL WIDTH, ONE PAGE (2026-10-02). The calendar now spans the page's printable width: each week is a box
  // twice as wide as it is tall (22 x 11px, ~3.2 x 1.6mm on letter). It could not be a bigger SQUARE: 100 rows
  // are what limit a box, and 26px squares would need ~2,650px of grid on a ~1,550px page. Read at a glance:
  // bold year numbers every 5 years (larger every 10), week numbers 1 / 13 / 26 / 39 / 52 across the top,
  // a clear rule every 10 years and light rules at the quarters. Labels are 18-20px (7.3-8.2pt on letter,
  // 7.1-8pt on A4, which prints the letter sheet at 97%).
  // ONE PATH, TWO PAGES: the reached chart is this grid with the same boxes, rules and shape; its box is a share
  // of the list's PEOPLE, so it has no week numbers and labels each 10-row block with its share: 10% ... 100%.
  // cw x ch is a box, px / py the pitch, x0 the label column, y0 the week-number row, dec the extra gap per decade;
  // pr / pb keep the last column's week number and the last row's label inside the picture.
  const LC = { cw: 22, ch: 11, px: 25, py: 14, x0: 66, y0: 30, dec: 8, pr: 8, pb: 8 };
  function lifeGrid({ shaded = 0, shadeClass = 'lc-on', people = false } = {}) {
    const YEARS = 100, WEEKS = 52, TOTAL = YEARS * WEEKS;
    const n = Math.max(0, Math.min(TOTAL, Math.round(Number(shaded) || 0)));
    // The people grid has no week-number row: its top and bottom margins are evened out, so it sits centred in the same frame.
    const x0 = LC.x0, y0 = people ? (LC.y0 + LC.pb) / 2 : LC.y0;
    const at = (i) => { const r = Math.floor(i / WEEKS), c = i % WEEKS; return [x0 + c * LC.px, y0 + r * LC.py + Math.floor(r / 10) * LC.dec]; };
    const sq = (i) => { const [x, y] = at(i); return `M${x + 0.5} ${y + 0.5}h${LC.cw - 1}v${LC.ch - 1}h${1 - LC.cw}z`; };
    let on = '', off = '';
    for (let i = 0; i < TOTAL; i++) { if (i < n) on += sq(i); else off += sq(i); }
    const gx = LC.px - LC.cw, gy = LC.py - LC.ch;
    const gridW = WEEKS * LC.px - gx, gridH = YEARS * LC.py + (YEARS / 10 - 1) * LC.dec - gy;
    const W = LC.x0 + gridW + LC.pr, H = LC.y0 + gridH + LC.pb;
    // A side label sits beside its row, vertically centred on the box.
    const side = (row, text, cls) => { const [, top] = at(row * WEEKS); return `<text class="lc-t ${cls}" x="${x0 - 6}" y="${top + LC.ch / 2}" dominant-baseline="central" text-anchor="end">${text}</text>`; };
    let marks = '';
    if (!people) {
      for (const w of [1, 13, 26, 39, 52]) marks += `<text class="lc-t lc-tw" x="${x0 + (w - 1) * LC.px + LC.cw / 2}" y="${y0 - 10}" text-anchor="middle">${num(w)}</text>`;
      for (let y = 1; y <= YEARS; y++) if (y === 1 || y % 5 === 0) marks += side(y - 1, num(y), y % 10 ? 'lc-ty' : 'lc-ty lc-big');
    } else {
      // lc-tp, not lc-ty: a share of the people, never a year (check:evangelical-share tells the two apart).
      // 18px like the 5-year labels: "100%" at 20px overran the label column in a fallback serif.
      for (let d = 1; d <= YEARS / 10; d++) marks += side(d * 10 - 1, `${num(d * 10)}%`, 'lc-tp');
    }
    // A clear rule between decades, in the extra gap, so ten years read as one block; light rules at the quarters.
    let rules = '';
    for (const w of [13, 26, 39]) {
      const x = x0 + w * LC.px - gx / 2;
      rules += `<line class="lc-rule-q" x1="${x}" x2="${x}" y1="${y0 - 4}" y2="${y0 + gridH + 4}"/>`;
    }
    for (let d = 1; d < YEARS / 10; d++) {
      const [, top] = at(d * 10 * WEEKS);
      const y = top - LC.dec / 2 - gy / 2;
      rules += `<line class="lc-rule" x1="${x0 - 4}" x2="${x0 + gridW + 4}" y1="${y}" y2="${y}"/>`;
    }
    // data-geom: x0,y0,px,dec,py. The gates decode every box back to its index from it.
    const svg = `<svg class="lc-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-total="${TOTAL}" data-shaded="${n}" data-weeks="${WEEKS}" data-geom="${x0},${y0},${LC.px},${LC.dec},${LC.py}">`
      + `${rules}${marks}<path class="lc-off" d="${off}"/>${on ? `<path class="${shadeClass}" d="${on}"/>` : ''}</svg>`;
    return { TOTAL, YEARS, WEEKS, shadedCount: n, html: `<div class="lc-frame${people ? ' lc-plain' : ''}">${svg}</div>` };
  }

  // Page 2 — a human life, unshaded except for the weeks already lived if the caller supplies an age.
  // No age is supplied today: the packet is printed for a reader we do not know, so shading their life
  // would be a guess presented as a fact. The empty grid is the honest version and still lands the
  // point — 5,200 boxes is a whole life on one page.
  // ★ THE FIRST 33 YEARS ARE JESUS' LIFE (2026-09-29: the highlighted boxes show the 33
  // years of Jesus' life). Still no reader's age: shading the reader's own weeks would be a
  // guess presented as a fact, while 33 x 52 is the same for every reader.
  const JESUS_YEARS = 33;
  function lifePage(zone) {
    const g = lifeGrid({ shaded: JESUS_YEARS * 52, shadeClass: 'lc-on' });
    return sheet(`
      <div class="pg-head pg-head-c"><div class="pg-kicker">${esc(t('life_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('life_title'))}</h1></div>
      <p class="pg-lede pg-lede-c">${esc(t('life_lede'))}</p>
      ${g.html}
      <div class="lc-legend">
        <span><i class="lc-c lc-on"></i> ${esc(t('life_jesus'))} — ${num(g.shadedCount)} ${esc(t('life_weeks'))}</span>
        <span><i class="lc-c"></i> ${esc(t('life_full'))} — ${num(g.TOTAL)} ${esc(t('life_weeks'))}</span>
      </div>
    `, 'sheet-life sheet-flow');
  }

  // Page 3 — the SAME grid, shaded by the share of the DX population that is evangelical.
  //
  // ⚠ THE NUMBER IS POPULATION-WEIGHTED, NOT A GROUP COUNT, because the page shows the Christian
  // share of the POPULATION against the lost. Those differ sharply: 69.1% of the 2,091 matched DX GROUPS
  // have no known evangelicals, but weighted by POPULATION the evangelical share is 0.61% of
  // 209,079,159 people — 32 boxes of 5,200. A group-count version would have shown a different,
  // milder picture of the same data.
  // ⚠ AND THE BAND MIDPOINT IS AN ASSUMPTION, NAMED ON THE PAGE. peoplegroups.org publishes
  // EvangelicalLevel as a BAND ("Less than 2%", "No Known Evangelicals", …), never a number, so a
  // percentage requires choosing a value inside each band. The builder uses the band's midpoint and
  // 0 for "No Known Evangelicals"; the footnote says so, because a computed figure whose method is
  // invisible reads as a measurement.
  // ★ THIS LIST'S OWN SHARE. The lede says each box is a share of the people in this list, so the
  // number must be this packet's: the caller sums its own groups (evangelicalShare.js). A DOXA-wide
  // figure used to print here in every packet, true of no single list.
  // ⚠ PRESENCE, NOT FINITENESS. `Number.isFinite(Number(x))` passes null as 0 (Number(null) is 0), so a
  // list with no published levels would have printed "0% evangelical" — a confident falsehood. A list
  // that lacks the data prints a dash and no number, and its grid stays unshaded.
  function christianPage(zone, christian) {
    if (!christian || typeof christian !== 'object') return '';
    const raw = christian.pctEvangelical;
    const known = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
    // ★ PEOPLE, NOT WEEKS. The grid is the life calendar's 5,200 boxes, but on this page a box is an
    // equal share of the list's PEOPLE, so it is drawn with no week or year axis and the legend states
    // the totals in people: how many follow Jesus and how many do not yet, with each share as a
    // percentage. Weeks were the previous page's unit and meant nothing here.
    // ⚠ TWO DECIMALS, and the second share is 100 minus the ROUNDED first, so the two always sum to 100
    // as printed: 99.39 and 0.61, never 99.4 and 0.61. Formatted in the reader's locale.
    // ⚠ THE TOTALS COME FROM THE UNROUNDED SHARE; only the printed percentage rounds. Computing people
    // from the rounded figure would print 0 followers for a large list at 0.004% (tens of thousands of
    // people), and drift every other total. A real share below the last printed digit reads "<0.01%".
    const share = known ? Number(raw) : null;
    const pct = known ? Math.round(share * 100) / 100 : null;
    const g = lifeGrid({ shaded: known ? (share / 100) * 5200 : 0, shadeClass: 'lc-reached', people: true });
    const fmtPct = (x) => `${Number(x).toLocaleString(lang, { maximumFractionDigits: 2 })}%`;
    const tiny = known && share > 0 && pct === 0;
    const pop = known && Number(christian.population) > 0 ? Number(christian.population) : null;
    const followers = pop !== null ? Math.round(pop * share / 100) : null;
    const people = (n) => `${num(n)} ${esc(t('christian_people'))}`;
    const reachedPct = tiny ? `<${fmtPct(0.01)}` : fmtPct(pct);
    const lostPct = tiny ? `>${fmtPct(99.99)}` : fmtPct(Math.round((100 - pct) * 100) / 100);
    const reached = known ? `${pop !== null ? `${people(followers)} · ` : ''}<span class="ev-pct">${esc(reachedPct)}</span>`
      : '<span class="ev-pct">—</span>';
    const lost = known ? `${pop !== null ? `${people(pop - followers)} · ` : ''}${esc(lostPct)}` : '—';
    // Stated only when it is partial: how many of this list's groups the figure is computed over.
    const inList = Number(christian.groupsInList), matched = Number(christian.groupsMatched);
    const coverage = Number.isFinite(inList) && Number.isFinite(matched) && matched < inList
      ? ` · ${esc(fill(t('christian_coverage'), { matched: num(matched), total: num(inList) }))}` : '';
    // Below 10 people a box, one decimal — a list of 1,300 people is 0.3 a box, and rounding printed "≈ 0".
    const perBoxNum = (x) => (x >= 10 ? num(Math.round(x)) : Number(x).toLocaleString(lang, { maximumFractionDigits: 1 }));
    // The page states how many people ONE box stands for (the screen chart's own peoplePerCell, so paper
    // and screen divide the same way). Only when the population is known.
    const perBox = pop !== null
      ? `<p class="lc-per">${esc(fill(t('christian_per_cell'), { n: perBoxNum(peoplePerCell(pop, g.YEARS, g.WEEKS)) }))}</p>` : '';
    return sheet(`
      <div class="pg-head pg-head-c"><div class="pg-kicker">${esc(t('christian_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('christian_title'))}</h1></div>
      <p class="pg-lede pg-lede-c">${esc(t('christian_lede'))}</p>
      ${g.html}
      <div class="lc-legend">
        <span><i class="lc-c lc-reached"></i> ${esc(t('christian_reached'))} — ${reached}</span>
        <span><i class="lc-c"></i> ${esc(t('christian_lost'))} — ${lost}</span>
      </div>
      ${perBox}
      <p class="lc-foot">${esc(t('christian_foot'))}${coverage}</p>
    `, 'sheet-christian sheet-flow');
  }

  // ── THE DESCRIPTION CELL: FIT BEFORE CLAMP ───────────────────────────────────────────────────
  // ★ DETERMINISTIC BY CHARACTER COUNT, NEVER A DOM MEASURE. This module runs under Node for the
  // offline generator, where there is no layout engine to ask "how tall did that wrap?". So the
  // budgets below come from an average character advance deliberately set WIDER than Georgia's true
  // ~0.50em — 0.52 — so a locale that runs wider than English is absorbed by the estimate rather
  // than by an overflow onto a second page. Measuring in a browser would make the browser path and
  // the Node path disagree, which is worse than a slightly conservative estimate in both.
  //
  // WHY FIT BEFORE CLAMP: on paper a cut prayer
  // description loses meaning and a reader cannot scroll to recover it. So shrink the type first —
  // 17px, then 15px, then 14px — and truncate only as the last resort.
  const DESC_SIZES = [17, 15, 14];
  const AVG_ADVANCE = 0.52;
  const DESC_LINES = 2;                               // the 2-line budget the 73px row allows
  const budgetFor = (px) => Math.floor(DESC_W / (px * AVG_ADVANCE)) * DESC_LINES;

  // Word-aware truncation. An earlier version sliced mid-word ("…Die Abai Sungai le…"), which reads
  // as a RENDERING FAULT rather than an editorial cut — especially inside a people-group's name, where
  // a reader cannot tell a truncation from a misspelling of a name they have never seen.
  function cutAtWord(s, max) {
    if (s.length <= max) return s;
    const hard = s.slice(0, max - 1);
    const sp = hard.lastIndexOf(' ');
    // Unless the FIRST word alone exceeds the budget, back up to the last space.
    const body = sp > 0 ? hard.slice(0, sp) : hard;
    return body.replace(/[\s,;:.!?—–-]+$/, '') + '…';
  }

  // Returns { text, px, truncated }. Steps down the ladder, then clamps at the smallest size.
  function fitDescription(text) {
    const s = String(text || '');
    for (const px of DESC_SIZES) {
      if (s.length <= budgetFor(px)) return { text: s, px, truncated: false };
    }
    const px = DESC_SIZES[DESC_SIZES.length - 1];
    return { text: cutAtWord(s, budgetFor(px)), px, truncated: true };
  }

  // ★ THREE STATES, AND THE MIDDLE ONE IS WHY THIS IS A FUNCTION. `describe` is INJECTED (see
  // createPacketRenderer) rather than imported, because describeGroup's country resolver reaches a
  // Vite-only alias and imports JSON without an attribute — importing it here would make every
  // `node internal/check-*.mjs` unrunnable. So it may be ABSENT, and it may also RETURN EMPTY for a
  // group whose fields cannot form a sentence. Both degrade to the metadata line.
  // The metadata line is a FALLBACK ONLY: the normal render has no metadata
  // line, because describeGroup already puts the country and language INTO the sentence and printing
  // them again would say the country twice.
  function descCell(g) {
    const sentence = describe ? String(describe(g) || '') : '';
    if (!sentence) {
      // The fallback: religion + population + country, the same three facts the old card carried.
      return `<div class="d-fb">${esc(flat(g.religion))} · ${num(g.population)} ${esc(t('people_suffix'))} · ${esc(flat(g.country_code))}</div>`;
    }
    const f = fitDescription(sentence);
    return `<div class="d-tx" style="font-size:${f.px}px">${esc(f.text)}</div>`;
  }

  // The first profile page carries the explanation (the same block as the worksheet's) and FD_FIRST rows;
  // every later page carries PER_PAGE. The question heads stand ONCE over each page's tally column.
  const FD_FIRST = Math.floor((H - M - FD_ROWS_TOP + GUT) / (CH + GUT));
  function listPages(zone, groups, photos) {
    const pages = [];
    const prayHead = (top) => `<div class="pray-head" style="top:${Math.round(top)}px">${
      PRAY_COLS.map((key) => `<span>${esc(t(key))}</span>`).join('')}</div>`;
    for (let start = 0, page = 0; start < groups.length; page += 1) {
      const per = page === 0 ? FD_FIRST : PER_PAGE;
      // ★ PAGE 1'S ROWS FOLLOW THE EXPLANATION (2026-10-03). The explanation reserved a fixed FD_TOP_H and the
      // rows sat below the reserve, so every language shorter than the tallest left a gap above the head row
      // (0.36-1.30 in, measured in all 11). Now the explanation (at most FD_TOP_H) and the rows share one
      // column (.fd-first), and the rows are placed inside .fd-rows, right under it. The page still holds
      // FD_FIRST rows, sized for the full reserve, so a shorter explanation leaves the room at the page's foot.
      // The rows stay absolutely placed (see below), only their origin moves: no row can reflow to a page.
      const rowsTop = page === 0 ? PRAY_HEAD_H : M + HEAD;
      const left = page === 0 ? 0 : M;
      const slice = groups.slice(start, start + per);
      // ★ ONE FULL-WIDTH ROW PER GROUP. The column index is gone: `top` advances by the row, and the
      // three cells sit inside it. Absolute positioning is kept rather than switching to flow layout
      // because the print frame must not reflow — a row that moves between the browser preview and
      // the printed sheet is how a 20-row page becomes a 21-row page.
      const cards = slice.map((g, k) => {
        const i = start + k;
        const top = rowsTop + k * (CH + GUT);
        const src = photos.get(g.slug);
        // esc() on the URL too, not just on the name below it. src is photos.get(slug), and
        // usePosterPrints builds that Map straight from the API's image_url — so a quote in a
        // photo URL would close the attribute and inject the rest as markup, in a document the
        // reader is about to print. Same omission this file makes nowhere else.
        const img = src
          ? `<img src="${esc(src)}" alt="">`
          : `<div class="nophoto">${esc(t('no_photo'))}</div>`;
        return `<div class="card" style="left:${left}px;top:${top.toFixed(0)}px;
          width:${CW.toFixed(0)}px;height:${CH.toFixed(0)}px">${img}
          <div class="d-cell">
            <div class="nm">${i + 1}. ${esc(g.name)}</div>
            ${descCell(g)}
          </div>
          <div class="pray-cols">${PRAY_COLS.map(() => '<span class="pray-col"><i class="pray-box"></i></span>').join('')}</div>
          </div>`;
      }).join('');
      const rowsH = PRAY_HEAD_H + slice.length * (CH + GUT) - GUT;
      const body = page === 0
        ? `<div class="fd-first"><div class="fd-top">${explainTop()}${explainBand(groups.length,
            { w: PRAY_COLS.length * PRAY_CELL, cols: `repeat(${PRAY_COLS.length},${PRAY_CELL}px)`, gap: 0, cell: 'xb-cell xb-cell-fd' })}</div>`
          + `<div class="fd-rows" style="height:${rowsH.toFixed(0)}px">${prayHead(0)}${cards}</div></div>`
        : `${prayHead(rowsTop - PRAY_HEAD_H)}${cards}`;
      pages.push(sheet(`
        <div class="hd">${esc(zone.label || zone.id)}</div>
        <div class="hd-r">${esc(fill(t('list_header'),
          { from: num(start + 1), to: num(Math.min(start + per, groups.length)), count: num(groups.length) }))}</div>
        ${body}`));
      start += per;
    }
    return pages;
  }

  // ── THE LIGHTWEIGHT LIST: a worksheet, not a profile book ───────────────────
  // 2026-09-29: the lightweight packet is less about fitting information in and more a
  // printable, instructive sheet — every people group, less text, a kind rather than commanding
  // voice, and type and spacing sized for paper. Modelled on the Module 1 list-of-100 worksheet: a
  // short note on the first page, one column header per page, numbered rows with room to tick.
  // ★ EVERY ROW ALSO SHOWS THE GROUP'S PHOTO AND SHORT DESCRIPTION (2026-09-30): both packets show people,
  // not just names. The worksheet keeps its shape; each row gains the photo and a two-line description
  // (the same describeGroup sentence the full packet prints, cut at a word), so rows grow 70 → 92px.
  // Without a describer (the Node gates) the row keeps its country · population line.
  // ⚠ STILL EVERY GROUP. A variant may change HOW people are listed, never WHETHER they are.
  // Sizes in sheet px (1500px = 8.5in, so 1px ~ 0.41pt): names 26px ~ 10.6pt, rows 92px ~ 0.52in.
  // ★ THE FIRST PAGE EXPLAINS THE LIST BEFORE IT LISTS ANYONE (2026-10-02): the blessing, then the band (the
  // pace table, what the three columns ask, an example row). That costs six rows of the first page (16 → 10);
  // later pages keep 18. Measured in all 11 locales with a 100-group list: the tallest first page (ru) keeps
  // 67px under its tenth row; an eleventh would not fit.
  const WS_ROW = 92, WS_FIRST = 10, WS_REST = 18, WS_PHOTO = 76, WS_DESC_PX = 17;
  // A tally column is wide enough for a heading of two short lines ("What do you / want me to know?") and
  // for a few groups of tally marks in its cell.
  const WS_TALLY_W = 160;
  // The description cell's width: the sheet less its padding, the number, photo and tick columns, and
  // the five column gaps (the .ws-row grid below). Budgeted like the full packet's (budgetFor), and the
  // CSS clamps it to two lines too, for the scripts whose glyphs run wider than the estimate.
  const WS_DESC_W = W - 2 * M - 58 - WS_PHOTO - PRAY_COLS.length * WS_TALLY_W - (PRAY_COLS.length + 2) * 8;
  const WS_DESC_BUDGET = Math.floor(WS_DESC_W / (WS_DESC_PX * AVG_ADVANCE)) * 2;
  function worksheetLine(g) {
    const sentence = describe ? String(describe(g) || '') : '';
    if (sentence) return `<small class="ws-desc">${esc(cutAtWord(sentence, WS_DESC_BUDGET))}</small>`;
    const where = [flat(g.country_code_label) || flat(g.country) || flat(g.country_code),   // the name, not the ISO3
      Number(g.population) > 0 ? `${num(g.population)} ${t('people_suffix')}` : ''].filter(Boolean).join(' · ');
    return `<small>${esc(where)}</small>`;
  }
  // ── THE FIRST PAGE'S DESCRIPTION: how to use the list, and at what pace ─────
  // Plain words, not instructions to fill in a form: the three columns are three things to DO in prayer,
  // so each is explained by what it asks. The first carries the blessing to pray (Numbers 6:24-26, a
  // public-domain text per locale, credited) and ONE line of further blessing references, so a reader who
  // wants more has them without the page turning into a lectionary.
  // ⚠ ONE LINE OF REFERENCES, by layout as well as by count: white-space:nowrap, and the fit probe fails a
  // line wider than its box rather than letting it wrap into a second.
  // The refs are canonical English addresses whose BOOK is named in the reader's language (refSpan). A
  // locale whose Bible numbers the Psalms differently (the Synodal follows the Septuagint) carries its own
  // `bless_refs` with its own numbers, so a reader finds the same verse in the Bible they own.
  const BLESS_REFS = ['Psalm 134:3', 'Psalm 115:15', 'Psalm 29:11', 'Psalm 121:7', 'Genesis 12:3'];
  // THE PACE TABLE. How often the reader prays for EVERY group on the list by name, strongest pace first.
  // Each pace also says what it asks of a day, computed from THIS list's size (never a typed number): a
  // daily pace prays for all of them every day; slower paces spread the list over the period.
  const PACES = [
    { key: 'pace_daily', word: 'pace_strongest', days: 1 },
    { key: 'pace_weekly', word: 'pace_healthiest', days: 7, best: true },
    { key: 'pace_fortnight', word: 'pace_healthy', days: 14 },
    { key: 'pace_monthly', word: 'pace_normal', days: 30 },
    { key: 'pace_quarter', word: 'pace_slower', days: 90 },
  ];
  function paceLoad(n, days) {
    if (days === 1) return fill(t('pace_all'), { n: num(n) });
    if (n / days >= 1) return fill(t('pace_day'), { n: num(Math.round(n / days)) });
    if ((n * 7) / days >= 1) return fill(t('pace_week'), { n: num(Math.round((n * 7) / days)) });
    return fill(t('pace_month'), { n: num(Math.max(1, Math.round((n * 30) / days))) });
  }
  // ── THE LIST'S FIRST PAGE: the blessing, then ONE band that explains the table below it ──────────────
  // Shared by both packets (one code path): the intro and the blessing at full width, then a band built like
  // the poster's header band (a rule above, three columns between short rules, a rule below):
  //   1 the PACE table, strongest to slower, weekly marked, each pace's daily load computed from the list;
  //   2 what the three columns ask, in plain words;
  //   3 an EXAMPLE: the table's own question heads over one row of tally cells with marks in them. Its
  //     column is exactly as wide as the table's tally columns and sits over them, so it reads as a legend.
  // `tally` describes the table this band sits over: { w } its tally block's width, { cols, gap } the grid
  // of its cells, { cell } the class that draws a cell the size of the table's own.
  function explainTop() {
    const refs = (Array.isArray(L.bless_refs) ? L.bless_refs : BLESS_REFS).map(refSpan).join(' · ');
    return `<p class="ws-intro">${esc(t('light_intro'))}</p>
      <div class="xb-bless"><p class="xb-lead">${esc(t('howto_bless'))}</p>
        <blockquote class="ws-bless">${esc(t('blessing_text'))}<cite>${esc(t('blessing_credit'))}</cite></blockquote>
        <div class="ws-refs">${esc(t('howto_bless_more'))} ${refs}</div>
        <p class="ws-wheel">${esc(t('howto_wheel'))}</p></div>`;
  }
  // Tally marks the way they are drawn by hand: four strokes, the fifth across them.
  function tallySvg(n) {
    const out = [];
    for (let g = 0, x = 6; g < Math.ceil(n / 5); g += 1, x += 34) {
      const k = Math.min(5, n - g * 5);
      for (let i = 0; i < Math.min(k, 4); i += 1) out.push(`<line x1="${x + i * 6}" y1="6" x2="${x + i * 6}" y2="30"/>`);
      if (k === 5) out.push(`<line x1="${x - 4}" y1="26" x2="${x + 22}" y2="10"/>`);
    }
    return `<svg class="xb-marks" viewBox="0 0 ${Math.max(40, Math.ceil(n / 5) * 34 + 8)} 36" aria-hidden="true">${out.join('')}</svg>`;
  }
  function explainBand(n, tally) {
    const pace = PACES.map((p) => `<tr${p.best ? ' class="ws-pace-best"' : ''}><th>${esc(t(p.key))}</th>`
      + `<td class="xb-word">${esc(t(p.word))}</td><td>${esc(paceLoad(n, p.days))}</td></tr>`).join('');
    const item = (key, body) => `<li><b>${esc(t(key))}</b> ${esc(t(body))}</li>`;
    const grid = `grid-template-columns:${tally.cols};column-gap:${tally.gap}px`;
    return `<section class="xb" style="grid-template-columns:1.4fr 0.9fr ${tally.w}px">
      <div class="xb-col xb-pace"><div class="ws-sec">${esc(t('pace_title'))}</div>
        <p class="xb-p">${esc(t('pace_lead'))}</p><table class="ws-pace-t">${pace}</table>
        <p class="ws-pace-note">${esc(t('pace_note'))}</p></div>
      <div class="xb-col xb-how"><div class="ws-sec">${esc(t('howto_title'))}</div>
        <ol class="ws-cols">${item('pray_blessed', 'howto_bless_col')}${item('pray_know', 'howto_know')}${item('pray_do', 'howto_do')}</ol></div>
      <div class="xb-col xb-ex"><div class="ws-sec">${esc(t('example_title'))}</div>
        <div class="xb-ex-head" style="${grid}">${PRAY_COLS.map((k) => `<span>${esc(t(k))}</span>`).join('')}</div>
        <div class="xb-ex-row" style="${grid}">${[7, 3, 2].map((m) => `<span class="${tally.cell}">${tallySvg(m)}</span>`).join('')}</div>
        <p class="xb-p xb-ex-note">${esc(t('example_note'))}</p></div>
    </section>`;
  }
  function worksheetPages(zone, groups, photos = new Map()) {
    const pages = [];
    const head = `<div class="ws-head"><span></span><span></span><span>${esc(t('light_col_group'))}</span>${
      PRAY_COLS.map((key) => `<span>${esc(t(key))}</span>`).join('')}</div>`;
    for (let start = 0, page = 0; start < groups.length; page += 1) {
      const per = page === 0 ? WS_FIRST : WS_REST;
      const slice = groups.slice(start, start + per);
      const rows = slice.map((g, k) => {
        const src = photos.get(g.slug);
        // esc() on the URL, as the profile cards do: a quote in an API image_url must not become markup.
        const photo = src
          ? `<img class="ws-ph" src="${esc(src)}" alt="">`
          : `<span class="ws-ph nophoto">${esc(t('no_photo'))}</span>`;
        return `<div class="ws-row"><span class="ws-n">${num(start + k + 1)}</span>${photo}`
          + `<span class="ws-name"><b>${esc(g.name)}</b>${worksheetLine(g)}</span>`
          + PRAY_COLS.map(() => '<i class="ws-box"></i>').join('') + '</div>';
      }).join('');
      const top = page === 0
        ? `<div class="pg-head"><div class="pg-kicker">${esc(zone.label || zone.id)}</div>
             <h1 class="pg-h1 ws-h1">${esc(fill(t('map_page_sub'), { count: num(groups.length) }))}</h1></div>
           ${explainTop()}${explainBand(groups.length, { w: PRAY_COLS.length * WS_TALLY_W + (PRAY_COLS.length - 1) * 8,
             cols: `repeat(${PRAY_COLS.length},${WS_TALLY_W}px)`, gap: 8, cell: 'xb-cell xb-cell-ws' })}`
        : `<div class="ws-top"><span>${esc(zone.label || zone.id)}</span><span>${esc(fill(t('list_header'),
            { from: num(start + 1), to: num(Math.min(start + per, groups.length)), count: num(groups.length) }))}</span></div>`;
      pages.push(sheet(`${top}${head}${rows}<div class="ws-foot">${esc(t('privacy_note'))}</div>`, 'sheet-worksheet sheet-flow'));
      start += per;
    }
    return pages;
  }
  // Which list a variant prints. Keyed like VARIANTS; an unknown variant gets the profile pages.
  const LIST_STYLE = { lightweight: worksheetPages };

  // ── PAGE n+1: the 12 prayer points ──────────────────────────────────────────
  // ★ LARGER TYPE, ONE PAGE (2026-09-30). The sheet prints at 0.544 (1500px → 8.5in), so the old 17px body
  // was about 7pt on paper; the body is now 20px (about 8pt), the heading 22px. All twelve points, point 4's
  // Mark 5:18-20 and the Father's-heart list share this ONE sheet, in every locale: the sizes below are the
  // largest that fit the longest locale. class="points-body" is a TEST HOOK: the page must fit ONE sheet in
  // every locale (its scrollHeight within its clientHeight).
  // ★ ONE SHEET AGAIN (2026-10-02): the twelve points and the themes fit ONE page, as large as one page allows:
  // the point text 18.5px (~7.5pt on letter), the themes 19px, 5px between points, the Mark 5 passage 16px; the
  // credit line stays 0.28in above the edge. Measured in all 11 locales: the tightest (fr 75px, hi 79px) keep
  // that much under the last point; check:packet-render fails overflow (pointsOver).
  // ★ THE PAGE FITS ITSELF (2026-10-03). In its own language the page takes the LARGEST sizes that still fit
  // ONE sheet: from PT_MIN (the one-sheet sizes above, measured to fit all 11 locales) up to PT_MAX (the
  // two-sheet sizes before them, the cap), in PT_TIERS even steps, so shorter words print larger by
  // themselves. The credits keep their size. th / thb / scr are the themes' text, titles and scene refs.
  // ★ ESTIMATED, NEVER MEASURED, like the description cell (FIT BEFORE CLAMP): this module also runs under
  // Node. pointsHeight() lays the page out by character count, each block's lines from a greedy word wrap at
  // its own width, with per-script advances measured on this page in the packet's fonts and rounded UP; a
  // tier is taken only when the estimate fits with PT_SAFE to spare. check:packet-render measures the real
  // page in all 11 locales behind it (pointsOver).
  const PT_MIN = { head: 22, sub: 19, text: 18.5, refs: 16, gap: 5, passage: 16, th: 19, thb: 20, scr: 18 };
  const PT_MAX = { head: 25, sub: 21, text: 22.5, refs: 18.5, gap: 18, passage: 20, th: 21, thb: 22, scr: 19 };
  const PT_TOP = 82, PT_TIERS = 10, PT_SAFE = 0.97;
  const PT_BODY_H = H - (M + PT_TOP) - 80;          // the .points-body box: 1719px
  const ptTier = (k) => {
    const o = {};
    for (const n of Object.keys(PT_MIN)) o[n] = Math.round((PT_MIN[n] + (PT_MAX[n] - PT_MIN[n]) * k / PT_TIERS) * 4) / 4;
    return o;
  };
  // em per character by script, measured on this page (2026-10-03: Latin text 0.50-0.53, Cyrillic 0.58,
  // Arabic 0.44, Devanagari 0.54, Chinese 1.03) and rounded up; bold and semibold run wider.
  const CJK = /[\u2E80-\u9FFF\u3000-\u303F\uF900-\uFAFF\uFF00-\uFFEF]/;
  const ptAdv = (ch) => {
    const c = ch.codePointAt(0);
    if (CJK.test(ch)) return 1.05;
    if (c >= 0x0400 && c <= 0x052F) return 0.6;
    if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0xFB50 && c <= 0xFEFF)) return 0.47;
    if (c >= 0x0900 && c <= 0x097F) return 0.56;
    return 0.54;
  };
  const PT_BOLD = 1.2, PT_SEMI = 1.12;
  const ptW = (str, fs, wt) => [...str].reduce((a, ch) => a + ptAdv(ch), 0) * fs * wt;
  // Lines a run of segments ([text, px, weight]) takes at `width`: words wrap at spaces, and a word with Chinese
  // in it breaks between any two characters, as the browser breaks it.
  function ptLines(segs, width) {
    let lines = 0, x = 0;
    const put = (w) => { if (!lines) lines = 1; if (x > 0 && x + w > width) { lines++; x = 0; } x += w; };
    for (const [str, fs, wt] of segs) {
      const words = String(str || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      for (const word of words) {
        if (CJK.test(word)) for (const ch of word) put(ptW(ch, fs, wt));
        else put(ptW(word, fs, wt));
        x += ptW(' ', fs, wt);
      }
    }
    return lines;
  }
  // The flex rows a wrapping list takes: items of the given widths, 20px apart.
  const ptRows = (widths, width) => {
    let rows = 1, x = 0;
    for (const w of widths) { if (x > 0 && x + 20 + w > width) { rows++; x = 0; } x += (x > 0 ? 20 : 0) + w; }
    return rows;
  };
  // A line's "normal" height, measured: 1.18-1.19 x its size in the serif faces, 1.31-1.32 where it is Chinese.
  const ptNormal = (str) => (CJK.test(String(str || '')) ? 1.33 : 1.19);
  function pointsHeight(sz) {
    const BW = W - 2 * M;                              // the body's width
    const themes = Array.isArray(L.themes) && L.themes.length === 7 ? L.themes : EN.themes || [];
    const scenes = Array.isArray(L.scenes) && L.scenes.length === 3 ? L.scenes : EN.scenes || [];
    const sref = EN.scene_refs || [];
    let h = 0;
    if (themes.length) {
      const row = sz.th * 1.3, numW = 1.3 * sz.th + ptW(' ', sz.th, 1);
      h += ptLines([[t('themes_title'), sz.thb, PT_BOLD], [t('themes_intro'), sz.th, 1]], BW) * Math.max(row, sz.thb * ptNormal(t('themes_title')));
      const tRows = ptRows(themes.map((x) => numW + ptW(String(x), sz.th, 1)), BW);
      const sRows = ptRows([ptW(String(t('scenes_title')), sz.thb, PT_BOLD), ...scenes.map((x, i) => numW + ptW(String(x), sz.th, 1)
        + ptW(` ${(sref[i] || []).map(refText).join(' · ')}`, sz.scr, PT_SEMI))], BW);
      h += 2 + tRows * row + (tRows - 1) + 2 + sRows * row + (sRows - 1) + 6 + 1.5 + 10;
    }
    for (const p of POINTS) {
      const refs = (p.refs || []).map(refText).join(' · ');
      h += ptLines([[`${p.n}. ${tr(p.rhythm)}`, sz.head, PT_BOLD], ...(p.sub ? [[`— ${p.sub}`, sz.sub, 1]] : [])], BW) * sz.head * ptNormal(tr(p.rhythm));
      h += 2 + ptLines([[p.text, sz.text, 1]], BW) * sz.text * 1.3;
      h += 2 + ptLines([[refs, sz.refs, PT_SEMI]], BW) * sz.refs * ptNormal(refs);
      if (p.print_passage) {
        const IW = BW - 15;                            // the passage and heart blocks' 12px inset and 3px rule
        const passage = String(t('point4_passage') || ''), bold = String(t('point4_passage_bold') || '');
        const at = bold ? passage.indexOf(bold) : -1;
        const segs = at < 0 ? [[passage, sz.passage, 1]]
          : [[passage.slice(0, at), sz.passage, 1], [bold, sz.passage, PT_BOLD], [passage.slice(at + bold.length), sz.passage, 1]];
        h += 6 + ptLines(segs, IW) * sz.passage * 1.4 + 2 + ptLines([[t('point4_passage_credit'), 13, 1]], IW) * 13 * ptNormal(t('point4_passage_credit'));
        h += 8 + ptLines([[t('point4_heart_title'), sz.refs, PT_BOLD + 0.15]], IW) * sz.refs * ptNormal(t('point4_heart_title'));
        h += 2 + ptLines([[t('point4_heart_lede'), sz.passage, 1]], IW) * sz.passage * 1.35;
        h += 6 + ptLines([[t('point4_heart_leadin'), sz.passage - 1, 1]], IW) * (sz.passage - 1) * 1.3;
        const CWH = (IW - 28 - 40) / 2;                // the heart list's two columns
        const items = HEART.reduce((a, x) => a + ptLines([[x.who, sz.passage - 1, PT_BOLD], [` · ${refText(x.ref)}`, sz.passage - 1, 1]], CWH), 0);
        h += 3 + Math.ceil(items / 2) * (sz.passage - 1) * 1.4;
      }
      h += sz.gap;
    }
    return h;
  }
  // The largest tier whose estimate fits; the floor when none does (the gate then reports the overflow).
  const fitPoints = () => {
    for (let k = PT_TIERS; k > 0; k--) if (pointsHeight(ptTier(k)) <= PT_BODY_H * PT_SAFE) return { k, sz: ptTier(k) };
    return { k: 0, sz: ptTier(0) };
  };
  // ⚠ ISOLATE EACH REFERENCE FOR BIDI. Scripture references stay in English
  // (a reader looks them up in their own Bible), so on an RTL page they are
  // LTR runs inside an RTL paragraph. Without isolation the Unicode bidi
  // algorithm reorders a run that STARTS WITH A DIGIT: measured on the Arabic
  // page, "1 Peter 5:6–11" rendered as "Peter 5:6-11 1". dir="ltr" on each
  // reference pins its internal order without affecting the line's direction.
  // ★ THE BOOK NAME IS PROSE, THE ADDRESS IS NOT. refs stay canonical English in the data (one
  // address, checkable against any Bible), and the BOOK is named in the packet's language at print
  // time from its `books` table: a Chinese packet cited "Matthew 27:27", English in every locale.
  // A localized name in a right-to-left script is isolated rtl, so the book reads on the right and
  // the chapter:verse keeps its digit order; a Latin reference stays the ltr isolate described above.
  const refBook = (r) => {
    const m = String(r).match(/^(.*?)\s+(\d[\d:–\-,; ]*)$/);
    const book = m && (L.books || {})[m[1]];
    return { book, text: book ? `${book} ${m[2]}` : String(r) };
  };
  const refText = (r) => refBook(r).text;
  const refSpan = (r) => {
    const { book, text } = refBook(r);
    const dir = book && RTL.has(lang) ? 'rtl' : 'ltr';
    return `<span dir="${dir}" style="unicode-bidi:isolate">${esc(text)}</span>`;
  };
  // ★ PRAYER THEMES AT THE TOP (2026-10-02): seven themes, then three prayer scenes, each scene with two
  // references (one Old Testament, one New), as a thin numbered list above the twelve points. They are
  // ideas to weave into the wheel's five-minute blocks, so they sit before the points rather than among them.
  // The words are the language's own (themes / scenes); the scene addresses are English's (scene_refs),
  // canonical like every reference here, the book named in the reader's language. class="pt-themes" is a
  // TEST HOOK: the gates count 7 themes and 3 scenes with 2 references each.
  function themesBlock() {
    const themes = Array.isArray(L.themes) && L.themes.length === 7 ? L.themes : EN.themes || [];
    const scenes = Array.isArray(L.scenes) && L.scenes.length === 3 ? L.scenes : EN.scenes || [];
    if (!themes.length) return '';
    const sref = EN.scene_refs || [];
    const item = (n, body) => `<li><span class="pt-n">${num(n)}</span> ${body}</li>`;
    return `<div class="pt-themes">
        <div class="pt-th-h"><b>${esc(t('themes_title'))}</b> <span class="pt-th-i">${esc(t('themes_intro'))}</span></div>
        <ol class="pt-th-list">${themes.map((x, i) => item(i + 1, esc(x))).join('')}</ol>
        <ol class="pt-th-list pt-sc-list"><li class="pt-sc-h"><b>${esc(t('scenes_title'))}</b></li>${scenes.map((x, i) => item(themes.length + i + 1,
          `${esc(x)} <span class="pt-sc-r">${(sref[i] || []).map(refSpan).join(' · ')}</span>`)).join('')}</ol>
      </div>`;
  }
  // `tier` forces a size tier (0..PT_TIERS); probes and gates only. data-pt-tier states the tier chosen and
  // data-pt-est its estimated height, so check:packet-render can hold the estimate to the real page.
  function pointsPage(tier) {
    const k = Number.isInteger(tier) ? Math.max(0, Math.min(PT_TIERS, tier)) : fitPoints().k;
    const PT = ptTier(k);
    const rows = POINTS.map((p) => {
      const refs = (p.refs || []).map(refSpan).join(' · ');
      const sub = p.sub ? ` <span style="font:italic ${PT.sub}px Georgia,serif;color:#8c8170">— ${esc(p.sub)}</span>` : '';
      return `<div style="margin-bottom:${PT.gap}px">
        <div class="pt-h" style="font:700 ${PT.head}px Georgia,serif;color:#1b1a17">
          ${p.n}. ${esc(tr(p.rhythm))}${sub}</div>
        <div style="font:400 ${PT.text}px Georgia,serif;color:#3b3226;line-height:1.3;margin-top:2px">${esc(p.text)}</div>
        <div style="font:600 ${PT.refs}px Georgia,serif;color:#7a3b2e;margin-top:2px">${refs}</div>
        ${p.print_passage ? passageBlock(PT) + heartBlock(PT) : ''}
      </div>`;
    });
    return sheet(`
      <div style="position:absolute;left:${M}px;top:44px;right:${M}px">
        <div class="points-title" style="font:700 40px Georgia,serif;color:#1b1a17">${esc(t('points_title'))}</div>
        <div style="font:italic 18px Georgia,serif;color:#6d766e;margin-top:6px">${esc(t('points_intro'))}</div>
      </div>
      <div class="points-body" data-pt-tier="${k}" data-pt-est="${Math.round(pointsHeight(PT))}" style="position:absolute;left:${M}px;top:${M + PT_TOP}px;right:${M}px;bottom:80px;--pt-th:${PT.th}px;--pt-thb:${PT.thb}px;--pt-scr:${PT.scr}px">${themesBlock()}${rows.join('')}</div>
      <div class="fine">${esc(t('points_attrib'))}</div>`, 'sheet-points');
  }

  // ★ THE HEAVENLY FATHER'S HEART (2026-09-30): a plain statement of what they need to know (point4_heart_lede,
  // the exact product copy), a simple lead-in, then seven short readings, each a household the Father saved
  // through one person. The person is named in the packet's language; the passage is addressed in the
  // reader's own Bible (refs stay canonical English in the data and the book is localized, like the point
  // refs). class="p4-heart" is a TEST HOOK: the gates count its seven items.
  const heartBlock = (PT) => `<div class="p4-heart" style="margin-top:8px;padding-inline-start:12px;border-inline-start:3px solid #d9d3c4">
      <div class="p4-heart-h" style="font:700 ${PT.refs}px Georgia,serif;letter-spacing:.08em;color:#7a3b2e">${esc(t('point4_heart_title'))}</div>
      <div class="p4-heart-lede" style="font:400 ${PT.passage}px/1.35 Georgia,serif;color:#2f2a22;margin-top:2px">${esc(t('point4_heart_lede'))}</div>
      <div class="p4-heart-leadin" style="font:italic ${PT.passage - 1}px/1.3 Georgia,serif;color:#4a4a45;margin-top:6px">${esc(t('point4_heart_leadin'))}</div>
      <ol class="p4-heart-list" style="margin:3px 0 0;padding-inline-start:28px;columns:2;column-gap:40px;font:400 ${PT.passage - 1}px/1.4 Georgia,serif;color:#3b3226">${
        HEART.map((h) => `<li><b>${esc(h.who)}</b> · ${refSpan(h.ref)}</li>`).join('')}</ol></div>`;
  // ── POINT 4's READING: Mark 5:18-20, on the points page ────────────────────────
  // ★ POINT 4 IS READING THE WORD (2026-09-30, the second revision): Mark 5:18-20 only, the man who begged to
  // stay, sent home to tell "how much the Lord has done for you", and the Decapolis. Short enough that point 4
  // carries it under its own text and ALL TWELVE POINTS FIT ONE PAGE again (it had its own sheet for 1-20).
  // The packet's public-domain texts, trimmed to those verses (point4_passage, with its credit; the English
  // WEB text where a language has none on file, as the packet always did). Verse 19 in bold:
  // point4_passage_bold holds it verbatim from the same text, so the bold is a substring match and never a
  // second rendering of scripture. class="p4-passage" / "p4-v19" are TEST HOOKS.
  function passageBlock(PT) {
    const passage = String(t('point4_passage') || '');
    const bold = String(t('point4_passage_bold') || '');
    const at = bold ? passage.indexOf(bold) : -1;
    const body = at < 0 ? esc(passage)
      : `${esc(passage.slice(0, at))}<strong class="p4-v19" style="font-weight:700;color:#1b1a17">${esc(bold)}</strong>${esc(passage.slice(at + bold.length))}`;
    return `<div class="p4-passage" style="font:400 ${PT.passage}px/1.4 Georgia,serif;color:#2f2a22;margin-top:6px;
        padding-inline-start:12px;border-inline-start:3px solid #d9d3c4">${body}
        <div class="p4-credit" style="font:italic 13px Georgia,serif;color:#a89f8c;margin-top:2px">${esc(t('point4_passage_credit'))}</div></div>`;
  }

  // ── PAGE n+1: the BOUNDED and CENTERED sets ─────────────────────────────────
  // BACK MATTER: after the profiles, before the wheel. FULL DETAIL ONLY — the lightweight
  // packet is map · triangle · profiles · wheel · points, and these two figures are the part a
  // reader sits with rather than carries.
  //
  // The LAYOUTS come from regions' library/components/charts modules, imported directly rather than
  // injected: unlike describeGroup's country resolver they have ZERO imports and run under plain
  // node (verified by importing and calling them, not by reading them), and packet-render already
  // imports scatterCells from that same directory. They return DATA — points with x/y in unitless
  // SVG user coordinates centred on (cx,cy) — so the markup below is ours.
  //
  // ⚠ GOSPEL'S NON-NEGOTIABLE, carried through regions: the bounded set keeps a deliberate gap
  // either side of the boundary (inside within 0.92r, outside beyond 1.12r) because a dot sitting ON
  // the line is the one thing a bounded set cannot express, and PRINT HAS NO HOVER to disambiguate
  // it. If the figure does not fit, SHRINK THE WHOLE FIGURE — never compress the gap. Measured on
  // the real module with 40 groups: inside max 85.3 of 92 allowed, outside min 119.8 of 112
  // required. The scale below is applied to the viewBox, so it cannot touch the gap.
  // ★ THE AGREED RING VOCABULARY, COMPOSED — not a flat 1..10 table. Settled between gospel and exp
  // and derived from exp's ringFor(), so the numbering cannot drift from the code that produces it;
  // the screen legend renders the same words, so a printed sheet cannot disagree with the screen.
  //   1 same dialect, same people     6 same language, different culture
  //   2 same dialect, near culture    7 same family, same people
  //   3 same dialect, different culture  8 same family, near culture
  //   4 same language, same people    9 same family, different culture
  //   5 same language, near culture  10 nearby only
  // ⚠ COMPOSED FROM band x culture BECAUSE ONE CELL IS PROVISIONAL. "same people" vs the brief's
  // "same culture" in column 1 is PROVISIONAL, pending a product decision, and it appears in rings 1, 4 AND 7 —
  // so a flat ten-string table would need THREE edits kept in step, which is exactly how two of them
  // end up saying different things. Composed, it is ONE string (ring_culture_same) and the ring
  // numbering, the columns and the colours are untouched either way.
  const BANDS = ['dialect', 'dialect', 'dialect', 'language', 'language', 'language', 'family', 'family', 'family'];
  const CULTURES = ['same', 'near', 'different', 'same', 'near', 'different', 'same', 'near', 'different'];
  function ringName(n) {
    if (n === RING_MAX) return t('ring_band_geography');          // 10 stands alone
    const i = n - 1;
    if (i < 0 || i >= BANDS.length) return '';
    return fill(t('ring_join'), { band: t(`ring_band_${BANDS[i]}`), culture: t(`ring_culture_${CULTURES[i]}`) });
  }

  // ONLY THE RINGS THAT HOLD SOMEONE. Ten rows of vocabulary beside a figure is a glossary, not a
  // legend, and nine of the ten are routinely empty for one zone. Printing a named ring with no
  // group on it also invites the reader to look for a dot that is not there. `ringTally` gives the
  // per-ring counts, so the legend states what this zone actually contains, in ring order.
  function ringLegend(tally) {
    const counts = tally && tally.counts;
    const get = (n) => (counts && typeof counts.get === 'function' ? Number(counts.get(n) || 0) : 0);
    const rows = [];
    for (let n = 1; n <= RING_MAX; n++) {
      const name = ringName(n);
      if (!name) continue;
      const c = get(n);
      // Ring 10 is not a ring of the target: it is everything past ring 9 (nearby, no shared tongue).
      rows.push(`<li><span class="ring-n">${n === RING_MAX ? '+' : n}</span> ${esc(name)}`
        + ` <span class="ring-c">${c ? num(c) : '—'}</span></li>`);
    }
    return rows.length ? `<ol class="set-rings">${rows.join('')}</ol>` : '';
  }

  // A cross, centred on (cx, cy), `h` tall: the centre of both figures is Christ.
  function cross(cx, cy, h) {
    const bar = h * 0.2, arm = h * 0.66;
    return `<g class="set-cross"><rect x="${(cx - bar / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`
      + `<rect x="${(cx - arm / 2).toFixed(1)}" y="${(cy - h / 2 + h * 0.24).toFixed(1)}" width="${arm.toFixed(1)}" height="${bar.toFixed(1)}" rx="1.5"/></g>`;
  }

  function setsPage(zone, sets, listSize) {
    // '' WITHOUT DATA, exactly like funnelPage and christianPage — a page that cannot state true
    // figures must not appear at all. This is what keeps FULL valid before a host supplies sets.
    if (!sets || (!Array.isArray(sets.bounded) && !Array.isArray(sets.centered))) return '';
    const bounded = Array.isArray(sets.bounded) ? sets.bounded : [];
    const centered = Array.isArray(sets.centered) ? sets.centered : [];
    if (!bounded.length && !centered.length) return '';
    // ★ EVERY GROUP OF THE LIST IS COUNTED (2026-10-03). A group with no record in a figure's data (no
    // near-neighbour data, say) is in none of its figures, so a caption used to add up to less than the
    // list: Laos printed "88 placed · 0 at the centre · 6 unplaced", 94 of its 95. The groups missing from
    // a figure's data are now named in its caption ("1 without data"), so its parts add up to the list.
    const noData = (n) => (Number.isFinite(listSize) && listSize > n ? ` · ${fill(t('sets_no_data'), { n: num(listSize - n) })}` : '');
    const panels = [];
    let legend = '';

    if (bounded.length) {
      const L = layoutBoundedSet(bounded, { r: 100, spread: 220 });
      const T = boundedSetTally(L);
      // ⚠ UNKNOWN POINTS CARRY NO x/y, AND THAT IS THE MODULE BEING CORRECT: we do not know which side of
      // the boundary they belong on, so there is no honest place to draw them. They are STATED in the
      // tally instead (an un-inked category on a printed page reads as zero).
      // A square view with PADDING: the outermost dot is spread*1 from the centre, so 250 leaves room.
      const S = 250;
      const dot = (p, cls) => `<circle class="${cls}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"/>`;
      panels.push({ kind: 'bounded', html: `<div class="set-panel">
        <h2 class="set-h">${esc(t('sets_head_bounded'))}</h2>
        <div class="set-sub">${esc(t('sets_bounded_title'))}</div>
        <svg class="set-svg" viewBox="${L.cx - S} ${L.cy - S} ${2 * S} ${2 * S}">
          ${L.outside.map((p) => dot(p, 'set-out')).join('')}
          ${L.inside.map((p) => dot(p, 'set-in')).join('')}
          <circle class="set-ring" cx="${L.cx}" cy="${L.cy}" r="${L.r}"/>
          ${cross(L.cx, L.cy, 44)}
        </svg>
        <p class="set-cap">${esc(fill(t('sets_bounded_tally'),
          { inside: num(T.inside), outside: num(T.outside), unknown: num(T.unknown) }) + noData(bounded.length))}</p>
      </div>` });
    }

    if (centered.length) {
      const L = layoutCenteredSet(centered, {});
      const T = ringTally(L);
      // ★ A TARGET, NOT RINGS OF DOTS. The layout places every group ON its ring's line, so one ring's
      // groups printed as a circle of overlapping dots and the figure read as rings of people rather than
      // as a target. Here each ring is a BAND, numbered, and each group sits somewhere inside its band:
      // the layout's own angle (stable per group), and a radius inside the band from the group's id.
      const R0 = 34, BW = 25, RINGS = RING_MAX - 1;          // 9 numbered bands; ring 10 lies past them
      const outer = R0 + RINGS * BW, far = outer + BW;
      const S = far + 14, DOT = 5.5;
      const bands = [];
      bands.push(`<circle class="set-band-out" cx="0" cy="0" r="${far}"/>`);
      for (let n = RINGS; n >= 1; n--) {
        bands.push(`<circle class="${n % 2 ? 'set-band-a' : 'set-band-b'}" cx="0" cy="0" r="${R0 + n * BW}"/>`);
      }
      bands.push(`<circle class="set-core" cx="0" cy="0" r="${R0}"/>`);
      // ★ READ UPWARD TO THE CROSS (2026-10-02): the numbers ride the vertical axis BELOW the centre, 9 at the
      // bottom, so the eye climbs 9 → 1 to the cross. The dots keep clear of that lane: bandFill leaves the
      // lane straight up clear, and every dot is turned half a circle (x, y → -x, -y) to put it below.
      const nums = [];
      for (let n = 1; n <= RINGS; n++) {
        const y = R0 + (n - 0.5) * BW;
        nums.push(`<circle class="set-num" cx="0" cy="${y}" r="9"/><text class="set-num-t" x="0" y="${y}">${n}</text>`);
      }
      // THE SHARED BAND GEOMETRY (charts/ringBands.js bandFill, the same module the screen set charts
      // use): even spread through each band, no two dots overlapping, none in the number lane straight
      // up. Bands are centred on ringRadii, so innerR is the middle of band 1. 'fit' mode, the one meant
      // for print: a ring too full to separate reports its remainder instead of overlapping it.
      const radii = ringRadii({ innerR: R0 + BW / 2, ringGap: BW });
      // The number lane, per ring: the arc a badge (radius 9) plus a dot (DOT) plus a gap subtends at THAT
      // ring's radius. A fixed angle was too narrow at ring 1 (r ≈ 46), where a dot could sit under the badge.
      const laneFor = (r) => { const half = Math.asin(Math.min(1, (9 + DOT + 2) / r)); return { start: -Math.PI / 2 - half, span: 2 * half }; };
      // The caption states what is DRAWN: 'fit' keeps every dot separable on paper, so a ring too full to
      // hold its groups reports the remainder (bf.unplaced), which joins the unplaced count rather than
      // vanishing while the caption still counted it. The ring legend keeps each ring's true total.
      const bf = bandFill(L.placed, radii, {
        ringGap: BW, minSep: 2 * DOT + 2, pinRadius: DOT, minPinFloor: 3,
        labels: radii.map((x) => ({ ring: x.ring, keepOut: laneFor(x.r) })),
      });
      const dots = bf.placed.map((p) =>
        `<circle class="set-in" cx="${(-p.x).toFixed(1)}" cy="${(-p.y).toFixed(1)}" r="${(p.pin || DOT).toFixed(1)}"/>`).join('');
      panels.push({ kind: 'centered', html: `<div class="set-panel">
        <h2 class="set-h">${esc(t('sets_head_centered'))}</h2>
        <div class="set-sub">${esc(t('sets_centered_title'))}</div>
        <svg class="set-svg" viewBox="${-S} ${-S} ${2 * S} ${2 * S}">
          ${bands.join('')}${dots}${nums.join('')}${cross(0, 0, 40)}
        </svg>
        <p class="set-cap">${esc(fill(t('sets_centered_tally'),
          { placed: num(bf.placed.length), centre: num(T.centre), unplaced: num(T.unplaced + bf.unplaced.length) }) + noData(centered.length))}</p>
      </div>` });
      const rows = ringLegend(T);
      // The legend first says what a ring IS, in plain words, then lists the rings that hold someone.
      if (rows) legend = `<div class="set-legend"><div class="set-legend-h">${esc(t('sets_rings_head'))}</div>`
        + `<p class="set-legend-p">${esc(t('sets_rings_lede'))}</p>${rows}</div>`;
    }

    // ★ ONE CHART PER PAGE (2026-09-29, second look: the bounded set on one page and the centered set on
    // another), each a large square panel centred on its page with its heading — the Module 1 panel,
    // at a size a printed page can carry. The centered set's page carries the ring legend beneath it.
    // Both pages share the pair's heading so they read as one spread; the first carries the lede.
    // The page key stays 'sets', so the lightweight variant still drops both together.
    return panels.map((p, i) => sheet(`
      <div class="pg-head pg-head-c"><div class="pg-kicker">${esc(t('sets_kicker'))}</div>
        <h1 class="pg-h1">${esc(t('sets_title'))}</h1></div>
      ${i === 0 ? `<p class="pg-lede pg-lede-c">${esc(t('sets_lede'))}</p>` : ''}
      <div class="set-row set-row-solo set-solo-${p.kind}">${p.html}</div>
      ${p.kind === 'centered' ? legend : ''}
    `, `sheet-sets sheet-flow sheet-sets-${p.kind}`)).join('');
  }

  // ── PAGE n+2: the prayer wheel ──────────────────────────────────────────────
  // REDRAWN as SVG rather than embedding the source PDF page: a raster embed cannot
  // be translated, and this packet must generate in any language. Twelve equal
  // segments, the rhythm name set along each, 5 minutes each = one hour.
  function wheelPage() {
    const cx = W / 2, cy = 1075, R = 500;
    const SANS = "'Public Sans','Helvetica Neue',Arial,-apple-system,'Segoe UI',system-ui,sans-serif";
    const order = ['praise', 'wait', 'confess', 'read', 'ask', 'intercede',
      'pray_word', 'thank', 'sing', 'meditate', 'listen', 'praise_end'];
    // ★ THE SOURCE WHEEL'S OWN COLOURS. Sampled from the fill operators in the content stream of the
    // Metacamp Module 1 prayer wheel's PDF, in rhythm order — not eyeballed
    // from a rendering. They run warm to cool around the hour, which is what makes the source wheel
    // read at a glance; a generated hue sweep had the right idea and none of its colours.
    const HUES = ['#fe936a', '#febb64', '#fed164', '#fffa83', '#e6f37d', '#a3d979',
      '#47ccfc', '#6293fe', '#722cfd', '#c632fd', '#e6578d', '#ff766f'];
    // ★ PRAISE AT THE TOP (2026-09-30, turned 90° clockwise from the source's nine o'clock). Like a peace sign:
    // the opening PRAISE runs from twelve to one and the closing PRAISE from eleven to twelve, so the two meet
    // at the top and the hour starts and ends with praise. SVG angles: 0 is three o'clock and they increase
    // clockwise, so twelve o'clock is 270. The "Start here" marker sits on the opening, top-RIGHT praise.
    const START = 270;
    const rad = (d) => d * Math.PI / 180;
    const seg = order.map((key, i) => {
      const a0 = rad(START + i * 30), a1 = rad(START + (i + 1) * 30), mid = (a0 + a1) / 2;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const tx = cx + R * 0.6 * Math.cos(mid), ty = cy + R * 0.6 * Math.sin(mid);
      let deg = mid * 180 / Math.PI;
      deg = ((deg + 180) % 360 + 360) % 360 - 180;      // normalise to -180..180
      if (deg > 90 || deg < -90) deg += 180;              // keep every label upright
      return `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${HUES[i]}"/>
              <text class="wheel-label" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})"
                text-anchor="middle" dominant-baseline="middle" filter="url(#pw-label)"
                font-family="${SANS}" font-weight="800" font-size="26" letter-spacing="0.5" fill="#ffffff"
                stroke="#000000" stroke-opacity="0.28" stroke-width="2.5" paint-order="stroke fill">${esc(tr(key))}</text>`;
    }).join('');
    // The source's "5 / minutes" badge on the rim: a black disc for the number, a dark tag under it.
    const badges = order.map((_, i) => {
      const a = rad(START + (i + 0.5) * 30);
      const x = cx + (R + 44) * Math.cos(a), y = cy + (R + 44) * Math.sin(a);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="23" fill="#000000"/>
              <text x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                font-family="${SANS}" font-weight="700" font-size="24" fill="#ffffff">5</text>
              <rect x="${(x - 40).toFixed(1)}" y="${(y + 19).toFixed(1)}" width="80" height="22" rx="2" fill="#5b5b5b"/>
              <text x="${x.toFixed(1)}" y="${(y + 31).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                font-family="${SANS}" font-size="14" fill="#ffffff">${esc(t('wheel_minutes'))}</text>`;
    }).join('');
    // "Start here": a pill beyond the rim at one o'clock, with an arrow to the opening praise segment's edge
    // (clockwise from there, back round to praise). class="wheel-start" is a TEST HOOK.
    const sa = rad(START + 45), px = cx + (R + 150) * Math.cos(sa), py = cy + (R + 150) * Math.sin(sa);
    const ea = rad(START + 20), ex = cx + (R + 8) * Math.cos(ea), ey = cy + (R + 8) * Math.sin(ea);
    const startMark = `<g class="wheel-start">
        <rect x="${(px - 110).toFixed(1)}" y="${(py - 26).toFixed(1)}" width="220" height="52" rx="26" fill="#009c57"/>
        <text x="${px.toFixed(1)}" y="${(py + 1).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
          font-family="${SANS}" font-weight="800" font-size="24" fill="#ffffff">${esc(t('wheel_start'))}</text>
        <path d="M ${(px - 70).toFixed(1)} ${(py + 26).toFixed(1)} Q ${(px - 90).toFixed(1)} ${(ey - 10).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"
          fill="none" stroke="#009c57" stroke-width="5" stroke-linecap="round" marker-end="url(#pw-arrow)"/>
      </g>`;
    return sheet(`
      <div style="position:absolute;left:${M}px;top:48px;right:${M}px;text-align:center">
        <div class="wheel-title" style="font:800 46px ${SANS};color:#009c57;text-transform:uppercase;letter-spacing:.5px">${esc(t('wheel_title'))}</div>
        <div style="font:400 21px/1.5 ${SANS};color:#2b2a26;margin-top:12px;
                    max-width:1060px;margin-left:auto;margin-right:auto">${esc(t('wheel_intro'))}</div>
      </div>
      <svg width="${W}" height="${H}" style="position:absolute;left:0;top:0" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- the source wheel's soft shadow, and the shadow that keeps white labels legible on its
               palest segments (READ THE WORD sits on #fffa83). The labels ALSO carry a faint dark
               outline painted under the fill: a print path that drops SVG filters would otherwise
               leave white text on pale yellow, near-invisible. -->
          <filter id="pw-wheel" x="${cx - R - 60}" y="${cy - R - 60}" width="${2 * R + 120}" height="${2 * R + 120}" filterUnits="userSpaceOnUse">
            <feDropShadow dx="4" dy="6" stdDeviation="7" flood-color="#000000" flood-opacity="0.22"/>
          </filter>
          <marker id="pw-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#009c57"/>
          </marker>
          <filter id="pw-label" x="-20%" y="-60%" width="140%" height="220%">
            <feDropShadow dx="1.5" dy="1.5" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.55"/>
          </filter>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="#ffffff" filter="url(#pw-wheel)"/>
        ${seg}${badges}${startMark}
      </svg>
      <div class="fine">${esc(t('wheel_attrib'))}</div>`);
  }

  // ── BUILD ONE PACKET ────────────────────────────────────────────────────────
  // Assemble the whole document. photos is a Map(slug -> dataURL-or-URL); mapSvg is
  // the poster's <svg> plus the stylesheet its var()s resolve against (see mapCss).
  // `funnel` is OPTIONAL and the page is omitted when it is absent, so every existing caller keeps
  // working unchanged and a host with no funnel data still gets a complete, correct packet. A page
  // that cannot state true numbers must not appear at all — better a 4-section packet than one
  // asserting figures it could not read.
  // ★ TWO PACKETS, ONE RENDERER: the Prayer List print gains a caret
  // with "Full detail" and "Lightweight". They are NOT two code paths. Every page below already
  // exists and is already exported; a variant is a FILTER over the page array, so the two packets
  // cannot drift apart in layout, i18n, RTL or print scale — there is only ever one implementation
  // of each page.
  //
  // LIGHTWEIGHT drops the two pages that are CONTEMPLATIVE rather than informational — the life
  // calendar and the evangelical-share grid. That is the whole difference, and it is deliberate:
  // those two are a full sheet each and exist to make the reader FEEL a number, which is exactly
  // what you cut when you want a packet to carry rather than to sit with.
  //
  // ⚠ 'lightweight' NEVER drops listPages. Losing a list page loses PEOPLE, silently — the failure
  // check-packet-render's sheet assertion exists to catch. A variant may drop a FIXED page; it may
  // never drop a page whose count depends on the data.
  const VARIANTS = {
    full: null,                                    // null = every page (today's packet, unchanged)
    // page KEYS to omit. 'sets' joins them: the bounded/centered figures are BACK MATTER a reader
    // sits with, which is the same reason the life calendar and the %-evangelical grid are dropped.
    lightweight: new Set(['life', 'christian', 'sets']),
  };

  // `sets` is the EIGHTH parameter and the last positional one this signature should ever grow — it
  // is already at the edge of readable. A ninth belongs in an options object; flagged here so the
  // next person adding a page makes that change rather than extending the line again.
  function buildPacket(zone, groups, photos, mapSvg, funnel = null, christian = null, variant = 'full', sets = null) {
    // ★ PAGE ORDER IS THE PRODUCT SPEC (A1, superseding the 2026-09-27 order this comment used to
    // record — the reorder is the spec's own deliberate change, confirmed via the shepherd, and the
    // stale "do not reorder" note updates in the SAME commit that reorders, as the plan card required):
    //   1 map            — where this zone is
    //   2 funnel         — the inverted triangle: 12,379 narrowing to THIS list, the argument first
    //   3 life calendar  — 100 years x 52 weeks, a whole human life on one page
    //   4 the SAME grid  — shaded by the evangelical share of these groups' POPULATION
    //   5..n people groups with photos and the three prayer columns
    //   then the bounded/centered sets (full only), the prayer WHEEL, and the 12 prayer POINTS —
    //   wheel before points, so the packet closes on what to pray rather than how long.
    // Pages 3 and 4 stay adjacent: the reader learns to read 5,200 boxes as their own life, then
    // sees the same 5,200 boxes answer "how many of these people know Christ".
    // ⚠ KEYED, NOT INDEXED. The omit-set names pages; it never carries positions. An index-based
    // filter reads identically today and silently drops the WRONG page the first time this order
    // changes — and the order above is a product decision, so it is expected to change again.
    // An unknown variant falls back to the full packet: a typo must not silently print a shorter
    // packet, because a packet missing two pages still looks like a packet.
    const omit = VARIANTS[variant] || VARIANTS.full;
    const keep = (key) => !(omit && omit.has(key));
    const pages = [
      keep('map') && mapPage(zone, groups, mapSvg, funnel),
      keep('funnel') && funnelPage(zone, groups, funnel),
      keep('life') && lifePage(zone),
      keep('christian') && christianPage(zone, christian),
      // NOT behind keep() — see the VARIANTS comment: dropping list pages drops people. The lightweight
      // packet lists the SAME groups as a worksheet (LIST_STYLE); the full packet as profiles.
      ...(LIST_STYLE[variant] ? LIST_STYLE[variant](zone, groups, photos) : listPages(zone, groups, photos)),
      // BACK MATTER: after the profiles (brief A1). Full-detail only.
      keep('sets') && setsPage(zone, sets, Array.isArray(groups) ? groups.length : NaN),
      keep('wheel') && wheelPage(),
      keep('points') && pointsPage(),
    ].filter(Boolean);
    // ⚠ dir MUST be set for right-to-left languages or the packet renders Arabic
    // left-aligned — readable glyphs in the wrong place, which looks like a
    // styling quirk rather than the bug it is. Verified in a browser: with
    // dir="rtl" the text right-aligns, shapes correctly, and a Latin scripture
    // reference stays LTR inside the RTL line (correct bidi) with no extra work.
    return `<!DOCTYPE html><html lang="${esc(lang)}" dir="${RTL.has(lang) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(zone.label || zone.id)}</title><style>${css()}</style></head>
<body>${pages.join('\n')}</body></html>`;
  }

  // VARIANTS is exported so the UI enumerates the packets it can print instead of hardcoding two
  // strings in a menu — add a third variant here and the caret gains an entry with no UI change.
  // pointsFit: the points page's estimate per tier, for the gates and probes that check it against the real page.
  const pointsFit = { tiers: PT_TIERS, bodyH: PT_BODY_H, safe: PT_SAFE, height: (k) => pointsHeight(ptTier(k)), chosen: () => fitPoints().k };
  return { buildPacket, mapPage, lifePage, christianPage, funnelPage, listPages, pointsPage, pointsFit, wheelPage, css, mapCss, liftMap, mapFromImage, mapSheetFiles, PER_PAGE, FD_FIRST, WS_FIRST, WS_REST, W, H, VARIANTS };
}
