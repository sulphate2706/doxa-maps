<!--
  LargerScreenNotice — what a map says on a phone when its <profile>.meta.json declares `mobile`
  (SPEC-MOBILE-FLAG). ProfileLoader decides WHETHER it shows (narrow screen, not inside the Research
  Gallery); this component only draws the two forms:

    mode="larger-screens"  a slim bar IN FLOW at the top of the plugin: the map still opens below it.
                           Not an overlay, so it can never cover the map's own controls. The × emits
                           `dismiss`; ProfileLoader remembers that per profile for the session.
    mode="desktop-only"    the whole plugin area: the map is NOT mounted, and the message says why.

  ONE TEXT: messages.largerScreenNotice / messages.desktopOnlyNotice are the Research Gallery's own
  sentences, moved into the library catalogue so the Gallery and a standalone leaf say the same thing
  in all eleven locales. tStatic with the element's locale, not useI18n: this mounts inside elements
  that may install no i18n plugin (the same reason PinHint reads tStatic).
-->
<template>
  <div v-if="mode === 'desktop-only'" class="lsn-block" role="status">
    <p class="lsn-block__text">{{ blockParts[0] }}<bdi v-if="blockParts.length > 1">{{ label }}</bdi>{{ blockParts[1] || '' }}</p>
  </div>
  <div v-else class="lsn-bar" role="note">
    <p class="lsn-bar__text">{{ adviseText }}</p>
    <button type="button" class="lsn-bar__x" :aria-label="dismissText" :title="dismissText" @click="$emit('dismiss')">×</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { tStatic } from '@map/i18n/index.js'

const props = defineProps({
  mode: { type: String, required: true },
  // The map's name for the desktop-only sentence ("{label} only supports desktop …").
  label: { type: String, default: '' },
  // The locale in force for THIS element (ProfileLoader's effectiveLocale), so the notice follows a
  // host's language switch instead of the page's boot language.
  locale: { type: String, default: '' },
})
defineEmits(['dismiss'])

const T = (key, en) => tStatic(key, props.locale || undefined) || en

const adviseText = computed(() => T('messages.largerScreenNotice',
  'This experimental map is built for larger screens. It opens here, but parts of it may not fit or work well on a phone.'))
const dismissText = computed(() => T('messages.noticeDismiss', 'Dismiss'))
// Split on the placeholder rather than replacing it, so the name can sit in its own <bdi>: a Latin map
// name inside an Arabic sentence must not take the sentence's direction.
const blockParts = computed(() => T('messages.desktopOnlyNotice',
  '{label} only supports desktop — open this page on a desktop to use it.').split('{label}'))
</script>

<style scoped>
.lsn-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: none;
  margin: 0;
  /* Logical, so in Arabic the wider side stays on the text and the narrow one on the ×. */
  padding-block: 8px;
  padding-inline: 12px 8px;
  background: #fff8e1;
  border-block-end: 1px solid #f0d68a;
  color: #4a3b00;
  font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.lsn-bar__text { flex: 1 1 auto; margin: 0; }
/* 24px is the smallest tap target the fleet accepts; the glyph stays small inside it. */
.lsn-bar__x {
  flex: none;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: 600 18px/1 system-ui, sans-serif;
  cursor: pointer;
}
.lsn-bar__x:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
.lsn-block {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 200px;
  padding: 24px;
  background: #f7f7f5;
  color: #333;
  text-align: center;
  font: 400 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.lsn-block__text { max-width: 28em; margin: 0; }
</style>
