// search-index.js — slice 09b-search-bar §1(c)
//
// Unified searchable index for the my-upg-100-list profile's TOP-CENTER search
// bar. Three kinds of target, all tokenized contains-matchable from ONE list:
//
//   { label, kind, target }
//     kind 'pg'        → target { type:'pg',        slug, lng, lat }
//     kind 'zone'      → target { type:'zone',      zoneId }
//     kind 'territory' → target { type:'territory', shapeName }   (ADM1 name OR
//                        the ISO3 of an ADM0 country — both live on the tapestry
//                        features as props.shapeName / props.iso3, so fitBounds
//                        can find their polygons either way)
//
// Pure data + pure functions: no Vue / Mapbox / DOM. The profile builds the PG
// rows from the LIVE records (slug+name+lat/lng), the zone rows from the legend
// leafZones, and the territory rows from admin-counts (ADM1) + the ADM0 ISO3
// name table — then hands the merged list to searchIndex() for matching.
//
// Match (S-D4): tokenized contains — the query is whitespace/comma-split, EVERY
// token must appear in the entry's normalized label. Case- AND diacritic-
// insensitive ("bihar" matches "Bihār", "deaf" matches "Deaf (affinity bloc …)").

// ── normalize: lowercase + strip diacritics (NFD → drop combining marks) ──────
// "Bihār" → "bihar", "Rājasthān" → "rajasthan", "São Tomé" → "sao tome".
export function normalizeText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .trim();
}

// Split a query into non-empty tokens (whitespace, comma, semicolon).
export function tokenize(q) {
  return normalizeText(q).split(/[\s,;]+/).filter(Boolean);
}

/**
 * buildSearchIndex({ records, leafZones, adm1Counts, iso3Names, countryNameMap })
 *   -> Array<{ label, kind, target, _hay }>
 *
 * @param {Array}  records         normalized live UPG records (slug, name,
 *                                  latitude, longitude). One PG row each.
 * @param {Array}  leafZones       legend leaf nodes ({ id|zoneKey, label }). One
 *                                  zone row each (33 leaves).
 * @param {object} adm1Counts      { shapeName: count } — the 46 India/China admins.
 * @param {object} iso3Names       { ISO3: displayName } — country fly-to targets.
 * @param {object} [countryNameMap] live iso3→label override (preferred label).
 *
 * `_hay` is the precomputed normalized label, so matchSearch() never re-normalizes
 * per keystroke. Returned in build order: PG, then Zone, then Territory.
 */
export function buildSearchIndex(opts = {}) {
  const {
    records = [],
    leafZones = [],
    adm1Counts = {},
    iso3Names = {},
    countryNameMap = null,
  } = opts;

  const out = [];

  // ── (1) People groups — from the LIVE records (proper names + lat/lng) ──────
  // Skip records with no finite lat/lng (can't fly to them). De-dup by slug so a
  // multi-country PG that appears twice in the list only indexes once.
  const seenSlug = new Set();
  for (const r of records) {
    if (!r) continue;
    const slug = r.slug;
    if (!slug || seenSlug.has(slug)) continue;
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = r.name || slug;
    seenSlug.add(slug);
    out.push({
      label: name,
      kind: 'pg',
      target: { type: 'pg', slug, lng, lat },
      _hay: normalizeText(name),
    });
  }

  // ── (2) Zones — the 33 legend leaf rows (zoneKey + label) ───────────────────
  for (const z of leafZones) {
    if (!z) continue;
    const zoneId = z.zoneKey || z.id;
    const label = z.label || zoneId;
    if (!zoneId) continue;
    out.push({
      label,
      kind: 'zone',
      target: { type: 'zone', zoneId },
      _hay: normalizeText(label),
    });
  }

  // ── (3a) Territories — ADM1 admins (India states + China provinces) ─────────
  // The tapestry ADM1 features carry props.shapeName === the admin-counts key, so
  // target.shapeName fly-to matches by shapeName.
  for (const shapeName of Object.keys(adm1Counts)) {
    out.push({
      label: shapeName,
      kind: 'territory',
      target: { type: 'territory', shapeName },
      _hay: normalizeText(shapeName),
    });
  }

  // ── (3b) Territories — ADM0 countries (by ISO3 → display name) ──────────────
  // The tapestry ADM0 features carry ONLY props.iso3, so target.shapeName holds
  // the ISO3 and the fly-to predicate matches f.properties.iso3. The LABEL is the
  // human name (live countryNameMap preferred, ISO3_NAME fallback) so a reader
  // typing "Nepal" finds NPL. De-dup: a name already covered as an ADM1 admin
  // (none collide today, but guard anyway) isn't re-added.
  const nameMap = countryNameMap || iso3Names;
  for (const iso3 of Object.keys(iso3Names)) {
    const label = (nameMap && nameMap[iso3]) || iso3Names[iso3] || iso3;
    out.push({
      label,
      kind: 'territory',
      target: { type: 'territory', shapeName: iso3, iso3: true },
      _hay: normalizeText(label),
    });
  }

  return out;
}

/**
 * matchSearch(index, query, opts?) -> Array<entry>
 * Tokenized contains-match (ALL tokens present), case+diacritic-insensitive.
 * Ranking: entries whose label STARTS with the first token rank first (so typing
 * "deaf" surfaces the "Deaf …" zone above PGs that merely contain "deaf"); within
 * a rank, shorter labels (closer matches) first, then kind order pg<zone<terr is
 * broken by leaving build order stable. Caps at opts.limit (default 8).
 */
const KIND_RANK = { zone: 0, territory: 1, pg: 2 };

