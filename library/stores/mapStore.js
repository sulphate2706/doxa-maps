/**
 * Map Store - Centralized state management for all map instances
 * 
 * Design Flaw Fixed: Round 5 Q1 - Pinia underutilized (state scattered in MapComponent)
 * Design Flaw Fixed: Round 5 Q2 - Severe prop-drilling (16 props + 10 events)
 * Design Flaw Fixed: Round 5 Q3 - Multiple sources of truth
 * Design Flaw Fixed: Round 5 Q4 - Cannot scale to 100 maps (isolated state)
 * 
 * Purpose:
 * - Registry of all active map instances
 * - Shared state (selections, filters, fly state)
 * - Eliminates prop-drilling between Layout → Map → Legend
 * - Enables multi-map coordination
 * - Provides single source of truth for map state
 * 
 * REFACTORED: Now uses NPM Pinia package instead of vendored libs
 */

// Import Pinia from NPM package
import { defineStore, acceptHMRUpdate } from 'pinia';

export const useMapStore = defineStore('map', {
    state: () => ({
        // ========================================
        // Map Instance Registry
        // ========================================
        /**
         * Registry of all active map instances
         * Key: mapId (string)
         * Value: { 
         *   instance: mapboxgl.Map, 
         *   config: object,
         *   isReady: boolean,
         *   zoom: number,
         *   center: [lng, lat]
         * }
         */
        maps: {},
        
        /**
         * Currently active/focused map ID
         * Used for keyboard shortcuts, global actions
         */
        activeMapId: null,

        // ========================================
        // Selection State (Shared across all maps)
        // ========================================
        /**
         * Currently selected DOXA region (null if none)
         * Example: { id: 'Africa', name: 'Africa', ... }
         */
        selectedRegion: null,
        
        /**
         * Currently selected language family (null if none)
         * Example: { id: 'indo-european', name: 'Indo-European', ... }
         */
        selectedFamily: null,
        
        /**
         * Currently selected affinity block (null if none)
         * Example: { code: 'A001', name: 'Arab World', ... }
         */
        selectedAffinityBlock: null,
        
        /**
         * Currently selected language (null if none) — drives Tab 2 of LegendFamilyTree
         * Example: 'Bengali'
         */
        selectedLanguage: null,

        /**
         * Currently selected dialect (null if none) — drives Tab 1/2/3 dialect row highlighting
         * Shape: { key: 'family__lang__dialect', originalLabels: ['Arabic, Sudanese'] }
         */
        selectedDialect: null,

        /**
         * Active legend tab — 'family' | 'language' | 'dialect'
         * Written by geocoder aggregate-result handler; read by LegendFamilyTree.
         */
        activeLegendTab: 'family',

        /**
         * Currently selected gospel resource filter (null if none)
         * Example: 'bible', 'jesusFilm', 'noResources'
         */
        selectedResource: null,

        /**
         * Selected people group (for detail view)
         * Example: { uniqueId: 'ROP3_ROG', name: 'Han Chinese', ... }
         */
        selectedPeopleGroup: null,

        /**
         * Selected pin IDs (for developer mode export)
         * Array of unique IDs for currently filtered/selected pins
         * Example: ['10001', '10002', '10003']
         */
        selectedPinIds: [],

        // ========================================
        // Global Filters (Apply to all maps)
        // ========================================
        // ========================================
        /**
         * Global filters that affect data visibility
         * Example: { status: ['Unreached'], population: { min: 1000 } }
         */
        globalFilters: {},
        
        /**
         * Search query (affects all maps)
         */
        searchQuery: '',

        // ========================================
        // Animation State (Auto-fly, Guided Tour)
        // ========================================
        /**
         * Auto-fly animation state
         */
        autoFly: {
            isActive: false,
            speed: 1.0,        // 0.5x - 2.0x
            interval: 5000,    // ms between transitions
            currentIndex: 0,   // Current item in rotation
            items: [],         // Array of regions/families to cycle through
            timerId: null      // setInterval ID for cleanup
        },

        /**
         * Guided tour state
         */
        guidedTour: {
            isActive: false,
            currentStep: 0,
            steps: []          // Array of tour steps
        },

        // ========================================
        // Clustering State
        // ========================================
        /**
         * Clustering enabled globally
         */
        showClusters: false,
        
        /**
         * Clustering mode: 'region', 'language-family', 'affinity-block', 'mst'
         */
        clusterMode: 'region',

        /**
         * ★ WHICH CLUSTERING ALGORITHM IS DRAWN — and NOT the same thing as `clusterMode` above,
         * which is a grouping AXIS ('region' | 'language-family' | …) and is read by nothing today.
         * The two names are one letter apart and mean different things, which is exactly why this
         * one needs saying out loud rather than being folded into its neighbour.
         *
         * 'off' | 'mapbox' (native circle clusters) | 'mst' | 'network'. useMapClustering reads it
         * (`mode` computed) and ResearchMapSideMenu writes it — but it was never declared HERE, so
         * the side menu's four-way picker wrote to a property no reactive system was watching and
         * choosing "Native" drew nothing. A control that does nothing is worse than an absent one:
         * it tells the reader the map cannot do what it can.
         *
         * 'off' IS the disabled state, so this single field answers both "is clustering on" and
         * "which one" — the legend's Clusters checkbox and this picker are two views of it rather
         * than two sources of truth that can disagree.
         */
        clusteringMode: 'off',

        /**
         * Opacity of individual pins while clustering is on (the side menu's dim slider).
         * Declared here for the same reason as the mode: the control wrote to a property that did
         * not exist, so dragging it changed a number nobody read.
         */
        clusterPinOpacity: 0.6,

        /**
         * Per-selection MST cluster filter (null when no filter active)
         * clusterFilterProperty: 'languageFamily' | 'doxaRegion' | 'language' | null
         */
        clusterFilterProperty: null,
        clusterFilterValue:    null,

        /**
         * Auto-fly speed label: 'slow' | 'normal' | 'fast'
         */
        flySpeed: 'normal',

        // ========================================
        // Fullscreen State
        // ========================================
        /**
         * Is any map in fullscreen mode?
         * Tracks which map is fullscreen (null if none)
         */
        fullscreenMapId: null,

        // ========================================
        // User Preferences (Persisted)
        // ========================================
        /**
         * User preferences loaded from LocalStorage
         */
        preferences: {
            theme: 'light',              // 'light' | 'dark'
            defaultMapStyle: 'streets',  // Mapbox style preference
            enableAnimations: true,
            autoSavePreferences: true
        }
    }),

    getters: {
        /**
         * Get a specific map instance by ID
         */
        getMapById: (state) => (mapId) => {
            return state.maps[mapId];
        },

        /**
         * Get the active map instance
         */
        activeMap: (state) => {
            if (!state.activeMapId) return null;
            return state.maps[state.activeMapId];
        },

        /**
         * Check if a map is registered
         */
        hasMap: (state) => (mapId) => {
            return (mapId in state.maps);
        },

        /**
         * Get all registered map IDs
         */
        allMapIds: (state) => {
            return Object.keys(state.maps);
        },

        /**
         * Check if any selection is active
         */
        hasSelection: (state) => {
            return !!(state.selectedRegion || state.selectedFamily || 
                     state.selectedAffinityBlock || state.selectedPeopleGroup);
        },

        /**
         * Check if auto-fly is active
         */
        isAutoFlying: (state) => {
            return state.autoFly.isActive;
        },

        /**
         * Check if guided tour is active
         */
        isGuidedTourActive: (state) => {
            return state.guidedTour.isActive;
        },

        /**
         * Check if a specific map is in fullscreen
         */
        isMapFullscreen: (state) => (mapId) => {
            return state.fullscreenMapId === mapId;
        }
    },

    actions: {
        // ========================================
        // Map Registration & Lifecycle
        // ========================================
        
        /**
         * Register a new map instance
         * @param {string} mapId - Unique map identifier
         * @param {object} instance - Mapbox map instance
         * @param {object} config - Map configuration (optional)
         */
        registerMap(mapId, instance, config = {}) {
            // Safely get zoom - from config, or from instance, or default
            let zoom = 1.5;
            if (config.zoom !== undefined) {
                zoom = config.zoom;
            } else if (instance && typeof instance.getZoom === 'function') {
                zoom = instance.getZoom();
            }
            
            // Safely get center - from config, or from instance, or default
            let center = [0, 0];
            if (config.center) {
                center = config.center;
            } else if (instance && typeof instance.getCenter === 'function') {
                const c = instance.getCenter();
                if (c) {
                    center = [c.lng, c.lat];
                }
            }
            
            this.maps[mapId] = {
                instance,
                config,
                isReady: false,
                zoom,
                center,
                registeredAt: Date.now()
            };

            // Set as active if first map
            if (!this.activeMapId) {
                this.activeMapId = mapId;
            }

        },

        /**
         * Mark a map as ready (loaded and initialized)
         * @param {string} mapId
         */
        setMapReady(mapId) {
            const map = this.maps[mapId];
            if (map) {
                map.isReady = true;
            }
        },

        /**
         * Update map state (zoom, center)
         * @param {string} mapId
         * @param {object} updates - { zoom?, center? }
         */
        updateMapState(mapId, updates) {
            const map = this.maps[mapId];
            if (map) {
                Object.assign(map, updates);
            }
        },

        /**
         * Unregister a map instance (cleanup)
         * @param {string} mapId
         */
        unregisterMap(mapId) {
            delete this.maps[mapId];
            
            // If active map was removed, switch to another
            if (this.activeMapId === mapId) {
                const remainingMaps = this.allMapIds;
                this.activeMapId = remainingMaps.length > 0 ? remainingMaps[0] : null;
            }

        },

        /**
         * Set the active map
         * @param {string} mapId
         */
        setActiveMap(mapId) {
            if (mapId in this.maps) {
                this.activeMapId = mapId;
            }
        },

        // ========================================
        // Selection Actions
        // ========================================

        /**
         * Select a DOXA region
         * @param {string|null} region - Region name string or null to clear
         */
        selectRegion(region) {
            // Clear other selections (exclusive selection model)
            this.selectedFamily = null;
            this.selectedAffinityBlock = null;
            this.selectedPeopleGroup = null;
            
            this.selectedRegion = region;
        },

        /**
         * Select a language family
         * @param {string|null} family - Family name string or null to clear
         */
        selectFamily(family) {
            // Clear other selections (legend levels are mutually exclusive — Bug 13)
            this.selectedRegion = null;
            this.selectedAffinityBlock = null;
            this.selectedPeopleGroup = null;
            this.selectedLanguage = null;
            this.selectedDialect = null;

            this.selectedFamily = family;
        },

        setActiveLegendTab(tab) {
            this.activeLegendTab = tab;
        },

        /**
         * Select a specific language (Tab 2 of LegendFamilyTree)
         * @param {string|null} language - Language label string or null to clear
         */
        selectLanguage(language) {
            // Clear other legend selections (mutually exclusive — Bug 13: clicking a
            // child language while a family is selected swaps the selection cleanly)
            this.selectedRegion = null;
            this.selectedAffinityBlock = null;
            this.selectedPeopleGroup = null;
            this.selectedFamily = null;
            this.selectedDialect = null;

            this.selectedLanguage = language;
        },

        /**
         * Select a dialect (Tab 1/2/3 dialect row)
         * @param {{ key: string, originalLabels: string[] }|null} dialect
         */
        selectDialect(dialect) {
            this.selectedRegion = null;
            this.selectedFamily = null;
            this.selectedLanguage = null;
            this.selectedAffinityBlock = null;
            this.selectedPeopleGroup = null;

            this.selectedDialect = dialect;
        },

        /**
         * Select an affinity block
         * @param {object|null} block - Block object or null to clear
         */
        selectAffinityBlock(block) {
            // Clear other selections
            this.selectedRegion = null;
            this.selectedFamily = null;
            this.selectedPeopleGroup = null;
            
            this.selectedAffinityBlock = block;
        },

        /**
         * Select a people group (detail view)
         * @param {object|null} group - People group object or null to clear
         */
        selectPeopleGroup(group) {
            this.selectedPeopleGroup = group;
        },
        
        /**
         * Select a gospel resource filter
         * @param {string|null} resourceKey - Resource key ('bible', 'jesusFilm', 'noResources') or null to clear
         */
        selectResource(resourceKey) {
            // Clear other selections
            this.selectedRegion = null;
            this.selectedFamily = null;
            this.selectedAffinityBlock = null;
            this.selectedPeopleGroup = null;
            
            // Toggle behavior: clicking same resource clears it
            if (this.selectedResource === resourceKey) {
                this.selectedResource = null;
            } else {
                this.selectedResource = resourceKey;
            }
        },

        /**
         * Clear all selections and reset map state
         * Call this when switching tabs to prevent cross-tab glitches
         */
        clearSelections() {
            this.selectedRegion = null;
            this.selectedFamily = null;
            this.selectedLanguage = null;
            this.selectedDialect = null;
            this.selectedAffinityBlock = null;
            this.selectedResource = null;
            this.selectedPeopleGroup = null;
            this.selectedPinIds = [];
            this.showClusters = false;
            this.clusterMode = 'region';
        },

        /**
         * Set selected pin IDs (Developer Mode export)
         * @param {Array<string>} ids - Array of unique IDs for selected pins
         */
        setSelectedPinIds(ids) {
            this.selectedPinIds = ids || [];
        },

        // ========================================
        // Filter Actions
        // ========================================

        /**
         * Set a global filter
         * @param {string} key - Filter key (e.g., 'status', 'population')
         * @param {any} value - Filter value
         */
        setFilter(key, value) {
            this.globalFilters[key] = value;
        },

        /**
         * Remove a global filter
         * @param {string} key
         */
        removeFilter(key) {
            delete this.globalFilters[key];
        },

        /**
         * Clear all filters
         */
        clearFilters() {
            this.globalFilters = {};
            this.searchQuery = '';
        },

        /**
         * Set search query
         * @param {string} query
         */
        setSearchQuery(query) {
            this.searchQuery = query;
        },

        // ========================================
        // Animation Actions (Auto-Fly)
        // ========================================

        /**
         * Start auto-fly animation
         * @param {array} items - Array of regions/families to cycle through
         * @param {number} speed - Speed multiplier (0.5 - 2.0)
         */
        startAutoFly(items, speed = 1.0) {
            // Stop existing auto-fly
            this.stopAutoFly();

            this.autoFly.isActive = true;
            this.autoFly.speed = speed;
            this.autoFly.items = items;
            this.autoFly.currentIndex = 0;

        },

        /**
         * Stop auto-fly animation
         */
        stopAutoFly() {
            if (this.autoFly.timerId) {
                clearInterval(this.autoFly.timerId);
                this.autoFly.timerId = null;
            }
            
            this.autoFly.isActive = false;
            this.autoFly.currentIndex = 0;
        },

        /**
         * Update auto-fly speed
         * @param {number} speed - Speed multiplier (0.5 - 2.0)
         */
        setAutoFlySpeed(speed) {
            this.autoFly.speed = Math.max(0.5, Math.min(2.0, speed));
        },

        /**
         * Advance to next auto-fly item
         */
        nextAutoFlyItem() {
            if (!this.autoFly.isActive || this.autoFly.items.length === 0) return;
            
            this.autoFly.currentIndex = (this.autoFly.currentIndex + 1) % this.autoFly.items.length;
            const currentItem = this.autoFly.items[this.autoFly.currentIndex];
            
            // Trigger selection based on item type
            if (currentItem.type === 'region') {
                this.selectRegion(currentItem);
            } else if (currentItem.type === 'family') {
                this.selectFamily(currentItem);
            }
        },

        // ========================================
        // Clustering Actions
        // ========================================

        /**
         * Toggle clustering on/off
         * @param {boolean|undefined} value - Optional explicit value, or toggle if undefined
         */
        toggleClusters(value) {
            if (typeof value === 'boolean') {
                this.showClusters = value;
            } else {
                this.showClusters = !this.showClusters;
            }
        },

        /**
         * Set clustering mode
         * @param {string} mode - 'region' | 'language-family' | 'affinity-block' | 'mst' | 'resource'
         */
        setClusterMode(mode) {
            const validModes = ['region', 'language-family', 'affinity-block', 'mst', 'resource'];
            if (validModes.includes(mode)) {
                this.clusterMode = mode;
            }
        },

        /**
         * Set the clustering ALGORITHM (see the clusteringMode note in state). useMapClustering
         * prefers this action over a direct assignment when it exists, so declaring it keeps the
         * composable and the store agreeing about who owns the transition.
         * @param {string} mode - 'off' | 'mapbox' | 'mst' | 'network'
         */
        setClusteringMode(mode) {
            if (['off', 'mapbox', 'mst', 'network'].includes(mode)) {
                this.clusteringMode = mode;
                this.showClusters = mode !== 'off';
            }
        },

        /**
         * Set per-selection MST cluster filter
         * @param {string|null} property - 'languageFamily' | 'doxaRegion' | 'language' | null
         * @param {*} value - filter value (string|null)
         */
        setClusterFilter(property, value) {
            this.clusterFilterProperty = property || null;
            this.clusterFilterValue = value || null;
        },

        /**
         * Clear the MST cluster filter
         */
        clearClusterFilter() {
            this.clusterFilterProperty = null;
            this.clusterFilterValue = null;
        },

        /**
         * Set fly speed label
         * @param {string} speed - 'slow' | 'normal' | 'fast'
         */
        setFlySpeed(speed) {
            const validSpeeds = ['slow', 'normal', 'fast'];
            if (validSpeeds.includes(speed)) {
                this.flySpeed = speed;
            }
        },

        // ========================================
        // Selection Aliases (legacy-friendly wrappers)
        // ========================================

        setSelectedFamily(family) { this.selectFamily(family); },
        clearSelectedFamily() { this.selectFamily(null); },
        setSelectedRegion(region) { this.selectRegion(region); },
        clearSelectedRegion() { this.selectRegion(null); },
        clearSelectedResource() { this.selectResource(null); },
        clearSelectedLanguage() { this.selectLanguage(null); },
        clearSelectedDialect() { this.selectDialect(null); },

        // ========================================
        // Fullscreen Actions
        // ========================================

        /**
         * Toggle fullscreen for a specific map
         * @param {string} mapId
         */
        toggleFullscreen(mapId) {
            if (this.fullscreenMapId === mapId) {
                // Exit fullscreen
                this.fullscreenMapId = null;
            } else {
                // Enter fullscreen
                this.fullscreenMapId = mapId;
            }
        },

        // ========================================
        // User Preferences
        // ========================================

        /**
         * Load user preferences from LocalStorage
         */
        loadPreferences() {
            try {
                const stored = localStorage.getItem('mapUserPreferences');
                if (stored) {
                    const prefs = JSON.parse(stored);
                    this.preferences = { ...this.preferences, ...prefs };
                }
            } catch (error) {
                console.error('[mapStore] Failed to load preferences:', error);
            }
        },

        /**
         * Save user preferences to LocalStorage
         */
        savePreferences() {
            try {
                localStorage.setItem('mapUserPreferences', JSON.stringify(this.preferences));
            } catch (error) {
                console.error('[mapStore] Failed to save preferences:', error);
            }
        },

        /**
         * Update a preference
         * @param {string} key
         * @param {any} value
         */
        setPreference(key, value) {
            this.preferences[key] = value;
            if (this.preferences.autoSavePreferences) {
                this.savePreferences();
            }
        }
    }
});

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useMapStore, import.meta.hot));
}
