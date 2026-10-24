// useMapLayers.js - Map Layers Composable
// Handles adding/removing Mapbox layers (regions, pins, language families)
// Vue 3 Composition API - ES Module with NPM packages

// Import Vue functions from NPM package
import { retryFetch } from './retryFetch.js'
import { ref, toRaw } from 'vue';
import { resolveAssetsBase } from '../utils/embedBase.js'
import { emissivePaint } from './useMapProvider.js';

// Import utilities
import { buildColorExpression } from '../colors/_registry.js';
import { getCircleRadiusInterpolation, getCircleStrokeWidthInterpolation } from '../constants/zoom.js';
import { FULL_PRAYER_THRESHOLD, PALETTE as PRAYER_PALETTE } from '../colors/prayer-progress.js';
import { useMapEvents } from './useMapEvents.js';
import langFamilyByLanguage from '../data/langFamilyByLanguage.json';

// ── Pin ring widths (theme-aware, parameterized) ─────────────────────────────
// LIGHT = elegant data-driven hairline (need-prayer pins thinner than has-prayer).
// DARK  = a noticeably THICKER white ring so BLACK / near-black pins stay visible on
//         the Standard NIGHT basemap. Black is INTENTIONAL for several buckets —
//         unmapped language families (#000000), 'Sign Language' (#212121), 'Unknown'
//         (#000000) and the Deaf affinity block (#000000, accessibility) — and the
//         hairline ring can't outline them in dark mode. Each profile's
//         _updatePinStroke() swaps these on theme/tab change; pin COLOURS are NEVER
//         changed — only the ring width, dark-mode only.
const HAS_PRAYER        = ['>', ['to-number', ['get', 'peoplePraying'], 0], 0];
const RING_HAIRLINE_HAS = { 0: 0.25, 8: 0.4,  14: 0.5  };  // light has-prayer hairline
const RING_HAIRLINE_NO  = { 0: 0.1,  8: 0.18, 14: 0.22 };  // light need-prayer hairline (also the dark EXCEPTION width)
const RING_THICK        = { 0: 1.2,  8: 1.6,  14: 2    };  // dark default — outlines black pins

export const PIN_STROKE_WIDTH_LIGHT = [
    'interpolate', ['linear'], ['zoom'],
    0,  ['case', HAS_PRAYER, RING_HAIRLINE_HAS[0],  RING_HAIRLINE_NO[0]],
    8,  ['case', HAS_PRAYER, RING_HAIRLINE_HAS[8],  RING_HAIRLINE_NO[8]],
    14, ['case', HAS_PRAYER, RING_HAIRLINE_HAS[14], RING_HAIRLINE_NO[14]]
];
export const PIN_STROKE_WIDTH_DARK = [
    'interpolate', ['linear'], ['zoom'], 0, RING_THICK[0], 8, RING_THICK[8], 14, RING_THICK[14]
];

// MODULAR dark-ring EXCEPTIONS, keyed by the active colour-strategy. A pin matching an
// exception keeps the THIN hairline instead of the thick default. To add a future
// exception (a pin type / legend row / colour that should stay thin), add a key + match
// expression here — CONFIG ONLY, no code edits. (coder: the prayer map's RED no-prayer
// pins MUST stay thin so RED vs YELLOW don't blur under a thick white ring.)
const NO_PRAYER   = ['==', ['to-number', ['get', 'peoplePraying'], 0], 0];
const NOT_ENGAGED = ['all', ['!=', ['get', 'engagementStatus'], true], ['!=', ['get', 'engagementStatus'], 1]];
const NOT_ADOPTED = ['all', ['!=', ['get', 'adoptionStatus'], true], ['!=', ['get', 'adoptionStatus'], 1]];
export const DARK_RING_EXCEPTIONS = {
    // Negative-status pins are RED (#e74c3c) on every status map — already visible by
    // colour, and a thick white ring blurs RED vs the positive GREEN/YELLOW. Keep them
    // thin; positive (has-*) pins keep the thick white ring like every other pin.
    prayer:         [NO_PRAYER],     // simple-map prayer colour-strategy: no-prayer (red) thin
    prayerProgress: [NO_PRAYER],     // research / countries / clone prayer colour-strategy
    engagement:     [NOT_ENGAGED],   // notEngaged (red) thin
    adoption:       [NOT_ADOPTED],   // notAdopted (red) thin
};

// Build the dark-mode circle-stroke-width for the active colour-strategy: THICK by
// default, but THIN (hairline) for any pin matching that strategy's exceptions.
export function buildDarkRingWidth(colorStrategy) {
    const excs = DARK_RING_EXCEPTIONS[colorStrategy] || [];
    if (!excs.length) return PIN_STROKE_WIDTH_DARK;             // no exception → all thick
    const anyExc = excs.length === 1 ? excs[0] : ['any', ...excs];
    return [
        'interpolate', ['linear'], ['zoom'],
        0,  ['case', anyExc, RING_HAIRLINE_NO[0],  RING_THICK[0]],
        8,  ['case', anyExc, RING_HAIRLINE_NO[8],  RING_THICK[8]],
        14, ['case', anyExc, RING_HAIRLINE_NO[14], RING_THICK[14]]
    ];
}

