// card-render.js — THE prayer-card deck renderer, shared by every caller.
//
// ★ THE POINT OF THIS FILE: A DECK PRINTS AS CARDS, NOT AS PAPER.
// The previous deck set `@page{size:letter portrait}` and gave each card
// `height:100%`, so one card was stretched across a whole 8.5x11 sheet — 95
// mostly-empty letter pages, with no photo. The print dialog has to show every
// card in a CARD format, not a paper format: the aspect ratio the card generator
// uses.
//
// So the page IS the card: @page takes the card's own dimensions, and every card
// fills exactly one page. Print two-sided on cardstock and cut, or print to PDF
// and send to a card printer.
//
// ⚠ @page size MUST be given in explicit units. MEASURED: `size: A6 portrait`
// SILENTLY falls back to letter in Chromium (612x792pt) with no error, while
// `size: 2.5in 3.5in` yields exactly 180x252pt. Named sizes beyond letter/A4 are
// not reliable — always use explicit inches, and always ASSERT the measured
// MediaBox rather than trusting the CSS.
//
// The card content follows doxa-life/promotional-material-generation, which is a
// data pipeline feeding an InDesign template: per language it emits Description,
// Religion, Area, Country, a QR code and a URL. Description and Area are NOT
// available from this API (measured: 0 of 2107 records carry either), so the card
// is built from what genuinely exists — portrait, name, country, population,
// language, religion (with its explanatory sentence) and the QR back to the live
// profile. An empty block reserved for data that never arrives is worse than a
// card designed around the data there is.
//
// I18N: every string comes from the caller's strings object, per-key fallback to
// English, same contract as the packet. The QR encodes the LOCALISED URL, so a
// Spanish card scans to the Spanish page.

import { qrSvg } from './qr.js';

// ── CARD STOCK ──────────────────────────────────────────────────────────────
// Poker-size trading card (2.5 x 3.5in) — the format commercial card printers,
// sleeves and boxes are built around, and the one people already associate with a
// deck you hold and deal out. Bleed is included in the page so a trimmed card
// keeps its full-bleed portrait.
// ★ LANDSCAPE IS NOT JUST TRANSPOSED DIMENSIONS. The portrait card stacks the
// photo ABOVE the text (portrait occupies the top 46%); at 3.5 x 2.5in that same
// band is a strip too short to carry a face or leave room for the rows beneath it.
// A landscape card puts the photo BESIDE the text instead — so `side: true` is a
// LAYOUT switch the CSS reads, not a cosmetic flag.
// `label` is the English name (and the fallback). `noun` names the stock for a localized label — the
// NOUN is translated and the size is not: "2.5 × 3.5 in" is what a printer's paper box says in every
// language, and A6 is an international designation, so it has no noun and prints as named.
export const STOCK = {
  poker: { w: 2.5, h: 3.5, label: 'Card 2.5 × 3.5 in', noun: 'card' },
  pokerLandscape: { w: 3.5, h: 2.5, label: 'Card 3.5 × 2.5 in (landscape)', noun: 'card', side: true },
  postcard: { w: 4, h: 6, label: 'Postcard 4 × 6 in', noun: 'postcard' },
  postcardLandscape: { w: 6, h: 4, label: 'Postcard 6 × 4 in (landscape)', noun: 'postcard', side: true },
  a6: { w: 4.13, h: 5.83, label: 'A6 105 × 148 mm' },     // explicit in, NOT "A6"
};

const PX = 96;                        // CSS px per inch

