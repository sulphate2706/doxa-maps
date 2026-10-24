/**
 * UI Store - Centralized UI state management
 * 
 * Design Flaw Fixed: Round 5 Q1 - UI state scattered in components (theme, activeTab in LayoutComponent)
 * Design Flaw Fixed: Round 5 Q3 - Multiple sources of truth (UI state in component data())
 * Design Flaw Fixed: Round 9 Q1 - No error notifications (console-only errors)
 * Design Flaw Fixed: Round 6 Q1 - No theme system (cannot swap light/dark easily)
 * 
 * Purpose:
 * - Centralized UI state (theme, sidebar, tabs, modals)
 * - Toast notifications (success, error, warning, info)
 * - Modal/dialog management
 * - Loading overlays and progress indicators
 * - Responsive breakpoint tracking
 * - Accessibility settings
 * 
 * REFACTORED: Now uses NPM Pinia package instead of vendored libs
 */

// Import Pinia from NPM package
import { defineStore, acceptHMRUpdate } from 'pinia';
// Feature flag (single source of truth). useMapTheme.js has NO imports of its own
// and receives uiStore as an argument, so importing the flag here is cycle-free.
import { THEME_TOGGLE } from '@map/composables/useMapTheme.js';

let _uiStoreInstanceCounter = 0;

