/**
 * DataSourceManager.js
 *
 * Loads people-group data from one of three source types declared in
 * api/sources.json:
 *   - csv      → fetch + parse a local CSV file
 *   - api      → fetch a single JSON URL
 *   - rest-api → fetch a versioned REST endpoint (pray-tools shape) with
 *                live query params, no-store cache, and cache-buster
 *
 * Normalizes raw rows to system field names so map/legend/detail components
 * stay source-agnostic. Keeps a per-source cache so tab switches don't
 * re-parse / re-fetch.
 *
 * sources.json is inlined via static import at build time — no runtime
 * fetch is needed for config (works inside an IIFE bundle that has no /src/).
 *
 * NOTE — framework version: this file is the template's lean port of the
 * production DataSourceManager from doxa-map-mfe. The doxa-map-mfe variant
 * additionally imports a vue-i18n locale module and ISO3/ROR lookup tables
 * for label decoding. The template intentionally omits both — apps that
 * need locale-aware labels can wrap this class or replace it.
 */

import sourcesConfig from './sources.json'
import { getApiBaseUrl } from './apiBaseUrl.js'
import { applyPeopleGroupList } from '../lists/peopleGroupList.js'

export class DataSourceManager {
    constructor(options = {}) {
        this.sourcesConfig = null;
        this.activeSource = null;
        this.rawData = [];
        this.normalizedData = [];
        this.dataByUniqueId = new Map();
        this.baseUrl = (typeof window !== 'undefined' && window.MAP_APP_BASE_URL) || './';

        // Active UI locale (e.g. 'fr'). When set, overrides a rest-api source's
        // static `queryParams.lang` so the API returns translated field values.
        // Unset → the source's own `lang` (sources.json defaults it to 'en').
        this.locale = options.locale || null;

        // The map's profile-config (object or ref), for its people-group LIST (library/lists/). Unset
        // still honours ?list= and window.MAP_LIST; the default list keeps every row, unfetched.
        this.profileConfig = options.profileConfig || null;

        // CACHE: Store normalized data per source to avoid re-parsing on tab switch
        this.cache = new Map();
        this.cacheEnabled = true;
        this.cacheTTL = 5 * 60 * 1000;
    }

    /**
     * Initialize — config is inlined at build time via static import.
     */
    async init() {
        this.sourcesConfig = sourcesConfig
        return this.sourcesConfig
    }

    getActiveSourceId() {
        return this.sourcesConfig?.activeSource || 'doxa-csv';
    }

    getSourceConfig(sourceId) {
        return this.sourcesConfig?.sources?.[sourceId];
    }

    /**
     * Set the active data source and load its data
     */
    async setActiveSource(sourceId) {
        const sourceConfig = this.getSourceConfig(sourceId);
        if (!sourceConfig) {
            throw new Error(`Source not found: ${sourceId}`);
        }

        this.activeSource = sourceConfig;

        // CHECK CACHE FIRST
        if (this.cacheEnabled && this.cache.has(sourceId)) {
            const cached = this.cache.get(sourceId);
            this.normalizedData = cached.normalizedData;
            this.dataByUniqueId = cached.dataByUniqueId;
            return this.normalizedData;
        }

        if (sourceConfig.type === 'csv') {
            await this.loadCSVData(sourceConfig);
        } else if (sourceConfig.type === 'api') {
            await this.loadAPIData(sourceConfig);
        } else if (sourceConfig.type === 'rest-api') {
            await this.loadRestApiData(sourceConfig);
        }

        if (this.cacheEnabled) {
            this.cache.set(sourceId, {
                normalizedData: this.normalizedData,
                dataByUniqueId: this.dataByUniqueId,
                timestamp: Date.now()
            });
        }

        return this.normalizedData;
    }

    clearCache(sourceId = null) {
        if (sourceId) {
            this.cache.delete(sourceId);
        } else {
            this.cache.clear();
        }
    }

    isCached(sourceId) {
        return this.cache.has(sourceId);
    }

    async loadActiveSource() {
        if (!this.sourcesConfig) {
            await this.init();
        }
        return this.setActiveSource(this.getActiveSourceId());
    }

