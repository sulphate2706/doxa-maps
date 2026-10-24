/**
 * dataStore.js — Centralized data cache
 *
 * All data fetching goes through here — no direct fetch() inside components.
 * markRaw() is REQUIRED on all large datasets to prevent Vue proxy wrapping.
 */

import { defineStore, acceptHMRUpdate } from 'pinia'
import { markRaw } from 'vue'

export const useDataStore = defineStore('data', {
  state: () => ({
    /**
     * Cached data per source.
     * Key: sourceId (string)
     * Value: { features, rawData, timestamp }
     */
    sources: {},

    /**
     * Loading state per source.
     * Key: sourceId
     * Value: { isLoading, error }
     */
    loadingStates: {}
  }),

  actions: {
    /**
     * Load data for a sourceId.
     * fetchFn: async () => data — caller provides the fetch logic.
     * Data is marked raw to avoid Vue proxy overhead on large arrays.
     */
    async load(sourceId, fetchFn) {
      if (this.sources[sourceId]) return  // already cached

      this.loadingStates[sourceId] = { isLoading: true, error: null }

      try {
        const data = await fetchFn()
        // markRaw: large datasets (GeoJSON features, CSV rows) must NOT be reactive
        this.sources[sourceId] = markRaw({
          features: data,
          timestamp: Date.now()
        })
        this.loadingStates[sourceId] = { isLoading: false, error: null }
      } catch (err) {
        console.error(`[dataStore] Failed to load source "${sourceId}":`, err)
        this.loadingStates[sourceId] = { isLoading: false, error: err }
      }
    },

    clearSource(sourceId) {
      delete this.sources[sourceId]
      delete this.loadingStates[sourceId]
    },

    /**
     * Cache normalized source data — called by useMapData after DataSourceManager loads.
     * Stores under sources[sourceId].features so LegendPrayerProgress.localScan() can read it.
     */
    cacheSourceData(sourceId, payload) {
      this.sources[sourceId] = markRaw({
        features: payload.normalizedData || [],
        timestamp: payload.timestamp || Date.now()
      })
    },

    /**
     * Check if a source is already cached.
     */
    hasSourceData(sourceId) {
      return !!this.sources[sourceId]
    },

    /**
     * Get cached source data (returns the stored payload object).
     */
    getSourceData(sourceId) {
      return this.sources[sourceId]
        ? { normalizedData: this.sources[sourceId].features }
        : null
    }
  },

  getters: {
    getData:    (state) => (sourceId) => state.sources[sourceId]?.features ?? null,
    isLoading:  (state) => (sourceId) => state.loadingStates[sourceId]?.isLoading ?? false,
    getError:   (state) => (sourceId) => state.loadingStates[sourceId]?.error ?? null
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDataStore, import.meta.hot))
}
