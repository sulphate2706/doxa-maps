<script setup>
/**
 * template-map-b.vue — example profile "B"
 *
 * @description Minimal example profile B — a second profile in the same bundle.
 * @profile     template-map-b
 * @bundle      template-bundle
 * @element     template-bundle
 *
 * A SECOND profile living in the SAME bundle folder, alongside
 * template-map-a.vue (both flat, no profiles/ subfolder). Both compile into the
 * single output file public/dx-maps/template-bundle/template-bundle.js — one
 * bundle, two profiles.
 * The host chooses which one to show with the `profile` field:
 *
 *   <template-bundle profile-config='{"profile":"template-map-b"}'></template-bundle>
 *
 * Its text shows the two ways a string reaches the catalogue (library/i18n/locales/<lc>/template.json):
 *   - a plain label or line: t('template.profileB.title') in the template;
 *   - a SENTENCE that carries markup: ONE key with named placeholders ("Served from {file} in the
 *     {bundle} bundle."), rendered by library/composables/useSentence.js. The file and bundle names
 *     are passed in as their own left-to-right <code> islands, so a translator can move them anywhere
 *     in the sentence and never has to copy markup. Building it from pieces ("Served from" + <code> +
 *     "in the" …) would fix English word order into every language.
 * The host's note is content, not interface: it is shown as given, inside a translated line.
 */
import { inject, computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { sentenceParts, keep } from '@map/composables/useSentence.js'

const { t } = useI18n()
const config = inject('profileConfig', null)
const note = computed(() => config?.value?.note || '')
const code = (text) => h('code', { dir: 'ltr' }, text)
// A computed VNode, so it re-renders when the language changes (t() reads the current locale).
const servedFrom = computed(() => h('p', sentenceParts(
  t('template.profileB.servedFrom', keep('file', 'bundle')),
  { file: code('template-map-b.vue'), bundle: code('template-bundle') },
)))
</script>

<template>
  <div class="tpl tpl--b">
    <h2>{{ t('template.profileB.title') }}</h2>
    <component :is="servedFrom" />
    <p class="note">{{ note ? t('template.profileB.note', { note }) : t('template.profileB.noNote') }}</p>
  </div>
</template>

<style scoped>
.tpl {
  width: 100%; height: 100%;
  display: flex; flex-direction: column; gap: 6px;
  align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  text-align: center;
}
/* MATERIAL LIGHT (2026-09-21). Was background #1f0b2a / color #d8b4fe. See template-map-a.vue for
   why the STARTER matters most: the copy-me recipe propagates whatever it finds here.
   Kept visibly distinct from profile a (white card + neutral border, vs a's tinted surface and
   accent border) so the two-profile demo still reads as two profiles. */
.tpl--b { background: #ffffff; color: #3b463d; border: 1px solid #d1d4cd; }
.tpl h2 { font-size: 22px; font-weight: 700; }
.tpl code { background: rgba(59, 70, 61, 0.08); padding: 1px 6px; border-radius: 4px; }
.tpl .note { font-size: 12px; opacity: 0.7; }
</style>