    /**
     * Parse CSV text handling quoted (multi-line) fields.
     */
    parseCSV(csvText) {
        const results = [];
        const headers = [];
        let currentField = '';
        let inQuotes = false;
        let row = [];
        let isHeader = true;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(currentField.trim());
                currentField = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && nextChar === '\n') {
                    i++;
                }
                if (currentField || row.length > 0) {
                    row.push(currentField.trim());
                    currentField = '';

                    if (isHeader) {
                        headers.push(...row);
                        isHeader = false;
                    } else if (row.length > 1) {
                        const obj = {};
                        headers.forEach((header, index) => {
                            obj[header] = row[index] || '';
                        });
                        results.push(obj);
                    }
                    row = [];
                }
            } else {
                currentField += char;
            }
        }

        if (currentField || row.length > 0) {
            row.push(currentField.trim());
            if (!isHeader && row.length > 1) {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = row[index] || '';
                });
                results.push(obj);
            }
        }

        return { headers, data: results };
    }

    async loadCSVData(sourceConfig) {
        try {
            const response = await fetch(this.baseUrl + sourceConfig.path);
            const csvText = await response.text();
            const { headers, data } = this.parseCSV(csvText);
            this.rawData = data;
            this.validateFieldMappings(sourceConfig.fieldMappings, headers, sourceConfig.name);
            this.normalizeData(sourceConfig);
            return this.normalizedData;
        } catch (error) {
            console.error('Failed to load CSV data:', error);
            throw error;
        }
    }

    /**
     * Validate that all source field mappings exist in the CSV headers
     */
    validateFieldMappings(fieldMappings, headers, sourceName) {
        const headerSet = new Set(headers.map(h => h.trim()));
        const missingFields = [];
        for (const [systemField, sourceField] of Object.entries(fieldMappings || {})) {
            if (Array.isArray(sourceField)) {
                for (const field of sourceField) {
                    if (!headerSet.has(field)) {
                        missingFields.push({ systemField, sourceField: field, isComposite: true });
                    }
                }
            } else if (sourceField && !headerSet.has(sourceField)) {
                missingFields.push({ systemField, sourceField, isComposite: false });
            }
        }
        if (missingFields.length > 0) {
            console.warn(`[DataSourceManager] ${sourceName}: missing CSV columns:`, missingFields);
        }
    }

    /**
     * Load data from a generic JSON URL (sourceConfig.url).
     */
    async loadAPIData(sourceConfig) {
        try {
            const response = await fetch(sourceConfig.url || sourceConfig.endpoint);
            const data = await response.json();
            this.rawData = await applyPeopleGroupList(Array.isArray(data) ? data : (data.posts || data.data || data.peopleGroups || data.results || []), this.profileConfig);
            this.normalizeData(sourceConfig);
            return this.normalizedData;
        } catch (error) {
            console.error('Failed to load API data:', error);
            throw error;
        }
    }

    /**
     * Load data from a REST API source (type: 'rest-api').
     * Reads the runtime base URL via getApiBaseUrl(); appends defaultFields and
     * any static queryParams. The request URL is stable so the response is
     * cacheable by the browser and any CDN edge in front of the API. On
     * HTTP/content-type failure, throws a descriptive error so callers can
     * surface a usable banner.
     */
    async loadRestApiData(sourceConfig) {
        const baseUrl = getApiBaseUrl();
        const bulkEndpoint = sourceConfig.endpoints?.bulk || '/api/people-groups/list';
        const fields = sourceConfig.defaultFields?.join(',') || '';

        const queryParts = [];
        if (fields) queryParts.push(`fields=${fields}`);
        const extraParams = { ...(sourceConfig.queryParams || {}) };
        // Layer-1 i18n: the active UI locale wins over the source's frozen
        // `lang` so /fr/research etc. get translated API field values.
        if (this.locale) extraParams.lang = this.locale;
        for (const [k, v] of Object.entries(extraParams)) {
            queryParts.push(`${k}=${encodeURIComponent(v)}`);
        }
        const url = `${baseUrl}${bulkEndpoint}?${queryParts.join('&')}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error(
                    `API returned "${contentType}" instead of JSON. ` +
                    `Server at ${baseUrl} may be down or misconfigured.`
                );
            }
            const data = await response.json();
            this.rawData = await applyPeopleGroupList(Array.isArray(data) ? data : (data.posts || data.data || data.results || []), this.profileConfig);
            this.normalizeData(sourceConfig);
            return this.normalizedData;
        } catch (error) {
            console.error(`[rest-api] Failed to load from ${sourceConfig.id}:`, error);
            throw error;
        }
    }

    /**
     * Normalize raw data to use system field names declared in fieldMappings.
     * Handles composite keys (arrays), {value,label} objects (rest-api shape),
     * boolean coercion for engagement / adoption status, and image URL fallbacks.
     */
    normalizeData(sourceConfig) {
        const mappings = sourceConfig.fieldMappings || {};
        this.normalizedData = [];
        this.dataByUniqueId = new Map();

        for (const row of this.rawData) {
            const normalized = {};

            for (const [systemField, sourceField] of Object.entries(mappings)) {
                if (Array.isArray(sourceField)) {
                    const values = sourceField.map(f => this.getFieldValue(row, f));
                    normalized[systemField] = values.join('_');
                } else {
                    normalized[systemField] = this.getFieldValue(row, sourceField);
                }
            }

            normalized.latitude = parseFloat(normalized.latitude) || 0;
            normalized.longitude = parseFloat(normalized.longitude) || 0;
            if (normalized.latitude === 0 && normalized.longitude === 0) continue;

            normalized.populationNum = this.parsePopulation(normalized.population);
            normalized.imageUrl = this.getImageUrl(normalized, sourceConfig.imageConfig);

            // engagementStatus → boolean; preserve label if {value,label} object
            const es = normalized.engagementStatus;
            if (es != null) {
                if (typeof es === 'object' && 'value' in es) {
                    normalized.engagementStatusLabel = es.label || es.value;
                    normalized.engagementStatus = es.value === 'engaged';
                } else {
                    normalized.engagementStatus = es === true || es === 1 || es === '1' || es === 'true'
                        || (typeof es === 'number' && es > 0)
                        || (typeof es === 'string' && parseInt(es, 10) > 0);
                }
            }

            // adoptionStatus → boolean (count > 0 means adopted)
            const as = normalized.adoptionStatus;
            if (as != null) {
                normalized.adoptionStatus = as === true || as === 1 || as === '1' || as === 'true'
                    || (typeof as === 'object' && !!as?.value)
                    || (typeof as === 'number' && as > 0)
                    || (typeof as === 'string' && parseInt(as, 10) > 0);
            }

            // {value,label} → extract .value, preserve label as `${field}Label`
            // Plain strings → use as both value and label so popups always have a label to display
            const objectFields = ['doxaRegion', 'wagfRegion', 'wagfBlock', 'wagfMember', 'affinityBlock', 'cluster', 'peopleGroup', 'countryIso', 'religion', 'religionCode'];
            for (const field of objectFields) {
                const val = normalized[field];
                if (val != null && typeof val === 'object' && 'value' in val) {
                    normalized[field + 'Label'] = val.label || val.value;
                    normalized[field] = val.value;
                } else if (val != null && typeof val === 'string' && val !== '') {
                    // Plain string — use as label too (no slug/label distinction available)
                    if (!normalized[field + 'Label']) {
                        normalized[field + 'Label'] = val;
                    }
                }
            }

            // Best-effort countryName / religionName for display (no lookup tables in template)
            normalized.countryName = normalized.countryIsoLabel || normalized.country || normalized.countryIso || '';
            normalized.religionName = normalized.religionLabel || normalized.religion || '';

            normalized._raw = row;
            this.normalizedData.push(normalized);
            this.dataByUniqueId.set(normalized.uniqueId, normalized);
        }

        // FREE MEMORY after normalization
        this.rawData = null;
    }

    /**
     * Tolerant field lookup — direct, trimmed, then partial match.
     */
    getFieldValue(row, fieldName) {
        if (!fieldName) return '';
        if (row[fieldName] !== undefined) return row[fieldName];
        const trimmed = fieldName.trim();
        if (row[trimmed] !== undefined) return row[trimmed];
        for (const key of Object.keys(row)) {
            if (key.trim() === trimmed) return row[key];
            if (key.includes(trimmed) || trimmed.includes(key.trim())) return row[key];
        }
        return '';
    }

    parsePopulation(popValue) {
        if (!popValue) return 0;
        const cleaned = String(popValue).replace(/,/g, '').trim();
        const num = parseInt(cleaned, 10);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Generate image URL — direct field, then placeholder.
     */
    getImageUrl(normalized, imageConfig) {
        if (!imageConfig) return '';
        const placeholderUrl = imageConfig.placeholderUrl || '';
        const directUrl = normalized[imageConfig.useField];
        if (directUrl && String(directUrl).trim() && !String(directUrl).includes('NoImageAvailable')) {
            return directUrl;
        }
        return placeholderUrl;
    }

    getData() {
        return this.normalizedData;
    }

    getByUniqueId(uniqueId) {
        return this.dataByUniqueId.get(uniqueId);
    }

    getByCoordinates(lat, lng, tolerance = 0.0001) {
        return this.normalizedData.find(d =>
            Math.abs(d.latitude - lat) < tolerance &&
            Math.abs(d.longitude - lng) < tolerance
        );
    }

    getByPeopleGroupId(rop3) {
        return this.normalizedData.filter(d => d.peopleGroupId === rop3);
    }

    getLanguageFamilies() {
        const families = new Set();
        this.normalizedData.forEach(d => {
            if (d.languageFamily) families.add(d.languageFamily);
        });
        return Array.from(families).sort();
    }

    getDataByLanguageFamily() {
        const grouped = {};
        this.normalizedData.forEach(d => {
            const family = d.languageFamily || 'Unknown';
            if (!grouped[family]) grouped[family] = [];
            grouped[family].push(d);
        });
        return grouped;
    }

    getDataByRegion() {
        const grouped = {};
        this.normalizedData.forEach(d => {
            const region = d.doxaRegion || 'Unknown';
            if (!grouped[region]) grouped[region] = [];
            grouped[region].push(d);
        });
        return grouped;
    }

    getStats() {
        return {
            totalRecords: this.normalizedData.length,
            withPeopleId3: this.normalizedData.filter(d => d.peopleId3).length,
            withPhotos: this.normalizedData.filter(d => d.imageUrl && !String(d.imageUrl).includes('NoImageAvailable')).length,
            languageFamilies: this.getLanguageFamilies().length,
            countries: new Set(this.normalizedData.map(d => d.country)).size,
            regions: Object.keys(this.getDataByRegion()).length
        };
    }
}

// Singleton (legacy import shape — prefer `new DataSourceManager()` per <doxa-map>)
export const dataSourceManager = new DataSourceManager();
export default dataSourceManager;