/**
 * buildGeocoderFeed({ records, leafZones, adm1Counts, iso3Names, countryNameMap, centroidFor })
 *   -> Array<record-like>  (the `normalizedData` array fed to the SHARED
 *      GeocoderComponent's dataStore source, consumed by useGeoSearch.buildIndex)
 *
 * 09b-search-reuse-geocoder §1(b): the shared GeocoderComponent has NO
 * `localGeocoder` prop — it builds its own search from `inject('dataStore')`
 * via useGeoSearch, which only knows people-group records (it indexes any
 * record with finite latitude/longitude and maps it to a `place_type:
 * ['people-group']` Carmen feature, spreading `...pg` onto feature.properties).
 *
 * So to drive ALL THREE of this profile's kinds (PG + zone + territory) through
 * the ONE shared search input WITHOUT editing src/, we hand useGeoSearch a
 * unified record list:
 *   - PG rows are the LIVE records as-is (real name + lat/lng).
 *   - Zone + territory rows are SYNTHETIC records carrying a centroid lat/lng
 *     (so buildIndex keeps them) + a `__upgKind` discriminator + the original
 *     fly-to target (`__zoneId` / `__shapeName`). useGeoSearch spreads these
 *     onto feature.properties, so they survive into the component's
 *     `people-group-result` emit; the profile's handler branches on
 *     `properties.__upgKind` to route to flyToZone / flyToTerritory instead of
 *     openPgDetail. `name` is set to the human label so name-match still fires.
 *
 * @param {object} opts
 * @param {Array}  opts.records       live UPG records (PG rows — used verbatim).
 * @param {Array}  opts.leafZones     legend leaf nodes ({ id|zoneKey, label }).
 * @param {object} opts.adm1Counts    { shapeName: count } — ADM1 admins.
 * @param {object} opts.iso3Names     { ISO3: displayName } — ADM0 countries.
 * @param {object} [opts.countryNameMap]  live iso3→label override.
 * @param {(pred:(f:object)=>boolean)=>([lng,lat]|null)} opts.centroidFor
 *        returns a [lng,lat] centroid for the tapestry features a zone/territory
 *        predicate selects (the profile passes a centroid built from boundsFor).
 */
export function buildGeocoderFeed(opts = {}) {
  const {
    records = [],
    leafZones = [],
    adm1Counts = {},
    iso3Names = {},
    countryNameMap = null,
    centroidFor = null,
  } = opts;

  const feed = [];

  // ── (1) People groups — the LIVE records, untouched (real name + lat/lng) ────
  for (const r of records) {
    if (r) feed.push(r);
  }

  // Helper: build a synthetic record useGeoSearch.buildIndex will keep.
  // It needs finite latitude/longitude; everything else rides on properties.
  const synth = (label, center, extra) => {
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null;
    return {
      name: label,            // useGeoSearch matches name first → label is searchable
      slug: extra.__synthSlug,
      latitude: center[1],
      longitude: center[0],
      ...extra,               // __upgKind + (__zoneId | __shapeName)
    };
  };

  // ── (2) Zones — legend leaves; centroid from the zone's tapestry polygons ────
  for (const z of leafZones) {
    if (!z) continue;
    const zoneId = z.zoneKey || z.id;
    const label = z.label || zoneId;
    if (!zoneId) continue;
    const center = typeof centroidFor === 'function'
      ? centroidFor((f) => f && f.properties && f.properties.zoneKey === zoneId)
      : null;
    const rec = synth(label, center, {
      __upgKind: 'zone', __zoneId: zoneId, __synthSlug: `__zone__${zoneId}`,
    });
    if (rec) feed.push(rec);
  }

  // ── (3a) Territories — ADM1 admins (centroid from props.shapeName polygons) ──
  for (const shapeName of Object.keys(adm1Counts)) {
    const center = typeof centroidFor === 'function'
      ? centroidFor((f) => f && f.properties && f.properties.shapeName === shapeName)
      : null;
    const rec = synth(shapeName, center, {
      __upgKind: 'territory', __shapeName: shapeName, __synthSlug: `__terr__${shapeName}`,
    });
    if (rec) feed.push(rec);
  }

  // ── (3b) Territories — ADM0 countries (centroid from props.iso3 polygons) ────
  const nameMap = countryNameMap || iso3Names;
  for (const iso3 of Object.keys(iso3Names)) {
    const label = (nameMap && nameMap[iso3]) || iso3Names[iso3] || iso3;
    const center = typeof centroidFor === 'function'
      ? centroidFor((f) => f && f.properties && f.properties.iso3 === iso3)
      : null;
    const rec = synth(label, center, {
      __upgKind: 'territory', __shapeName: iso3, __synthSlug: `__terr__${iso3}`,
    });
    if (rec) feed.push(rec);
  }

  return feed;
}

export function matchSearch(index, query, opts = {}) {
  const limit = opts.limit ?? 8;
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const first = tokens[0];

  const hits = [];
  for (const e of index) {
    let all = true;
    for (const t of tokens) {
      if (!e._hay.includes(t)) { all = false; break; }
    }
    if (!all) continue;
    const starts = e._hay.startsWith(first) ? 0 : 1;
    // exact whole-label match ranks ahead of prefix
    const exact = e._hay === normalizeText(query) ? -1 : 0;
    hits.push({ e, starts, exact, kr: KIND_RANK[e.kind] ?? 9, len: e._hay.length });
  }
  hits.sort((a, b) =>
    a.exact - b.exact ||
    a.starts - b.starts ||
    a.kr - b.kr ||
    a.len - b.len);
  return hits.slice(0, limit).map((h) => h.e);
}

export default { buildSearchIndex, buildGeocoderFeed, matchSearch, normalizeText, tokenize };
