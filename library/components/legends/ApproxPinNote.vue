<!--
  ApproxPinNote.vue — the ONE wording every map with people-group pins uses (APPROXPIN, 2026-09-26).

  The first sentence always: a dot marks a people group, not a town or a boundary. The second only
  when the pin's point is SHARED, naming the other groups (from library/utils/colocation.js, built from the
  roster the map draws), because "approximate" alone hides that some dots are the same dot.
  Never shows the raw coordinate: six decimal places beside a caveat that says "approximate" reads as a
  contradiction. Wording: a measured proposal (P5), in library/i18n/locales/<lc>/pins.json.
-->
<script setup>
import { computed, unref } from 'vue'
import { useOptionalI18n } from '@map/composables/useOptionalT.js'
import { formatList } from '@map/i18n/index.js'

const props = defineProps({
  /** Names of the OTHER groups on this pin's coordinate; empty = not shared. */
  shared: { type: Array, default: () => [] },
  dark: { type: Boolean, default: false },
})
// i18n is OPTIONAL here, as in PinHint: an unguarded useI18n() throws on a host that never installed
// vue-i18n, inside the custom-element boundary, and the reader gets an empty shadow root. Without it
// the English below renders, with the same placeholders filled.
const APPROX_FALLBACK = {
  'pins.approximate': 'The dot marks a people group, not a town or a boundary.',
  'pins.sharedPoint': 'It sits on the same point as {names} — {n} groups share this dot.',
}
// C4: the guard is library/composables/useOptionalT.js now. The fallback MAP stays exactly as it was,
// passed in, so a bare host renders the same English it rendered before.
// The names list follows the SAME locale as its sentence: the host's vue-i18n when it installed one;
// otherwise '' (not the helper's 'en' default), so formatList resolves the runtime/page locale as tStatic does.
const { t, locale } = useOptionalI18n('', { fallback: (key) => APPROX_FALLBACK[key], locale: '' })
const second = computed(() => props.shared.length
  ? t('pins.sharedPoint', { names: formatList(props.shared, { locale: unref(locale) || undefined }), n: props.shared.length + 1 })
  : '')
</script>

<template>
  <p class="approx-pin-note" :style="{ margin: '6px 10px 4px', font: '400 11px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: dark ? 'rgba(243,243,241,0.7)' : '#5b6470' }">
    {{ t('pins.approximate') }}<template v-if="second"> {{ second }}</template>
  </p>
</template>