// ── Client-side language → family derivation ────────────────────────────────
// API field `imb_language_family` is null for all 2,069 records (qa-feedback1
// Round 5 A2). The legend bucketing (useLanguageFamilyLegendData.readFamily)
// derives family client-side via langFamilyByLanguage; mirror the same
// derivation here so pin features carry the correct languageFamily property.
// Without this, the languageFamily color strategy paints pins as 'Unknown'
// (gray/black) and PPLR-style property filters miss them.
const FAMILY_SUFFIXES_PIN = [
  [/ sign language$/i, 'Sign Language'],
];
function deriveFamilyFromLanguage(label) {
  if (!label || typeof label !== 'string') return null;
  const lbl = label.trim();
  // Comma-inverted lookup: "Arabic, Sudanese" → "Sudanese Arabic"
  const parts = lbl.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const fullReversed = [...parts].reverse().join(' ');
    if (langFamilyByLanguage[fullReversed]) return langFamilyByLanguage[fullReversed];
    if (parts.length >= 3) {
      const twoReversed = [parts[1], parts[0]].join(' ');
      if (langFamilyByLanguage[twoReversed]) return langFamilyByLanguage[twoReversed];
    }
  }
  if (langFamilyByLanguage[lbl]) return langFamilyByLanguage[lbl];
  // Strip parenthetical suffix: "Ainu (China)" → "Ainu"
  const stripped = lbl.replace(/\s*\(.*?\)\s*$/, '').trim();
  if (stripped !== lbl && langFamilyByLanguage[stripped]) return langFamilyByLanguage[stripped];
  // Suffix groups: "Pakistan Sign Language" → "Sign Language"
  for (const [re, base] of FAMILY_SUFFIXES_PIN) {
    if (re.test(lbl)) return base;
  }
  return null;
}

/**
 * useMapLayers composable - manages Mapbox layer creation and updates
 *
 * NOTE: Event handlers (click, hover, popups) are handled by useMapEvents composable
 * which is automatically initialized and used by this composable.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.getMap - Function that returns the map instance
 * @param {string} options.mapId - Unique map identifier for logging
 * @param {Function} options.getLanguageFamilyColor - Color lookup function
 * @param {Function} options.getNormalizedPeopleGroups - Returns normalized PG array for region popups
 *
 * @returns {Object} Layer management functions and state
 */
