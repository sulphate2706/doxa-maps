<!--
  PosterDialog.vue — modal for previewing + rendering a poster export.

  Wires together:
    - posterSizes preset picker
    - format (PNG / PDF) picker
    - orientation toggle
    - DPI selector
    - PosterPreview live-preview pane
    - render → download trigger via useMapPoster

  Caller passes a `getMap` accessor and optional `legendRows` (for legend slot)
  and `metadata` (for footer slot).

  Slots (Vue) you can override:
    - #header          — replace the title bar
    - #format-extras   — add custom inputs next to the format picker
-->
<template>
  <transition name="poster-dlg">
    <div v-if="visible" ref="scrimRef" :style="scrimStyle" class="poster-dlg-backdrop" @click.self="onClose">
      <section class="poster-dlg" role="dialog" aria-modal="true" :aria-label="T('poster.export_poster', 'Export Poster')">
        <header class="poster-dlg__header">
          <slot name="header">
            <h2>{{ T('poster.export_poster', 'Export Poster') }}</h2>
          </slot>
          <button class="poster-dlg__close" type="button" :aria-label="T('buttons.close', 'Close')" @click="onClose">×</button>
        </header>

        <div class="poster-dlg__body">
          <aside class="poster-dlg__controls">
            <label class="ctl">
              <span>{{ T('poster.size', 'Size') }}</span>
              <select v-model="sizeId">
                <option v-for="s in sizes" :key="s.id" :value="s.id" :disabled="phoneTooBig(s, 150)">{{ s.label }}</option>
              </select>
            </label>
            <p v-if="PHONE" class="ctl-note">{{ T('poster.phoneLimit', "On a phone, the largest sizes are off: a phone can't draw a poster that big. Use a computer for them.") }}</p>

            <label class="ctl">
              <span>{{ T('poster.orientation', 'Orientation') }}</span>
              <select v-model="orientation">
                <option value="portrait">{{ T('poster.portrait', 'Portrait') }}</option>
                <option value="landscape">{{ T('poster.landscape', 'Landscape') }}</option>
              </select>
            </label>

            <label class="ctl">
              <span>{{ T('poster.dpi', 'DPI') }}</span>
              <select v-model.number="dpi">
                <option :value="150" :disabled="phoneTooBig(getPosterSize(sizeId), 150)">150 (large posters)</option>
                <option :value="200" :disabled="phoneTooBig(getPosterSize(sizeId), 200)">200 (balanced)</option>
                <option :value="300" :disabled="phoneTooBig(getPosterSize(sizeId), 300)">300 (sharp)</option>
              </select>
            </label>

            <label class="ctl">
              <span>{{ T('poster.format', 'Format') }}</span>
              <select v-model="format">
                <option value="png">{{ T('poster.png_raster', 'PNG (raster)') }}</option>
                <option value="pdf">{{ T('poster.pdf_raster', 'PDF (raster on vector page)') }}</option>
              </select>
              <slot name="format-extras" />
            </label>

            <label class="ctl">
              <span>{{ T('poster.title', 'Title') }}</span>
              <input v-model="titleText" type="text" :placeholder="T('poster.map_title', 'Map title')" />
            </label>

            <label class="ctl">
              <span>{{ T('poster.subtitle', 'Subtitle') }}</span>
              <input v-model="subtitleText" type="text" :placeholder="T('poster.optional', '(optional)')" />
            </label>

            <fieldset class="ctl ctl--check">
              <legend>{{ T('poster.slots', 'Slots') }}</legend>
              <label><input v-model="enableLegend"   type="checkbox" /> {{ T('legend.header.default', 'Legend') }}</label>
              <label><input v-model="enableScale"    type="checkbox" /> {{ T('poster.scale_bar', 'Scale bar') }}</label>
              <label><input v-model="enableNorth"    type="checkbox" /> {{ T('poster.north_arrow', 'North arrow') }}</label>
              <label class="muted"><input type="checkbox" checked disabled /> {{ T('poster.footer_attribution', 'Footer (attribution required)') }}</label>
            </fieldset>

            <!-- ★ A LONG RENDER SAYS SO. Large or high-dpi posters take from under a minute to several
                 (measured timings: A4 300 dpi ~42 s, 24x36 in 150 dpi 90-135 s, 24x36 in 300 dpi ~4 min), and this
                 used to show an internal phase name and a bar that restarted with every phase. Now: the overall
                 percent (the composable's monotonic fraction), the time elapsed, the tile count while stitching,
                 an honest expectation for the chosen size, and a message if it fails. -->
            <div class="render-status" v-if="poster.isRendering.value || renderError" role="status" aria-live="polite">
              <template v-if="poster.isRendering.value">
                <strong>{{ T('poster.rendering', 'Rendering…') }}</strong>
                <progress max="100" :value="poster.progress.value.percent || 0" />
                <small>{{ progressDetail }}</small>
                <small v-if="sizeHint" class="render-hint">{{ sizeHint }}</small>
                <button class="btn btn--ghost" type="button" @click="poster.cancel">{{ T('poster.cancel', 'Cancel') }}</button>
              </template>
              <p v-else class="render-error" role="alert">{{ renderError }}</p>
            </div>

            <div class="actions">
              <button class="btn btn--ghost" type="button" @click="onClose">{{ T('buttons.close', 'Close') }}</button>
              <button class="btn btn--primary" type="button" :disabled="poster.isRendering.value" @click="onRender">
                {{ poster.isRendering.value ? T('poster.rendering', 'Rendering…') : fillIn(T('poster.render_format', 'Render {format}'), { format: format.toUpperCase() }) }}
              </button>
            </div>
          </aside>

          <main class="poster-dlg__preview">
            <PosterPreview
              :spec="spec"
              :get-map="getMap"
              :legend-rows="legendRows"
              :metadata="metadata"
            />
          </main>
        </div>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import PosterPreview from './PosterPreview.vue';
import { useMapPoster, posterPixels } from '../../composables/poster/useMapPoster.js';
import { listPosterSizes, getPosterSize, DEFAULT_POSTER_ID } from '../../constants/posterSizes.js';
import { defaultPosterSpec, posterDefaults } from '../../constants/posterDefaults.js';
// Backdrop geometry — a fixed;inset:0 backdrop covers only the content pane inside the cap-5
// shell (contain:layout on .vtl-content). See library/utils/viewportScrim.js.
import { useViewportScrim } from '../../utils/viewportScrim.js';
import { tStatic } from '../../i18n/index.js';
import { printImageBlob, isPhonePrint } from '../../composables/printInPlace.js';

// This dialog's chrome, read out of the catalogue. tStatic and not useI18n: these components mount
// inside custom elements that install no i18n plugin, and an unguarded useI18n() throws on the way
// in and takes the dialog with it. The English stays as the fallback so a missing key degrades to
// what shipped rather than to a key name.
const T = (key, en) => tStatic(key) || en;

const props = defineProps({
  /**
   * What the Render button does. 'print' (default, the rule since 2026-09-28: an export-poster button opens
   * the PRINT DIALOG with a preview, never a direct download) prints the rendered poster in place; a PDF
   * opens in the browser's viewer, where it can be printed or saved. 'download' saves the file, and a
   * consumer that opts in must say why in a `posterAction-download:` comment (check:poster-action-print).
   */
  action:     { type: String,   default: 'print' },   // 'print' | 'download'
  /** Boolean v-model: dialog visibility. */
  modelValue: { type: Boolean, default: false },
  /** Function returning the live Mapbox map instance. */
  getMap:     { type: Function, required: true },
  /** Optional pre-built legend rows: [{ color, label }] */
  legendRows: { type: Array,    default: () => [] },
  /** Optional metadata for footer slot, e.g. { source, date, author } */
  metadata:   { type: Object,   default: () => ({}) },
  /** Optional initial size id. */
  initialSize: { type: String,  default: DEFAULT_POSTER_ID },
});

const emit = defineEmits(['update:modelValue', 'rendered', 'error']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const { scrimRef, scrimStyle } = useViewportScrim(visible);

const sizes        = listPosterSizes();
// ★ A PHONE CANNOT DRAW THE DEFAULT POSTER (2026-09-30: "Export poster -> nothing happens" on a phone). The default
// is 24x36 in at its recommended 300 dpi, 7200x10800 = 77.8 MP, rendered as stitched tiles into one master canvas:
// minutes on a desktop, and far past iOS Safari's canvas area limit (4096x4096 = 16.7 MP) on a phone. On a phone
// (the platform test printInPlace uses) the dialog opens on Letter at 150 dpi (2.1 MP, one canvas, seconds), and a
// size or dpi whose canvas would exceed that limit is disabled, with the reason shown. Desktop is unchanged.
const PHONE = isPhonePrint();
const PHONE_MAX_PX = 4096 * 4096;
const PHONE_DEFAULT_SIZE = 'letter';
const pxAt = (s, d) => (s && s.inches ? Math.round(s.inches.w * d) * Math.round(s.inches.h * d) : 0);
const phoneTooBig = (s, d) => PHONE && pxAt(s, d) > PHONE_MAX_PX;
const sizeId       = ref(PHONE && props.initialSize === DEFAULT_POSTER_ID ? PHONE_DEFAULT_SIZE : props.initialSize);
const orientation  = ref('portrait');
const dpi          = ref(300);
const format       = ref('png');
const titleText    = ref('');
const subtitleText = ref('');
const enableLegend = ref(true);
const enableScale  = ref(true);
const enableNorth  = ref(true);

watch(sizeId, (id) => {
  const s = getPosterSize(id);
  if (s) {
    dpi.value = PHONE ? 150 : s.recommendedDpi;
    if (s.orientation !== 'either') orientation.value = s.orientation;
  }
}, { immediate: true });

const spec = computed(() => {
  const s = getPosterSize(sizeId.value);
  if (!s) return defaultPosterSpec({ widthIn: 24, heightIn: 36 });
  const base = defaultPosterSpec({
    widthIn:  s.inches.w,
    heightIn: s.inches.h,
    dpi:      dpi.value,
    orientation: orientation.value,
  });
  base.slots.title = {
    ...base.slots.title,
    text: titleText.value,
    subtitle: subtitleText.value,
  };
  base.slots.legend   = enableLegend.value
    ? { ...base.slots.legend, rows: props.legendRows }
    : null;
  base.slots.scaleBar = enableScale.value;
  base.slots.north    = enableNorth.value;
  base.slots.footer   = {
    ...base.slots.footer,
    left:  props.metadata.source ? `Source: ${props.metadata.source}` : '',
    right: props.metadata.date   ? `${props.metadata.date}`           : new Date().toISOString().slice(0, 10),
    attribution: posterDefaults.footer.attribution,
  };
  return base;
});

const poster = useMapPoster(props.getMap);

// {name} interpolation for the T() strings below.
const fillIn = (str, params) => String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));

