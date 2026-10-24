<script setup>
/**
 * FullDetailsDialog.vue: "Show full details" for one poster configuration.
 *
 * Everything a person needs to name the template to an agent, or an agent needs to find it: the
 * configuration name (the stable id), what it is, its size, the size of the file it prints, where its
 * renderer lives, its settings and its sample data. A design another plugin makes (config.pageUrl) shows that
 * plugin's page live instead of a file size, with a link to open it.
 *
 * A NATIVE <dialog> opened with showModal(), so it sits in the browser's TOP LAYER. A fixed scrim inside
 * this element would be captured by a host's containing block (VerticalTabsLayout sets contain:layout on
 * its content pane) and would fight the shell's z-index ladder; the top layer is above both, and brings
 * Escape-to-close and focus return with it.
 */
import { ref, watch, nextTick, computed } from 'vue'
import { useOptionalT } from '@map/composables/useOptionalT.js'

const props = defineProps({
  // One entry of listConfigurations(), or null when closed.
  config: { type: Object, default: null },
  // The printed document's size in bytes, once it has been drawn; null until then.
  fileBytes: { type: Number, default: null },
  label: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const t = useOptionalT('')

const dlg = ref(null)
watch(() => props.config, async (c) => {
  await nextTick()
  const d = dlg.value
  if (!d) return
  if (c && !d.open) d.showModal?.()
  else if (!c && d.open) d.close()
})

// A number with its unit, or an identifier, inside Arabic text is a left-to-right RUN: without an
// isolate the bidi algorithm reorders it ("KB 888", a configuration name split at its dots).
// LRI … PDI (U+2066 … U+2069) keeps the run whole in any locale and changes nothing in an LTR one.
const ltr = (s) => `\u2066${s}\u2069`
const fileSize = computed(() => {
  const b = props.fileBytes
  if (b == null) return t('posterDesign.details.fileSizeUnknown')
  return ltr(b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
})
const settings = computed(() => {
  const s = props.config?.settings || {}
  return Object.keys(s).length ? Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'
})
const agentLine = computed(() => (props.config ? t('posterDesign.details.forAgents', { name: ltr(props.config.name) }) : ''))

async function copyName() {
  try { await navigator.clipboard.writeText(props.config.name) } catch (_) { /* the name stays selectable */ }
}
</script>

<template>
  <dialog ref="dlg" class="pd-dialog" aria-labelledby="pd-dialog-title" @close="emit('close')" @cancel="emit('close')">
    <template v-if="config">
      <h2 id="pd-dialog-title" class="pd-dialog__title">{{ label }}</h2>
      <dl class="pd-dialog__list">
        <dt>{{ t('posterDesign.details.configName') }}</dt>
        <dd><code dir="ltr" class="pd-dialog__name">{{ config.name }}</code>
          <button type="button" class="pd-dialog__copy" @click="copyName">{{ t('posterDesign.details.copyName') }}</button></dd>
        <dt>{{ t('posterDesign.details.size') }}</dt>
        <dd>{{ config.size }}<span v-if="config.px"> · {{ ltr(`${config.px[0]} × ${config.px[1]} px`) }}</span></dd>
        <template v-if="!config.pageUrl">
        <dt>{{ t('posterDesign.details.fileSize') }}</dt>
        <dd>{{ fileSize }}</dd>
        </template>
        <dt>{{ t('posterDesign.details.settings') }}</dt>
        <dd dir="ltr">{{ settings }}</dd>
        <dt>{{ t('posterDesign.details.sample') }}</dt>
        <dd dir="ltr">{{ config.sample || '—' }}</dd>
        <dt>{{ t('posterDesign.details.renderer') }}</dt>
        <dd dir="ltr"><code>{{ config.renderer }}</code></dd>
      </dl>
      <div v-if="config.pageUrl" class="pd-dialog__live">
        <iframe class="pd-dialog__frame" :src="config.pageUrl" :title="label" loading="lazy"></iframe>
        <a class="pd-dialog__open" :href="config.pageUrl" target="_blank" rel="noopener">{{ t('posterDesign.details.openPage') }}</a>
      </div>
      <p v-if="config.legacy" class="pd-dialog__note">{{ t('posterDesign.details.legacy') }}</p>
      <p v-if="config.missing" class="pd-dialog__note">{{ t(config.missing) }}</p>
      <p class="pd-dialog__agent">{{ agentLine }}</p>
      <form method="dialog" class="pd-dialog__actions">
        <button type="submit" class="pd-dialog__close">{{ t('buttons.close') }}</button>
      </form>
    </template>
  </dialog>
</template>
