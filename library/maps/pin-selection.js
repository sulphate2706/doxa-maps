/**
 * pin-selection.js — which pins does a Mapbox/MapLibre filter expression actually select?
 *
 * ★ MOVED, NOT WRITTEN (from useMapFly.js, where it was private). zoomToLegendRow has always had to
 * answer this question to fit the camera to a legend row, and it answers it the only way that is
 * correct: map.querySourceFeatures(id, {filter}) is VIEWPORT-CLIPPED, so pins outside the camera are
 * dropped and an off-screen region silently selects nothing. These read the full source data and
 * evaluate the expression in JS instead.
 *
 * ★ WHY IT HAD TO BE SHARED (PACKETSEL). The research map's prayer packet printed the first 50 of
 * every people group whatever the reader had selected. Choosing the right rows means asking exactly
 * this question — and the naive alternative, evaluating the filter against the raw data rows, is
 * WRONG in a way that would not throw: pin properties are DERIVED from rows (useMapLayers derives
 * languageFamily when the API returns null, canonicalizes doxaRegion onto the palette's key forms),
 * so a filter written against pin properties does not mean the same thing applied to a row. The
 * features the map holds are the only place those two vocabularies agree.
 *
 * country-posters prints the same kind of packet from the same kind of selection, which is why this
 * is in library/ rather than in one plugin.
 *
 * The evaluator covers the expression subset this product's filters use — all/any/!/has/comparisons/
 * in/match, plus get/literal/feature-state/coalesce/to-number. Anything else evaluates false rather than throwing:
 * a packet that prints fewer rows is recoverable, a map that throws mid-print is not.
 */

// Why: map.querySourceFeatures(sourceId, {filter}) is viewport-clipped —
// pins outside the rendered camera are dropped, so legend rows for off-screen
// regions silently no-op when the user is zoomed in. We evaluate the Mapbox
// filter expression against the full source data instead, so fitBounds can
// zoom OUT to a different region or IN to a tight cluster uniformly.
export function resolveExpr(expr, props, state) {
    if (!Array.isArray(expr)) return expr;
    const op = expr[0];
    switch (op) {
        case 'get':      return props?.[expr[1]];
        case 'literal':  return expr[1];
        // ★ THE LIVE VALUE, NOT THE ONE FROZEN AT LOAD. A pin's prayer count arrives twice: as a GeoJSON
        // property at initial load, and thereafter through setFeatureState() as polling updates it.
        // prayer-progress.js:94 colours from ['feature-state','peoplePraying'] once polling is on, so a
        // reader looking at 699 lit "Has Prayer" pins is looking at feature-state. Without this case the
        // expression resolved to undefined, to-number defaulted it to 0, and the packet selected only
        // the pins whose FROZEN property happened to be > 0 — 50 of 997 where the legend said 699.
        case 'feature-state': return state == null ? undefined : state[expr[1]];
        case 'has':      return props != null && expr[1] in props;
        case '!has':     return props == null || !(expr[1] in props);
        case '!':        return !resolveExpr(expr[1], props, state);
        case 'coalesce': {
            for (let i = 1; i < expr.length; i++) {
                const v = resolveExpr(expr[i], props, state);
                if (v != null) return v;
            }
            return null;
        }
        case 'to-number': {
            const v = resolveExpr(expr[1], props, state);
            const n = Number(v);
            if (Number.isFinite(n)) return n;
            if (expr.length > 2) {
                const fb = Number(resolveExpr(expr[2], props, state));
                return Number.isFinite(fb) ? fb : 0;
            }
            return NaN;
        }
        case 'to-string': {
            const v = resolveExpr(expr[1], props, state);
            return v == null ? '' : String(v);
        }
        case 'to-boolean': return Boolean(resolveExpr(expr[1], props, state));
        case 'slice': {
            const s = resolveExpr(expr[1], props, state);
            const i = resolveExpr(expr[2], props, state);
            const j = expr.length > 3 ? resolveExpr(expr[3], props, state) : undefined;
            if (typeof s !== 'string') return '';
            return j != null ? s.slice(i, j) : s.slice(i);
        }
        default:           return expr;
    }
}
export function matchesExpression(filter, props, state) {
    if (filter === true) return true;
    if (filter === false) return false;
    if (!Array.isArray(filter)) return Boolean(filter);
    const op = filter[0];
    if (op === 'all') {
        for (let i = 1; i < filter.length; i++) {
            if (!matchesExpression(filter[i], props, state)) return false;
        }
        return true;
    }
    if (op === 'any') {
        for (let i = 1; i < filter.length; i++) {
            if (matchesExpression(filter[i], props, state)) return true;
        }
        return false;
    }
    if (op === '!')   return !matchesExpression(filter[1], props, state);
    if (op === 'has') return props != null && filter[1] in props;
    if (op === '!has') return props == null || !(filter[1] in props);

    if (op === '==' || op === '!=' || op === '>' || op === '>=' ||
        op === '<'  || op === '<=') {
        // Legacy form: ['==', 'propName', value] (no ['get', ...])
        const left = (typeof filter[1] === 'string')
            ? props?.[filter[1]]
            : resolveExpr(filter[1], props, state);
        const right = resolveExpr(filter[2], props, state);
        switch (op) {
            case '==': return left === right || (left == null && right == null);
            case '!=': return !(left === right || (left == null && right == null));
            case '>':  return left >  right;
            case '>=': return left >= right;
            case '<':  return left <  right;
            case '<=': return left <= right;
        }
    }
    if (op === 'in') {
        const v = resolveExpr(filter[1], props, state);
        const haystack = resolveExpr(filter[2], props, state);
        if (Array.isArray(haystack)) return haystack.includes(v);
        if (typeof haystack === 'string') return haystack.includes(v);
        return false;
    }
    if (op === 'match') {
        const input = resolveExpr(filter[1], props, state);
        const lastIdx = filter.length - 1;
        for (let i = 2; i < lastIdx; i += 2) {
            const labelRaw = filter[i];
            const labels = Array.isArray(labelRaw) ? labelRaw : [labelRaw];
            if (labels.includes(input)) return Boolean(resolveExpr(filter[i + 1], props, state));
        }
        return Boolean(resolveExpr(filter[lastIdx], props, state));
    }
    return false;
}
const _warnedUrlSources = new Set();

