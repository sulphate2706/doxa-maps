<!--
  HelpButton.vue — the map's "?" control: what this map is and how to use it.

  One click, two ways to answer it:
    - `open-help` (emit): the map shows its own help (doxa-simple-map's popup does).
    - `doxa:help` (a DOM event, bubbling and COMPOSED; see composables/useHostedHelp.js): a HOST
      answers for the map. The Doxa Maps app (doxa-maps-spa) answers with the Experimental shelf's
      what/how text, which is how that explainer left the top of the screen for the map's own control
      column, next to zoom and fullscreen.

  Props:
    isDark — theme flag forwarded from parent
    hosted — show the button ONLY under a host that answers doxa:help. A map whose help lives in its
             host sets this, so the same bundle embedded on a page with no such host shows no dead "?".

  Emits:
    open-help — fires on click; parent decides how to display help content
-->
<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MapControlButton from './MapControlButton.vue'
import { useHostedHelp } from '../../composables/useHostedHelp.js'

const { t } = useI18n()

const props = defineProps({
  isDark: { type: Boolean, default: false },
  hosted: { type: Boolean, default: false }
})

const emit = defineEmits(['open-help'])

const { hosted: underHost, askForHelp } = useHostedHelp()
const shown = computed(() => !props.hosted || underHost.value)

function onClick() {
  emit('open-help')
  askForHelp()
}
</script>

<template>
  <MapControlButton v-if="shown" data-control="help" :is-dark="isDark" :title="t('buttons.aboutThisMap')" @click="onClick">
    <span style="font-size:15px;font-weight:700;font-family:serif;line-height:1;">?</span>
  </MapControlButton>
</template>
