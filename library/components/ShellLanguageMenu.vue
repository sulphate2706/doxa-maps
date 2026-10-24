<!--
  ShellLanguageMenu — the language menu a header-off shell puts in VerticalTabsLayout's #phone-end
  (the phone bar) and #rail-end (the bottom of the desktop rail) slots. ONE component for both shells
  and both places, so the list, the host contract and the look cannot drift apart.

  THE LIST: SWITCHER_LANGUAGES (app-wrapper-material/languages.js) PLUS the current language when it is
  one of the hidden ones, so a reader on /de/… always sees Deutsch selected. hideFromSwitcher is the
  product's choice and is not changed here.

  THE CONTRACT (library/utils/languageRequest.js): a pick first asks the host page with a cancelable
  doxa-language-request. Cancelled → nothing happens here; the host sets the shell's `language`, and
  `current` follows. Not cancelled → emits 'switch' (the shell runs its own setLocale + saveLocale)
  and writes ?lang= only on a page this tree generated.

  A NATIVE <select>, laid transparent over its own face: the OS picker on a phone, the keyboard and
  screen-reader behaviour of a real select everywhere, and the face (🌐 + the language's own name, or
  its code in a collapsed rail) is only paint. The menu opens where the OS puts it (upward at the
  bottom of the rail), so it needs no placement prop.
-->
<script setup>
import { computed } from 'vue'
import { SWITCHER_LANGUAGES, getLanguage } from '../layouts/app-wrapper-material/languages.js'
import { icon } from '../layouts/app-wrapper-material/icons.js'
import { requestLanguage, writeOwnedLangParam } from '../utils/languageRequest.js'
import { tStatic } from '../i18n/index.js'

const props = defineProps({
  /** The shell's effective language code ('en', 'ar', …). */
  current: { type: String, default: 'en' },
  /** The desktop rail is collapsed to its icon strip: show the code, not the name. */
  collapsed: { type: Boolean, default: false },
})
const emit = defineEmits(['switch'])

const options = computed(() => {
  const list = SWITCHER_LANGUAGES.slice()
  if (props.current && !list.some((l) => l.code === props.current)) {
    const cur = getLanguage(props.current)
    if (cur) list.push(cur)
  }
  return list
})
const currentLang = computed(() => getLanguage(props.current) || { code: props.current, nativeName: props.current })
// The menu's name, in the language the reader is reading (the catalogue's controls.language).
const ariaLabel = computed(() => tStatic('controls.language', props.current) || 'Language')
const globe = icon('globe')

function onPick(e) {
  const sel = e.target
  const code = sel.value
  if (!code || code === props.current) return
  if (requestLanguage(sel, code)) {
    emit('switch', code)
    writeOwnedLangParam(code)
  } else {
    // The host took the request; show the current language until the host changes it.
    sel.value = props.current
  }
}
</script>

<template>
  <span class="slm" :class="{ collapsed }">
    <span class="slm-face" aria-hidden="true">
      <span class="slm-ic" v-html="globe"></span>
      <span v-if="collapsed" class="slm-code">{{ String(current).toUpperCase() }}</span>
      <span v-else class="slm-name" :lang="currentLang.code" :dir="currentLang.dir || null">{{ currentLang.nativeName }}</span>
      <span v-if="!collapsed" class="slm-caret">▾</span>
    </span>
    <select class="slm-select" :value="current" :aria-label="ariaLabel" :title="ariaLabel" @change="onPick">
      <option v-for="l in options" :key="l.code" :value="l.code" :lang="l.code" :dir="l.dir || null">{{ l.nativeName }}</option>
    </select>
  </span>
</template>

<style scoped>
/* 44px tall: the phone bar's end slot and the rail's bottom row are both tap targets. */
.slm { position: relative; display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; box-sizing: border-box; border-radius: 8px; color: #3b463d; }
.slm-face { display: inline-flex; align-items: center; gap: 6px; padding-inline: 10px; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.2; }
.slm-ic { flex: 0 0 auto; display: inline-flex; color: var(--vtl-muted, #6d766e); }
.slm-ic :deep(svg) { width: 18px; height: 18px; }
.slm-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.slm-code { font-weight: 600; font-size: 12px; letter-spacing: .03em; }
.slm-caret { flex: 0 0 auto; color: var(--vtl-muted, #6d766e); font-size: 11px; }
.slm.collapsed .slm-face { flex-direction: column; gap: 2px; padding-inline: 4px; }
/* The real control: transparent, covering the face, so every tap and key lands on the select. */
.slm-select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; border: 0; cursor: pointer; font-size: 16px; }
.slm:hover { background: var(--vtl-accented, #d1d4cd); }
.slm:focus-within { outline: 2px solid var(--vtl-accent, #92b195); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .slm { transition: none; } }
</style>