export function createCardRenderer({ strings, lang = 'en', stock = 'poker',
  siteBase = 'https://pray.doxa.life' } = {}) {
  const EN = strings.en;
  const L = strings[lang] || {};
  const t = (k) => (L[k] !== undefined ? L[k] : EN[k]);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // ⚠ PREFER THE LABEL, AND KNOW WHERE IT LIVES.
  // The API sends { value, label } dicts, but records reach this renderer AFTER
  // normalizeRecords(), which flattens each field to its `.value` and parks the
  // human-readable text under `<field>_label`. Reading the field alone therefore
  // yields "LAO", "thm", "EAN" — codes, on a card a person is meant to pray from.
  // Measured: the first deck shipped exactly that, and a gate counting "4 rows
  // rendered" passed it, because the rows were present, just unreadable.
  // Handles all three shapes: an un-normalized dict, a normalized value+label
  // pair, and a plain string.
  const label = (g, key) => {
    const lab = g[`${key}_label`];
    if (lab) return String(lab);
    const v = g[key];
    if (v && typeof v === 'object') return String(v.label ?? v.value ?? '');
    return v == null ? '' : String(v);
  };
  const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString(lang) : '—');

  const S = STOCK[stock] || STOCK.poker;
  const W = Math.round(S.w * PX);      // card box in CSS px
  const H = Math.round(S.h * PX);
  // Photo BESIDE the text rather than above it. Driven by the stock, not by
  // comparing W to H: a square stock would be ambiguous, and the choice is a
  // deliberate property of the format rather than an inference from its numbers.
  const SIDE = S.side === true;

  // ★ THE PHOTO IS PRINTED NO LARGER THAN ITS PIXELS CAN HOLD. The people-group photos are small:
  // measured on a sample across the dataset, every one is at most 200 px wide (typically 200x250), and
  // the API offers no larger variant. The card used to stretch that across the full 2.5in top band with
  // object-fit:cover, i.e. 200 source px over 2.5in: about 80 ppi, visibly blurred in print, on the one
  // part of the card that is a person's face. So the photo is now a framed portrait at the source's own
  // 4:5 shape, sized from its PIXELS rather than from the card: 200x250 at PHOTO_PPI prints at about
  // 1.1x1.4in, sharp. A bigger card (a postcard) gets more room around the face, never a bigger, blurrier
  // face. The 250x250 regional no-photo images fit the same frame at a higher density still.
  const PHOTO_PPI = 180;
  const PW = Math.round(200 / PHOTO_PPI * PX);   // frame width in CSS px (~1.11in)
  const PH = Math.round(250 / PHOTO_PPI * PX);   // frame height in CSS px (~1.39in)
  const COL = Math.round(W * 0.42);             // landscape: the photo column
  const BAND = Math.max(Math.round(H * 0.46), PH + 24);   // portrait: the header band behind photo + name

  // The live profile URL for this group, in this language. English has no prefix
  // (the generator's own rule); every other language does.
  const profileUrl = (slug) => (lang === 'en'
    ? `${siteBase}/${slug}`
    : `${siteBase}/${lang}/${slug}`);

  function css() {
    return `
  /* THE PAGE IS THE CARD. Explicit inches — a named size silently falls back to
     letter in Chromium, which is exactly the bug this renderer exists to fix. */
  @page{size:${S.w}in ${S.h}in;margin:0}
  html,body{margin:0;padding:0;background:#6f6f6f;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .card{position:relative;width:${W}px;height:${H}px;overflow:hidden;
    background:#f7f4ec;color:#1b1a17;
    font-family:Georgia,'Palatino Linotype',serif;
    page-break-after:always;break-after:page}
  .card:last-child{page-break-after:auto;break-after:auto}

  /* THE PHOTO. A framed portrait at its own 4:5 shape, sized from its pixels (PHOTO_PPI above), on a
     warm band: across the top on a portrait card with the name beside it, down the left on a landscape
     card with the name below it. A face is what makes this a prayer card rather than a data tile, and
     a face printed from too few pixels is blurred, which is no way to show someone. */
  .band{position:absolute;left:0;top:0;
    width:${SIDE ? COL : W}px;height:${SIDE ? H : BAND}px;
    background:linear-gradient(160deg,#e6dfcd,#cfc6ad)}
  .ph,.ph-none{position:absolute;display:block;box-sizing:border-box;
    left:${SIDE ? Math.round((COL - PW) / 2) : 12}px;
    top:${SIDE ? 12 : Math.round((BAND - PH) / 2)}px;
    width:${PW}px;height:${PH}px;border:3px solid #fff;border-radius:2px;
    box-shadow:0 1px 4px rgba(0,0,0,.25)}
  .ph{object-fit:cover;background:#ddd6c6}
  .ph-none{background:#efe9da;display:flex;
    align-items:center;justify-content:center;text-align:center;padding:6px;
    font:italic 10px Georgia,serif;color:#8c8170}

  .nm{position:absolute;display:flex;align-items:center;
    ${SIDE
    ? `left:10px;width:${COL - 20}px;top:${12 + PH + 6}px;bottom:10px;align-items:flex-start;justify-content:center;text-align:center;`
    : `left:${12 + PW + 10}px;right:8px;top:0;height:${BAND}px;`}
    font:700 ${SIDE ? 14 : 17}px Georgia,serif;color:#1b1a17;line-height:1.1;overflow:hidden;
    overflow-wrap:anywhere}
  /* Steps by the LONGEST WORD as well as the length: the name sits in a narrow box beside the photo,
     and one unbreakable word (the dataset has 16-letter ones, e.g. Pagativeshagallu) would overflow it
     sideways. overflow-wrap:anywhere is the last resort, so a name is never cut off without a sign. */
  .nm.long{font-size:${SIDE ? 11.5 : 14}px}
  .nm.xlong{font-size:${SIDE ? 10.5 : 11}px}
  /* A HYPHEN ONLY WHERE A WORD CANNOT FIT. hyphens:auto on every name would let the browser split ANY
     word at a line end ("Northern Conchu-/cos"), and a people group's name split mid-word is worse than
     the problem it solves. So it applies only to names holding a 14+ letter word (12 of 2,107), and the
     limit keeps short words whole: the only multi-word ones are "Deaf <X>", and Deaf is never split. */
  .nm.hy{-webkit-hyphens:auto;hyphens:auto;hyphenate-limit-chars:10 4 4}

  .body{position:absolute;right:14px;overflow:hidden;
    left:${SIDE ? COL + 12 : 14}px;
    top:${SIDE ? 12 : BAND + 8}px;
    bottom:${SIDE ? Math.round(H * 0.30) : Math.round(H * 0.20)}px}
  .row{display:flex;gap:6px;font:400 9.5px Georgia,serif;line-height:1.5;margin-bottom:1px}
  .k{color:#8c8170;min-width:52px;flex:0 0 auto}
  .v{color:#3b3a34;font-weight:600}
  .rel{margin-top:5px;font:italic 8.5px Georgia,serif;color:#6d665a;line-height:1.35}

  /* FOOTER: the QR is the card's whole reason to survive the day it is handed
     over — it carries the reader to the live profile in their own language. */
  .ft{position:absolute;right:14px;bottom:10px;
    left:${SIDE ? COL + 12 : 14}px;
    display:flex;align-items:flex-end;gap:8px}
  .qr{flex:0 0 auto;line-height:0}
  .ftx{flex:1 1 auto;min-width:0}
  .cta{font:600 8px Georgia,serif;color:#7a3b2e;letter-spacing:.04em;
    text-transform:uppercase}
  .url{font:400 7px Georgia,serif;color:#a89f8c;word-break:break-all;margin-top:1px}
  .brand{position:absolute;right:14px;bottom:10px;
    font:400 7px Georgia,serif;color:#b9ae99;text-align:right}`;
  }

  // The name's size step, from its length and its longest word (see .nm above).
  function nameSize(name) {
    const word = Math.max(0, ...String(name).split(/[\s,()/-]+/).map((w) => w.length));
    if (word >= 14) return ' xlong hy';
    if (name.length > 28) return ' xlong';
    if (word >= 11 || name.length > 16) return ' long';
    return '';
  }

  // One card = one page.
  function card(g) {
    const name = String(g.name || g.slug || '');
    const photo = g.image_url
      ? `<img class="ph" src="${esc(g.image_url)}" alt="">`
      : `<div class="ph-none">${esc(t('no_photo'))}</div>`;
    // The religion's explanatory sentence, when the caller kept it. normalizeRecords()
    // keeps only { value, label } and DROPS `description`, so this is present only
    // when a caller passes records straight from the API. Absent is normal, not a bug —
    // the card simply gives that space back to the rows.
    const relDesc = (g.religion && typeof g.religion === 'object' && g.religion.description)
      || g.religion_description || '';
    const relHtml = relDesc
      ? `<div class="rel">${esc(String(relDesc).slice(0, 170))}</div>` : '';
    const url = profileUrl(g.slug);
    const rows = [
      [t('card_country'), label(g, 'country_code')],
      [t('card_population'), `${num(g.population)} ${t('people_suffix')}`],
      [t('card_language'), label(g, 'primary_language')],
      [t('card_religion'), label(g, 'religion')],
    ].filter(([, v]) => v && String(v).trim() && String(v) !== '—')
      .map(([k, v]) => `<div class="row"><div class="k">${esc(k)}</div>`
        + `<div class="v">${esc(v)}</div></div>`).join('');

    return `<div class="card"><div class="band"></div>${photo}`
      + `<div class="nm${nameSize(name)}">${esc(name)}</div>`
      + `<div class="body">${rows}${relHtml}</div>`
      + `<div class="ft"><div class="qr">${qrSvg(url, { size: 54, margin: 1 })}</div>`
      + `<div class="ftx"><div class="cta">${esc(t('card_cta'))}</div>`
      + `<div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div></div></div>`
      + `</div>`;
  }

  function buildDeck(zone, groups) {
    const cards = groups.map(card).join('');
    return `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<title>${esc(zone.label || zone.id)} — ${esc(t('deck_title'))}</title>
<style>${css()}</style></head><body>${cards}</body></html>`;
  }

  return { buildDeck, card, css, profileUrl, W, H, stock: S };
}
