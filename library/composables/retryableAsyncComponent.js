/**
 * retryableAsyncComponent.js — SHARED (@map/composables/retryableAsyncComponent.js).
 *
 * ★ WHY (card BUG-LAZY-PLUGIN-DEATH-ON-A-SINGLE-FAILED-IMPORT). Vue's defineAsyncComponent
 * caches a REJECTED loader promise: once a dynamic import() fails, that component is dead for
 * the life of the page — every later render replays the same rejection. It happened live, exactly
 * like this: one net::ERR_NETWORK_CHANGED event (wifi switch / VPN / sleep-wake, a TRANSPORT blip,
 * not a 404) failed five unrelated module fetches at the same moment, and doxa-simple-map +
 * doxa-research-map stayed "not loading" until a full reload — a working product reading as
 * two broken plugins.
 *
 * This is the ONE shared wrapper every lazy component goes through instead. It uses
 * defineAsyncComponent's own onError contract — retry() re-invokes the loader, which issues a
 * FRESH import() request — with 3 attempts and a short growing backoff, which is precisely the
 * shape a transient network blip needs. If all attempts fail (a real 404, a dead server), it
 * fails for good: retrying forever would hide genuine breakage.
 *
 * Usage (drop-in): retryableAsyncComponent(() => import('./Heavy.vue'))
 */
import { defineAsyncComponent, defineComponent, h, ref, shallowRef } from 'vue'
import { useOptionalT } from './useOptionalT.js'

// ★ WHEN ALL RETRIES FAIL the pane used to render BLANK: no message, no way back but a full reload.
// Now it says so and offers Retry. Retry cannot revive the dead async component (Vue caches its
// rejected load), so it swaps in a FRESH one: `current` is reactive, the wrapper renders whatever
// it holds, and every mounted instance of this lazy component re-renders with the new loader.
// The wrapper declares no props, so props, listeners and slots pass straight through; no consumer
// puts a template ref on a lazy component (checked at all 8 before adding the layer).
// Its own background and colour: it renders over map panes and dark basemaps, where inherited
// text with no surface can be invisible, the blank-pane symptom this exists to remove.
const LIGHT = 'background:var(--dx-elevated, #fff);color:var(--dx-text, #3b463d);border:1px solid var(--dx-line, #d1d4cd);'
const DARK = 'background:#2b2f2c;color:#e8e9e6;border:1px solid #4a4f4b;'
const LoadFailed = defineComponent({
  name: 'LazyLoadFailed',
  props: { onRetry: { type: Function, required: true }, dark: Boolean },
  setup(props) {
    const t = useOptionalT('messages')
    // One press per failure: the press swaps the component and this view unmounts, so a second
    // press could only queue a duplicate attempt.
    const pressed = ref(false)
    const press = () => { if (pressed.value) return; pressed.value = true; props.onRetry() }
    return () => h('div', {
      class: 'dx-lazy-failed', role: 'alert',
      style: 'padding:12px;font-size:13px;line-height:1.4;border-radius:8px;' + (props.dark ? DARK : LIGHT),
    }, [
      h('span', t('viewLoadFailed')),
      ' ',
      h('button', { type: 'button', disabled: pressed.value, style: 'font:inherit;cursor:pointer;', onClick: press }, t('retry')),
    ])
  },
})

function attempt(loader, onRetry) {
  return defineAsyncComponent({
    loader,
    // The consumer's attrs fall through the async wrapper to this root, so a pane passed isDark
    // hands it on; everything else is dropped rather than landing on the message's <div>.
    errorComponent: defineComponent({
      inheritAttrs: false,
      props: { isDark: Boolean },
      setup: (p) => () => h(LoadFailed, { onRetry, dark: p.isDark }),
    }),
    onError(error, retry, fail, attempts) {
      if (attempts <= 3) setTimeout(retry, attempts * 500)
      else fail()
    },
  })
}

export function retryableAsyncComponent(loader) {
  const current = shallowRef(null)
  const rearm = () => { current.value = attempt(loader, rearm) }
  rearm()
  return defineComponent({
    name: 'RetryableAsync',
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h(current.value, attrs, slots)
    },
  })
}
