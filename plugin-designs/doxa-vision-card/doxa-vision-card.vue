<script setup>
/**
 * doxa-vision-card.vue — Application Profile: Vision Card (Capability-1 showcase)
 *
 * @description A true funnel of the remaining task, every number computed from data: all people
 *              groups → unreached → frontier → the DOXA people groups. One self-contained element,
 *              no map, no token, no network: it renders instantly, embedded by iframe or script.
 * @profile     doxa-vision-card
 * @bundle      doxa-vision-card
 * @element     doxa-vision-card
 *
 * ★ WHY IT WAS REBUILT (2026-09-25). Its figures were reported as making no sense, and they could
 *   not be traced: the old card rotated four TYPED-IN figures (7,398 / 3,240 / 42% / 1,910) with no
 *   source. Now NO number is written here. They come from data/people-groups/vision-funnel.json,
 *   which library/scripts/people-groups/build-vision-funnel.mjs computes from the IMB people-group
 *   CSV in the repo and a saved snapshot of the live DOXA list, and which is compiled in at build
 *   time. The rules are in HOW-THE-NUMBERS-ARE-COUNTED.md beside this file, and in the card's own
 *   "How these are counted" note.
 *
 * ★ A TRUE FUNNEL. Bar widths are proportional to the counts, and the first three steps NEST (each
 *   is a subset of the one above). The DOXA list does not nest inside frontier, so the card says how
 *   many DOXA groups are frontier instead of drawing them as a sub-slice of it.
 *
 * Registered directly with defineCustomElement (index.js), not through the map ProfileLoader. It
 * reads `profile-config` for optional overrides: title, tagline, accent, locale.
 */
import { computed } from 'vue'
import { useHostedHelp } from '@map/composables/useHostedHelp.js'
import FUNNEL from '../../data/people-groups/vision-funnel.json'

// Every locale's strings, compiled in (library/i18n/locales/<lc>/vision.json, held to key parity by
// check:i18n-parity). Looked up per key: locale → English → the key itself.
const STRINGS = {}
for (const [path, mod] of Object.entries(import.meta.glob('../../library/i18n/locales/*/vision.json', { eager: true, import: 'default' }))) {
  const m = path.match(/locales\/([^/]+)\/vision\.json$/)
  if (m) STRINGS[m[1]] = mod
}

const props = defineProps({
  profileConfig: { type: String, default: '' },
})
const config = computed(() => {
  if (!props.profileConfig) return {}
  try { return JSON.parse(props.profileConfig) || {} } catch { return {} }
})

// The same ladder as the rest of the library (i18n/index.js detectLocale): the host's profile-config
// first, then ?lang= / ?locale= — without it the card was unreachable in any other language on the
// built tree, whose leaf pages all bake <html lang="en"> — then the page's lang.
const urlLang = (() => {
  try { const q = new URLSearchParams(window.location.search); return q.get('lang') || q.get('locale') || '' } catch { return '' }
})()
const locale = computed(() => {
  // profile-config `locale` OR `lang`: composites forward the page language as `lang`, so a card
  // nested in one missed it and fell back to English (documentation/reference-universal-props.md).
  const raw = String(config.value.locale || config.value.lang || urlLang || (typeof document !== 'undefined' && document.documentElement.lang) || 'en')
  const base = raw.split('-')[0].toLowerCase()
  return STRINGS[raw] ? raw : (STRINGS[base] ? base : 'en')
})
const dir = computed(() => (locale.value === 'ar' ? 'rtl' : 'ltr'))
function t(key, vars) {
  let s = (STRINGS[locale.value] || {})[key] || (STRINGS.en || {})[key] || key
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]))
  return s
}
const num = (n) => new Intl.NumberFormat(locale.value).format(n)
const people = (n) => new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const date = (iso) => { try { return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso + 'T00:00:00Z')) } catch { return iso } }

const accent = computed(() => config.value.accent || '#92b195')
// The card's "?" asks its HOST for this map's help (doxa:help); it shows only where a host answers.
const { hosted: helpHosted, askForHelp } = useHostedHelp()
const heading = computed(() => config.value.title || t('title'))
const tagline = computed(() => config.value.tagline || t('tagline'))

const top = FUNNEL.steps[0].groups
const steps = computed(() => FUNNEL.steps.map((s) => ({
  id: s.id,
  groups: num(s.groups),
  population: t('people', { n: people(s.population) }),
  label: t(s.id + 'Label'),
  note: s.id === 'doxa' ? t('doxaNote', { frontier: num(s.frontier) }) : t(s.id + 'Note'),
  // Proportional, with a floor so the smallest bar still holds its number.
  width: Math.max(24, Math.round((s.groups / top) * 100)),
})))
const rules = computed(() => ['ruleAll', 'ruleUnreached', 'ruleFrontier', 'ruleDoxa'].map((k) => t(k)))
const sources = computed(() => t('sources', {
  imb: FUNNEL.sources.imb.publisher, date: date(FUNNEL.sources.imb.captured), date2: date(FUNNEL.sources.doxa.fetched),
}))
</script>

