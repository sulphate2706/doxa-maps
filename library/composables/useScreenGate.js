/**
 * useScreenGate — the phone rule for one element (SPEC-MOBILE-FLAG).
 *
 * profile-config `mobile` comes from <profile>.meta.json through the leaf page (generate-tree):
 *   'desktop-only'    on a narrow screen the element is NOT mounted; a message says why
 *   'larger-screens'  the element mounts under a dismissible notice
 * Neither shows inside the Research Gallery, which keeps its own rail badge and pane notice: every
 * Gallery pane carries data-doxa-gallery, so a reader never gets two. (Not data-doxa-help: the Gallery
 * sets that only on panes whose map has help, so it would miss the rest.)
 *
 * WHY A COMPOSABLE. ProfileLoader applied the rule, and a baked composite that defines its element
 * without ProfileLoader (dashboard-plus-grid) carried the flag on its leaf page and ignored it: at 390px
 * the desktop-only map mounted anyway. Any root that is not under ProfileLoader calls this itself;
 * check:mobile-gating holds every flagged profile to one or the other.
 *
 * The host is already in the document when setup runs, so "inside the Gallery" is known before anything
 * mounts, and a blocked element is never mounted at all rather than mounted and then removed.
 *
 * @param {import('vue').Ref<object>} config  the element's parsed profile-config
 */
import { computed, ref, watch, onBeforeUnmount, useHost } from 'vue'

export const NARROW_SCREEN = '(max-width: 639.98px)'

function insideGallery(node) {
  for (let n = node; n; n = n.parentNode || n.host) {
    if (n.nodeType === 1 && n.hasAttribute('data-doxa-gallery')) return true
  }
  return false
}

export function useScreenGate(config) {
  const flag = computed(() => {
    const m = config.value?.mobile
    return m === 'desktop-only' || m === 'larger-screens' ? m : null
  })
  let host = null
  try { host = useHost() } catch { host = null }
  const hosted = host ? insideGallery(host) : false

  const narrow = ref(false)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(NARROW_SCREEN)
    narrow.value = mq.matches
    const onChange = (e) => { narrow.value = e.matches }
    mq.addEventListener?.('change', onChange)
    onBeforeUnmount(() => mq.removeEventListener?.('change', onChange))
  }

  const dismissKey = computed(() => `dx-maps:larger-screens-dismissed:${config.value?.profile || ''}`)
  const dismissed = ref(false)
  watch(dismissKey, (k) => {
    try { dismissed.value = sessionStorage.getItem(k) === '1' } catch { dismissed.value = false }
  }, { immediate: true })
  function dismiss() {
    dismissed.value = true
    try { sessionStorage.setItem(dismissKey.value, '1') } catch { /* private mode: dismissed until reload */ }
  }

  return {
    flag,
    blocked: computed(() => flag.value === 'desktop-only' && narrow.value && !hosted),
    advise: computed(() => flag.value === 'larger-screens' && narrow.value && !hosted && !dismissed.value),
    dismiss,
    label: computed(() => String(config.value?.mobileLabel || config.value?.profile || '')),
  }
}
