<template>
  <div class="people-group-detail" :class="{ 'dark-mode': dark }">
    <!-- Header with Avatar, Name, and X Button (hidden when parent handles the header)    const baseUrl = import.meta.env?.VITE_API_BASE_URL || '';-->
    <div v-if="!hideHeader" class="detail-header">
      <div class="header-left">
        <div class="avatar" :style="avatarStyle">
          {{ avatarLetter }}
        </div>
        <div class="header-text">
          <h3 class="people-group-name">{{ peopleGroup.properties.name }}</h3>
          <p class="people-group-subtitle">{{ subtitle }}</p>
        </div>
      </div>
      <button class="close-button" @click="handleClose" :aria-label="t('aria.closeDetailView')">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- Content Section (visible at 40% and 90%) -->
    <div class="detail-content">
      <!-- Name lead — when parent hides its own header (LegendDesktop /
           LegendMobile removed their legend-header bars), the people group
           name still needs a place to live. Show it above the CTA buttons. -->
      <h3 v-if="hideHeader" class="pg-name-lead">
        {{ peopleGroup.properties.name || t('legend.header.peopleGroupFallback') }}
      </h3>

      <!-- Action Buttons FIRST so they're immediately visible at 30% open -->
      <div class="action-buttons">
        <button
          v-if="action === 'pray' || action === 'adopt'"
          class="action-btn primary"
          @click="handleActionPrimary"
        >
          <svg class="btn-icon" width="16" height="16" viewBox="0 0 16 16">
            <path d="M8 2L10 6L14 6.5L11 9.5L11.5 14L8 12L4.5 14L5 9.5L2 6.5L6 6L8 2Z"
                  fill="currentColor"/>
          </svg>
          <span>{{ action === 'adopt' ? t('buttons.adoptThem') : t('buttons.prayForThem') }}</span>
        </button>
        <button class="action-btn secondary" @click="handleMoreInfo">
          <svg class="btn-icon" width="16" height="16" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M8 6V8M8 10H8.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span>{{ t('buttons.moreInfo') }}</span>
        </button>
      </div>

      <!-- Quick Stats — PPLR order: Country, Population, Language, Religion.
           Rows always visible even when data is missing (em-dash fallback)
           so the 4-field scaffold reads consistently across all people groups. -->
      <div class="quick-stats">
        <div class="stat-item">
          <span class="stat-label">{{ t('detail.labels.country') }}</span>
          <span class="stat-value">{{ country || '—' }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('detail.labels.population') }}</span>
          <span class="stat-value">{{ formattedPopulation || '—' }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('detail.labels.language') }}</span>
          <span class="stat-value">{{ language || '—' }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('detail.labels.religion') }}</span>
          <span class="stat-value">{{ religion || '—' }}</span>
        </div>
        <!-- Prayer commitments — Feedback #11: show how many people have
             committed to pray for this group. Live pray-tools count; never
             stubbed. Highlighted so the relational invitation stands out. -->
        <div class="stat-item stat-committed">
          <span class="stat-label">{{ t('detail.labels.peopleCommitted') }}</span>
          <span class="stat-value">{{ formattedCommitted }}</span>
        </div>
      </div>

      <!-- Image Display: desktop always shows; mobile only at 90% (fullyOpen). At mobile 40%, parent renders floating image above drawer -->
      <div v-if="showImage" class="image-container position-inside">
        <!-- SVG placeholder shown instantly; fades out when real image loads -->
        <div class="image-placeholder-svg" :class="{ hidden: imageLoaded }">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="80" height="96" aria-hidden="true">
            <circle cx="50" cy="36" r="22" fill="#ccc"/>
            <ellipse cx="50" cy="95" rx="36" ry="28" fill="#ccc"/>
          </svg>
        </div>
        <img
          v-if="resolvedImageUrl"
          :src="resolvedImageUrl"
          :alt="`${peopleGroup.properties.name} people group`"
          class="people-group-image"
          :class="{ loaded: imageLoaded }"
          @load="imageLoaded = true"
          @error="handleImageError"
        />
      </div>

      <!-- Description (only visible at 90% on mobile, always on desktop) -->
      <div v-if="showImage" class="description-section">
        <p v-if="resolvedDescription" class="description-text">{{ resolvedDescription }}</p>
        <p v-else class="description-text empty">{{ t('detail.messages.noDescription') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { retryFetch } from '@map/composables/retryFetch.js'
import { computed, ref, watch, inject } from 'vue';
import { markPrayedLocally } from '../composables/usePrayedLocally.js';
import { useI18n } from 'vue-i18n';
import { generateAvatar, getAvatarStyle } from '../composables/useAvatarGenerator.js';
import { useShadowStyles } from '../composables/useShadowStyles.js';
import { getApiBaseUrl } from '../utils/apiBaseUrl.js';

const { t, locale } = useI18n();

useShadowStyles(`
.people-group-detail{display:flex;flex-direction:column;height:100%;overflow-y:auto;overscroll-behavior:contain;}
.people-group-detail.dark-mode{background:#1a1a2e;color:#eee;}
.detail-header{display:flex;justify-content:space-between;align-items:flex-start;padding:16px;border-bottom:1px solid #e0e0e0;background:white;position:sticky;top:0;z-index:10;}
.dark-mode .detail-header{background:#16213e;border-bottom-color:#2d2d4e;}
.header-left{display:flex;gap:12px;align-items:center;flex:1;min-width:0;}
.header-text{flex:1;min-width:0;}
.people-group-name{margin:0;font-size:18px;font-weight:700;color:#333;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;-webkit-user-select:text;cursor:text;}
.dark-mode .people-group-name{color:#fff;}
.people-group-subtitle{margin:4px 0 0 0;font-size:13px;color:#666;line-height:1.2;}
.dark-mode .people-group-subtitle{color:#aaa;}
.close-button{background:none;border:none;padding:4px;cursor:pointer;color:#666;transition:color 0.2s ease;flex-shrink:0;}
.dark-mode .close-button{color:#aaa;}
.close-button:hover{color:#333;}
.dark-mode .close-button:hover{color:#fff;}
.detail-content{padding:6px 12px 12px;flex:1;overflow-y:auto;overscroll-behavior:contain;}
.dark-mode .detail-content{background:#1a1a2e;}
.quick-stats{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;}
.stat-item{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;}
.stat-label{color:#666;font-weight:500;}
.dark-mode .stat-label{color:#9ca3af;}
.stat-value{color:#333;font-weight:600;text-align:right;}
.dark-mode .stat-value{color:#e5e7eb;}
/* Prayer-commitment row — accent the count so the relational invitation reads. */
.stat-committed .stat-value{color:#73A17F;}
.dark-mode .stat-committed .stat-value{color:#92b195;}
/* Name lead — rendered when the parent legend hides its own header
   (hideHeader=true). Stands in for the old legend-header title bar. */
.pg-name-lead{margin:0 0 8px 0;font-size:16px;font-weight:700;color:#333;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;-webkit-user-select:text;cursor:text;}
.dark-mode .pg-name-lead{color:#F3F3F1;}
.action-buttons{display:flex;gap:8px;padding-top:4px;margin-bottom:10px;overflow-x:auto;padding-bottom:2px;}
.action-btn{display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s ease;white-space:nowrap;flex-shrink:0;}
.action-btn.primary{background:#92b195;color:white;}
.action-btn.primary:hover{background:#73A17F;box-shadow:0 2px 4px rgba(146,177,149,0.3);}
.action-btn.secondary{background:#ecf0f1;color:#333;}
.dark-mode .action-btn.secondary{background:#2d2d4e;color:#e5e7eb;}
.action-btn.secondary:hover{background:#d5dbdb;}
.dark-mode .action-btn.secondary:hover{background:#3d3d5e;}
.btn-icon{flex-shrink:0;}
.image-container{margin-bottom:16px;border-radius:8px;overflow:hidden;background:#f5f5f5;position:relative;}
.dark-mode .image-container{background:#2d2d4e;}
.image-container.position-above{width:120px;height:150px;margin:0 auto 16px auto;}
.image-container.position-inside{width:200px;height:250px;margin:0 auto 16px auto;}
.people-group-image{width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease;}
.people-group-image.loaded{opacity:1;}
.image-placeholder-svg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f0f0f0;transition:opacity 0.3s ease;}
.dark-mode .image-placeholder-svg{background:#2d2d4e;}
.image-placeholder-svg.hidden{opacity:0;pointer-events:none;}
.description-section{margin-top:16px;padding-top:16px;border-top:1px solid #e0e0e0;}
.dark-mode .description-section{border-top-color:#2d2d4e;}
.description-text{margin:0;font-size:14px;line-height:1.6;color:#555;}
.dark-mode .description-text{color:#d1d5db;}
.description-text.empty{color:#999;font-style:italic;}
.dark-mode .description-text.empty{color:#6b7280;}

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .pgd-root, .pgd-card, .pgd-close, .pgd-img { transition: none !important; animation: none !important; }
}
`, 'legend-people-group-detail')

const props = defineProps({
  peopleGroup: {
    type: Object,
    required: true
  },
  hideHeader: {
    type: Boolean,
    default: false
  },
  dark: {
    type: Boolean,
    default: false
  },
  /**
   * Which primary action button to show.
   *   'pray'  → "Pray for them"  → https://pray.doxa.life/<slug>?source=doxalife&utm_source=<utmSource|agwm>
   *   'adopt' → "Adopt them"     → https://doxa.life/adopt/<slug>/
   *   'none'  → primary button hidden; only "More info" shown
   * Default comes from injected tab config (later). For now, falls back to 'pray'.
   */
  action: {
    type: String,
    default: 'pray',
    validator: (v) => ['pray', 'adopt', 'none'].includes(v)
  }
});

const uiStore = inject('uiStore');
// Per-embed config (ProfileLoader provides it) — used for outbound-link attribution.
const profileConfig = inject('profileConfig', null);

// Get legend state for conditional rendering
const legendState = computed(() => uiStore.legendState);
const isMobile = computed(() => uiStore.isMobile);

// Show image: desktop always shows it; mobile only at 90% (fullyOpen)
const showImage = computed(() => !isMobile.value || legendState.value === 'fullyOpen');

// Avatar generation
const avatarData = computed(() => generateAvatar(props.peopleGroup.properties.name));
const avatarLetter = computed(() => avatarData.value.letter);
const avatarStyle = computed(() => getAvatarStyle(props.peopleGroup.properties.name, { size: 32, borderRadius: 4 }));

// Extract properties (base data from bulk fetch, in GeoJSON feature properties)
const properties = computed(() => props.peopleGroup.properties);

// ─────────────────────────────────────────────────────────────────
// API detail fetch — GET /api/people-groups/detail/{slug}
// Fetches richer detail (people_committed, committed_duration, etc.)
// on each pin click. Falls back to bulk data already in properties.
// ─────────────────────────────────────────────────────────────────
const detailData = ref(null);
const imageLoaded = ref(false);

const slug = computed(() => properties.value.slug || '');

async function fetchDetail(slugVal) {
  if (!slugVal) return;
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return; // No API — use bulk data
  try {
    // Default fetch — the /detail endpoint is Cloudflare-cached for 5 min
    // (s-maxage=300). Adding a cache-buster here forced a CF-MISS on every
    // click and routed to the slow WP origin, making images load 10+ seconds.
    // Live counts (prayer / committed / adopted) come from /list which IS
    // cache-busted in DataSourceManager — so freshness stays intact.
    const res = await retryFetch(`${baseUrl}/api/people-groups/detail/${encodeURIComponent(slugVal)}?lang=${encodeURIComponent(locale.value)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    detailData.value = await res.json();
  } catch (err) {
    detailData.value = null;
  }
}

// Fetch detail whenever the selected people group changes
watch(slug, (val) => {
  imageLoaded.value = false; // reset fade state for new group
  detailData.value = null;
  fetchDetail(val);
}, { immediate: true });

// ─────────────────────────────────────────────────────────────────
// Resolved data — prefers detailData, falls back to bulk properties
// ─────────────────────────────────────────────────────────────────

// Country — DataSourceManager exposes `countryName` as the unified, decoded
// human-readable label (pray-tools .label → lookup table fallback → raw).
const country = computed(() =>
  properties.value.countryName
  || properties.value.countryIsoLabel
  || properties.value.country
  || properties.value.countryIso
  || properties.value._raw?.Country
  || ''
);

const subtitle = computed(() => {
  const status = properties.value.status || properties.value._raw?.Status;
  const countryText = country.value || 'Unknown';
  return status ? `${countryText} • ${status}` : countryText;
});

const language = computed(() => {
  const raw = properties.value.language || properties.value._raw?.Language
  if (!raw) return 'Unknown'
  // Already a proper object with a label (e.g. { value: 'pes', label: 'Persian, Iranian' })
  if (typeof raw === 'object' && raw.label) return raw.label
  // API sometimes returns the object JSON-encoded as a string
  if (typeof raw === 'string' && raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.label) return parsed.label
    } catch { /* fall through */ }
  }
  return raw
})
const languageFamily = computed(() => properties.value.languageFamily || properties.value._raw?.LanguageFamily || 'Unknown');
const population = computed(() => properties.value.population || properties.value._raw?.Population || 0);

// Prayer count — how many people are currently praying for this group.
// MUST match the map's prayer heatmap, else the popup shows 0 while the
// heatmap shows activity (Feedback #7/#11).
//
// Root cause of the "popup 0 vs map active" bug: the clicked GeoJSON feature
// carries `properties.peoplePraying` frozen at INITIAL LOAD (useMapLayers.js
// coerces missing → 0). Polling refreshes the live count ONLY via Mapbox
// setFeatureState() — which recolors the heatmap (`['feature-state','peoplePraying']`)
// but NEVER writes back to feature.properties. So the popup's bulk property is
// a stale 0 while the map shows real activity.
//
// Fix: prefer the LIVE value from the real campaigns-server endpoint
// (GET /api/people-groups/detail/{slug} → `people_praying`), which reads the
// same people_groups.people_praying column the poll refreshes, so popup == map.
// The stale bulk property and _raw are fallbacks for the pre-fetch instant
// (detailData loads async after click). Never stub — always the live count.
// 0 is meaningful ("be the first to pray"); a truly absent field → em-dash.
const peoplePraying = computed(() => {
  const candidates = [
    detailData.value?.people_praying,
    properties.value.peoplePraying,
    properties.value._raw?.people_praying,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== '') return Number(c);
  }
  return null;
});

const formattedCommitted = computed(() =>
  peoplePraying.value === null ? '—' : peoplePraying.value.toLocaleString()
);
// Religion — prefer the unified decoded label; DataSourceManager handles
// pray-tools {value,label} and UUPG raw-code records transparently.
const religion = computed(() =>
  properties.value.religionName
  || properties.value.religionLabel
  || properties.value.religion
  || properties.value._raw?.Religion
  || ''
);

// Prefer API detail description over bulk description
const resolvedDescription = computed(() =>
  detailData.value?.imb_people_description
  || detailData.value?.description
  || properties.value.description
  || properties.value._raw?.Description
  || ''
);

// Prefer API detail image URL over bulk image URL
// Canonical "no image" placeholder — from sources.json imageConfig.placeholderUrl
const NO_IMAGE_URL = 'https://www.peoplegroups.org/images/pgphotosearch/NoImageAvailable_search.jpg';

const resolvedImageUrl = computed(() =>
  detailData.value?.image_url
  || detailData.value?.imageUrl
  || properties.value.imageUrl
  || properties.value._raw?.ImageURL
  || NO_IMAGE_URL  // always render an <img>; never show the raw SVG silhouette for missing photos
);

// Format population with commas and K/M suffixes
const formattedPopulation = computed(() => {
  const pop = parseInt(population.value);
  if (pop >= 1000000) {
    return `${(pop / 1000000).toFixed(1)}M`;
  } else if (pop >= 1000) {
    return `${(pop / 1000).toFixed(1)}K`;
  }
  return pop.toLocaleString();
});

// Event handlers
function handleClose() {
  uiStore.selectPeopleGroup(null); // Clears selection and returns to prayer mode
}

// ── OUTBOUND TRAFFIC ATTRIBUTION (utm_source) ────────────────────────────────
// Every outbound people-group link carries a standard `utm_source` so the
// destination site's analytics can measure the traffic arriving THROUGH THE MAPS
// (the maps-as-mobilizers conversion metric). Per-embed override: profile-config
// `utmSource` (a partner site sets its own tag) or window.DOXA_UTM_SOURCE (host
// page override); default 'agwm'. The legacy `source=doxalife` param is KEPT so
// any existing consumer of it keeps working.
function utmSource() {
  // THE QUESTION MARK IS THE MECHANISM: an embed URL like
  //   <embed-page>?utm_source=agwm   (iframe)  or a partner page's own ?utm_source
  // is the per-placement tracking signal, so the PAGE URL outranks everything —
  // whoever placed the embed decides the attribution. Then per-embed config,
  // then the host global, then the default.
  let fromUrl = ''
  try { fromUrl = new URLSearchParams(window.location.search).get('utm_source') || '' } catch (_) {}
  const fromConfig = profileConfig?.value?.utmSource
  const fromHost = (typeof window !== 'undefined' && window.DOXA_UTM_SOURCE) || ''
  return encodeURIComponent(String(fromUrl || fromConfig || fromHost || 'agwm'))
}

// Slug-based URL templates (see documentation/feedback.md → Section E).
// These open the DOXA-site flow for the active people group.
function prayUrl(slug)   { return `https://pray.doxa.life/${encodeURIComponent(slug)}?source=doxalife&utm_source=${utmSource()}` }
// Adopt form lives on the SAME WordPress site the map is embedded in — use the
// current origin so the link works in local dev (localhost:10013), staging,
// and production without a hardcoded host. Pattern: /adopt/<slug>/?source=doxalife
function adoptUrl(slug)  {
  // Same fix as researchUrl — see siteOrigin() below. This had the identical
  // window.location.origin bug, so it would have broken in the app too.
  return `${siteOrigin()}/adopt/${encodeURIComponent(slug)}/?source=doxalife&utm_source=${utmSource()}`
}
// ── SITE-LINK ORIGIN ────────────────────────────────────────────────────────
// These links open PAGES ON THE DOXA SITE (a /research/<slug>/ or /adopt/<slug>/
// route). They were built from window.location.origin, which silently assumes the
// map is embedded ON that site. That assumption breaks wherever it is not:
//   • the standalone CDN  -> http://<cdn-host>/research/<slug>/  = 404
//   • the Capacitor app   -> https://localhost/research/<slug>/  = points AT THE
//     APP ITSELF, so it 404s or reloads the app — a crash-class bug on mobile
// So the site origin is now CONFIGURABLE and falls back to the canonical site
// instead of to wherever the bundle happens to be served from:
//   1. window.DOXA_SITE_URL   (host page / wrapper override, per embed)
//   2. https://doxa.life      (canonical default — SAFE everywhere)
// An embedder hosting the map on the Doxa site can still set siteBaseUrl to its
// own origin to keep the previous same-origin behaviour.
function siteOrigin() {
  // NOTE: this component has no profile-config injection (only `uiStore`), so the
  // per-embed value is read from the host global that ProfileLoader/the host page
  // sets. Wiring a real profile-config `siteBaseUrl` through ProfileLoader -> here
  // is the fuller fix (tracked as its own item); this already removes the
  // crash-class localhost bug in the app.
  const fromHost = (typeof window !== 'undefined' && window.DOXA_SITE_URL) || ''
  return String(fromHost || 'https://doxa.life').replace(/\/+$/, '')
}
function researchUrl(slug) {
  return `${siteOrigin()}/research/${encodeURIComponent(slug)}/?utm_source=${utmSource()}`
}

function handleActionPrimary() {
  const s = slug.value;
  if (!s) return;
  // The encouragement loop: their dot glows for THEM right away (localStorage,
  // TTL'd) — lasting glow comes from the real signup via the API. See
  // composables/usePrayedLocally.js.
  if (props.action !== 'adopt') markPrayedLocally(s);
  const url = props.action === 'adopt' ? adoptUrl(s) : prayUrl(s);
  window.open(url, '_blank', 'noopener');
}

function handleMoreInfo() {
  const s = slug.value;
  if (!s) return;
  window.open(researchUrl(s), '_blank', 'noopener');
}

function handleImageError(event) {
  if (event.target.dataset.usedFallback) return; // prevent infinite loop if placeholder itself fails
  event.target.dataset.usedFallback = 'true';
  event.target.src = NO_IMAGE_URL;
}
</script>

<style scoped>
.people-group-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  /* a scroll that reaches this panel's end never chains to the page (the mobile sheet's detail view) */
  overscroll-behavior: contain;
}

/* Header Section */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background: white;
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-left {
  display: flex;
  gap: 12px;
  align-items: center;
  flex: 1;
  min-width: 0; /* Allow text truncation */
}

.avatar {
  /* Styles applied via :style binding from useAvatarGenerator */
}

.header-text {
  flex: 1;
  min-width: 0;
}

.people-group-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #333;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Header text must be click-drag selectable / copyable (feedback 2026-04-20) */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.people-group-subtitle {
  margin: 4px 0 0 0;
  font-size: 13px;
  color: #666;
  line-height: 1.2;
}

.close-button {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #666;
  transition: color 0.2s ease;
  flex-shrink: 0;
}

.close-button:hover {
  color: #333;
}

/* Content Section */
.detail-content {
  padding: 6px 12px 12px;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* Quick Stats */
.quick-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
}

.stat-label {
  color: #666;
  font-weight: 500;
}

.stat-value {
  color: #333;
  font-weight: 600;
  text-align: right;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 8px;
  /* 4px, matching the shadow copy. These two disagreed (12px here, 4px there) since the initial
     commit, so there is no later intent to infer — and the shadow copy is the one that reaches the
     shipped bundles, so its value is what users have actually been seeing when this component is
     embedded. Aligning to it preserves the current appearance rather than changing it. */
  padding-top: 4px;
  margin-bottom: 10px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.action-btn.primary {
  background: #92b195;
  color: white;
}

.action-btn.primary:hover {
  background: #73A17F;
  box-shadow: 0 2px 4px rgba(146, 177, 149, 0.3);
}

.action-btn.secondary {
  background: #ecf0f1;
  color: #333;
}

.action-btn.secondary:hover {
  background: #d5dbdb;
}

.btn-icon {
  flex-shrink: 0;
}

/* Image Container */
.image-container {
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
}

.image-container.position-above {
  /* At 40% open: smaller image (120×150) */
  width: 120px;
  height: 150px;
  margin: 0 auto 16px auto;
}

.image-container.position-inside {
  /* At 90% open: full-size image (200×250) */
  width: 200px;
  height: 250px;
  margin: 0 auto 16px auto;
}

.people-group-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.people-group-image.loaded {
  opacity: 1;
}

/* SVG silhouette placeholder — shown instantly, zero network cost */
.image-placeholder-svg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f0f0;
  transition: opacity 0.3s ease;
}

.image-placeholder-svg.hidden {
  opacity: 0;
  pointer-events: none;
}

/* Ensure image sits on top of placeholder */
.image-container {
  position: relative;
}

/* Description Section */
.description-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.description-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #555;
}

.description-text.empty {
  color: #999;
  font-style: italic;
}

/* Scrollbar styling */
.action-buttons::-webkit-scrollbar {
  height: 4px;
}

.action-buttons::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 2px;
}

.action-buttons::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 2px;
}

.action-buttons::-webkit-scrollbar-thumb:hover {
  background: #999;
}

/* Mobile responsiveness */
@media (max-width: 480px) {
  .people-group-name {
    font-size: 16px;
  }
  
  .stat-item {
    font-size: 13px;
  }
  
  .action-btn {
    padding: 8px 14px;
    font-size: 13px;
  }
}
</style>
