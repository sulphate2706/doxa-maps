<script setup>
/**
 * @description One poster section on its own: the reusable <dxm-poster-section> element (a region's posters, the same cards and print options as the Country Posters wall), shown here for Africa (open) and Oceania (collapsed).
 *
 * poster-section.vue — the reusable <dxm-poster-section> element, shown on its own page: two regions, each ONE
 * section (the same cards and print options as the Country Posters wall), one collapsible and open, one starting
 * shut. The element is the library's (registered by this bundle); this page only places it.
 */
import { computed, h, inject, ref } from 'vue'
import { getRuntimeLocale, detectLocale } from '@map/i18n/index.js'

const profileConfig = inject('profileConfig', ref(null))
const cfg = computed(() => profileConfig.value || {})
const locale = computed(() => cfg.value.locale || getRuntimeLocale() || detectLocale() || 'en')
const section = (scope, extra = {}) => h('dxm-poster-section', {
  type: 'country', scope, locale: locale.value, 'assets-base': cfg.value.assetsBase || './assets', ...extra,
})
const Page = () => h('div', { class: 'ps-demo' }, [section(cfg.value.scope || 'africa'), section('oceania', { collapsed: '' })])
</script>

<template>
  <Page />
</template>
