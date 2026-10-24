import { nextTick, unref } from 'vue'

/**
 * Shared geocoder→map search logic (kind-switch + Mapbox filter builder + the
 * common legend-tab tail). One copy for all map plugin-designs AND the future
 * dashboard — the kind-switch / per-kind property map / filter-expression
 * builder live HERE and nowhere else.
 *
 * What lives here (was duplicated per profile):
 *  - the geocoder-clear guard (`_geoBeingCleared` + `clearGeocoderProgrammatic`)
 *  - the hitbox-filter mirror + the `legend:reveal-selected` emitter
 *  - the kind→pin-property map (`KIND_PROPERTY`)
 *  - the per-kind Mapbox filter-expression builder (`buildFilterExpr`)
 *  - the 6 byte-identical legend branches
 *    (family / language / dialect / affinity-bloc / cluster / people-group)
 *  - the `onClear` body
 *  - the rich "dim every other pin" people-group handler (the DEFAULT)
 *
 * What stays in the profile and is passed in:
 *  - `clearAllHighlights(m)` — canonical full reset (touches profile-only layers)
 *  - `legendRouters` — the genuinely divergent country / region / religion camera
 *    + outline logic (do NOT unify these; they differ per profile)
 *  - `clearCountryHighlight` — profile-local country-polygon reset
 *  - `peopleGroupResult` — optional override for lean consumers
 *
 * @param {Object}   opts
 * @param {Ref}      opts.map                   ref to the Mapbox map instance (reads .value)
 * @param {string}  [opts.filterLayerId]        pin layer to setFilter (default 'language-family-pins')
 * @param {Ref}      opts.geocoderRef           template ref of <GeocoderComponent> (for programmatic clear)
 * @param {Object}   opts.clustering            shared clustering wrapper — needs .setSelectionFilter()
 * @param {Object}   opts.mapStore              injected pinia store
 * @param {Object}  [opts.mapLayers]            useMapLayers instance (syncGlowFilter) — only the rich PG handler needs it
 * @param {Object}  [opts.uiStore]             injected ui store — only the rich PG handler needs it
 * @param {Object}  [opts.pplrInstance]         usePplrInstance() — drives legend-row highlight
 * @param {Function} opts.onSemanticTreeSelect  profile fn (row-click path reused by tree-kind picks)
 * @param {Function} opts.switchTab             profile fn (tab swap before tree-kind selection)
 * @param {Ref}      opts.activeTabId           profile ref (current outer tab id)
 * @param {Function} opts.clearAllHighlights    profile fn — canonical full reset, called by onClear
 * @param {Function}[opts.clearCountryHighlight] profile fn — country-polygon reset (no-op default)
 * @param {string}  [opts.mapId]                per-instance id for the legend:reveal-selected CustomEvent scope
 * @param {string[]}[opts.supportedKinds]       kinds this profile handles; when omitted, all handled kinds pass
 * @param {Object}  [opts.legendRouters]        { [kind]: (evt, ctx) => void } profile overrides for
 *                                              country/region/religion (and any custom kind). ctx carries
 *                                              { map, filterLayerId, clearGeocoder, emitLegendReveal, property, value }
 * @param {Function}[opts.peopleGroupResult]    override for the PG handler; default = rich-dim version
 * @param {Object}  [opts.busAdapter]           OPTIONAL swappable sink (the 2nd consumer type, e.g. the
 *                                              research dashboard's selectionBus). When present, the three
 *                                              handlers route through it and RETURN BEFORE any map op — the
 *                                              adapter needs NO map / clustering / pin layer. The kind-switch
 *                                              still runs HERE (resolveAggregate); the adapter only maps the
 *                                              already-RESOLVED kind to its own sink. Shape:
 *                                                { aggregate(r, evt), peopleGroup(feature), clear() }
 *                                              where r = { kind, value, property, expr }. When ABSENT the
 *                                              existing map path runs unchanged (byte-identical).
 *
 * @returns {{
 *   onPeopleGroupResult: (feature) => void,
 *   onAggregateResult:   (evt) => void,
 *   onClear:             () => void,
 *   clearGeocoderProgrammatic: () => void
 * }}
 */
