// useMapEvents.js - Map Event Handlers Composable
// Handles click handlers, popups, cursor changes, and hover effects
// Vue 3 Composition API - ES Module with NPM packages

// Import Vue functions from NPM package
import { ref, inject } from 'vue';
import { escapeHtml as esc, safeUrl } from '../utils/html.js';
import { useI18n } from 'vue-i18n';
import { engineFor } from './useMapProvider.js';

/**
 * useMapEvents composable - manages Mapbox layer event handlers
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.getMap - Function that returns the map instance
 * @param {string} options.mapId - Unique map identifier for logging
 * @param {Function} options.getLanguageFamilyColor - Color lookup function for language families
 *
 * @returns {Object} Event management functions
 */
export function useMapEvents(options = {}) {
    const {
        getMap = () => null,
        mapId = 'unknown',
        getLanguageFamilyColor = () => '#999999',
        getNormalizedPeopleGroups = () => []
    } = options;

    // ── CRITICAL: capture store reference NOW, during Vue setup context ──────
    // inject('uiStore') resolves to THIS web-component instance's Pinia store,
    // provided by ProfileLoader.vue which runs inside the correct Vue app.
    // Using inject() here (synchronously during setup) guarantees isolation
    // when multiple map elements share a page.
    const uiStore = inject('uiStore');

    // ── i18n ─────────────────────────────────────────────────────────────────
    // Locale parity (feedback #8 /fr/research): the country-click detail popup
    // (WAGF Region / Block / Country / UUPG count) was hardcoded English, so on
    // /fr the country geography click rendered an all-English card. Route the
    // labels through i18n so every locale behaves identically. Missing-key
    // behavior falls back to English (see src/i18n/index.js), so locales without
    // a `popup` catalog keep the prior English text rather than breaking.
    const { t, locale } = useI18n();

    // Track registered event handlers for cleanup
    const registeredHandlers = ref([]);

    /**
     * Generate popup content for a people group pin
     * @param {Object} properties - Feature properties
     * @returns {string} HTML content
     */
    function generatePinPopupContent(properties) {
        const familyColor = getLanguageFamilyColor(properties.languageFamily);

        // Get image URL - use imageUrl from data, fallback to placeholder
        const placeholderImage = "https://www.peoplegroups.org/images/pgphotosearch/NoImageAvailable_search.jpg";
        let imageUrl = properties.imageUrl;
        if (!imageUrl || imageUrl.includes('NoImageAvailable')) {
            imageUrl = placeholderImage;
        }

        // Generate avatar based on first letter
        const firstLetter = (properties.name || 'U')[0].toUpperCase();
        const avatarColors = [
            '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
            '#9b59b6', '#1abc9c', '#e67e22', '#34495e'
        ];
        const colorIndex = firstLetter.charCodeAt(0) % avatarColors.length;
        const avatarColor = avatarColors[colorIndex];

        // TODO: domain-specific — `https://uupg.doxa.life/people-groups/${properties.rop3}`
        // Override the "Learn more" URL via a profile-level callback if you need a different host.
        return `
            <div style="
                width: 300px;
                background: white;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <!-- Header with Avatar and Name -->
                <div style="
                    display: flex;
                    align-items: center;
                    padding: 12px;
                    border-bottom: 1px solid #efefef;
                ">
                    <!-- Avatar -->
                    <div style="
                        width: 32px;
                        height: 32px;
                        border-radius: 4px;
                        background-color: ${esc(avatarColor)};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: 700;
                        font-size: 16px;
                        margin-right: 10px;
                        flex-shrink: 0;
                    ">
                        ${esc(firstLetter)}
                    </div>

                    <!-- Name and Status -->
                    <div style="flex: 1; min-width: 0;">
                        <h3 style="
                            margin: 0;
                            font-size: 14px;
                            font-weight: 600;
                            color: #262626;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        ">${esc(properties.name)}</h3>
                        <p style="
                            margin: 2px 0 0 0;
                            font-size: 12px;
                            color: #8e8e8e;
                        ">${esc(properties.country || 'Unknown')} • ${esc(properties.status || 'Unknown Status')}</p>
                    </div>
                </div>

                <!-- Image -->
                <div style="
                    width: 100%;
                    height: 200px;
                    background-color: #fafafa;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                ">
                    <img
                        src="${safeUrl(imageUrl, placeholderImage)}"
                        alt="${esc(properties.name)}"
                        style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        "
                        onerror="this.onerror=null; this.src=&#39;${esc(placeholderImage)}&#39;"
                    />
                </div>

                <!-- Info Section -->
                <div style="padding: 12px;">
                    <p style="margin: 0 0 6px 0; font-size: 13px;">
                        <strong>Language:</strong> ${esc(properties.language || 'Unknown')}
                    </p>
                    <p style="margin: 0 0 6px 0; font-size: 13px;">
                        <strong>Family:</strong>
                        <span style="background: ${esc(familyColor)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                            ${esc(properties.languageFamily || 'Unknown')}
                        </span>
                    </p>
                    ${properties.population ? `<p style="margin: 0 0 6px 0; font-size: 13px;"><strong>Population:</strong> ${esc(properties.population)}</p>` : ''}
                    ${properties.description ? `<p style="margin: 8px 0; font-size: 13px; color: #262626; line-height: 1.4;">${esc(properties.description)}</p>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Generate popup content for a region/country
     * @param {Object} properties - Feature properties
     * @returns {string} HTML content
     */
    function generateRegionPopupContent(tileProps) {
        const iso3 = tileProps.iso_3166_1_alpha_3 || ''
        // Prefer the active locale's tile name field when present, then the
        // canonical English name, then the bare name, then the ISO code. The
        // country-boundaries tileset may not carry a per-locale name for every
        // country, so the coalesce keeps the popup populated in every locale.
        const localeName = tileProps['name_' + (locale?.value || 'en')]
        const countryName = localeName || tileProps.name_en || tileProps.name || iso3
        const pgs = getNormalizedPeopleGroups()
        // Match by countryIso (pray-tools) OR country (doxa-api uses `country` for ISO alpha-3)
        const iso3Upper = iso3.toUpperCase()
        const matching = pgs.filter(pg => {
            const pgIso = (pg.countryIso || pg.country || '').toUpperCase()
            return pgIso && pgIso === iso3Upper
        })
        const uupgCount = matching.length
        const first = matching[0]
        const wagfRegion = first?.wagfRegionLabel || first?.doxaRegionLabel || first?.doxaRegion || first?.wagfRegion || '—'
        const wagfBlock = first?.wagfBlockLabel || first?.wagfBlock || '—'
        return `
            <div style="padding: 8px; min-width: 220px;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #333;">
                    ${esc(countryName)}
                </h3>
                <p style="margin: 4px 0; font-size: 14px;">
                    <strong>${esc(t('popup.country.wagfRegion'))}:</strong> ${esc(wagfRegion)}
                </p>
                <p style="margin: 4px 0; font-size: 14px;">
                    <strong>${esc(t('popup.country.wagfBlock'))}:</strong> ${esc(wagfBlock)}
                </p>
                <p style="margin: 4px 0; font-size: 14px;">
                    <strong>${esc(t('popup.country.country'))}:</strong> ${esc(countryName)} (${esc(iso3)})
                </p>
                <p style="margin: 4px 0; font-size: 14px;">
                    <strong>${esc(t('popup.country.uupgCount'))}:</strong> ${esc(uupgCount)}
                </p>
            </div>
        `;
    }

    /**
     * Attach click handler for language family pins
     * Shows popup with people group details
     */
    function attachPinClickHandler(overrideLayerId) {
        const map = getMap();
        if (!map) return;

        const layerId = overrideLayerId || 'language-family-pins';
        if (!map.getLayer(layerId)) {
            return;
        }

        const handler = (e) => {
          try {
            const feature = e.features[0];
            const properties = feature.properties;
            const coordinates = feature.geometry.coordinates.slice();

            // Ensure popup appears even if wrapped coordinates
            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }

            // Route pin click to legend (prayer mode) — show people group detail in side panel
            if (uiStore && uiStore.legendMode !== undefined) {
                // Select people group → switches legend to detail mode on both mobile and desktop
                uiStore.selectPeopleGroup(feature);
                // On mobile: expand legend to 40% if currently collapsed
                if (uiStore.isMobile && uiStore.legendState === 'collapsed') {
                    uiStore.setLegendState('open');
                }
                // On desktop: if legend is collapsed, open it
                if (!uiStore.isMobile) {
                    // Signal via custom event that the desktop legend can listen to
                    window.dispatchEvent(new CustomEvent('dxm:openDesktopLegend', { detail: { mapId } }));
                }
                return; // Don't show popup — info is in the legend panel
            }

            // Fallback: show popup (for non-prayer legend types)
            new (engineFor(map).Popup)({
                maxWidth: '320px',
                className: 'people-group-popup'
            })
                .setLngLat(coordinates)
                .setHTML(generatePinPopupContent(properties))
                .addTo(map);
          } catch (err) {
            console.error(` [${mapId}] Pin click handler error:`, err);
          }
        };

        map.on('click', layerId, handler);
        registeredHandlers.value.push({ event: 'click', layer: layerId, handler });
    }

    /**
     * Attach click handler for regions layer
     * Shows popup with country/region details
     */
    function attachRegionClickHandler() {
        const map = getMap();
        if (!map) return;

        const layerId = 'regions-fill';
        if (!map.getLayer(layerId)) {
            return;
        }

        const handler = (e) => {
            // Check if we clicked on a people group pin - if so, don't show country popup
            const pinLayers = ['language-family-pins', 'language-family-pins-hitbox', 'people-groups-pins'];
            for (const pinLayer of pinLayers) {
                if (map.getLayer(pinLayer)) {
                    const pinFeatures = map.queryRenderedFeatures(e.point, { layers: [pinLayer] });
                    if (pinFeatures && pinFeatures.length > 0) {
                        // There's a pin at this location, don't show country popup
                        return;
                    }
                }
            }

            if (e.features && e.features.length > 0) {
                const properties = e.features[0].properties;

                new (engineFor(map).Popup)()
                    .setLngLat(e.lngLat)
                    .setHTML(generateRegionPopupContent(properties))
                    .addTo(map);
            }
        };

        map.on('click', layerId, handler);
        registeredHandlers.value.push({ event: 'click', layer: layerId, handler });
    }

    /**
     * Attach click handler for cluster expansion
     */
    function attachClusterClickHandler() {
        const map = getMap();
        if (!map) return;

        const layerId = 'clusters';
        if (!map.getLayer(layerId)) {
            // Clusters layer may not exist - that's ok
            return;
        }

        const handler = (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
            if (!features.length) return;

            const clusterId = features[0].properties.cluster_id;
            const sourceId = features[0].source;

            map.getSource(sourceId).getClusterExpansionZoom(
                clusterId,
                (err, zoom) => {
                    if (err) return;
                    map.easeTo({
                        center: features[0].geometry.coordinates,
                        zoom: zoom
                    });
                }
            );
        };

        map.on('click', layerId, handler);
        registeredHandlers.value.push({ event: 'click', layer: layerId, handler });
    }

    /**
     * Attach cursor change handlers for a layer
     */
    function attachCursorHandlers(layerId) {
        const map = getMap();
        if (!map || !map.getLayer(layerId)) return;

        const enterHandler = () => {
            map.getCanvas().style.cursor = 'pointer';
        };

        const leaveHandler = () => {
            map.getCanvas().style.cursor = '';
        };

        map.on('mouseenter', layerId, enterHandler);
        map.on('mouseleave', layerId, leaveHandler);

        registeredHandlers.value.push({ event: 'mouseenter', layer: layerId, handler: enterHandler });
        registeredHandlers.value.push({ event: 'mouseleave', layer: layerId, handler: leaveHandler });
    }

    /**
     * Attach all event handlers for language family layer
     */
    function attachLanguageFamilyEvents() {
        // ★ CLICKS BIND TO THE HITBOX ONLY, AND THAT IS DELIBERATE. addLanguageFamilyLayer creates
        // the hitbox together with the pins, from the same source, with a larger radius and its
        // filter mirrored — so it already covers every click the visible layer would catch. A pins
        // layer added WITHOUT a hitbox would get no clicks at all.
        //
        // ⚠ BINDING BOTH IS NOT HARMLESS, IT DOUBLES EVERY CLICK. A layer-scoped click fires once
        // per registered layer that has a feature under the point, and every visible pin has a
        // hitbox twin at its own point — so registering this handler on both layers called it
        // TWICE per click, 3ms apart (measured on the leaf at 1440, two different pins, both
        // reporting both layers at the click point). That shipped as a visible bug: the second
        // call overwrote the legend state the first had saved, so closing a detail reopened a
        // legend the reader had collapsed. Anything that counts, toggles or reports from a pin
        // click was also wrong by a factor of two.
        attachPinClickHandler('language-family-pins-hitbox');
        attachCursorHandlers('language-family-pins');
        attachCursorHandlers('language-family-pins-hitbox');
        attachClusterClickHandler();
        attachCursorHandlers('clusters');
    }

    /**
     * Attach all event handlers for regions layer
     */
    function attachRegionEvents() {
        attachRegionClickHandler();
        attachCursorHandlers('regions-fill');
    }

    /**
     * Attach all standard event handlers
     * Call this after layers are added
     */
    function attachAllEventHandlers() {
        const map = getMap();
        if (!map) {
            return;
        }

        // Language family pins
        if (map.getLayer('language-family-pins')) {
            attachLanguageFamilyEvents();
        }

        // Regions
        if (map.getLayer('regions-fill')) {
            attachRegionEvents();
        }

        // People groups pins (alternate layer name).
        //
        // ⚠ NOTHING CREATES THIS LAYER TODAY, so this branch never runs — the id appears only in
        // this file. It is left in place for a map that adds it later, with the argument it was
        // missing: the call below used to omit the layer id, which made it fall back to
        // 'language-family-pins' (see attachPinClickHandler) and bind the wrong layer. Whoever
        // first adds a people-groups-pins layer would have got either a duplicate binding on the
        // language-family pins or, with no such layer present, no click handler at all.
        if (map.getLayer('people-groups-pins')) {
            attachPinClickHandler('people-groups-pins');
            attachCursorHandlers('people-groups-pins');
        }

    }

    /**
     * Remove all registered event handlers
     * Call this on component unmount or when re-adding layers
     */
    function detachAllEventHandlers() {
        const map = getMap();
        if (!map) return;

        for (const { event, layer, handler } of registeredHandlers.value) {
            try {
                map.off(event, layer, handler);
            } catch (err) {
                // Layer might have been removed already
            }
        }

        registeredHandlers.value = [];
    }

    return {
        // Event attachment
        attachAllEventHandlers,
        attachLanguageFamilyEvents,
        attachRegionEvents,
        attachPinClickHandler,
        attachRegionClickHandler,
        attachClusterClickHandler,
        attachCursorHandlers,

        // Cleanup
        detachAllEventHandlers,

        // Popup content generators (for customization)
        generatePinPopupContent,
        generateRegionPopupContent,

        // State
        registeredHandlers
    };
}

// ES Module export
