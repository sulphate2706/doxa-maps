<script setup>
/**
 * upg-neighbor.vue — My UPG Neighbors: mobilize the reached neighbors nearest to each unreached group.
 *
 * @description Near-neighbor mobilization on Winter's E-scale: who to mobilize, in what language, where
 *
 * Two views over one dataset (data/tables/near-neighbors.json, built from peoplegroups.org by
 * scripts/build-near-neighbors.mjs):
 *   Mobilize   pick an unreached group; see its E-1 / E-2 / E-3 reached neighbors and export them as
 *              campaign audience segments.
 *   Campaigns  bridge languages: languages spoken by believers AND by unreached groups, ranked by the
 *              unreached population one campaign in that language can reach.
 * @profile     upg-neighbor
 * @bundle      upg-neighbor
 * @element     upg-neighbor
 *
 * profile-config: { "profile":"upg-neighbor", "view":"mobilize"|"campaigns", "pgid":"PG…", "lang":"hin" }
 * The five earlier lenses (Send Map, the cockpit, Flower Mesh, Lang Cluster, Flowers) were retired
 * 2026-09-27: they ran on a 40-country snapshot and answered one question five ways. Their view names
 * still open the nearest new view, so existing embeds keep working.
 */
import { inject, reactive, computed, provide, ref, watch, nextTick } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import Mobilize from './src/mobilize.vue'
import Campaigns from './src/campaigns.vue'
import { NAVY } from './src/nearData.js'

const profileConfig = inject('profileConfig', null)
const cfg = computed(() => profileConfig?.value || {})

const VIEWS = ['mobilize', 'campaigns']
// Old view names → the view that now answers their question.
const LEGACY = { 'send-map': 'mobilize', cockpit: 'mobilize', 'upg-neighbors': 'mobilize', 'bloom-cockpit': 'mobilize',
  'flower-mesh': 'mobilize', 'lang-cluster': 'campaigns', flowers: 'campaigns' }
const asked = cfg.value.view || cfg.value.legacyElement
const initial = VIEWS.includes(asked) ? asked : (LEGACY[asked] || (cfg.value.lang ? 'campaigns' : 'mobilize'))

// Shared by both views, so a choice made in one is still there in the other.
const nbState = reactive({ view: initial, pgid: cfg.value.pgid || null, lang: cfg.value.lang || null, about: false, list: 'unreached', sheetDown: false })
provide('nbState', nbState)

// "How it works" is a real dialog for the keyboard: focus moves to its close button when it opens, Tab
// stays there (its only control), Escape closes it, and focus returns to the button that opened it.
const aboutBtn = ref(null), aboutClose = ref(null)
watch(() => nbState.about, (open) => nextTick(() => (open ? aboutClose.value : aboutBtn.value)?.focus?.()))
function onAboutKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nbState.about = false }
  else if (e.key === 'Tab') { e.preventDefault(); aboutClose.value?.focus?.() }
}

useShadowStyles(`
  .dun-root { position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden; background:#fff; isolation:isolate;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .dun-bar { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:8px 12px; background:${NAVY}; z-index:50; flex-wrap:wrap; }
  .dun-brand { font:700 13px/1 inherit; color:#fff; white-space:nowrap; margin-inline-end:4px; }
  .dun-seg { display:inline-flex; background:rgba(255,255,255,.08); border-radius:999px; padding:3px; gap:2px; }
  .dun-seg button { border:0; background:transparent; color:#c7d3ea; cursor:pointer; font:600 13px/1 inherit; padding:7px 14px; border-radius:999px; }
  .dun-seg button.on { background:#fff; color:${NAVY}; }
  .dun-seg button:focus-visible, .dun-about:focus-visible { outline:2px solid #fff; outline-offset:2px; }
  .dun-about { margin-inline-start:auto; border:1px solid rgba(255,255,255,.35); background:transparent; color:#fff; border-radius:999px; padding:6px 12px; font:600 12px/1 inherit; cursor:pointer; }
  .dun-stage { flex:1 1 0; position:relative; min-height:0; }
  .dun-modal { position:absolute; inset:0; z-index:60; background:rgba(0,20,50,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
  .dun-card { background:#fff; border-radius:12px; max-width:620px; max-height:100%; overflow-y:auto; padding:18px 20px; font-size:14px; line-height:1.5; color:#1f2937; }
  .dun-card h2 { margin:0 0 8px; font-size:18px; }
  .dun-card h3 { margin:14px 0 4px; font-size:14px; }
  .dun-card p { margin:0 0 8px; }
  .dun-card .src { font-size:12px; color:#6b7280; }
  .dun-close { float:inline-end; border:0; background:none; font-size:20px; line-height:1; cursor:pointer; color:#6b7280; }
  @media (max-width:640px){ .dun-brand{ display:none; } .dun-seg button { padding:7px 10px; } }
`, 'upg-neighbor')
</script>

<template>
  <div class="dun-root">
    <div class="dun-bar">
      <span class="dun-brand">{{ $t('neighbor.brand') }}</span>
      <div class="dun-seg" role="tablist" :aria-label="$t('neighbor.chooseView')">
        <button v-for="v in VIEWS" :key="v" role="tab" :aria-selected="nbState.view === v"
                :class="{ on: nbState.view === v }" @click="nbState.view = v">{{ $t(v === 'mobilize' ? 'neighbor.views.mobilize' : 'neighbor.views.campaigns') }}</button>
      </div>
      <button ref="aboutBtn" class="dun-about" @click="nbState.about = true">{{ $t('neighbor.about.button') }}</button>
    </div>

    <div class="dun-stage">
      <Mobilize v-if="nbState.view === 'mobilize'" />
      <Campaigns v-else />

      <div v-if="nbState.about" class="dun-modal" role="dialog" aria-modal="true" :aria-label="$t('neighbor.about.title')" @click.self="nbState.about = false" @keydown="onAboutKey">
        <div class="dun-card">
          <button ref="aboutClose" class="dun-close" :aria-label="$t('neighbor.about.close')" @click="nbState.about = false">×</button>
          <h2>{{ $t('neighbor.about.title') }}</h2>
          <p>{{ $t('neighbor.about.why') }}</p>
          <h3>{{ $t('neighbor.about.greenTitle') }}</h3>
          <p>{{ $t('neighbor.about.green') }}</p>
          <h3>{{ $t('neighbor.about.eTitle') }}</h3>
          <p><b>E-1</b> · {{ $t('neighbor.e.long1') }}<br><b>E-2</b> · {{ $t('neighbor.e.long2') }}<br><b>E-3</b> · {{ $t('neighbor.e.long3') }}</p>
          <h3>{{ $t('neighbor.about.pTitle') }}</h3>
          <p><b>P-1</b> · {{ $t('neighbor.p.long1') }}<br><b>P-2</b> · {{ $t('neighbor.p.long2') }}<br><b>P-3</b> · {{ $t('neighbor.p.long3') }}</p>
          <h3>{{ $t('neighbor.about.dataTitle') }}</h3>
          <p>{{ $t('neighbor.about.data') }}</p>
          <p class="src">{{ $t('neighbor.about.source') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