export const useUIStore = defineStore('ui', {
    state: () => {
        const instanceId = ++_uiStoreInstanceCounter;
        return {
        // Diagnostic: unique ID per store instance
        _storeInstanceId: instanceId,

        // ========================================
        // Theme & Appearance
        // ========================================
        /**
         * Current theme mode
         * 'light' | 'dark' | 'auto' (follows system preference)
         */
        theme: 'light',

        /**
         * Color scheme variant
         * Used for white-labeling and customization
         */
        colorScheme: 'default', // 'default' | 'blue' | 'green' | 'purple' etc.

        /**
         * Reduced motion preference (accessibility)
         */
        reducedMotion: false,

        /**
         * High contrast mode (accessibility)
         */
        highContrast: false,

        // ========================================
        // Layout & Navigation
        // ========================================
        /**
         * Currently active tab/map
         */
        activeTab: 'doxa-regions', // Default from mapDefaults

        /**
         * Sidebar/legend collapsed state
         */
        sidebarCollapsed: false,

        /**
         * Mobile menu open state
         */
        mobileMenuOpen: false,

        // ========================================
        // Mobile UI (NEW - Mobile-Friendly Implementation)
        // ========================================
        /**
         * Mobile Legend Bottom Sheet State
         * - 'collapsed': ~70px height, caret pointing right →
         * - 'open': 30vh height, caret pointing down ↓
         * - 'fullyOpen': 90vh height, caret pointing down ↓
         */
        legendState: 'collapsed',

        /**
         * Custom legend height (used during dragging for smooth transitions)
         * Cleared when snapping to a state
         */
        _customLegendHeight: null,

        /**
         * Search Mode State
         * Controls hamburger icon (☰) vs cancel icon (✕)
         * true = search active (show ✕)
         * false = normal mode (show ☰)
         */
        searchMode: false,

        /**
         * Hamburger Menu State (75% width overlay)
         * true = menu open
         * false = menu closed
         */
        hamburgerMenuOpen: false,

        /**
         * Legend Mode (NEW - Prayer Progress Implementation)
         * Controls which legend content to display
         * 'prayer' = Prayer Progress legend (red/orange/green 3-tier)
         * 'detail' = People Group Detail mode (image + action buttons)
         */
        legendMode: 'prayer',

        /**
         * Prayer Filter State (NEW - Prayer Progress Implementation)
         * Controls map pin visibility filtering
         * null = show all pins
         * 'noPrayer' = show only groups without prayer
         * 'hasPrayer' = show only groups with partial prayer
         * 'fullPrayer' = show only groups with full prayer coverage
         */
        prayerFilter: null,

        /**
         * Engagement Filter State
         * null = show all | 'notEngaged' | 'hasEngagement'
         */
        engagementFilter: null,

        /**
         * Adoption Filter State
         * null = show all | 'notAdopted' | 'hasAdoption'
         */
        adoptionFilter: null,

        /**
         * Religion-family filter — null | family-letter ('C', 'M', 'H', 'B', 'E', 'J', 'S', 'N', 'O', 'U').
         * When set, the religion-tab pin layer dims pins whose religion code's
         * first letter doesn't match.
         */
        religionFilter: null,

        /**
         * Selected People Group (NEW - People Group Detail Implementation)
         * When user clicks a pin, this stores the full people group data
         * Used to display detail view with image and action buttons
         */
        selectedPeopleGroup: null,

        /**
         * Current viewport breakpoint
         * Updated via resize observer
         */
        breakpoint: 'desktop', // 'mobile' | 'tablet' | 'desktop' | 'wide'

        /**
         * Window dimensions
         */
        windowSize: {
            width: window.innerWidth,
            height: window.innerHeight
        },

        // ========================================
        // Notifications (Toast System)
        // ========================================
        /**
         * Array of active toast notifications
         * Auto-removed after timeout
         */
        toasts: [],

        /**
         * Next toast ID (auto-increment)
         */
        nextToastId: 1,

        /**
         * Default toast duration (ms)
         */
        toastDuration: 5000,

        // ========================================
        // Modals & Dialogs
        // ========================================
        /**
         * Currently open modals
         * Stack-based (multiple modals supported)
         */
        openModals: [],

        /**
         * Modal data/props
         * Key: modalId, Value: modal data
         */
        modalData: new Map(),

        // ========================================
        // Loading States
        // ========================================
        /**
         * Global loading overlay
         * Shows full-screen spinner
         */
        isGlobalLoading: false,

        /**
         * Global loading message
         */
        globalLoadingMessage: 'Loading...',

        /**
         * Loading states by key
         * For granular loading indicators
         */
        loadingStates: new Map(),

        // ========================================
        // User Interactions
        // ========================================
        /**
         * Recently clicked items (for undo/redo)
         */
        interactionHistory: [],

        /**
         * Max history length
         */
        maxHistoryLength: 20,

        /**
         * Keyboard shortcuts enabled
         */
        keyboardShortcutsEnabled: true,

        // ========================================
        // Accessibility
        // ========================================
        /**
         * Screen reader announcements
         */
        screenReaderAnnouncement: '',

        /**
         * Focus trap active (for modals)
         */
        focusTrapActive: false,

        // ========================================
        // Developer Tools
        // ========================================
        /**
         * Debug mode enabled
         */
        debugMode: false,

        /**
         * Show performance overlay
         */
        showPerformanceOverlay: false
    }; },

    getters: {
        /**
         * Check if dark theme is active
         */
        isDarkTheme: (state) => {
            // FEATURE FLAG: THEME_TOGGLE off (see library/composables/useMapTheme.js)
            // forces the UI CHROME (controls, legend, search, drawer) to LIGHT.
            // The BASEMAP is pinned separately to the dark/colourful look in
            // useMapTheme.applyTheme(), so the map keeps its colour strategy while
            // everything around it is light. Restore user-switchable theming by
            // setting THEME_TOGGLE = true.
            if (!THEME_TOGGLE) return false;
            if (state.theme === 'auto') {
                return window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            return state.theme === 'dark';
        },

        /**
         * Check if mobile viewport
         */
        isMobile: (state) => {
            return state.breakpoint === 'mobile';
        },

        /**
         * Check if tablet viewport
         */
        isTablet: (state) => {
            return state.breakpoint === 'tablet';
        },

        /**
         * Check if desktop or wider
         */
        isDesktop: (state) => {
            return state.breakpoint === 'desktop' || state.breakpoint === 'wide';
        },

        // ========================================
        // Mobile Legend Getters
        // ========================================

        /**
         * Legend height based on state (CSS value)
         */
        legendHeight: (state) => {
            // Use custom height if set (during dragging)
            if (state._customLegendHeight) {
                return state._customLegendHeight
            }
            
            // Default heights based on state
            if (state.legendState === 'collapsed') return '48px'
            if (state.legendState === 'open') return '30%'
            if (state.legendState === 'fullyOpen') return 'calc(100% - 80px)' // 80px reserves top room: search bar (10+36) + gap (34)
            return '48px'
        },

        /**
         * Caret rotation degrees
         * collapsed: 0deg (→ right)
         * open/fullyOpen: 90deg (↓ down)
         */
        caretRotation: (state) => {
            return state.legendState === 'collapsed' ? 0 : 90
        },

        /**
         * Check if pull tab should be visible
         * Only visible in 'open' (30%) and 'fullyOpen' (90%) states
         */
        showPullTab: (state) => {
            return state.legendState === 'open' || state.legendState === 'fullyOpen'
        },

        /**
         * Get toasts by type
         */
        getToastsByType: (state) => (type) => {
            return state.toasts.filter(toast => toast.type === type);
        },

        /**
         * Check if any modal is open
         */
        hasOpenModal: (state) => {
            return state.openModals.length > 0;
        },

        /**
         * Get top modal (most recent)
         */
        topModal: (state) => {
            if (state.openModals.length === 0) return null;
            return state.openModals[state.openModals.length - 1];
        },

        /**
         * Check if specific modal is open
         */
        isModalOpen: (state) => (modalId) => {
            return state.openModals.includes(modalId);
        },

        /**
         * Check if any loading state is active
         */
        isAnyLoading: (state) => {
            return state.isGlobalLoading || state.loadingStates.size > 0;
        },

        /**
         * Get loading state by key
         */
        isLoading: (state) => (key) => {
            return state.loadingStates.get(key) || false;
        }
    },

    actions: {
        // ========================================
        // Theme Actions
        // ========================================

        /**
         * Set theme mode
         * @param {string} theme - 'light' | 'dark' | 'auto'
         */
        setTheme(theme) {
            const validThemes = ['light', 'dark', 'auto'];
            if (!validThemes.includes(theme)) {
                return;
            }
            // FEATURE FLAG: with THEME_TOGGLE off there is exactly ONE theme — light.
            // Coerce here (the single funnel every caller goes through: ProfileLoader's
            // pre-render restore, init()'s localStorage load, and toggleTheme) so a
            // stale persisted 'dark' can never resurrect dark chrome.
            if (!THEME_TOGGLE) theme = 'light';

            this.theme = theme;
            
            // Apply to DOM. NOTE: with THEME_TOGGLE off, isDarkTheme is always false,
            // so data-theme is pinned to 'light' — the UI chrome stays light no matter
            // what is persisted in localStorage from a previous session.
            const isDark = this.isDarkTheme;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
            
            // Save to localStorage (sandboxed iframe throws — persistence is best-effort)
            try { localStorage.setItem('theme', theme); } catch (e) { /* sandboxed: no persistence */ }
            
        },

        /**
         * Toggle between light and dark theme
         */
        toggleTheme() {
            const newTheme = this.theme === 'light' ? 'dark' : 'light';
            this.setTheme(newTheme);
        },

        /**
         * Set color scheme variant
         */
        setColorScheme(scheme) {
            this.colorScheme = scheme;
            document.documentElement.setAttribute('data-color-scheme', scheme);
        },

        /**
         * Toggle reduced motion
         */
        toggleReducedMotion() {
            this.reducedMotion = !this.reducedMotion;
            document.documentElement.setAttribute('data-reduced-motion', this.reducedMotion);
        },

        /**
         * Toggle high contrast mode
         */
        toggleHighContrast() {
            this.highContrast = !this.highContrast;
            document.documentElement.setAttribute('data-high-contrast', this.highContrast);
        },

        // ========================================
        // Navigation Actions
        // ========================================

        /**
         * Set active tab/map
         * @param {string} tabId - Tab identifier
         */
        setActiveTab(tabId) {
            this.activeTab = tabId;
            
            // Add to history
            this.addToHistory({ type: 'tab-change', tabId, timestamp: Date.now() });
        },

        /**
         * Toggle sidebar collapsed state
         */
        toggleSidebar() {
            this.sidebarCollapsed = !this.sidebarCollapsed;
        },

        /**
         * Open mobile menu
         */
        openMobileMenu() {
            this.mobileMenuOpen = true;
        },

        /**
         * Close mobile menu
         */
        closeMobileMenu() {
            this.mobileMenuOpen = false;
        },

        // ========================================
        // Mobile UI Actions (NEW - Mobile-Friendly Implementation)
        // ========================================

        /**
         * Set legend mode (prayer progress vs people group detail)
         * @param {string} mode - 'prayer' | 'detail'
         */
        setLegendMode(mode) {
            const validModes = ['prayer', 'detail'];
            if (!validModes.includes(mode)) {
                return;
            }
            this.legendMode = mode;
        },

        /**
         * Set prayer filter (for pin visibility)
         * @param {string|null} filter - null | 'noPrayer' | 'hasPrayer' | 'fullPrayer'
         */
        setPrayerFilter(filter) {
            const validFilters = [null, 'noPrayer', 'hasPrayer', 'fullPrayer'];
            if (!validFilters.includes(filter)) {
                return;
            }
            this.prayerFilter = filter;
        },

        /**
         * Set engagement filter (for pin visibility)
         * @param {string|null} filter - null | 'notEngaged' | 'hasEngagement'
         */
        setEngagementFilter(filter) {
            const validFilters = [null, 'notEngaged', 'hasEngagement'];
            if (!validFilters.includes(filter)) {
                return;
            }
            this.engagementFilter = filter;
        },

        /**
         * Set adoption filter (for pin visibility)
         * @param {string|null} filter - null | 'notAdopted' | 'hasAdoption'
         */
        setAdoptionFilter(filter) {
            const validFilters = [null, 'notAdopted', 'hasAdoption'];
            if (!validFilters.includes(filter)) {
                return;
            }
            this.adoptionFilter = filter;
        },

        /**
         * Set religion-family filter (for pin dim).
         * @param {string|null} filter - null | family letter ('C', 'M', 'H', 'B', 'E', 'J', 'S', 'N', 'O', 'U')
         */
        setReligionFilter(filter) {
            const valid = [null, 'C', 'M', 'H', 'B', 'E', 'J', 'S', 'N', 'O', 'U'];
            if (!valid.includes(filter)) return;
            this.religionFilter = filter;
        },

        /**
         * Select a people group (for detail view)
         * @param {object|null} peopleGroup - People group data object or null
         */
        selectPeopleGroup(peopleGroup) {
            // ★ SAVE ONLY ON ENTERING DETAIL, AND ONLY ONCE. This used to save on every call with a
            // group, so a SECOND call while a detail was already open stored the 'open' this method
            // had just forced, over the 'collapsed' it saved on entry — and the later clear restored
            // 'open'. A reader who collapsed the legend, opened a detail and closed it got the
            // legend back open, having never asked for it.
            //
            // ⚠ ONE PICK IS NOT ONE CALL — MEASURED, NOT ASSUMED. The pin click handler is
            // registered per map layer, and every visible pin has an invisible hitbox twin at the
            // same point (same source, larger radius, added alongside it) so that taps are easier
            // to land. A layer-scoped click fires once per layer with a feature under the point,
            // so EVERY pin click calls this exactly twice, 3ms apart — measured on the leaf at
            // 1440 on 2026-09-29, on two different pins. One pick was therefore already enough to
            // corrupt the saved state; it never needed two.
            //
            // Guarding on `entering` rather than on call count is what makes that harmless: this
            // stays idempotent for as long as one detail is open, whatever the caller count. The
            // duplicate binding is a real defect and is being fixed separately, but this method
            // should not have depended on being called once in the first place.
            const entering = peopleGroup && !this.selectedPeopleGroup;
            this.selectedPeopleGroup = peopleGroup;

            if (peopleGroup) {
                if (entering) this._legendStateBeforeDetail = this.legendState;
                this.legendState = 'open';
                this._customLegendHeight = null;
                this.setLegendMode('detail');
            } else {
                // Restore only what was actually saved, then forget it: a stale value left here
                // would be applied to a later detail that never recorded one.
                if (this._legendStateBeforeDetail) this.legendState = this._legendStateBeforeDetail;
                this._legendStateBeforeDetail = null;
                this._customLegendHeight = null;
                this.setLegendMode('prayer');
            }
        },

        /**
         * Set legend state (collapsed/open/fullyOpen)
         * @param {string} state - 'collapsed' | 'open' | 'fullyOpen'
         */
        setLegendState(state) {
            const validStates = ['collapsed', 'open', 'fullyOpen'];
            if (!validStates.includes(state)) {
                return;
            }
            this.legendState = state;
        },

        /**
         * Toggle search mode (controls hamburger vs cancel icon)
         */
        toggleSearchMode() {
            this.searchMode = !this.searchMode;
        },

        /**
         * Set search mode explicitly
         * @param {boolean} enabled - true = search active, false = normal
         */
        setSearchMode(enabled) {
            this.searchMode = enabled;
        },

        /**
         * Toggle hamburger menu
         */
        toggleHamburgerMenu() {
            this.hamburgerMenuOpen = !this.hamburgerMenuOpen;
        },

        /**
         * Update viewport breakpoint
         * Called by resize observer
         * @param {number} width - Window width
         */
        updateBreakpoint(width) {
            let newBreakpoint;
            if (width < 768) {
                newBreakpoint = 'mobile';
            } else if (width < 1024) {
                newBreakpoint = 'tablet';
            } else if (width < 1920) {
                newBreakpoint = 'desktop';
            } else {
                newBreakpoint = 'wide';
            }

            if (newBreakpoint !== this.breakpoint) {
                this.breakpoint = newBreakpoint;
            }
        },

        /**
         * Update window size
         * Called by resize observer
         */
        updateWindowSize(width, height) {
            this.windowSize.width = width;
            this.windowSize.height = height;
            this.updateBreakpoint(width);
        },

        // ========================================
        // Toast Notification Actions
        // ========================================

        /**
         * Show a toast notification
         * @param {object} options - { message, type, duration, action }
         * @returns {number} Toast ID
         */
        showToast(options) {
            const {
                message,
                type = 'info', // 'success' | 'error' | 'warning' | 'info'
                duration = this.toastDuration,
                action = null, // { label, callback }
                persistent = false
            } = options;

            const toast = {
                id: this.nextToastId++,
                message,
                type,
                duration,
                action,
                persistent,
                createdAt: Date.now()
            };

            this.toasts.push(toast);

            // Auto-remove after duration (unless persistent)
            if (!persistent && duration > 0) {
                setTimeout(() => {
                    this.removeToast(toast.id);
                }, duration);
            }

            return toast.id;
        },

        /**
         * Convenience methods for common toast types
         */
        showSuccess(message, options = {}) {
            return this.showToast({ message, type: 'success', ...options });
        },

        showError(message, options = {}) {
            return this.showToast({ message, type: 'error', duration: 7000, ...options });
        },

        showWarning(message, options = {}) {
            return this.showToast({ message, type: 'warning', ...options });
        },

        showInfo(message, options = {}) {
            return this.showToast({ message, type: 'info', ...options });
        },

        /**
         * Remove a toast by ID
         */
        removeToast(toastId) {
            const index = this.toasts.findIndex(t => t.id === toastId);
            if (index !== -1) {
                this.toasts.splice(index, 1);
            }
        },

        /**
         * Clear all toasts
         */
        clearAllToasts() {
            this.toasts = [];
        },

        // ========================================
        // Modal Actions
        // ========================================

        /**
         * Open a modal
         * @param {string} modalId - Unique modal identifier
         * @param {object} data - Modal data/props
         */
        openModal(modalId, data = {}) {
            if (!this.openModals.includes(modalId)) {
                this.openModals.push(modalId);
                this.modalData.set(modalId, data);
                this.focusTrapActive = true;
            }
        },

        /**
         * Close a modal
         * @param {string} modalId - Modal identifier to close (optional - closes top if not specified)
         */
        closeModal(modalId = null) {
            if (modalId) {
                // Close specific modal
                const index = this.openModals.indexOf(modalId);
                if (index !== -1) {
                    this.openModals.splice(index, 1);
                    this.modalData.delete(modalId);
                }
            } else {
                // Close top modal
                const topModalId = this.openModals.pop();
                if (topModalId) {
                    this.modalData.delete(topModalId);
                }
            }

            // Disable focus trap if no modals open
            if (this.openModals.length === 0) {
                this.focusTrapActive = false;
            }

        },

        /**
         * Close all modals
         */
        closeAllModals() {
            this.openModals = [];
            this.modalData.clear();
            this.focusTrapActive = false;
        },

        /**
         * Get modal data
         */
        getModalData(modalId) {
            return this.modalData.get(modalId);
        },

        // ========================================
        // Loading State Actions
        // ========================================

        /**
         * Show global loading overlay
         */
        showGlobalLoading(message = 'Loading...') {
            this.isGlobalLoading = true;
            this.globalLoadingMessage = message;
        },

        /**
         * Hide global loading overlay
         */
        hideGlobalLoading() {
            this.isGlobalLoading = false;
        },

        /**
         * Set loading state by key
         */
        setLoading(key, isLoading = true) {
            if (isLoading) {
                this.loadingStates.set(key, true);
            } else {
                this.loadingStates.delete(key);
            }
        },

        // ========================================
        // History Actions
        // ========================================

        /**
         * Add item to interaction history
         * @private
         */
        addToHistory(item) {
            this.interactionHistory.push(item);
            
            // Trim history if too long
            if (this.interactionHistory.length > this.maxHistoryLength) {
                this.interactionHistory.shift();
            }
        },

        /**
         * Clear interaction history
         */
        clearHistory() {
            this.interactionHistory = [];
        },

        // ========================================
        // Accessibility Actions
        // ========================================

        /**
         * Announce message to screen readers
         */
        announce(message, priority = 'polite') {
            this.screenReaderAnnouncement = message;
            
            // Clear after delay to allow re-announcement
            setTimeout(() => {
                if (this.screenReaderAnnouncement === message) {
                    this.screenReaderAnnouncement = '';
                }
            }, 1000);
        },

        /**
         * Toggle keyboard shortcuts
         */
        toggleKeyboardShortcuts() {
            this.keyboardShortcutsEnabled = !this.keyboardShortcutsEnabled;
        },

        // ========================================
        // Developer Tools
        // ========================================

        /**
         * Toggle debug mode
         */
        toggleDebugMode() {
            this.debugMode = !this.debugMode;
        },

        /**
         * Toggle performance overlay
         */
        togglePerformanceOverlay() {
            this.showPerformanceOverlay = !this.showPerformanceOverlay;
        },

        // ========================================
        // Mobile Legend Actions (NEW)
        // ========================================

        /**
         * Toggle legend — tri-state cascade so fullscreen doesn't slam all
         * the way closed on one caret tap (feedback 2026-04-20).
         *
         *   fullyOpen (90%) → open (30%)     ← keeps user's view of the map
         *   open (30%)      → collapsed      ← next tap closes
         *   collapsed       → open (30%)     ← re-open
         */
        toggleLegend() {
            if (this.legendState === 'fullyOpen') {
                this.legendState = 'open'
            } else if (this.legendState === 'open') {
                this.legendState = 'collapsed'
            } else {
                this.legendState = 'open'
            }
            this._customLegendHeight = null
        },

        /**
         * Open legend to 30% (from collapsed)
         */
        openLegend() {
            this.legendState = 'open'
            this._customLegendHeight = null // Clear custom height
        },

        /**
         * Fully open legend to 90%
         */
        fullyOpenLegend() {
            this.legendState = 'fullyOpen'
            this._customLegendHeight = null // Clear custom height
        },

        /**
         * Collapse legend completely
         */
        collapseLegend() {
            this.legendState = 'collapsed'
            this._customLegendHeight = null // Clear custom height
        },

        /**
         * Set legend height dynamically (for smooth dragging)
         * @param {string} height - CSS height value (e.g., '400px')
         */
        setLegendHeight(height) {
            // Store the custom height temporarily
            this._customLegendHeight = height
        },

        /**
         * Handle legend item click behavior
         * - If at 90%: collapse to 30%
         * - If at 30%: stay at 30%
         * - If collapsed: stay collapsed
         */
        handleLegendItemClick() {
            if (this.legendState === 'fullyOpen') {
                this.legendState = 'open' // 90% → 30%
            }
            // Else: do nothing (stay at current state)
        },

        /**
         * Enable search mode (show ✕ icon)
         */
        enableSearchMode() {
            this.searchMode = true
        },

        /**
         * Disable search mode (show ☰ icon)
         */
        disableSearchMode() {
            this.searchMode = false
        },

        /**
         * Toggle hamburger menu (75% overlay)
         */
        toggleHamburgerMenu() {
            this.hamburgerMenuOpen = !this.hamburgerMenuOpen
        },

        /**
         * Open hamburger menu
         */
        openHamburgerMenu() {
            this.hamburgerMenuOpen = true
        },

        /**
         * Close hamburger menu
         */
        closeHamburgerMenu() {
            this.hamburgerMenuOpen = false
        },

        // ========================================
        // Initialization
        // ========================================

        /**
         * Initialize UI store
         * Load saved preferences, set up listeners
         */
        init() {
            // Load theme from localStorage (sandboxed iframe throws — skip if unavailable)
            let savedTheme = null;
            try { savedTheme = localStorage.getItem('theme'); } catch (e) { /* sandboxed */ }
            if (savedTheme) {
                this.setTheme(savedTheme);
            }

            // Set up window resize listener
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    this.updateWindowSize(entry.contentRect.width, entry.contentRect.height);
                }
            });
            resizeObserver.observe(document.documentElement);

            // Listen for system theme changes
            if (window.matchMedia) {
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                    if (this.theme === 'auto') {
                        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                    }
                });

                // Listen for reduced motion preference
                window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
                    this.reducedMotion = e.matches;
                    document.documentElement.setAttribute('data-reduced-motion', e.matches);
                });
            }

        }
    }
});

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useUIStore, import.meta.hot));
}