export function readSourceFeatures(map, sourceId) {
    const src = map.getSource(sourceId);
    if (!src) return [];
    let data = src._data ?? src.serialize?.()?.data;
    // ★ THE TWO ENGINES STORE _data DIFFERENTLY, and reading only Mapbox's shape is why this returned
    // NOTHING on MapLibre. maplibre-gl's GeoJSONSource wraps it —
    //     this._data = typeof options.data === 'string' ? { url: options.data } : { geojson: options.data }
    // — so `data.features` is undefined there and every caller silently got an empty list. Mapbox stores
    // the GeoJSON directly, which is the engine this was written against, so it worked where it was
    // tested and failed where it was not. Measured: a packet probe on MapLibre logged "0 pin(s)
    // selected" for both a language-family and a prayer selection, with the pins plainly on screen.
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        if (data.geojson !== undefined) data = data.geojson;
        else if (data.url !== undefined) {
            // ★ A REMOTE SOURCE IS NOT AN EMPTY ONE, and saying so out loud is the whole point. The
            // features live on a server; this cannot enumerate them. Returning [] silently is exactly
            // the shape of the bug above — a caller would no-op and look merely unlucky. Warned ONCE
            // per source so a map that legitimately streams its pins does not spam a console.
            if (!_warnedUrlSources.has(sourceId)) {
                _warnedUrlSources.add(sourceId);
                // eslint-disable-next-line no-console
                console.warn(`[pin-selection] source "${sourceId}" is remote (url); its features cannot be read locally, so nothing can be selected from it.`);
            }
            return [];
        }
    }
    if (!data) return [];
    if (Array.isArray(data?.features)) return data.features;
    if (data?.type === 'Feature') return [data];
    // ★ THE SAME RULE AS THE url BRANCH, FOR THE SHAPES WE HAVE NOT MET YET. Falling off the end used
    // to return [] in silence, which is "the map drew nothing" stated as fact about a payload nobody
    // recognised — the precise failure the url warning above exists to prevent, left in place one line
    // below it. maplibre already HAS a third shape: updateData() stores _data = { updateable }
    // (maplibre-gl :49001). No product code calls updateData today, so this is a landmine rather than
    // a bug, and it is armed the moment someone adopts partial updates. Warned once per source, with
    // the keys named, so the message identifies the shape instead of merely reporting a miss.
    if (data && typeof data === 'object' && !_warnedUrlSources.has(sourceId)) {
        _warnedUrlSources.add(sourceId);
        // eslint-disable-next-line no-console
        console.warn(`[pin-selection] source "${sourceId}": unrecognised data shape {${Object.keys(data).join(',')}} — nothing can be selected from it; this is NOT a confirmed empty source.`);
    }
    return [];
}

/**
 * The ids of the pins a set of expressions currently selects, as a Set of strings.
 *
 * Every expression must match (they are ANDed) because they describe different halves of the same
 * question: the layer's own filter says which pins RENDER, and a dim expression says which of those
 * are lit. A pin at opacity 0 is not what the reader is looking at.
 *
 * With NO active expressions this returns every pin's id rather than an empty set — "nothing is
 * selected" means everything is on screen, not nothing is.
 */
export function selectedPinIds(map, { sourceId = 'language-families', expressions = [], idKey = 'uniqueId' } = {}) {
  const ids = new Set()
  const exprs = (expressions || []).filter((e) => e != null && e !== true)
  // ★ FEATURE-STATE IS READ PER PIN, and it has to come off the MAP rather than off the feature: the
  // GeoJSON the source holds is what was loaded, and setFeatureState writes to a separate per-feature
  // store that never touches it. useMapLayers adds this source with promoteId:'uniqueId', so the id
  // feature-state is keyed by IS props[idKey] -- if a caller ever passes a different idKey the lookup
  // yields {} and the evaluation falls back to the loaded properties, which is the old behaviour and
  // not a new failure. getFeatureState throws on an unknown source, so it is guarded once, not per pin.
  const canReadState = typeof map?.getFeatureState === 'function'
  const stateOf = (id) => {
    if (!canReadState || id == null) return undefined
    try { return map.getFeatureState({ source: sourceId, id }) } catch (_) { return undefined }
  }
  for (const f of readSourceFeatures(map, sourceId)) {
    const props = f && f.properties
    if (!props) continue
    const id = props[idKey]
    const state = stateOf(id)
    if (exprs.length && !exprs.every((e) => matchesExpression(e, props, state))) continue
    if (id != null) ids.add(String(id))
  }
  return ids
}
