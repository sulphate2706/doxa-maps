<script setup>
/**
 * city-poster-wall.vue — the KEY CITY POSTER WALL.
 *
 * One poster per named population centre, grouped by region and collapsible —
 * rendered by the SHARED @map/components/poster/PosterWall.vue, the same component
 * the 100-list and country walls use. Third consumer, zero new wall code: that is
 * the payoff of promoting it to the library rather than copying it per app.
 *
 * WHY 176 AND NOT 1,646. A sheet is generated only where all three hold:
 *   NAMED     — by a cited gazetteer (Nominatim/OSM). An unnamed cluster would
 *               make a poster titled "unnamed location", which is not a poster.
 *   MULTI-GROUP — >1 people group within ~25km. A single centroid is a pin, not
 *               a population centre.
 *   ASCII-SAFE — the sheet fonts are Lato/Georgia. 99 of the 277 named centres are
 *               non-Latin (Hebrew/Arabic/Lao/Tibetan/Chinese/Cyrillic) and would
 *               render as tofu, so they are HELD on the the brief's font decision
 *               (likely Noto Sans per-script) rather than shipped broken.
 * Partial and correct beats complete and wrong. The wall shows only what exists.
 */
import { computed, inject, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { regionLabel } from './regionLabel.js'
import PosterWall from '@map/components/poster/PosterWall.vue'
import { resolveAssetsBase } from '@map/utils/embedBase.js'

const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))

const rows = ref([])
onMounted(async () => {
  try {
    const r = await fetch(`${assetsBase.value}/tables/key-cities.json`)
    if (r.ok) rows.value = (await r.json()).rows || []
  } catch (_) { /* the wall renders empty rather than throwing */ }
})

// Only rows that actually HAVE a sheet. poster_id is set by the table builder, so
// the wall never asks for an image that was never generated.
const items = computed(() => rows.value
  .filter((r) => r.poster_id)
  .map((r) => ({
    id: r.poster_id,
    label: r.place_name,
    count: r.people_group_count,
    region: r.region,
    bbox: null,
  })))

const { t } = useI18n()
// PosterWall prints its section name as given, so the wall groups by the region's heading in the page's
// language (as country-posters' wall does). 'Other' is the data guard dashboard.other projects.
const groupBy = (c) => regionLabel(t, c.region || 'Other')
const collapsedBy = (sec) => sec.total < 20
</script>

<template>
  <PosterWall
    :items="items"
    :group-by="groupBy"
    :is-dark="isDark"
    :assets-base="assetsBase"
    event-name="doxa-key-cities:show-on-map"
    :heading="$t('keyCities.posters.heading')"
    :tag="$t('keyCities.posters.tag')"
    :intro="$t('keyCities.posters.intro')"
    unit="UPG"
    :item-noun="$t('keyCities.posters.itemNoun')"
    :item-noun-plural="$t('keyCities.posters.itemNounPlural')"
    :collapsible="true"
    :collapsed-by="collapsedBy"
    :prayer-list-soon-message="$t('keyCities.posters.soon')"
    download-prefix="doxa-city"
  />
</template>