export function useMapLayers(options = {}) {
    const {
        getMap: _getMapOption = () => null,
        mapId = 'unknown',
        getLanguageFamilyColor = () => '#999999',
        getNormalizedPeopleGroups = () => []
    } = options;

    // Mapbox must NEVER run through Vue's reactive Proxy. The profiles hold the Map in
    // a plain ref() (deep-reactive), so `getMap()` hands back a Proxy: every
    // `this.style…` read inside Mapbox then goes through the Proxy get/set traps, and a
    // render scheduled from a proxied call (setPaintProperty → triggerRepaint) draws the
    // WHOLE frame through the Proxy — measured with internal/long-frames-probe.mjs
    // --profile: Vue's `get`/`set` traps were the two top self-time frames of an IDLE
    // prayer map (~2.7 s of a 16 s window), called from Mapbox's updatePaintArrays /
    // bind / freshBind. toRaw() unwraps once at this boundary; a raw map passes through.
    const getMap = () => { const m = _getMapOption(); return m ? toRaw(m) : null; };

    // Initialize events composable for click handlers, popups, cursor changes
    const mapEvents = useMapEvents({ getMap, mapId, getLanguageFamilyColor, getNormalizedPeopleGroups });

    // Track which layers have been added
    const layersAdded = ref({
        languageFamilyPins: false,
        regions: false,
        peopleGroups: false,
        familyConnections: false
    });

    // Populated by addRegionsLayer — maps WAGF region label → Set of ISO alpha-2 codes.
    // Used by applyDimFilter to build the Mapbox match expression for polygon highlight.
    const regionIsoMap = ref({});

    /**
     * Add language family pins layer
     * Shows people groups as colored circles based on language family
     *
     * @param {Array} peopleGroups - Array of people group data
     * @param {string} colorMode - Color mode ('languageFamily', 'affinityBlock', etc.)
     */
    function addLanguageFamilyLayer(peopleGroups, colorMode = 'languageFamily') {
        const map = getMap();
        if (!map || !peopleGroups?.length) {
            return;
        }

        // Build color expression from properties for all modes.
        // peoplePraying is stored in GeoJSON feature properties as a number,
        // so the Mapbox ['get', 'peoplePraying'] expression reads directly from properties.
        const colorExpression = buildColorExpression(colorMode);

        // Create GeoJSON features
        const features = peopleGroups.map(pg => ({
            type: 'Feature',
            properties: {
                uniqueId: pg.id || pg.uniqueId,
                slug: pg.slug || pg._normalized?.slug || '',
                rop3: pg.rop3 || pg.peopleGroupId,
                peopleId3: pg.peopleId3 || '',
                name: pg.name,
                language: pg.language,
                // Derive languageFamily client-side when API is null. The api
                // field `imb_language_family` is null for all 2,069 PGs; without
                // this fallback, every pin's languageFamily is 'Unknown' which
                // breaks the languageFamily color strategy AND any property-
                // based family filter (the legend's family-bucket only
                // catches whatever subset of langs the lookup happened to hit).
                languageFamily: pg.languageFamily
                  || pg._normalized?.languageFamily
                  || deriveFamilyFromLanguage(pg.language)
                  || 'Unknown',
                affinityBlock: pg.affinityBlock || pg.affbloc || pg.Affbloc || pg._normalized?.affinityBlock || 'Unknown',
                affinityBlockLabel: pg.affinityBlockLabel || pg._normalized?.affinityBlockLabel || '',
                // Cluster (rop2) — added 2026-05-08 for the affinity-block 4-tier legend.
                cluster:           pg.cluster      || pg._normalized?.cluster      || '',
                clusterLabel:      pg.clusterLabel || pg._normalized?.clusterLabel || '',
                // People group (rop25) — added 2026-05-08 for the affinity-block tier-3 filter.
                peopleGroup:       pg.peopleGroup      || pg._normalized?.peopleGroup      || '',
                peopleGroupLabel:  pg.peopleGroupLabel || pg._normalized?.peopleGroupLabel || '',
                // Prefer the top-level `pg.doxaRegion` because useMapData's
                // backfill loop canonicalizes raw value forms ("africa",
                // "latin_america_&_caribbean", "na") onto the DOXA_REGION_COLORS
                // keys ("Africa", "Latin America & Caribbean", "No WAGF Region/Bloc").
                // Reading `_normalized` first would pin the GeoJSON property to
                // the lowercase value form and break Mapbox setFilter matches.
                doxaRegion: pg.doxaRegion || pg._normalized?.doxaRegion || 'Unknown',
                wagfBlock: pg.wagfBlock || pg._normalized?.wagfBlock || '',
                wagfBlockLabel: pg.wagfBlockLabel || pg._normalized?.wagfBlockLabel || '',
                wagfRegionLabel: pg.wagfRegionLabel || pg._normalized?.wagfRegionLabel || '',
                // Country fields — `countryName` is the unified decoded display label
                country:         pg.country,
                countryIso:      pg.countryIso,
                countryIsoLabel: pg.countryIsoLabel,
                countryName:     pg.countryName,
                // Religion fields — `religionName` is the unified decoded display label.
                religion:        pg.religion,
                religionCode:    pg.religionCode,
                religionLabel:   pg.religionLabel,
                religionName:    pg.religionName,
                population: pg.population,
                status: pg.status,
                description: pg.description || '',
                imageUrl: pg.imageUrl || '',
                // peoplePraying: stored in feature properties for initial load path;
                // after polling starts, Mapbox feature-state overrides color via setFeatureState().
                peoplePraying: Number(pg.peoplePraying ?? pg._normalized?.peoplePraying ?? 0),
                // engagementStatus / adoptionStatus: stored as booleans so Mapbox expressions work
                engagementStatus: pg.engagementStatus === true || pg.engagementStatus === 1 || false,
                adoptionStatus:   pg.adoptionStatus   === true || pg.adoptionStatus   === 1 || false,
                // Gospel resources for resource coloring (all 6 types)
                bible: pg.bible || pg._normalized?.bible || 'Not Available',
                jesusFilm: pg.jesusFilm || pg._normalized?.jesusFilm || 'Not Available',
                radio: pg.radio || pg._normalized?.radio || 'Not Available',
                gospel: pg.gospel || pg._normalized?.gospel || 'Not Available',
                audio: pg.audio || pg._normalized?.audio || 'Not Available',
                stories: pg.stories || pg._normalized?.stories || 'Not Available',
                // lng stored as feature property so wave animation expressions can read it
                lng: parseFloat(pg.longitude || pg.lng) || 0
            },
            geometry: {
                type: 'Point',
                coordinates: [parseFloat(pg.longitude || pg.lng), parseFloat(pg.latitude || pg.lat)]
            }
        })).filter(f =>
            !isNaN(f.geometry.coordinates[0]) &&
            !isNaN(f.geometry.coordinates[1])
        );

        // Offset co-located pins so they fan out in a circle instead of stacking.
        // Radius is ~0.04 degrees (~4 km) — visible at zoom ≥ 5, invisible at world view.
        const OFFSET_RADIUS_DEG = 0.04;
        const coordKey = (f) => `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`;
        const groups = new Map();
        for (const f of features) {
            const k = coordKey(f);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(f);
        }
        for (const bucket of groups.values()) {
            if (bucket.length < 2) continue;
            const [cx, cy] = bucket[0].geometry.coordinates;
            const n = bucket.length;
            for (let i = 0; i < n; i++) {
                const angle = (2 * Math.PI * i) / n;
                bucket[i].geometry.coordinates = [
                    cx + OFFSET_RADIUS_DEG * Math.cos(angle),
                    cy + OFFSET_RADIUS_DEG * Math.sin(angle)
                ];
            }
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };


        // Add source — promoteId promotes properties.uniqueId → feature.id for setFeatureState()
        map.addSource('language-families', {
            type: 'geojson',
            data: geojson,
            promoteId: 'uniqueId'
        });

        // Shadow layer — rendered BEFORE pins for a subtle drop-shadow effect.
        // Uses circle-blur + circle-translate to simulate depth with zero DOM overhead.
        map.addLayer({
            id: 'language-family-pins-shadow',
            type: 'circle',
            source: 'language-families',
            paint: {
                'circle-radius': getCircleRadiusInterpolation('standard'),
                'circle-color': 'rgba(0,0,0,0.12)',
                'circle-blur': 0.8,
                'circle-translate': [0, 1],
                'circle-stroke-width': 0,
                'circle-opacity': 1
            }
        });

        // Add the pins layer. Pins render fully opaque so they read clearly
        // on top of the doxa-regions polygon fill (which is semi-transparent).
        map.addLayer({
            id: 'language-family-pins',
            type: 'circle',
            source: 'language-families',
            paint: {
                'circle-radius': getCircleRadiusInterpolation('standard'),
                'circle-color': colorExpression,
                // Mapbox Standard style v3 lights custom layers by the lightPreset — on the
                // 'night' preset, circles WITHOUT an emissive strength get darkened to
                // near-black. Setting it to 1 makes the pins render their OWN colour
                // identically in day + night, so pins keep the same colour in dark mode
                // (not black). (doxa dark-mode pin-colour fix on Standard style.)
                ...emissivePaint(map),
                // Very thin / subtle hairline ring. Data-driven so the need-prayer (red) pins —
                // the only ones that carry the DARK ring in light mode — get a noticeably THINNER
                // hairline than the has-prayer (white-ring) pins (coder: "dark lines round the red
                // pins are too thick"). Zoom interpolation is kept by putting the 'case' in the
                // interpolate OUTPUTS (zoom-and-property — allowed); the reverse (zoom nested inside
                // a 'case') is what breaks the layer, so don't do that.
                'circle-stroke-width': PIN_STROKE_WIDTH_LIGHT,
                // BOOT default = LIGHT-mode ring (has-prayer→white, need-prayer/red→subtle dark
                // #1f2937). The profile's _updatePinStroke (theme-aware) overrides this on boot/
                // toggle: DARK mode → subtle WHITE ring on ALL pins (no dark line in dark).
                'circle-stroke-color': [
                    'case',
                    ['>', ['to-number', ['get', 'peoplePraying'], 0], 0], '#ffffff',
                    '#1f2937'
                ],
                'circle-opacity': 1,
                'circle-stroke-opacity': 1,
                'circle-opacity-transition': { duration: 250 }
            }
        });

        // Invisible hitbox layer — larger transparent circles on top of pins
        // for easier touch/click targeting (especially on mobile/tablet).
        // Uses 'touchTarget' profile: 22px+ radius at zoom 4-8 for >=44px
        // effective tap diameter (Apple HIG / Material minimum).
        map.addLayer({
            id: 'language-family-pins-hitbox',
            type: 'circle',
            source: 'language-families',
            paint: {
                'circle-radius': getCircleRadiusInterpolation('touchTarget'),
                'circle-color': 'rgba(0,0,0,0)',
                'circle-stroke-width': 0,
                'circle-opacity': 0
            }
        });

        layersAdded.value.languageFamilyPins = true;

        // Attach event handlers (click for popup, cursor change on hover)
        mapEvents.attachLanguageFamilyEvents();

    }

    /**
     * Add regions polygon layer using Mapbox's built-in country boundaries
     * vector tileset (mapbox.country-boundaries-v1). No external fetch —
     * same CDN as the base map, vector tiles load only the visible viewport.
     *
     * @param {Object} regionsData - { isoToRegion: { 'AFG': 'asia', … } } (region SLUGs)
     * @param {string} colorScheme - 'doxa-regions' | 'none'
     */
    function addRegionsLayer(regionsData, colorScheme = 'doxa-regions') {
        const map = getMap();
        if (!map) return;

        // If layers already exist (e.g. after a style reload) remove them first.
        if (map.getLayer('regions-fill'))   map.removeLayer('regions-fill');
        if (map.getLayer('regions-border')) map.removeLayer('regions-border');
        if (map.getSource('regions'))       map.removeSource('regions');

        // Keyed on the STABLE region slug (wagf_region.value) — loadRegionsData
        // builds isoToRegion as ISO → slug. A label-keyed palette greys out every
        // region except "Asia" once the API returns localized labels (locale bug).
        const REGION_COLORS = {
            'africa':                                 '#ff2e2e',
            'asia':                                   '#1a8cff',
            'europe':                                 '#1ee05f',
            'latin_america_&_caribbean':              '#FFEB3B',
            'middle_east':                            '#a83dff',
            'north_america_&_non-spanish_caribbean':  '#00e0bd',
            'oceania':                                '#ff7f11',
        };
        const DEFAULT_COLOR = '#cccccc';

        // Build a Mapbox `match` expression on iso_3166_1_alpha_3 (alpha-3).
        // The mapbox.country-boundaries-v1 tileset exposes both iso_3166_1 (alpha-2)
        // AND iso_3166_1_alpha_3 (alpha-3). The API gives us country_code as alpha-3
        // (e.g. 'MYS', 'SDN') so we match on the alpha-3 property to avoid a lookup table.
        const isoToRegion = (regionsData && regionsData.isoToRegion) ? regionsData.isoToRegion : {};
        const matchPairs = [];
        // Build regionIsoMap: region slug → array of ISO alpha-3 codes for that region.
        const _regionIsoMap = {};
        for (const [iso, region] of Object.entries(isoToRegion)) {
            const color = REGION_COLORS[String(region).toLowerCase()];
            if (color) matchPairs.push(iso, color);
            if (!_regionIsoMap[region]) _regionIsoMap[region] = [];
            _regionIsoMap[region].push(iso);
        }
        regionIsoMap.value = _regionIsoMap;

        // If no mapping available fall back to a flat grey — map still renders.
        const fillColorExpr = matchPairs.length
            ? ['match', ['get', 'iso_3166_1_alpha_3'], ...matchPairs, DEFAULT_COLOR]
            : DEFAULT_COLOR;

        // Insert regions UNDER the pins (and shadow) layer so pins stay on top + clickable.
        // Prefer inserting before the shadow layer so z-order is: regions → shadow → pins → hitbox.
        const beforeId = map.getLayer('language-family-pins-shadow')
            ? 'language-family-pins-shadow'
            : map.getLayer('language-family-pins')
                ? 'language-family-pins'
                : undefined;

        // ── REGION POLYGONS, PER ENGINE ────────────────────────────────────────────────────
        // ★ SECOND SITE OF THE SAME DEFECT. mapbox://mapbox.country-boundaries-v1 is a
        // Mapbox-hosted VECTOR TILESET; MapLibre cannot fetch a mapbox:// URL and throws
        //   Fetch API cannot load mapbox://mapbox.country-boundaries-v1. URL scheme "mapbox"
        // then renders everything else correctly with this fill simply MISSING. Fixing the
        // country-OUTLINE composable cleaned doxa-simple-map and research-map but left
        // countries-map (and the new country-posters-mfe that nests it) still throwing —
        // measured, which is how this second site was found at all.
        // The keyless equivalent already ships: assets/boundaries/world-adm0.geojson.
        // Engine read off the live map (its container carries maplibregl-map), not guessed.
        const _isMaplibre = (() => {
            try { return !!map.getContainer?.()?.classList?.contains('maplibregl-map') } catch (_) { return false }
        })();
        if (_isMaplibre) {
            // EMPTY first so the addLayer below stays synchronous and keeps its z-order slot
            // (regions → shadow → pins → hitbox); setData once the fetch lands.
            map.addSource('regions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            retryFetch(`${resolveAssetsBase(null)}/boundaries/world-adm0-web.geojson`)
                .then((r) => r.json())
                .then((gj) => {
                    // Tileset field is iso_3166_1_alpha_3; the geojson's is iso3. Normalise ONCE
                    // so every colour/filter expression downstream reads the name it always read.
                    for (const f of gj.features || []) {
                        if (f.properties && f.properties.iso3) f.properties.iso_3166_1_alpha_3 = f.properties.iso3;
                    }
                    const src = map.getSource('regions');
                    if (src) src.setData(gj);
                })
                .catch((e) => console.warn('[map-layers] region boundaries failed to load', e));
        } else {
            map.addSource('regions', {
                type: 'vector',
                url: 'mapbox://mapbox.country-boundaries-v1'
            });
        }

        map.addLayer({
            id: 'regions-fill',
            type: 'fill',
            source: 'regions',
            // VECTOR-TILE only; MapLibre rejects a layer declaring source-layer on geojson.
            ...(_isMaplibre ? {} : { 'source-layer': 'country_boundaries' }),
            paint: {
                'fill-color': fillColorExpr,
                'fill-opacity': colorScheme === 'none' ? 0.1 : 0.7,
                'fill-antialias': true,
                // Standard-style night lighting darkens custom layers — emit full colour
                // so region fills keep their colour in dark mode (doxa dark-mode fix).
                ...emissivePaint(map, 'fill'),
                'fill-opacity-transition': { duration: 300 }
            }
        }, beforeId);

        map.addLayer({
            id: 'regions-border',
            type: 'line',
            source: 'regions',
            // Same rule as regions-fill above: VECTOR-TILE only. This sibling kept the literal
            // and so was still dropped by MapLibre after the fill was fixed —
            //   Source layer "country_boundaries" does not exist on source
            // which surfaces ONLY on the map's error event, never from addLayer().
            ...(_isMaplibre ? {} : { 'source-layer': 'country_boundaries' }),
            paint: {
                // Crisp per-region outline: each country border is drawn in its own
                // region hue at full opacity. Internal (same-region) borders blend
                // into the fill; region-to-region boundaries read as sharp saturated
                // edges — this is what makes the fills look vibrant/sharp rather than
                // washed-out. Falls back to the same grey as the fill for unmapped ISOs.
                'line-color': fillColorExpr,
                'line-width': 1,
                'line-opacity': 0.9,
                // Emit full colour so the border stays visible on the night preset.
                ...emissivePaint(map, 'line')
            }
        }, beforeId);

        layersAdded.value.regions = true;

        mapEvents.attachRegionEvents();
    }

    /**
     * Add family connection lines (tapestry effect)
     * Connects people groups of the same language family
     *
     * @param {string} familyName - Language family name
     * @param {Array} peopleGroups - Array of people groups
     */
    function addFamilyConnectionLines(familyName, peopleGroups) {
        const map = getMap();
        if (!map || !familyName || !peopleGroups?.length) return;

        // Remove existing lines first
        removeFamilyConnectionLines();

        // Get all people groups in this family
        const familyGroups = peopleGroups.filter(pg => {
            const pgFamily = pg.languageFamily || pg._normalized?.languageFamily || 'Unknown';
            return pgFamily === familyName;
        });


        if (familyGroups.length < 2) return;

        // Get the color for this family
        const familyColor = getLanguageFamilyColor(familyName);

        // Create line features connecting nearby points
        const lineFeatures = [];
        const maxDistance = 15; // Maximum degrees distance

        // Sort by longitude for efficient neighbor finding
        const sorted = [...familyGroups].sort((a, b) =>
            (a.longitude || a.lng) - (b.longitude || b.lng)
        );

        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i];
            const currLng = current.longitude || current.lng;
            const currLat = current.latitude || current.lat;

            for (let j = i + 1; j < Math.min(i + 15, sorted.length); j++) {
                const other = sorted[j];
                const otherLng = other.longitude || other.lng;
                const otherLat = other.latitude || other.lat;

                const distance = Math.sqrt(
                    Math.pow(currLng - otherLng, 2) +
                    Math.pow(currLat - otherLat, 2)
                );

                if (distance < maxDistance) {
                    lineFeatures.push({
                        type: 'Feature',
                        properties: { family: familyName },
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [currLng, currLat],
                                [otherLng, otherLat]
                            ]
                        }
                    });
                }
            }
        }

        // Add source and layer
        map.addSource('family-connections', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: lineFeatures
            }
        });

        map.addLayer({
            id: 'family-connection-lines',
            type: 'line',
            source: 'family-connections',
            paint: {
                'line-color': familyColor,
                'line-width': 0.75,
                'line-opacity': 0.5,
                // Emit full colour so connection lines stay visible on the night preset.
                ...emissivePaint(map, 'line')
            }
        }, 'language-family-pins'); // Add below the pins layer

        layersAdded.value.familyConnections = true;
    }

    /**
     * Remove family connection lines
     */
    function removeFamilyConnectionLines() {
        const map = getMap();
        if (!map) return;

        if (map.getLayer('family-connection-lines')) {
            map.removeLayer('family-connection-lines');
        }
        if (map.getSource('family-connections')) {
            map.removeSource('family-connections');
        }
        layersAdded.value.familyConnections = false;
    }

    /**
     * Update layer source data
     */
    function updateLayerSource(sourceId, data) {
        const map = getMap();
        if (!map) return;

        const source = map.getSource(sourceId);
        if (source) {
            source.setData(data);
        }
    }

    /**
     * Remove a layer and its source
     */
    function removeLayer(layerId, sourceId = null) {
        const map = getMap();
        if (!map) return;

        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId || layerId)) {
            map.removeSource(sourceId || layerId);
        }
    }

    /**
     * Check if a layer exists
     */
    function hasLayer(layerId) {
        const map = getMap();
        return map ? !!map.getLayer(layerId) : false;
    }

    /**
     * Set paint property on a layer
     */
    function setPaintProperty(layerId, property, value) {
        const map = getMap();
        if (!map || !map.getLayer(layerId)) return;

        map.setPaintProperty(layerId, property, value);
    }

    /**
     * Cleanup: detach all event handlers
     * Call this before destroying the map
     */
    function cleanup() {
        mapEvents.detachAllEventHandlers();
        _unwatchGlowVisibility();
    }

    // ── Prayer ripple animation (continuous WiFi-style waves) ─────────────────
    // Solid colored disc behind pin + 4 ring layers in perpetual staggered
    // expansion. Each ring is offset by 1/4 of the cycle so there is ALWAYS
    // at least 2 rings visible — no gap, no pause. Rings emit continuously
    // from the pin center and fade to transparent at max radius, like ripples
    // on water or WiFi signal waves radiating outward.
    //
    // Pin radii: z0=3, z2=3.5, z4=4, z5=5, z6=6.5, z7=8, z8=10, z10=14, z12=18, z14=22
    //
    // Style-swap safety:
    //   map.setStyle() removes all custom layers + sources. The host profile
    //   already owns the post-style.load reconciliation path: it re-adds the
    //   pin source via addLanguageFamilyLayer, then calls startPrayerGlow()
    //   again. We DO NOT register our own style.load handler here — having
    //   two listeners fire on the same style.load creates a remove-then-add
    //   race against the host's reconciliation, which is the visible
    //   "flash" on theme toggle. Single source of truth = host's
    //   map.once('style.load') only. Our job is just to make sure that
    //   when startPrayerGlow() is called repeatedly we do NOT churn layers
    //   that are already correctly attached.
    let _glowRafId = null;
    let _glowActive = false;
    // Monotonic counter — incremented each _scheduleGlowTick() invocation.
    // Every tick closure remembers the epoch it was created under and
    // self-terminates if a newer scheduler has incremented it. Belt to the
    // cancelAnimationFrame suspenders inside _scheduleGlowTick().
    let _glowEpoch = 0;
    const GLOW_BASE  = 'prayer-glow-base';
    const RING_COUNT = 4;
    const _RING_IDS = [];
    for (let _ri = 0; _ri < RING_COUNT; _ri++) _RING_IDS.push('prayer-glow-ring-' + _ri);
    const _GLOW_IDS  = [GLOW_BASE, ..._RING_IDS];
    const CYCLE_SEC  = 6.0;
    const MIN_SCALE  = 0.3;
    const MAX_SCALE  = 2.5;
    // Write rate of the ring animation. EVERY paint write makes Mapbox re-render the
    // whole Standard style (hundreds of layers, 3D), so writing at rAF rate meant the
    // map never idled and every frame was a candidate "[Violation] requestAnimationFrame
    // handler took Nms" line (~100 per 15 s measured). 12 steps/s over a 6 s cycle is
    // 72 steps per ripple — visually the same slow glow, 5× fewer renders.
    const GLOW_FPS     = 12;
    const GLOW_STEP_MS = 1000 / GLOW_FPS;
    // One render per write: the animated ring props opt OUT of Mapbox's default 300 ms
    // paint transition, which would otherwise keep the map rendering at 60 fps for
    // 300 ms after EVERY write and defeat the throttle above.
    const NO_TRANSITION = { duration: 0, delay: 0 };
    // Offscreen pause: an embedded map scrolled below the fold must not keep its host
    // page's main thread busy. IntersectionObserver on the map container flips
    // _glowVisible; the tick skips writes while hidden. No IO (old WebView) → visible.
    let _glowVisible = true;
    let _glowIO = null;

    function _glowColorExpr() {
        return [
            'case',
            ['>=', ['get', 'peoplePraying'], FULL_PRAYER_THRESHOLD],
            '#15803d',
            ['>', ['get', 'peoplePraying'], 0],
            '#d97706',
            'rgba(0,0,0,0)'
        ];
    }

    const _BASE_R = [0,5, 2,6, 4,7, 5,9, 6,12, 7,14, 8,18, 10,25, 12,32, 14,40];

    function _scaledRadius(base, scale) {
        const out = ['interpolate', ['linear'], ['zoom']];
        for (let i = 0; i < base.length; i += 2) {
            out.push(base[i], base[i+1] * scale);
        }
        return out;
    }

    function addPrayerGlowLayers() {
        const map = getMap();
        if (!map || !map.getSource('language-families')) return;

        const prayerFilter = ['>', ['get', 'peoplePraying'], 0];
        const color = _glowColorExpr();

        // True idempotency: if ALL 5 glow layers already exist, do nothing.
        // The previous remove-then-re-add path reset ring stroke-opacity
        // and circle-radius to their addLayer defaults on every call,
        // producing a visible flash on the next paint until the rAF tick
        // wrote them back. Repeated calls to startPrayerGlow() (e.g. from
        // tab switches, theme toggles, or a host calling it after style
        // re-load) now leave already-attached layers alone — only the rAF
        // baseline is reset by _scheduleGlowTick().
        const allPresent = _GLOW_IDS.every(id => map.getLayer(id));
        if (allPresent) return;

        // Partial state: some layers exist, some don't. Tear down what's
        // there so the re-add below produces a clean, consistent stack.
        for (const id of _GLOW_IDS) {
            if (map.getLayer(id)) {
                try { map.removeLayer(id); } catch (_) {}
            }
        }

        map.addLayer({
            id: GLOW_BASE,
            type: 'circle',
            source: 'language-families',
            filter: prayerFilter,
            paint: {
                'circle-radius': _scaledRadius(_BASE_R, 1.0),
                'circle-color': color,
                'circle-blur': 0.3,
                'circle-opacity': 0.45,
                'circle-stroke-width': 0,
                // Standard-style night lighting darkens custom layers — emit full colour
                // so the prayer glow stays visible in dark mode. (Lighting prop, NOT an
                // animation value: opacity/radius/colour formulae are unchanged.)
                ...emissivePaint(map),
            }
        }, 'language-family-pins');

        for (const ringId of _RING_IDS) {
            map.addLayer({
                id: ringId,
                type: 'circle',
                source: 'language-families',
                filter: prayerFilter,
                paint: {
                    'circle-radius': _scaledRadius(_BASE_R, 1.0),
                    'circle-radius-transition': NO_TRANSITION,
                    'circle-color': 'rgba(0,0,0,0)',
                    'circle-blur': 0,
                    'circle-opacity': 1,
                    // Constant for the life of the layer — the tick used to rewrite
                    // stroke-width 2.5 and blur 0 on every frame; set once here instead.
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': color,
                    'circle-stroke-opacity': 0,
                    'circle-stroke-opacity-transition': NO_TRANSITION,
                    // Standard-style night lighting darkens custom layers — emit full
                    // colour so the ring stroke stays visible in dark mode. (Lighting
                    // prop, NOT an animation value.)
                    ...emissivePaint(map),
                }
            }, 'language-family-pins');
        }
    }

    function removePrayerGlowLayers() {
        const map = getMap();
        if (!map) return;
        for (const id of _GLOW_IDS) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
    }

    function syncGlowFilter(extraFilter) {
        const map = getMap();
        if (!map) return;
        const base = ['>', ['get', 'peoplePraying'], 0];
        const filter = extraFilter ? ['all', base, extraFilter] : base;
        for (const id of _GLOW_IDS) {
            if (map.getLayer(id)) {
                try { map.setFilter(id, filter); } catch (_) {}
            }
        }
    }

    function startPrayerGlow() {
        const map = getMap();
        if (!map) return;
        addPrayerGlowLayers();

        // Cancel any pending rAF before scheduling a new one. Single source
        // of truth for the animation timer ID — guarantees exactly one
        // tick loop is ever running, even when the host calls
        // startPrayerGlow() multiple times (tab switch, theme toggle,
        // initial mount, etc.). No internal style.load listener is
        // registered: the host profile's own map.once('style.load') is
        // the only place that re-adds the pin source after a setStyle and
        // re-invokes startPrayerGlow(). Adding a second listener here
        // produced a paint-property race against the host's re-add path,
        // visible as a periodic brightness flash on every prayer dot.
        if (_glowRafId) {
            cancelAnimationFrame(_glowRafId);
            _glowRafId = null;
        }
        _glowActive = true;

        if (map.getLayer('language-family-pins')) {
            try {
                map.setLayoutProperty('language-family-pins', 'circle-sort-key', [
                    'case',
                    ['>=', ['get', 'peoplePraying'], FULL_PRAYER_THRESHOLD], 1,
                    ['>', ['get', 'peoplePraying'], 0], 1,
                    3
                ]);
            } catch (_) {}
        }

        _watchGlowVisibility(map);
        _scheduleGlowTick();
    }

    // Internal helper: spins up a fresh rAF tick with a fresh `t0` baseline.
    //
    // Concurrency contract:
    //   Each call cancels any in-flight rAF before scheduling a new one
    //   and bumps an epoch token; the tick closure self-terminates if a
    //   newer scheduler has superseded it. Belt-and-suspenders against
    //   a stray frame that was enqueued before the cancel landed.
    function _scheduleGlowTick() {
        // (1) Hard cancel any pending rAF — single source of truth for the
        //     timer ID. Load-bearing for the duplicate-tick-leak fix.
        if (_glowRafId) {
            cancelAnimationFrame(_glowRafId);
            _glowRafId = null;
        }
        // (2) Epoch stamp — older closures still referencing a stale
        //     epoch will exit on their next frame instead of writing
        //     paint properties.
        const myEpoch = ++_glowEpoch;
        let t0 = performance.now();
        let lastWrite = -Infinity;
        function tick(now) {
            if (!_glowActive) return;
            if (myEpoch !== _glowEpoch) return; // superseded by newer scheduler
            const m = getMap();
            if (!m || !_GLOW_IDS.some(id => m.getLayer(id))) {
                // Layers gone (mid style swap). Stop scheduling new frames;
                // _glowActive stays true so the host's post-style.load
                // call to startPrayerGlow() will restart this tick chain
                // once the layers come back.
                _glowRafId = null;
                return;
            }
            // Throttle + offscreen pause: no write (and therefore no Mapbox
            // render) until the next step is due, or while the map is
            // scrolled out of view. The rAF chain itself is kept — a no-op
            // callback costs nothing and the browser already pauses it in
            // hidden tabs; the phase is clock-based, so a resumed ring lands
            // where it would have been, never restarts.
            if (now - lastWrite < GLOW_STEP_MS || !_glowVisible) {
                _glowRafId = requestAnimationFrame(tick);
                return;
            }
            lastWrite = now;
            const elapsed = (now - t0) / 1000;

            for (let i = 0; i < RING_COUNT; i++) {
                const ringId = _RING_IDS[i];
                if (!m.getLayer(ringId)) continue;

                const delay = i * (CYCLE_SEC / RING_COUNT);
                const t = ((elapsed - delay) % CYCLE_SEC + CYCLE_SEC) % CYCLE_SEC;
                const phase = t / CYCLE_SEC;
                const radiusScale = MIN_SCALE + phase * (MAX_SCALE - MIN_SCALE);
                const opacity = 0.5 * (1.0 - phase);

                // Only the two values that actually move; stroke-width/blur are
                // constants set in addPrayerGlowLayers().
                try {
                    m.setPaintProperty(ringId, 'circle-radius', _scaledRadius(_BASE_R, radiusScale));
                    m.setPaintProperty(ringId, 'circle-stroke-opacity', opacity);
                } catch (_) {}
            }
            // Schedule next frame LAST, after work, so _glowRafId always
            // reflects the most recently scheduled frame for this chain.
            _glowRafId = requestAnimationFrame(tick);
        }
        _glowRafId = requestAnimationFrame(tick);
    }

    // Offscreen pause plumbing (see _glowVisible). One observer per composable;
    // startPrayerGlow() may be called many times, stopPrayerGlow() disconnects.
    function _watchGlowVisibility(map) {
        if (_glowIO || typeof IntersectionObserver === 'undefined') return;
        const el = typeof map.getContainer === 'function' ? map.getContainer() : null;
        if (!el) return;
        try {
            _glowIO = new IntersectionObserver((entries) => {
                for (const e of entries) _glowVisible = e.isIntersecting;
            }, { threshold: 0 });
            _glowIO.observe(el);
        } catch (_) { _glowIO = null; _glowVisible = true; }
    }
    function _unwatchGlowVisibility() {
        if (_glowIO) { try { _glowIO.disconnect(); } catch (_) {} _glowIO = null; }
        _glowVisible = true;
    }

    function stopPrayerGlow() {
        _glowActive = false;
        if (_glowRafId) { cancelAnimationFrame(_glowRafId); _glowRafId = null; }
        _unwatchGlowVisibility();
        // No persistent style.load listener to detach — the host profile
        // owns the post-style.load reconciliation path.
        try {
            removePrayerGlowLayers();
            const map = getMap();
            if (map && map.getLayer('language-family-pins')) {
                map.setLayoutProperty('language-family-pins', 'circle-sort-key', undefined);
            }
        } catch (_) {}
    }

    return {
        // State
        layersAdded,
        regionIsoMap,

        // Layer creation (includes event handler attachment)
        addLanguageFamilyLayer,
        addRegionsLayer,
        addFamilyConnectionLines,
        removeFamilyConnectionLines,

        // Layer management
        updateLayerSource,
        removeLayer,
        hasLayer,
        setPaintProperty,

        // Event management (exposed for advanced usage)
        mapEvents,

        // Prayer glow animation
        startPrayerGlow,
        stopPrayerGlow,
        syncGlowFilter,

        // Cleanup
        cleanup
    };
}

// ES Module export
