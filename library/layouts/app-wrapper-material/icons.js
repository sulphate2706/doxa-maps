/**
 * icons.js — SELF-HOSTED icon set. No CDN, no icon font, no Google/YouTube request.
 *
 * These are hand-written 24x24 stroke paths in the Lucide idiom (ISC-licensed style:
 * 2px stroke, round cap/join, 24x24 box). Shipping them as inline SVG means:
 *   - zero network requests (works offline, works in Capacitor from local assets)
 *   - F-Droid safe (no proprietary blobs, no tracking, reproducible from source)
 *   - no FOUT/icon-font flash
 *
 * To swap in a real icon package later, replace these path strings — the API
 * (`icon(name)` returning an <svg> string) stays the same.
 */
const P = {
  menu:     '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  map:      '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  heart:    '<path d="M19 14c1.5-1.5 3-3.5 3-5.5A4.5 4.5 0 0 0 12 6a4.5 4.5 0 0 0-10 2.5C2 10.5 3.5 12.5 5 14l7 7Z"/>',
  // `prayer` = Prayer Mobilization — two hands pressed together (praying): pointed
  // fingertips at top, knuckle bulges on the outer edges, wrists curling in at the base.
  prayer:   '<path d="M12 4.2c-.9 1.4-1.9 2.6-2.9 3.8-1 1.2-1.6 2.6-1.6 4.2v3.3c0 1.3.7 2.4 1.8 3 .5.3 1.1-.1 1.1-.7"/><path d="M12 4.2c.9 1.4 1.9 2.6 2.9 3.8 1 1.2 1.6 2.6 1.6 4.2v3.3c0 1.3-.7 2.4-1.8 3-.5.3-1.1-.1-1.1-.7"/><path d="M12 4.2V17"/>',
  list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  flag:     '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  target:   '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  pin:      '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  monitor:  '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  chart:    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  folder:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  layers:   '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  flask:    '<path d="M9 3h6v5l5 11a2 2 0 0 1-2 3H6a2 2 0 0 1-2-3l5-11z"/><line x1="9" y1="3" x2="15" y2="3"/><line x1="6" y1="15" x2="18" y2="15"/>',
  share:    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
  beaker:   '<path d="M6 3h12"/><path d="M8 3v7l-3 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-3-8V3"/>',
  chevron:  '<polyline points="9 18 15 12 9 6"/>',
  grid:     '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  tree:     '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/>',
  dots:     '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
  // `embed` = the <> script/code-embed mark. Signals "this map is the embeddable
  // one you paste into a partner site" (2026-07-29, for Prayer Progress).
  embed:    '<polyline points="9 7 4 12 9 17"/><polyline points="15 7 20 12 15 17"/>',
  // `send` = Laborer Mobilization (sending labourers) — a paper-plane/send mark,
  // deliberately distinct from `heart` (Prayer Mobilization) and `users` (People Groups).
  send:     '<path d="M21 3 L3 10.5 L9.5 13.5 L12.5 20 Z"/><line x1="21" y1="3" x2="9.5" y2="13.5"/>',
  // `poster` = a printable poster asset (Country Posters / Key City Posters) —
  // a framed sheet with a pinned marker, distinct from `map` and `pin`.
  poster:   '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17h8"/>',
  // `search` = Material "search" magnifying glass, hand-drawn to Material's geometry
  // (circle r=7.5 centred at 10.5,10.5 with the handle running to ~20,20 at 45°).
  // Written out locally — NEVER fetched from a Google/Material CDN. That is a standing
  // law, not a style choice: a CDN icon request leaks the end user's IP to Google,
  // which in a persecution context is a safety risk. Self-hosted also = works offline
  // and inside Capacitor/F-Droid from local files.
  search:   '<circle cx="10.5" cy="10.5" r="7.5"/><line x1="15.8" y1="15.8" x2="20.5" y2="20.5"/>',
  // `book` = Gospel Access (an open book / the Word reaching a place).
  book:     '<path d="M12 6.5C12 6.5 9.5 4.5 4 4.5v13C9.5 17.5 12 19.5 12 19.5"/><path d="M12 6.5C12 6.5 14.5 4.5 20 4.5v13C14.5 17.5 12 19.5 12 19.5"/>',
  // `home` = the host site's homepage (VerticalTabsLayout's optional "Back to homepage" link): a house.
  home:     '<path d="M3 11 12 3l9 8"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  // `wifi` = Cities with Internet (connectivity arcs + node). Local, no CDN.
  wifi:     '<path d="M3.5 9a13 13 0 0 1 17 0"/><path d="M6.8 12.4a8.5 8.5 0 0 1 10.4 0"/><path d="M10 15.7a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/>',
}

export function icon(name, cls = '') {
  const d = P[name] || P.map
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
}