// The time elapsed, ticking once a second while a render runs.
const elapsed = ref(0);
let elapsedTimer = null;
watch(() => poster.isRendering.value, (on) => {
  clearInterval(elapsedTimer);
  if (!on) return;
  const t0 = Date.now();
  elapsed.value = 0;
  elapsedTimer = setInterval(() => { elapsed.value = Math.round((Date.now() - t0) / 1000); }, 1000);
});
onBeforeUnmount(() => clearInterval(elapsedTimer));
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const progressDetail = computed(() => {
  const p = poster.progress.value;
  const parts = [`${p.percent || 0}%`, fillIn(T('poster.progress_elapsed', '{time} elapsed'), { time: clock(elapsed.value) })];
  if (p.phase === 'stitch' && p.total) parts.push(fillIn(T('poster.progress_tiles', 'tile {n} of {total}'), { n: p.completed, total: p.total }));
  return parts.join(' · ');
});
// An honest expectation from the size chosen, before and during the render. Thresholds from measured timings
// under load: 8.7 MP (A4 300 dpi) ~42 s; 19.4 MP (24x36 in 150 dpi) 90-135 s; 77.8 MP (24x36 in 300 dpi) ~4 min.
const sizeHint = computed(() => {
  let mp = 0;
  try { const px = posterPixels(spec.value); mp = (px.width * px.height) / 1e6; } catch { return ''; }
  if (mp >= 15) return T('poster.hint_few_minutes', 'Large posters can take a few minutes to render.');
  if (mp >= 5) return T('poster.hint_up_to_minute', 'This size can take up to a minute to render.');
  return '';
});
// A failed render used to vanish: the status block disappeared and only the console knew. The reader now
// gets a sentence, specific when the device ran out of memory (the large-format failure: an oversized canvas
// the browser cannot allocate or encode), and nothing when they cancelled it themselves.
const renderError = ref('');
const OUT_OF_MEMORY = /out of memory|allocation failed|array buffer|invalid array length|context lost|toBlob failed|too large|exceeds/i;
function renderFailureText(err) {
  if (err?.name === 'AbortError') return '';
  if (err?.name === 'RangeError' || OUT_OF_MEMORY.test(String(err?.message || err))) {
    return T('poster.error_too_large', "This poster is too large for this device's memory. Choose a smaller size or a lower resolution.");
  }
  return T('poster.error_failed', 'The poster could not be rendered. Try again, or choose a smaller size.');
}