export function useGeocoderSearch(opts) {
  const {
    map,
    geocoderRef,
    clustering,
    mapStore,
    uiStore,
    mapLayers,
    pplrInstance,
    onSemanticTreeSelect,
    switchTab,
    activeTabId,
    clearAllHighlights,
    clearCountryHighlight,
    mapId,
    supportedKinds,
    legendRouters = {},
    peopleGroupResult,
    busAdapter,
  } = opts

  const filterLayerId = opts.filterLayerId || 'language-family-pins'

  // ── Geocoder-clear guard ───────────────────────────────────────────────────
  // Prevents the feedback loop: legend-X → selectFamily(null) → watcher →
  // applyDimFilter(null) → clearGeocoderProgrammatic() → 'clear' event →
  // onClear → selectFamily(null) → watcher → ... (infinite).
  // _geoBeingCleared is set synchronously around every programmatic clear() call
  // so onClear can tell it apart from a real user-X click.
  let _geoBeingCleared = false
  function clearGeocoderProgrammatic() {
    _geoBeingCleared = true
    // geocoderRef.value.geocoder is the exposed ref<MapboxGeocoder>; .value is the instance.
    const inst = geocoderRef.value?.geocoder?.value
    inst?.clear?.()
    // Belt-and-suspenders: Mapbox geocoder's clear() sometimes leaves the
    // selected feature's text in the DOM input (especially after user picked
    // an aggregate result). Force-reset the input element directly so tab
    // switches don't carry over the prior tab's "Afro-Asiatic (219)" text.
    // Without this, search text persisted across tabs.
    const input = inst?._inputEl
      || inst?.container?.querySelector?.('input.mapboxgl-ctrl-geocoder--input')
    if (input) {
      input.value = ''
      try { input.dispatchEvent(new Event('input', { bubbles: true })) } catch (_) {}
    }
    _geoBeingCleared = false
  }

  // Mirror setFilter to the invisible hitbox layer so click targets stay in sync.
  function _syncHitboxFilter(m, filter) {
    const hitboxId = `${filterLayerId}-hitbox`
    if (m?.getLayer(hitboxId)) {
      try { m.setFilter(hitboxId, filter) } catch (_) {}
    }
  }

  // Tells the legend to collapse other expanded families and scroll the newly
  // selected row into view. Only fired on geocoder-driven selections so direct
  // legend-row clicks don't disturb the user's manual expansion state
  // (per qa-buildinng-round-1 R3 A5 — auto-collapse only on search reveal).
  function _emitLegendReveal() {
    if (typeof window === 'undefined') return
    if (typeof window.CustomEvent !== 'function') return
    window.dispatchEvent(new CustomEvent('legend:reveal-selected', { detail: { mapId } }))
  }

  // result.kind → the corresponding pin property to filter on.
  // 'language-family' uses the derived `languageFamily` pin prop; 'dialect'
  // exact-matches against `language` using originalLabels (e.g. "Arabic, Sudanese").
  const KIND_PROPERTY = {
    'country':         'countryName',
    'language-family': 'languageFamily',
    'language':        'language',
    'dialect':         'language',
    'religion':        'religionName',
    'region':          'doxaRegion',
    'affinity-bloc':   'affinityBlock',
    'cluster':         'cluster',
    'people-group':    'peopleGroup',
  }

  // Build a per-kind filter expression. 'language' (base-language) matches the
  // base exactly OR comma-prefix ("Arabic," → "Arabic, Sudanese") OR suffix-
  // contains (" Sign Language" → "Pakistan Sign Language"). 'dialect' hard-
  // matches against originalLabels — the raw API string on the pin.
  function buildFilterExpr(evt, property, value) {
    if (evt.kind === 'language') {
      return ['any',
        ['==', ['get', property], value],
        ['==', ['slice', ['get', property], 0, value.length + 1], value + ','],
        ['in', ' ' + value, ['get', property]]
      ]
    } else if (evt.kind === 'dialect') {
      const labels = Array.isArray(evt.originalLabels) ? evt.originalLabels : []
      if (labels.length === 1) {
        return ['==', ['get', property], labels[0]]
      } else if (labels.length > 1) {
        return ['in', ['get', property], ['literal', labels]]
      } else {
        return ['==', ['get', property], value]
      }
    } else if (evt.kind === 'affinity-bloc') {
      const code = evt.blocCode || evt.properties?.blocCode || ''
      return code
        ? ['==', ['get', 'affinityBlock'], code]
        : ['==', ['get', 'affinityBlockLabel'], value]
    } else if (evt.kind === 'cluster') {
      const code     = evt.clusterCode || evt.properties?.clusterCode || ''
      const blocCode = evt.blocCode    || evt.properties?.blocCode    || ''
      return code && blocCode
        ? ['all', ['==', ['get', 'affinityBlock'], blocCode], ['==', ['get', 'cluster'], code]]
        : ['==', ['get', 'clusterLabel'], value]
    } else {
      return ['==', ['get', property], value]
    }
  }

  // ── Shared kind resolution (the ONE place the kind-switch lives) ───────────
  // Resolve a geocoder aggregate event to { kind, value, property, expr } WITHOUT
  // touching the map. Both the map path (onAggregateResult below) AND any
  // busAdapter consumer (the dashboard search bars) call this, so the
  // kind→property map + filter-expression builder are never re-implemented
  // downstream — a busAdapter receives the RESOLVED result and only lands it in
  // its own sink. Returns null when the kind is out of scope or unmappable
  // (same early-out conditions the map path always used).
  function resolveAggregate(evt) {
    if (!evt) return null
    if (supportedKinds && !supportedKinds.includes(evt.kind)) return null
    const property = KIND_PROPERTY[evt.kind] || null
    const value = evt.label
    if (!property || value == null || value === '') return null
    return { kind: evt.kind, value, property, expr: buildFilterExpr(evt, property, value) }
  }

  // ── DEFAULT people-group handler (rich dim) ────────────────────────────────
  function richPeopleGroupResult(feature) {
    if (!feature) return
    // A people-group pick is "clicking elsewhere" relative to a prior country
    // highlight — drop it so it doesn't linger over the new selection.
    clearCountryHighlight?.()
    const m = unref(map)
    // Resolve the pin's promoted id the SAME way useMapLayers builds it
    // (`pg.id || pg.uniqueId` → properties.uniqueId).
    const uid = feature.properties?.id || feature.properties?.uniqueId || null

    // Open the people-group detail + float the GO highlight marker via the SAME
    // path a real pin click uses (useMapEvents → uiStore.selectPeopleGroup;
    // useSelectedPin watches uiStore.selectedPeopleGroup). Stamp the resolved
    // uniqueId onto the feature so the highlight layer's filter matches this pin.
    uiStore?.selectPeopleGroup?.({
      ...feature,
      properties: { ...feature.properties, uniqueId: uid }
    })

    // Dim every OTHER people-group pin and keep only the picked one at full
    // opacity — parity with a language search result (which hides non-matching
    // pins). Mirrors the bloc/cluster/pg dim path in onSemanticTreeSelect:
    // case-expression opacity + hitbox + glow sync.
    if (m && uid != null && m.getLayer(filterLayerId)) {
      const selFilter = ['==', ['get', 'uniqueId'], uid]
      // Drop any prior tab/legend setFilter so the case-expression governs all pins.
      try { m.setFilter(filterLayerId, null) } catch (_) {}
      // Mirror onto the invisible hitbox so dimmed (opacity-0) pins aren't tappable.
      _syncHitboxFilter(m, selFilter)
      m.setPaintProperty(filterLayerId, 'circle-opacity', ['case', selFilter, 1, 0])
      m.setPaintProperty(filterLayerId, 'circle-stroke-opacity', ['case', selFilter, 1, 0])
      if (m.getLayer(`${filterLayerId}-shadow`)) {
        m.setPaintProperty(`${filterLayerId}-shadow`, 'circle-opacity', ['case', selFilter, 1, 0])
      }
      mapLayers?.syncGlowFilter?.(selFilter)
    }
  }

  // ── Aggregate (country / language / religion / …) handler ──────────────────
  function onAggregateResult(evt) {
    // Bus-adapter path (2nd consumer type — e.g. the dashboard's selectionBus):
    // resolve the kind ONCE via the shared resolver and route to the sink,
    // returning BEFORE any map op. The adapter needs no map/clustering/pin layer.
    if (busAdapter) {
      const r = resolveAggregate(evt)
      if (!r) return
      busAdapter.aggregate(r, evt)
      return
    }

    const m = unref(map)
    if (!evt || !m || !m.getLayer(filterLayerId)) return
    // When a profile/facet scopes the kinds it accepts, ignore out-of-scope
    // kinds (cheap guard — no GeocoderComponent change). When omitted, any
    // handled kind passes through (research-map relies on this).
    if (supportedKinds && !supportedKinds.includes(evt.kind)) return

    // Any non-country aggregate pick drops a prior country highlight; a country
    // pick re-draws its own below. Keeps the highlight tied to the live selection.
    if (evt.kind !== 'country') clearCountryHighlight?.()

    // Same kind→property→filter resolution as before, now via the shared helper
    // (identical result; null on the same early-out conditions as the old inline code).
    const r = resolveAggregate(evt)
    if (!r) return
    const { property, value } = r

    try {
      m.setFilter(filterLayerId, r.expr)
    } catch (e) {
      // setFilter throws on style mid-load; swallow — clear-on-error is harmless.
    }

    // Scope MST clusters to the same slice so the cluster graph isn't re-built
    // across the full dataset on every aggregate pick.
    clustering.setSelectionFilter({ property, value })

    // Drive legend tab + store selection so legend row highlights correctly.
    // For family/language/dialect: legend row IS the active-filter indicator, so
    // we clear the geocoder text. For country/region/religion the geocoder text
    // stays visible as the indicator (QA R10 closeout) — handled by the routers.
    let handled = false
    if (evt.kind === 'language-family' || evt.kind === 'family') {
      mapStore.selectFamily(evt.label)
      mapStore.setActiveLegendTab('family')
      handled = true
    } else if (evt.kind === 'language') {
      mapStore.selectLanguage(evt.label)
      mapStore.setActiveLegendTab('language')
      handled = true
    } else if (evt.kind === 'dialect') {
      // Build a legend-matching dialect key: "familyKey__baseLang__dialect".
      // useEntitySearch threads familyDerived/baseLang/dialectLabel onto the Carmen
      // feature so we can construct the same key the legend's dialectRows compute.
      const labels = Array.isArray(evt.originalLabels) ? evt.originalLabels : []
      const family  = evt.familyDerived || ''
      const baseLang = evt.baseLang     || ''
      const dialect  = evt.dialectLabel || ''
      const dialectKey = `${family}__${baseLang}__${dialect}`
      mapStore.selectDialect?.({ key: dialectKey, originalLabels: labels })
      mapStore.setActiveLegendTab('dialect')
      handled = true
    } else if (evt.kind === 'affinity-bloc' || evt.kind === 'cluster' || evt.kind === 'people-group') {
      // Build a synthetic tree node matching the shape useAffinityBlockLegendData
      // produces, then route through onSemanticTreeSelect. That re-uses the
      // dim-on-select path (case-expression opacity) the legend uses, keeping
      // search-click and row-click visually identical.
      let node = null
      if (evt.kind === 'affinity-bloc') {
        const code = evt.blocCode || ''
        node = {
          id: `bloc:${code}`,
          label: evt.label,
          depth: 0,                                          // ← bloc tab
          filter: code ? ['==', ['get', 'affinityBlock'], code] : null,
        }
      } else if (evt.kind === 'cluster') {
        const blocCode = evt.blocCode    || ''
        const clCode   = evt.clusterCode || ''
        node = {
          id: `cluster:${blocCode}__${clCode}`,
          label: evt.label,
          depth: 1,                                          // ← cluster tab
          filter: clCode ? ['==', ['get', 'cluster'], clCode] : null,
        }
      } else if (evt.kind === 'people-group') {
        const blocCode    = evt.blocCode        || ''
        const clCode      = evt.clusterCode     || ''
        const pgCode      = evt.peopleGroupCode || ''
        node = {
          id: `pg:${blocCode}__${clCode}__${pgCode}`,
          label: evt.label,
          depth: 2,                                          // ← people-group tab
          filter: pgCode ? ['==', ['get', 'peopleGroup'], pgCode] : null,
        }
      }
      if (node && node.filter) {
        const applyAffinitySel = () => {
          // Drop the harsh setFilter applied earlier in this function — we want
          // dim, not hide. Then call the same handler the legend uses on row click.
          try { m.setFilter(filterLayerId, null) } catch (_) {}
          onSemanticTreeSelect(node)
          // Drive the legend's selection ref so the matching row visually highlights.
          if (pplrInstance && pplrInstance.selection) {
            pplrInstance.selection.value = node
          }
        }
        // feedback#9: a PG/bloc/cluster search-pick only mirrors in the legend when
        // the People Groups (affinity-blocks) lens is the active OUTER tab — on any
        // other tab legendNodes holds a different tree, so pplrInstance.selection
        // finds no matching row and nothing highlights. Switch to that tab first,
        // THEN drive the selection. switchTab swaps legendNodes, and the
        // SemanticTreeLegend's props.nodes watcher resets its selection to null on
        // the same flush — so defer the selection to nextTick to land it AFTER that
        // reset instead of being clobbered.
        if (activeTabId.value !== 'affinity-blocks') {
          switchTab('affinity-blocks')
          nextTick(applyAffinitySel)
        } else {
          applyAffinitySel()
        }
      }
      handled = true
    } else if (legendRouters[evt.kind]) {
      // Profile-specific divergent routers: country / region / religion (and any
      // custom kind). They own their camera/outline logic and close over their
      // own profile locals; the composable hands them the shared deps via ctx.
      legendRouters[evt.kind](evt, {
        map: m,
        filterLayerId,
        clearGeocoder: clearGeocoderProgrammatic,
        emitLegendReveal: _emitLegendReveal,
        property,
        value,
      })
      handled = true
    }

    if (handled) {
      clearGeocoderProgrammatic()
      _emitLegendReveal()
    }
    // For religion/region/country: the geocoder text remains the active-filter
    // indicator until the user clicks the geocoder X to clear.
  }

  // ── Clear (user clicks the geocoder X) ─────────────────────────────────────
  function onClear() {
    // Bus-adapter path: route to the sink and return BEFORE any map op (no map needed).
    if (busAdapter) { busAdapter.clear(); return }
    if (_geoBeingCleared) return  // programmatic clear, not a user-X click
    // Drop the country polygon highlight drawn by a country search pick.
    clearCountryHighlight?.()
    const m = unref(map)
    // A search pick can leave THREE kinds of state behind: the geocoder text
    // (Mapbox clears it on the X click), a legend-row/store selection, and a map
    // filter — which for a country/region pick is BOTH the pin-layer filter AND
    // the WAGF-region polygon highlight. All three must reset together.
    // clearAllHighlights() is the canonical full reset; it does NOT null
    // selectedRegion/selectedResource, so null them first.
    if (mapStore.selectedRegion)   mapStore.selectRegion?.(null)
    if (mapStore.selectedResource) mapStore.selectResource?.(null)
    if (m && m.getLayer(filterLayerId)) {
      clearAllHighlights(m)
    } else {
      // Map/layer not ready — still null store selections so the legend stays consistent.
      mapStore.selectFamily(null)
      mapStore.selectLanguage(null)
      mapStore.selectDialect?.(null)
      clustering.setSelectionFilter(null)
    }
  }

  return {
    // Bus-adapter path: a PG pick routes to the sink (no map dim). Otherwise the
    // existing map handler (override or the rich-dim default) runs unchanged.
    onPeopleGroupResult: busAdapter
      ? (feature) => busAdapter.peopleGroup(feature)
      : (peopleGroupResult || richPeopleGroupResult),
    onAggregateResult,
    onClear,
    clearGeocoderProgrammatic,
  }
}
