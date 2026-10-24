/**
 * nav.js — the sidebar data model for the app-wrapper-material layout.
 *
 * Extends a conventional `SidebarNavItem` shape ({ to, label, icon, children })
 * with the two things doxa-maps needs:
 *   - `kind`   : 'item' | 'section' | 'folder'
 *                 section = always-open, labelled group (YouTube "Subscriptions" style)
 *                 folder  = collapsible group (click to open/close)
 *   - `target` : 'both' | 'desktop' | 'mobile'   <-- per-target packaging flag.
 *                'desktop' items are hidden on mobile AND excluded from the
 *                Capacitor build's webDir (the mobile build copies fewer bundles).
 *
 * Order matters: this array renders top-to-bottom, exactly as authored.
 * Icons are LOCAL names resolved from ./icons/<name>.svg — no CDN, no icon font.
 * (F-Droid requires self-hosted, non-proprietary assets.)
 */
export const NAV = [
  // ── PRAYER MOBILIZATION FIRST: the prayer map is the landing view, so this
  //    section sits at the TOP and its first child is the DEFAULT profile.
  //    (2026-07-29: "so that the first map they see is the prayer map".)
  {
    kind: 'section', id: 'prayer-mobilization', label: 'Prayer Mobilization', icon: 'heart', target: 'both',
    children: [
      // Prayer Progress = the research map opened on its PRAYER tab (colorStrategy
      // 'prayerProgress'). That tab is tabs[0] in the bundle, so it is already the
      // default view — no separate bundle needed. The `embed` icon (<>) marks it as
      // the embeddable/share-first map.
      { kind: 'item', id: 'prayer-progress', label: 'Prayer Progress',  icon: 'embed', target: 'both' },
      { kind: 'item', id: 'upg-100-list',    label: 'UPG100 Posters',  icon: 'list',  target: 'both' },
      // REMOVED 'Prayer List' (2026-07-29): not a real app.
    ],
  },

  // ── LABORER MOBILIZATION — mobilising the labourers/disciple-makers themselves
  //    (as distinct from mobilising prayer). UPG Neighbor MOVED here from Prayer
  //    Mobilization: it is a labourer/sending tool, not a prayer tool.
  //    (2026-07-29).
  {
    kind: 'section', id: 'laborer-mobilization', label: 'Laborer Mobilization', icon: 'send', target: 'both',
    children: [
      { kind: 'item', id: 'upg-neighbor',      label: 'UPG Neighbor',      icon: 'users',  target: 'both' },
    ],
  },

  // ── RESEARCH — a TOP-LEVEL section, PEER of Prayer/Laborer Mobilization
  //    (2026-07-29: "a section to the same degree as Laborer", i.e. a
  //    sibling, NOT nested under it). Holds the research/general maps.
  {
    kind: 'section', id: 'research', label: 'Research', icon: 'search', target: 'both',
    children: [
      { kind: 'item', id: 'research-map',      label: 'Research Map',      icon: 'map',   target: 'both' },
      // 'All People Groups' = the FULL global people-group set (~15,000), as distinct
      // from the ~2,100-UPG DX cluster the prayer map plots. Different datasets —
      // keep them straight. (The "15k" suffix was dropped from the label at the
      // maintainer's request 2026-07-29; the distinction is recorded here instead.)
      // ⚠ NO BUNDLE YET — renders the placeholder card.
      { kind: 'item', id: 'all-people-groups', label: 'All People Groups', icon: 'globe', target: 'both' },
      // REMOVED 'Reached People Groups' (2026-07-29) — added and withdrawn the
      // same round; do not re-add without an explicit ask.
      // REMOVED 'Simple Map' (2026-07-29). REASON WORTH KEEPING: the
      // doxa-simple-map BUNDLE is not one map — it carries THREE (prayer, adoption,
      // engagement). doxa-maps only wants to preview PRAYER, and that is already
      // surfaced as 'Prayer Progress' in Prayer Mobilization. Exposing "Simple Map"
      // would advertise adoption+engagement views we are not previewing here.
      // => If a simple prayer-only view is ever wanted as its own entry, add a
      //    profile-config that pins doxa-simple-map to its prayer profile only.
    ],
  },

  // ── GOSPEL ACCESS — where the gospel can actually REACH: the infrastructure
  //    (internet-connected cities) and the assets (gospel resources) that make
  //    access possible. Populated by the maintainer 2026-07-29.
  //    Both items are wired to real bundles (cities-internet + gospel-resources).
  {
    kind: 'section', id: 'gospel-access', label: 'Gospel Access', icon: 'book', target: 'both',
    children: [
      { kind: 'item', id: 'cities-with-internet', label: 'Cities with Internet', icon: 'wifi',  target: 'both' },
      { kind: 'item', id: 'gospel-resources',     label: 'Gospel Resources',     icon: 'book',  target: 'both' },
    ],
  },

  // ── 'People Groups' section REMOVED (2026-07-29): it is now empty —
  //    Countries -> Prayer Mobilization as Country Posters; Impact Map -> Experimental
  //    maps; People Pins -> deleted outright.

  // ── DASHBOARDS — a SECTION (always visible, no folder to open), DESKTOP ONLY
  //    (excluded from the mobile/Capacitor build). "Big Picture" carries a Desktop Only badge. ──
  {
    kind: 'section', id: 'dashboards', label: 'Dashboards', icon: 'monitor', target: 'desktop',
    children: [
      { kind: 'item', id: 'research-dashboard', label: 'Big Picture', icon: 'chart', target: 'desktop' },
    ],
  },

  // ── a FOLDER at the BOTTOM: the experimental maps ──
  {
    kind: 'folder', id: 'experimental', label: 'Experimental maps', icon: 'flask', target: 'both',
    open: false,
    children: [
      { kind: 'item', id: 'nationmapper',  label: 'Nationmapper',    badge: 'soon', icon: 'share',  target: 'both' },
      // Country Posters MOVED here from Prayer Mobilization to Experimental.
      { kind: 'item', id: 'countries-map',    label: 'Country Posters', icon: 'poster', target: 'both' },
      // Outreach Planner = geo-steward, renamed + moved out of the Dashboard folder.
      { kind: 'item', id: 'geo-steward',      label: 'Outreach Planner', badge: 'soon', icon: 'layers', target: 'both' },
      // Key City Posters MOVED here from Laborer Mobilization.
      { kind: 'item', id: 'key-city-posters', label: 'Key City Posters', icon: 'poster', target: 'both' },
      // Full UPG-Neighbor hub (all lenses: cockpit / flower / lang-cluster / send).
      // The production 'UPG Neighbor' in Laborer Mobilization is the focused lang-cluster map.
      { kind: 'item', id: 'upg-neighbor-lab', label: 'UPG Neighbor Lab', icon: 'flask', target: 'both' },
    ],
  },
]

/**
 * Filter the tree for a build/runtime target. Used by BOTH the UI and the packager.
 * RECURSIVE — the tree is no longer only two levels deep (a section may hold a
 * 'subgroup', e.g. Laborer Mobilization > Research > Research Map), so a flat
 * one-level filter would silently drop or mis-filter nested entries.
 */
export function navForTarget(nav, target /* 'desktop' | 'mobile' */) {
  const keep = (n) => n.target === 'both' || n.target === target
  const walk = (nodes) => nodes
    .filter(keep)
    .map((n) => (n.children ? { ...n, children: walk(n.children) } : n))
    // prune groups whose children were all filtered out (an empty group is noise)
    .filter((n) => !n.children || n.children.length > 0)
  return walk(nav)
}
