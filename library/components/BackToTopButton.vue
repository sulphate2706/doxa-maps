<script setup>
/**
 * BackToTopButton — a ↑ that appears once a long list has been scrolled, and sits NEXT TO the
 * layout's floating hamburger circle rather than on top of it.
 *
 * It sits next to the hamburger circle on mobile, for the people-group grid and
 * the regions dashboard list. Both scroll their own container, so the container is a prop: this
 * component owns the affordance, never the data.
 *
 * ★ IT DOES NOT KNOW WHERE THE CIRCLE IS, AND MUST NOT GUESS. .vtl-fab lives in VerticalTabsLayout,
 * outside every plugin's shadow root, and it is 44px at a 12px inset TODAY. Hardcoding 64px here
 * would put this button on top of it the day that changes, silently, on a phone. The layout
 * publishes --map-fab-beside while the circle is rendered; this reads it and falls back to the
 * plain inset when there is no circle — which is also the standalone case, where nothing sets it.
 *
 * ★ AND IT REFUSES TO APPEAR WHEN IT CANNOT WORK. No target, or a target that does not scroll,
 * means no button: a ↑ that does nothing when pressed is worse than no ↑, because the reader spends
 * a tap finding out. That is why `visible` tests scrollTop AND scrollHeight, not scrollTop alone.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  /** The scrolling element. Passed in, because the list belongs to the consumer, not to this. */
  target: { type: Object, default: null },
  /** How far down before it appears. */
  threshold: { type: Number, default: 400 },
  /** Every string passed in; this component writes no prose. */
  labels: { type: Object, default: () => ({}) },
})

const scrolled = ref(0)
const scrollable = ref(false)

function measure() {
  const el = props.target
  if (!el) { scrolled.value = 0; scrollable.value = false; return }
  scrolled.value = el.scrollTop || 0
  // A container shorter than its own viewport cannot be scrolled to the top of.
  scrollable.value = (el.scrollHeight || 0) - (el.clientHeight || 0) > props.threshold
}

const visible = computed(() => scrollable.value && scrolled.value > props.threshold)

function toTop() {
  const el = props.target
  if (!el) return
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

let bound = null
function bind(el) {
  if (bound) { bound.removeEventListener('scroll', measure); bound = null }
  if (el) { el.addEventListener('scroll', measure, { passive: true }); bound = el }
  measure()
}
onMounted(() => bind(props.target))
watch(() => props.target, (el) => bind(el))
onBeforeUnmount(() => bind(null))
</script>

<template>
  <button
    v-if="visible"
    class="btt"
    type="button"
    :aria-label="labels.backToTop || ''"
    :title="labels.backToTop || ''"
    @click="toTop"
  >↑</button>
</template>

<style scoped>
/* Mirrors .vtl-fab's shape so the pair reads as one control group: same 44px circle, same inset,
   same shadow. The inline offset is READ from the layout, never assumed — see the header. */
.btt {
  position: absolute;
  z-index: 15;
  inset-inline-start: var(--map-fab-beside, calc(12px + env(safe-area-inset-left)));
  bottom: calc(12px + env(safe-area-inset-bottom));
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  font: 18px/1 system-ui;
  color: #3b463d; background: #fff;
  border: 1px solid var(--vtl-border, #d6d9d2);
  border-radius: 50%;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .18);
  cursor: pointer;
}
.btt:hover { background: #d1d4cd; }
.btt:focus-visible { outline: 2px solid var(--vtl-accent, #3b463d); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .btt { transition: none; } }
</style>