async function onRender() {
  renderError.value = '';
  try {
    const blob = await poster.render(spec.value, format.value);
    const ext  = (format.value === 'pdf') ? 'pdf' : 'png';
    const name = (titleText.value || 'poster').replace(/\W+/g, '-').toLowerCase();
    if (props.action === 'download') _download(blob, `${name}.${ext}`);
    else if (ext === 'png') {
      const s = getPosterSize(sizeId.value);
      const opened = printImageBlob(blob, { labels: { print: T('wall.hud.printNow', 'Print'), close: T('buttons.close', 'Close') },
        widthIn: s?.inches?.w || 8.5, heightIn: s?.inches?.h || 11, title: titleText.value || 'poster', alt: titleText.value || '' });
      if (!opened) _download(blob, `${name}.${ext}`);   // the host blocked the print frame: a file beats nothing
    } else {
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener');
      if (!w) _download(blob, `${name}.${ext}`);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    emit('rendered', { blob, format: format.value, spec: spec.value });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[PosterDialog] render failed', err);
    renderError.value = renderFailureText(err);
    emit('error', err);
  }
}

function onClose() { visible.value = false; }

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
</script>

<style scoped>
.poster-dlg-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.poster-dlg {
  background: #fff;
  width: min(1100px, 95vw);
  height: min(800px, 92vh);
  border-radius: 8px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.poster-dlg__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid #eee;
}
.poster-dlg__header h2 { margin: 0; font-size: 16px; font-weight: 600; }
.poster-dlg__close {
  background: none; border: 0; font-size: 22px; cursor: pointer; color: #555;
}
.poster-dlg__body {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: 280px 1fr;
}
.poster-dlg__controls {
  padding: 14px;
  border-right: 1px solid #eee;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  background: #fafafa;
}
.poster-dlg__preview {
  padding: 14px;
  overflow: auto;
  background: #2b2b2b;
}
.ctl { display: flex; flex-direction: column; font-size: 12px; color: #444; gap: 4px; }
.ctl-note { margin: -4px 0 0; font-size: 11px; line-height: 1.35; color: #666; }
.ctl--check { border: 0; padding: 0; margin: 0; }
.ctl--check legend { font-size: 12px; color: #444; padding: 0 0 4px 0; }
.ctl--check label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.ctl input, .ctl select { padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; }
.muted { opacity: 0.65; }
.actions { display: flex; gap: 8px; margin-top: auto; }
.btn { padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; font-size: 13px; }
.btn--primary { background: #2266dd; color: #fff; border-color: #2266dd; }
.btn--primary:disabled { background: #88aae0; cursor: progress; }
.btn--ghost { background: transparent; }
.render-status { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: #fff; border: 1px solid #eee; border-radius: 4px; font-size: 12px; }
.render-status progress { width: 100%; }
.render-hint { opacity: .75; }
.render-error { margin: 0; color: #b42318; font-size: 13px; line-height: 1.4; }
.poster-dlg-enter-active, .poster-dlg-leave-active { transition: opacity 0.15s ease; }
.poster-dlg-enter-from, .poster-dlg-leave-to { opacity: 0; }
/* Reduced motion: this component's styles do not go through useShadowStyles, so it carries its own guard
   (check:shadow-reduced-motion). */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
</style>
