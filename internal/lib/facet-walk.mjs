/**
 * internal/lib/facet-walk.mjs — the in-page helper string check:facet-changes-map injects into the page
 * (__walk through open shadow roots, __srcFeatures reading a GeoJSON source in BOTH engines' shapes).
 * Browser-free on purpose: check:facet-shape imports this SAME string and evaluates it headlessly, so the
 * thing tested is the thing injected, and the test runs in gates:pre on any seat.
 */
// Shadow DOM DOES NOT PIERCE — recursive walk with a seen-Set, re-injected after every interaction.
export const WALK = `
function __walk(sel) {
  const seen = new Set(); const out = [];
  const visit = (root) => {
    if (!root || seen.has(root)) return; seen.add(root);
    let els = []; try { els = Array.from(root.querySelectorAll('*')) } catch (e) { return }
    for (const el of els) {
      try { if (el.matches && el.matches(sel)) out.push(el) } catch (e) {}
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document); return out;
}
// THE MEASUREMENT: the map's own bubble source — the DOTS a reader looks at — plus the paint
// property that decides what each one LOOKS like.
// ★ THE MAP HANDLE CAN GO STALE. The panel destroys and re-creates its Map on a re-render (and
// the dev server's HMR does this freely), which leaves window.__rdashMap pointing at a torn-down
// instance whose getSource() throws "Cannot read properties of undefined (reading 'getOwnSource')".
// Measured: one run in three failed that way on the dev surface while the product was fine.
// A gate that reports a product bug when its own handle went stale is a gate that gets ignored, so
// __live() proves the handle still works before any assertion reads through it.
// ★ READ A GEOJSON SOURCE'S FEATURES WITHOUT ASSUMING ONE ENGINE'S PRIVATE SHAPE.
// This gate could only ever measure Mapbox (BUG-FACET-GATE-CANNOT-MEASURE-MAPLIBRE), and the cause
// is four reads of 'source._data'. The two engines store it differently — cited from the bundles
// this repo actually loads, same constructor in each:
//     mapbox-gl v3.24.0   this._data = i.data                                   (the raw GeoJSON)
//     maplibre-gl         this._data = "string"==typeof i.data ? {url:…} : {geojson: i.data}
// So '_data.features' is undefined under MapLibre and every read fell to an empty list. A GATE that
// cannot see MapLibre's features PASSES A MAP THAT IS BROKEN THERE, which is worse than a plugin
// having the same bug.
//
// ⚠ THE 's._data || s.serialize().data' FALLBACK DOES NOT FIX IT, and that is why this is a helper
// rather than a copied one-liner: '||' only fires when the left side is FALSY, and '{geojson: …}'
// is TRUTHY. The old __state() carried that form and was broken under MapLibre exactly like the
// three unguarded reads. The wrapper has to be UNWRAPPED, not fallen back from.
//
// ⚠ AND IT LIVES HERE, IN THE PAGE, not as an import of library/maps/pin-selection.js. All four
// call sites run inside page.evaluate / page.waitForFunction bodies, which are serialised to the
// browser — a Node-side import does not exist there. This is the same logic as readSourceFeatures(),
// deliberately duplicated across the process boundary, which is the one place duplication is not a
// smell. If that helper's rules change, this must follow.
function __srcFeatures(m, id) {
  let s; try { s = m.getSource(id) } catch (e) { return null }
  if (!s) return null;
  let data = s._data !== undefined ? s._data : (s.serialize && s.serialize().data);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.geojson !== undefined) data = data.geojson;
    // A REMOTE SOURCE IS NOT AN EMPTY ONE. Its features live on a server and cannot be enumerated
    // here; returning [] would read as "the map drew nothing", which is the bug this gate exists to
    // catch. null means "could not measure", and the caller must not treat it as zero.
    else if (data.url !== undefined) return null;
  }
  if (data && data.features) return data.features;
  // A SOURCE MAY HOLD ONE FEATURE, NOT A COLLECTION — both engines accept it, and the product's reader
  // already did. This helper did not, so it answered "cannot measure" for a payload it could read
  // perfectly well. Found by the cross-check in check-facet-shape, not by anyone reading either file.
  if (data && data.type === 'Feature') return [data];
  // ★ AN UNRECOGNISED SHAPE MUST SAY SO BY NAME, not read as "the map drew nothing". maplibre has a
  // THIRD _data shape this reader does not handle: updateData() stores { updateable } (maplibre-gl
  // :49001), and nothing in the product calls updateData today — so the day someone adopts partial
  // updates for performance, this would have gone quietly back to reporting an empty map about a map
  // full of dots, which is the exact defect this gate exists to report. Naming the keys makes the
  // next reader's first question ("what shape IS it?") answered by the message itself.
  try {
    console.warn('[facet-walk] source "' + id + '": unrecognised _data shape {'
      + Object.keys(data || {}).join(',') + '} — cannot measure, NOT zero features');
  } catch (e) {}
  return null;
}
function __live() {
  const m = window.__rdashMap;
  if (!m) return null;
  try { m.getSource('rd-bubbles'); return m } catch (e) { return null }
}
function __state() {
  const m = __live();
  if (!m) return { stale: true, err: 'map handle is stale (torn down and re-created)' };
  let s; try { s = m.getSource('rd-bubbles') } catch (e) { return { stale: true, err: 'map torn down: ' + e.message } }
  if (!s) return { err: 'no rd-bubbles source' };
  const feats = __srcFeatures(m, 'rd-bubbles') || [];
  let color = null; try { color = m.getPaintProperty('rd-bubble-layer', 'circle-color') } catch (e) {}
  return {
    n: feats.length,
    slugs: feats.map((f) => f.properties && f.properties.slug),
    praying: feats.map((f) => (f.properties ? f.properties.peoplePraying : undefined)),
    color,
    colorIsExpression: Array.isArray(color),
    colorJson: JSON.stringify(color),
  };
}
function __openPrayer() {
  const dd = __walk('.filter-dropdown').find((d) => (d.textContent || '').includes('Prayer'));
  if (!dd) return false;
  const b = dd.querySelector('button'); if (!b) return false;
  b.click(); return true;
}
function __pickPrayer(label) {
  const dd = __walk('.filter-dropdown').find((d) => (d.textContent || '').includes('Prayer'));
  if (!dd) return 'no dropdown';
  const o = Array.from(dd.querySelectorAll('[role=option]')).find((x) => (x.textContent || '').trim().startsWith(label));
  if (!o) return 'no option: ' + label;
  o.click(); return 'ok';
}
`
