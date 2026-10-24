<script setup>
/**
 * pplr-index.vue — Profile: PPLR Validation Index
 *
 * Tile menu listing every PPLR validation profile in this MFE.
 * Each tile dispatches a `pplr-select-profile` CustomEvent on click —
 * the host page (index.html) listens for it and switches the topbar tab.
 *
 * A tile is named by its view's own name (pplr.tabs.*, the same words as the view select), and the
 * title and help line are keys. The tile DESCRIPTIONS and the source line are research notes, and stay
 * English until a full translation of this research tool is decided (chrome only for now).
 */
import { usePplrT } from '../composables/usePplrT.js'

const t = usePplrT()

const PROFILES = [
  { id: 'pplr-religion',    tKey: 'pplr.tabs.religion',
    desc: 'All 21k PG-in-country pins colored by primary religion group (9 groups: Christianity, Islam, Hinduism, Ethnoreligion, Buddhism, Judaism, Sikhism, Unaffiliated, Other). Country polygons underneath. Click any pin for detail.' },
  { id: 'pplr-rop-tree',     tKey: 'pplr.tabs.ropTree',
    desc: 'Split map + sidebar. Left panel: collapsible tree of 17 Affinity Blocs → 292 Clusters → 13,065 People Groups → PG-in-Country (21k entries). Click any node to filter map pins and fly the viewport. Pins colored by Affinity Bloc.' },
  { id: 'pplr-language-families', tKey: 'pplr.tabs.languageFamilies',
    desc: '21k PG-in-country pins colored by PPLR ethnolinguistic family (71 families, ~100% coverage via GeoID join to aROP3byCountry). Top 25 families (85% of pins) get distinct colors; remainder shown grey.' },
  { id: 'pplr-semantic-trees', tKey: 'pplr.tabs.semanticTrees',
    desc: 'Left-to-right reference tables for the three PPLR classification trees (Lang, ROP, Admin). Shows real API field names per level per system (PPLR / Joshua Project / IMB / WCD).' },
  { id: 'pplr-d3-tree',     tKey: 'pplr.tabs.ropSunburst',
    desc: 'D3 zoomable sunburst of the full ROP hierarchy. Inner ring: 17 Affinity Blocs; middle ring: 292 Clusters; outer ring: 13k People Groups. Click any arc to zoom in; click center to zoom out. Colors match the tree explorer.' },
  { id: 'pplr-pins',          tKey: 'pplr.tabs.allPins',
    desc: 'World Mapbox map with country polygons + every PG-in-country pin. Click any pin for full Rosetta popup. Validates lat/long completeness and global PG distribution.' },
  { id: 'pplr-translations',  tKey: 'pplr.tabs.nameLocales',
    desc: 'Same map; click any pin to see the PG name in English + 17 IMB locales side-by-side. Surfaces machine-translation quality issues (e.g. Asas → "basics" in 17 languages).' },
  { id: 'pplr-rosetta-cards', tKey: 'pplr.tabs.rosetta',
    desc: 'Pin color encodes which cross-system IDs exist (gold = JP+IMB+WCD, blue = JP+IMB, etc.). The 5 Rosetta sample PGs show as gold ★. Click any pin for the full Rosetta table.' },
  { id: 'pplr-coverage',      tKey: 'pplr.tabs.coverage',
    desc: 'Country polygons shaded by avg locales filled per PG (red 0/17 → green 17/17). PG pins overlaid on top. Click a country for stats; click a pin for the PG record.' },
]

function selectProfile(id) {
  // Dispatch a composed event so it crosses the shadow-DOM boundary into the host
  window.dispatchEvent(new CustomEvent('pplr-select-profile', {
    detail: { profile: id },
    bubbles: true, composed: true
  }))
}
</script>

<template>
  <div class="pplr-index">
    <header>
      <h1>{{ t('pplr.index.title') }}</h1>
      <p>Many small displays — each answers one validation question about the PPLR people-group data.
         Source: <a href="https://services2.arcgis.com/S4ydGgujXcif36k3" target="_blank">PPLR ArcGIS FeatureServer</a>
         · 6 parquets · 48,174 PG records · 17 locales.</p>
    </header>

    <section class="grid">
      <button v-for="p in PROFILES" :key="p.id" @click="selectProfile(p.id)" class="tile">
        <h2>{{ t(p.tKey) }}</h2>
        <p>{{ p.desc }}</p>
        <code>{{ p.id }}</code>
      </button>
    </section>

    <footer>
      <p>{{ t('pplr.index.help') }}</p>
    </footer>
  </div>
</template>

<style scoped>
.pplr-index {
  width: 100%; height: 100%; overflow: auto;
  background: #0d1117; color: #c9d1d9;
  font-family: system-ui, -apple-system, sans-serif;
  padding: 32px 40px;
  box-sizing: border-box;
}
header h1 { font-size: 22px; font-weight: 500; color: #58a6ff; margin: 0 0 8px; }
header p { font-size: 13px; color: #8b949e; line-height: 1.6; max-width: 720px; }
header a { color: #79c0ff; }

.grid {
  margin-top: 28px;
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.tile {
  display: block; text-align: left; cursor: pointer;
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 16px 18px; color: inherit; font: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.tile:hover { border-color: #58a6ff; background: #1c2128; }
.tile h2 { font-size: 14px; font-weight: 600; color: #79c0ff; margin: 0 0 6px; }
.tile p { font-size: 12px; color: #8b949e; line-height: 1.55; margin: 0 0 10px; }
.tile code { font-family: ui-monospace, monospace; font-size: 11px; color: #6e7681; }

footer {
  margin-top: 28px; padding-top: 14px;
  border-top: 1px solid #21262d;
  font-size: 11px; color: #6e7681;
}
footer b { color: #c9d1d9; }
</style>