<template>
  <div class="vc-root" :dir="dir" :lang="locale" :style="{ '--accent': accent }">
    <article class="vc-card">
      <button v-if="helpHosted" type="button" class="vc-help" :aria-label="t('about')" :title="t('about')"
              @click="askForHelp($event.currentTarget)">?</button>
      <div class="vc-kicker"><span class="vc-mark" aria-hidden="true"></span>{{ t('kicker') }}</div>
      <h1 class="vc-title">{{ heading }}</h1>
      <p class="vc-tagline">{{ tagline }}</p>

      <ol class="vc-funnel" :aria-label="t('funnelLabel')">
        <li v-for="(s, i) in steps" :key="s.id" class="vc-step" :class="'vc-step-' + s.id">
          <div class="vc-bar-row">
            <div class="vc-bar" :style="{ width: s.width + '%', '--i': i }">
              <span class="vc-n">{{ s.groups }}</span>
            </div>
          </div>
          <div class="vc-caption">
            <span class="vc-label">{{ s.label }}</span>
            <span class="vc-note">{{ s.note }} · {{ s.population }}</span>
          </div>
        </li>
      </ol>

      <details class="vc-how">
        <summary>{{ t('howCounted') }}</summary>
        <ul><li v-for="(r, i) in rules" :key="i">{{ r }}</li></ul>
      </details>
      <p class="vc-source">{{ sources }}</p>
    </article>
  </div>
</template>

<style>
/* defineCustomElement injects this root <style> into the element's shadow DOM.
   House style: Material LIGHT — #f3f3f1 surface, #fff card, #3b463d text, #92b195 accent,
   #d1d4cd border, #6d766e muted. No dark backdrop (the old aurora card was near-black). */
:host { display: block; }
.vc-root {
  position: absolute; inset: 0; overflow: auto;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 16px; box-sizing: border-box;
  background: #f3f3f1; color: #3b463d;
  font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.vc-card {
  position: relative;
  width: 100%; max-width: 640px; box-sizing: border-box;
  background: #fff; border: 1px solid #d1d4cd; border-radius: 16px;
  box-shadow: 0 1px 2px rgba(59,70,61,.06), 0 8px 24px -12px rgba(59,70,61,.18);
  padding: 28px 28px 20px;
}
.vc-kicker {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6d766e;
}
.vc-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
/* The card's "?": top corner at the END of the reading direction, so Arabic mirrors it. */
.vc-help {
  position: absolute; top: 14px; inset-inline-end: 14px; width: 28px; height: 28px; border-radius: 50%;
  border: 1px solid #d1d4cd; background: #fff; color: #3b463d; font: 700 15px/1 Georgia, serif; cursor: pointer;
}
.vc-help:focus-visible { outline: 2px solid #3f8f5a; outline-offset: 2px; }
.vc-title { margin: 10px 0 6px; font-size: clamp(22px, 4.2vw, 30px); line-height: 1.15; font-weight: 800; color: #3b463d; }
.vc-tagline { margin: 0 0 22px; font-size: 15px; line-height: 1.5; color: #6d766e; }

.vc-funnel { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.vc-bar-row { display: flex; justify-content: center; }
.vc-bar {
  box-sizing: border-box; min-height: 44px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; padding: 0 10px;
  background: var(--accent); color: #1d2a1f;
  animation: vc-grow .7s cubic-bezier(.16,1,.3,1) both; animation-delay: calc(var(--i) * 90ms);
  transform-origin: center;
}
/* The funnel darkens as it narrows: the last step is the assignment. */
.vc-step-all .vc-bar { background: #dfe7df; }
.vc-step-unreached .vc-bar { background: #c3d5c4; }
.vc-step-frontier .vc-bar { background: #a8c3aa; }
.vc-step-doxa .vc-bar { background: #3b463d; color: #fff; }
.vc-n { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.vc-caption { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: 6px; text-align: center; }
.vc-label { font-size: 14px; font-weight: 700; color: #3b463d; }
.vc-note { font-size: 12.5px; color: #6d766e; }
@keyframes vc-grow { from { transform: scaleX(.2); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .vc-bar { animation: none; } }

.vc-how { margin-top: 22px; border-top: 1px solid #e6e8e3; padding-top: 12px; font-size: 13px; color: #3b463d; }
.vc-how summary { cursor: pointer; font-weight: 700; color: #3b463d; }
.vc-how summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.vc-how ul { margin: 8px 0 0; padding-inline-start: 18px; line-height: 1.55; color: #3b463d; }
.vc-source { margin: 12px 0 0; font-size: 11.5px; line-height: 1.5; color: #6d766e; }
</style>
