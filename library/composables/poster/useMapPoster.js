/**
 * useMapPoster — render a Mapbox GL map to a poster-grade PNG or PDF blob.
 *
 * Two render paths:
 *   1. Single-canvas (≤4096² output, fast):
 *      - Spin up a hidden map at the requested poster pixel size.
 *      - Override window.devicePixelRatio for the hidden map only.
 *      - Wait for `idle`, capture via getCanvas().toDataURL().
 *      - Composite overlay (title, legend, scale, north, footer) on a 2D canvas.
 *
 *   2. Tile-stitch (>4096², size-aware fallback):
 *      - Iterate an N×M grid of viewports on the hidden map at TILE_PX each.
 *      - For each tile: jumpTo, await idle, capture, paint into the master canvas.
 *      - Memory-bound — caller should be aware.
 *
 * If the requested pixel size > 4096 in either dimension AND the user requested
 * the single-canvas path, we auto-switch to tile-stitch with a console warning.
 *
 * Mapbox attribution is ALWAYS rendered into the footer slot — non-negotiable
 * (Mapbox ToS).
 *
 * @example
 *   const poster = useMapPoster(getMap);
 *   const blob = await poster.render(spec, 'png');
 *   download(blob, 'research-map.png');
 *
 * // TODO package.json deps when you wire this:
 * //   "jspdf": "^4.2.1",
 * //   "svg2pdf.js": "^2.5.0",
 * //   "pdf-lib": "^1.17.1",
 * //   "@pdf-lib/fontkit": "^1.1.1"
 */

import { ref, readonly } from 'vue';
import { equalHeightLatBands } from '../../maps/mercator-slice.js';
import { computeLayout } from './usePosterLayout.js';
import { attributionTextFromMap } from '../../maps/map-attribution.js';
import { engineFor } from '../useMapProvider.js';

const MAX_SINGLE_CANVAS = 4096;       // WebGL safe ceiling for most hardware
const TILE_PX           = 2048;        // tile size for stitch path
const IDLE_TIMEOUT_MS   = 15000;

/**
 * @typedef {Object} PosterMargins
 * @property {number} top    inches
 * @property {number} right  inches
 * @property {number} bottom inches
 * @property {number} left   inches
 */

/**
 * @typedef {Object} PosterSlots
 * @property {Object}  [title]    { text, subtitle?, align? }
 * @property {Object}  [legend]   { rows: Array, type?: string }
 * @property {boolean} [scaleBar]
 * @property {boolean} [north]
 * @property {Object}  [footer]   { left?, right?, attribution? }
 */

/**
 * @typedef {Object} PosterSpec
 * @property {number}                widthIn
 * @property {number}                heightIn
 * @property {150|200|300}           dpi
 * @property {'portrait'|'landscape'} orientation
 * @property {PosterMargins}         margins
 * @property {number}                bleed         inches
 * @property {PosterSlots}           slots
 * @property {'auto'|'single'|'stitch'} [renderPath='auto']
 * @property {string}                [filename]
 * @property {AbortSignal}           [signal]
 */

/**
 * @param {() => any} getSourceMap  function returning the live Mapbox map
 * @returns {{
 *   render: (spec: PosterSpec, format: 'png'|'pdf') => Promise<Blob>,
 *   progress: import('vue').Ref<{ phase: string, completed: number, total: number, message: string }>,
 *   isRendering: import('vue').Ref<boolean>,
 *   cancel: () => void
 * }}
 */
export function useMapPoster(getSourceMap) {
  const progress    = ref({ phase: 'idle', completed: 0, total: 0, message: '', fraction: 0, percent: 0 });
  const isRendering = ref(false);
  let   abortCtrl   = null;

  /**
   * Render the poster.
   * @param {PosterSpec} spec
   * @param {'png'|'pdf'} [format='png']
   * @returns {Promise<Blob>}
   */
  async function render(spec, format = 'png') {
    if (isRendering.value) throw new Error('useMapPoster: already rendering');
    const sourceMap = getSourceMap();
    if (!sourceMap) throw new Error('useMapPoster: no source map');

    abortCtrl = new AbortController();
    const signal = mergeSignals(spec.signal, abortCtrl.signal);

    isRendering.value = true;
    _maxFraction = 0;
    _setProgress('init', 1, 1, 'preparing render');

    try {
      const px         = posterPixels(spec);
      const renderPath = decidePath(spec.renderPath || 'auto', px);

      if (renderPath === 'single' && (px.width > MAX_SINGLE_CANVAS || px.height > MAX_SINGLE_CANVAS)) {
        // the caller asked for single but it exceeds the WebGL ceiling — auto-switch
        // eslint-disable-next-line no-console
        console.warn(
          `[useMapPoster] requested single-canvas ${px.width}×${px.height}px > ${MAX_SINGLE_CANVAS}; ` +
          `auto-switching to tile-stitch.`
        );
      }

      const finalPath = (renderPath === 'single' &&
                         (px.width > MAX_SINGLE_CANVAS || px.height > MAX_SINGLE_CANVAS))
        ? 'stitch'
        : renderPath;

      // ★ THE POSTER LAYOUT IS OPT-IN, AND THAT IS A RULING, NOT A PREFERENCE.
      // usePosterLayout has always computed a real layout — map narrowed by the legend column, inset
      // by the margins, the title strip and the footer strip — and nothing here ever used it. The map
      // was rastered at FULL PAGE size and the title, legend and footer were composited ON TOP, so the
      // legend lay over the map it describes and there were no bands. PosterPreview.vue honours
      // layout.map, which is why the on-screen preview looked right and only the exported file was
      // wrong; a preview is not evidence for an export.
      //
      // WHY OPT-IN RATHER THAN SIMPLY FIXED (decided after the UPG-100 check): country-posters
      // embeds THIS renderer's output as a full-sheet <img> inside its own packet page, under the
      // packet's own title. Turning the chrome on by default would print a second header and footer
      // inside their page. UPG-100's packet does not call this renderer at all, so it is unaffected.
      // So a caller asks for the composed sheet with spec.layout === 'poster'; every existing caller,
      // which sets no layout, keeps today's full-bleed behaviour BYTE FOR BYTE.
      const posterLayout = spec.layout === 'poster';
      const layout = posterLayout ? computeLayout(spec, px) : null;
      // A page too small for its own margins, bands and legend column cannot hold a map. Falling back
      // to full-bleed is a poster rather than nothing, but silence here would be the original bug.
      const fits = !!layout && layout.map.w > 0 && layout.map.h > 0;
      if (posterLayout && !fits) {
        // eslint-disable-next-line no-console
        console.warn('[useMapPoster] layout:"poster" asked for a map box of ' +
          (layout ? layout.map.w + '×' + layout.map.h : '0×0') + 'px; the margins, title, footer and ' +
          'legend column leave no room on this sheet. Falling back to a full-bleed map.');
      }
      const mapPx = fits ? { width: layout.map.w, height: layout.map.h, dpi: px.dpi } : px;

      const baseRaster = (finalPath === 'single')
        ? await _renderSingleCanvas(sourceMap, mapPx, signal)
        : await _renderTileStitch(sourceMap, mapPx, signal);

      _setProgress('compose', 0, 1, 'compositing overlay');
      // ★ THE FOOTER CREDITS WHOEVER ACTUALLY SERVED THE TILES. posterDefaults ships
      // '© Mapbox © OpenStreetMap', which under the fleet's MapLibre default credits a company that
      // served nothing and omits the three parties whose licences do apply. Read from the map rather
      // than from a constant; the spec's value stays as the fallback, because an EMPTY attribution is
      // the one outcome a licence never allows. The caller's spec is copied, not mutated — it belongs
      // to whoever passed it in.
      const credit = attributionTextFromMap(sourceMap);
      const specForOverlay = credit
        ? { ...spec, slots: { ...spec.slots, footer: { ...(spec.slots?.footer || {}), attribution: credit } } }
        : spec;
      // Paper first, then the map into the box the layout reserved. White rather than transparent: a
      // PNG with holes prints as whatever is under it, and the slots draw panels expecting paper.
      const sheet = fits ? _placeMapOnSheet(baseRaster, layout, px) : baseRaster;
      const composed = await _composeOverlay(sheet, specForOverlay, px);

      _setProgress('encode', 0, 1, `encoding ${format.toUpperCase()}`);
      const blob = (format === 'pdf')
        ? await _toPdfBlob(composed, spec)
        : await _canvasToBlob(composed, 'image/png');

      _setProgress('done', 1, 1, 'render complete');
      return blob;
    } finally {
      isRendering.value = false;
      abortCtrl = null;
    }
  }

  function cancel() {
    if (abortCtrl) abortCtrl.abort();
  }

  // ── PHASE WEIGHTS: a bar that moves through the WHOLE render ────────────
  // Every phase used to report (0 of 1), so the bar sat at 0% for the entire
  // slow part — spawning a hidden map and waiting for tiles is most of the wall
  // clock — and then jumped to 100% in the last instant. A user reads a bar that
  // does not move as FROZEN.
  //
  // These weights are the approximate share of wall-clock each phase takes, so
  // `fraction` advances continuously and is MONOTONIC (it can never go
  // backwards, which also reads as a glitch). Within a phase, completed/total
  // interpolates — the tile-stitch path reports real per-tile progress, so its
  // segment fills smoothly rather than in one jump.
  const PHASE_WEIGHT = {
    init:         0.02,
    'hidden-map': 0.30,   // spawning the map + waiting for tiles: the long pole
    stitch:       0.42,   // tiled path only; real per-tile granularity
    capture:      0.14,
    compose:      0.06,
    encode:       0.05,
    done:         0.01,
  };
  const PHASE_ORDER = ['init', 'hidden-map', 'stitch', 'capture', 'compose', 'encode', 'done'];
  let _maxFraction = 0;

  function _setProgress(phase, completed, total, message) {
    // Sum the weight of every phase already finished, then add this phase's own
    // share scaled by how far through it we are.
    const idx = PHASE_ORDER.indexOf(phase);
    let base = 0;
    for (let i = 0; i < idx; i++) base += (PHASE_WEIGHT[PHASE_ORDER[i]] || 0);
    const within = total > 0 ? Math.min(1, completed / total) : 0;
    const raw = base + (PHASE_WEIGHT[phase] || 0) * within;
    _maxFraction = phase === 'init' ? raw : Math.max(_maxFraction, raw);
    progress.value = {
      phase, completed, total, message,
      fraction: Math.min(1, _maxFraction),
      percent: Math.round(Math.min(1, _maxFraction) * 100),
    };
  }

  // ─── Single-canvas path ────────────────────────────────────────────────
  async function _renderSingleCanvas(sourceMap, px, signal) {
    // Sub-steps inside the long pole. Waiting for map tiles is the slowest part
    // of a render and used to be one silent await, so the bar froze there.
    _setProgress('hidden-map', 0, 3, 'creating hidden map');
    const { hiddenMap, restoreDpr, container } = await _spawnHiddenMap(sourceMap, px.width, px.height);
    try {
      _throwIfAborted(signal);
      _setProgress('hidden-map', 1, 3, 'loading map tiles');
      await _waitForIdle(hiddenMap);
      _setProgress('hidden-map', 3, 3, 'tiles loaded');
      _throwIfAborted(signal);
      _setProgress('capture', 0, 1, 'capturing canvas');
      const dataUrl = hiddenMap.getCanvas().toDataURL('image/png');
      const img = await _loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width  = px.width;
      canvas.height = px.height;
      canvas.getContext('2d').drawImage(img, 0, 0, px.width, px.height);
      return canvas;
    } finally {
      try { hiddenMap.remove(); } catch (_) { /* noop */ }
      if (container?.parentNode) container.parentNode.removeChild(container);
      restoreDpr();
    }
  }

  // ─── Tile-stitch path ──────────────────────────────────────────────────
  async function _renderTileStitch(sourceMap, px, signal) {
    const cols = Math.ceil(px.width  / TILE_PX);
    const rows = Math.ceil(px.height / TILE_PX);
    const total = cols * rows;
    _setProgress('hidden-map', 0, total, `creating hidden map (${cols}×${rows} tiles)`);

    // Build a hidden map sized exactly to ONE tile; we'll re-aim it per tile.
    const sourceBounds = sourceMap.getBounds();
    const sourceCenter = sourceMap.getCenter();
    const sourceZoom   = sourceMap.getZoom();
    const sourceBearing = sourceMap.getBearing();
    const sourcePitch  = sourceMap.getPitch();

    const { hiddenMap, restoreDpr, container } = await _spawnHiddenMap(sourceMap, TILE_PX, TILE_PX, {
      preserveBounds: true,
      bounds: sourceBounds,
    });

    try {
      const master = document.createElement('canvas');
      master.width  = px.width;
      master.height = px.height;
      const ctx = master.getContext('2d');

      // Compute the geographic span per tile by projecting the source's bounds
      // into a rectangle and slicing it. We keep the source's bearing/pitch.
      const ne = sourceBounds.getNorthEast();
      const sw = sourceBounds.getSouthWest();
      const lngSpan = ne.lng - sw.lng;
      const lngStep = lngSpan / cols;
      // ★ ROWS ARE SLICED IN MERCATOR Y, NOT IN DEGREES, because each tile is drawn into an
      // EQUAL-HEIGHT slot of the output image and screen height is not linear in latitude.
      // Dividing the degree span evenly (what this did) squeezes some bands and stretches others:
      // MEASURED on a -60..75 view in 4 rows, the top band is 37.0% of the true screen height and was
      // being painted into 25% of the poster, the next 19.7% into 25%. That is the wrong aspect, and
      // the high-latitude bands — where a degree buys the most pixels — are the most over-represented,
      // which is why the poster showed far too much of Antarctica.
      const latBands = equalHeightLatBands(sw.lat, ne.lat, rows);

      let completed = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          _throwIfAborted(signal);
          const [bandS, bandN] = latBands[r];
          const tileSw = [sw.lng + (c     * lngStep), bandS];
          const tileNe = [sw.lng + ((c + 1) * lngStep), bandN];
          hiddenMap.fitBounds([tileSw, tileNe], { padding: 0, animate: false, duration: 0 });
          await _waitForIdle(hiddenMap);
          const tileUrl = hiddenMap.getCanvas().toDataURL('image/png');
          const img = await _loadImage(tileUrl);

          // tile fills 0..TILE_PX, but the last col/row may have a partial tile.
          const dx = c * TILE_PX;
          const dy = r * TILE_PX;
          const dw = Math.min(TILE_PX, px.width  - dx);
          const dh = Math.min(TILE_PX, px.height - dy);
          ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX, dx, dy, dw, dh);

          completed++;
          _setProgress('stitch', completed, total, `tile ${completed}/${total}`);
        }
      }

      // restore source map view (in case we share a token bucket etc.)
      sourceMap.jumpTo({ center: sourceCenter, zoom: sourceZoom, bearing: sourceBearing, pitch: sourcePitch });

      return master;
    } finally {
      try { hiddenMap.remove(); } catch (_) { /* noop */ }
      if (container?.parentNode) container.parentNode.removeChild(container);
      restoreDpr();
    }
  }

  // Draw the map onto a full sheet at the position the layout reserved for it.
  function _placeMapOnSheet(mapCanvas, layout, px) {
    const sheet = document.createElement('canvas');
    sheet.width = px.width;
    sheet.height = px.height;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px.width, px.height);
    ctx.drawImage(mapCanvas, layout.map.x, layout.map.y, layout.map.w, layout.map.h);
    return sheet;
  }

  // ─── Overlay compositing ──────────────────────────────────────────────
  async function _composeOverlay(baseCanvas, spec, px) {
    const layout = computeLayout(spec, px);
    const ctx = baseCanvas.getContext('2d');

    // Render slots as SVG strings → rasterize → drawImage onto base canvas.
    const slotSvgs = await _collectSlotSvgs(spec, layout);
    for (const slot of slotSvgs) {
      const img = await _svgStringToImage(slot.svg, slot.box.w, slot.box.h);
      ctx.drawImage(img, slot.box.x, slot.box.y, slot.box.w, slot.box.h);
    }
    return baseCanvas;
  }

  // Collects SVG markup for each enabled slot. Components render their own
  // SVG; here we just stub the strings — actual SVG building is mostly done
  // inside the slot components (PosterPreview path) or inline (server path).
  async function _collectSlotSvgs(spec, layout) {
    const out = [];
    if (spec.slots?.title)    out.push({ box: layout.title,    svg: _stubTitleSvg(spec, layout.title) });
    // A legend with no rows is an empty white panel over the map: leave it out.
    if (spec.slots?.legend?.rows?.length) out.push({ box: layout.legend, svg: _stubLegendSvg(spec, layout.legend) });
    if (spec.slots?.scaleBar) out.push({ box: layout.scaleBar, svg: _stubScaleSvg(spec, layout.scaleBar) });
    if (spec.slots?.north)    out.push({ box: layout.north,    svg: _stubNorthSvg(spec, layout.north) });
    // Footer is ALWAYS present (attribution is mandatory).
    out.push({ box: layout.footer, svg: _stubFooterSvg(spec, layout.footer) });
    return out;
  }

  return {
    render,
    progress: readonly(progress),
    isRendering: readonly(isRendering),
    cancel,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers (module-private)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert a PosterSpec to its raster pixel dimensions, honoring orientation.
 * @param {PosterSpec} spec
 * @returns {{ width: number, height: number, dpi: number }}
 */
export function posterPixels(spec) {
  let w = spec.widthIn;
  let h = spec.heightIn;
  if (spec.orientation === 'landscape' && h > w) [w, h] = [h, w];
  if (spec.orientation === 'portrait'  && w > h) [w, h] = [h, w];
  const dpi = spec.dpi || 300;
  return {
    width:  Math.round(w * dpi),
    height: Math.round(h * dpi),
    dpi,
  };
}

function decidePath(requested, px) {
  if (requested === 'single' || requested === 'stitch') return requested;
  if (px.width > MAX_SINGLE_CANVAS || px.height > MAX_SINGLE_CANVAS) return 'stitch';
  return 'single';
}

/**
 * Spawn a hidden map sized to the requested pixel dimensions.
 * Restores window.devicePixelRatio after construction (the hidden map
 * captures the value at init; subsequent restoration is safe).
 */
async function _spawnHiddenMap(sourceMap, w, h, opts = {}) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: -100000px; left: -100000px;
    width: ${w}px; height: ${h}px; pointer-events: none; visibility: hidden;
  `;
  document.body.appendChild(container);

  const originalDpr = window.devicePixelRatio;
  const restoreDpr  = () => { try { Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true }); } catch (_) { /* noop in strict envs */ } };
  try {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  } catch (_) {
    // Some environments lock devicePixelRatio; fall back silently.
  }

  // THE SAME ENGINE AS THE SOURCE MAP. This used to grab window.mapboxgl unconditionally, so on a
  // keyless page (provider=maplibre) every poster threw "mapboxgl global not found" — the source map
  // is a MapLibre map and no Mapbox engine is loaded at all. Measured 2026-09-25 while making the
  // Simple Research export one click. Mapbox behaviour is unchanged.
  // eslint-disable-next-line no-undef
  const W = (typeof window !== 'undefined' ? window : {});
  const isMaplibre = !!W.maplibregl && sourceMap instanceof W.maplibregl.Map;
  const gl = engineFor(sourceMap);   // the one per-instance helper (useMapProvider.js)
  if (!gl) throw new Error('useMapPoster: ' + (isMaplibre ? 'maplibregl' : 'mapboxgl') + ' global not found');

  const styleObj = sourceMap.getStyle();
  // MapLibre's style spec wants projection as an OBJECT ({ type: 'globe' }); a live MapLibre map can
  // hand back Mapbox's string spelling ('globe'), which MapLibre then refuses to load — measured
  // 2026-09-25: every keyless poster failed with "projection: object expected, string found".
  if (isMaplibre && styleObj && typeof styleObj.projection === 'string') {
    styleObj.projection = { type: styleObj.projection };
  }

  const hiddenMap = new gl.Map({
    container,
    style: styleObj,
    center: sourceMap.getCenter(),
    zoom:   sourceMap.getZoom(),
    bearing: sourceMap.getBearing(),
    pitch:   sourceMap.getPitch(),
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    canvasContextAttributes: { preserveDrawingBuffer: true },   // MapLibre v5 spelling of the same
    fadeDuration: 0,
  });

  // Style ready: 'style.load', or 'load', or already loaded by the time we look (an engine may finish
  // a style OBJECT before a listener is attached). A style that cannot load says why ('error'), so a
  // failed poster names its cause instead of a bare timeout.
  let lastError = '';
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(t); clearInterval(poll);
      err ? reject(err) : resolve();
    };
    const t = setTimeout(() => finish(new Error('useMapPoster: hidden map style.load timeout' + (lastError ? ' (' + lastError + ')' : ''))), IDLE_TIMEOUT_MS);
    const poll = setInterval(() => { try { if (hiddenMap.isStyleLoaded()) finish(); } catch (_) { /* not yet */ } }, 100);
    hiddenMap.once('style.load', () => finish());
    hiddenMap.once('load', () => finish());
    hiddenMap.on('error', (e) => { lastError = String(e?.error?.message || e?.message || e).slice(0, 160); });
  });

  // Print the place names in the language the reader sees. Mapbox localizes INSIDE the engine
  // (setLanguage), so a new instance starts in the style default (English) — measured on an Arabic
  // poster; carry the source map's language across. MapLibre's localized labels are expressions in
  // the style itself, which the hidden map already copied.
  try {
    const srcLang = typeof sourceMap.getLanguage === 'function' ? sourceMap.getLanguage() : null;
    if (srcLang && typeof hiddenMap.setLanguage === 'function') hiddenMap.setLanguage(srcLang);
  } catch (_) { /* a label left in the default language is a nicety lost, never a failed export */ }

  if (opts.preserveBounds && opts.bounds) {
    hiddenMap.fitBounds(opts.bounds, { padding: 0, animate: false, duration: 0 });
  }

  return { hiddenMap, restoreDpr, container };
}

// The hidden map's 'idle' can arrive late or never on a heavy render (measured 2026-09-25: an
// Arabic Letter poster, RTL shaping + a 2x canvas, missed a 15s idle and the export gave NO file).
// So: at IDLE_TIMEOUT_MS, capture if every tile is in (something else is only repainting); keep
// waiting to IDLE_HARD_MS otherwise, then capture what is drawn with a warning. A poster whose last
// tiles are missing is still a file; a rejected promise is a dead Export button.
const IDLE_HARD_MS = 60000;
function _waitForIdle(map) {
  return new Promise((resolve) => {
    let settled = false;
    const timers = [];
    const finish = (why) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      if (why) console.warn('[useMapPoster] ' + why);
      requestAnimationFrame(() => resolve());
    };
    const tilesIn = () => { try { return typeof map.areTilesLoaded === 'function' && map.areTilesLoaded(); } catch (_) { return false; } };
    timers.push(setTimeout(() => { if (tilesIn()) finish(); }, IDLE_TIMEOUT_MS));
    timers.push(setTimeout(() => finish('hidden map not idle after ' + IDLE_HARD_MS / 1000 + 's; capturing what is drawn'), IDLE_HARD_MS));
    if (map.loaded() && !map.isMoving()) {
      finish();
    } else {
      map.once('idle', () => finish());
    }
  });
}

function _loadImage(srcOrBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = (e) => reject(new Error('image load failed: ' + (e?.message || 'unknown')));
    img.src = (typeof srcOrBlob === 'string')
      ? srcOrBlob
      : URL.createObjectURL(srcOrBlob);
  });
}

function _svgStringToImage(svgStr, w, h) {
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('svg load failed: ' + (e?.message || 'unknown')));
    };
    img.width  = w;
    img.height = h;
    img.src    = url;
  });
}

function _canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), type);
  });
}

async function _toPdfBlob(canvas, spec) {
  // Lazy ESM import — keeps jspdf out of the main bundle until poster is used.
  // jsPDF / svg2pdf must be added to package.json (see header).
  let jsPDFCtor;
  try {
    const mod = await import('jspdf');
    jsPDFCtor = mod.jsPDF || mod.default;
  } catch (_) {
    throw new Error('useMapPoster.toPdf: jspdf not installed (npm i jspdf svg2pdf.js)');
  }
  const dataUrl = canvas.toDataURL('image/png');
  const orient  = (canvas.width > canvas.height) ? 'l' : 'p';
  const pdf = new jsPDFCtor({
    orientation: orient,
    unit: 'in',
    format: [spec.widthIn, spec.heightIn],
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, spec.widthIn, spec.heightIn);
  return pdf.output('blob');
}

function _throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('useMapPoster: aborted', 'AbortError');
  }
}

function mergeSignals(...signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(); break; }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

// ─── Stub SVG builders for the headless render path ───────────────────────
// These produce minimal SVG so the headless render still has *something* in
// each slot. Live preview uses the real Vue slot components instead.

// spec.dir === 'rtl' (an Arabic poster): text starts at the RIGHT edge and runs right-to-left.
// ⚠ Under direction="rtl" SVG's text-anchor is relative to the text's direction, so the right edge
// is "start", not "end" — "end" pushed every Arabic title off the poster (measured 2026-09-25).
function _rtl(spec) { return spec?.dir === 'rtl'; }
function _textAt(spec, box, inset) {
  return _rtl(spec)
    ? `x="${box.w - inset}" text-anchor="start" direction="rtl"`
    : `x="${inset}"`;
}

function _stubTitleSvg(spec, box) {
  const t = (spec.slots?.title?.text || '').replace(/[<>&]/g, _esc);
  const s = (spec.slots?.title?.subtitle || '').replace(/[<>&]/g, _esc);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}">
      <rect width="100%" height="100%" fill="rgba(255,255,255,0.92)"/>
      <text ${_textAt(spec, box, 20)} y="${box.h * 0.55}" font-family="Inter, system-ui, sans-serif"
            font-size="${Math.min(box.h * 0.5, 64)}" font-weight="700" fill="#0a0a0a">${t}</text>
      ${s ? `<text ${_textAt(spec, box, 20)} y="${box.h * 0.85}" font-family="Inter, system-ui, sans-serif"
            font-size="${Math.min(box.h * 0.22, 28)}" fill="#444">${s}</text>` : ''}
    </svg>`;
}

function _stubLegendSvg(spec, box) {
  const rows = (spec.slots?.legend?.rows || []).slice(0, 24);
  const title = (spec.slots?.legend?.title || 'Legend').replace(/[<>&]/g, _esc);
  const rtl = _rtl(spec);
  // Type scales with the panel (it is ~600px wide at 200 DPI); the panel is only as TALL as its rows,
  // so the rest of the column stays map.
  const fs = Math.max(14, Math.round(box.w / 26)), line = Math.round(fs * 1.9), sw = Math.round(fs * 1.2), pad = Math.round(fs * 1.1);
  const panelH = Math.min(box.h, pad * 2 + line * (rows.length + 1));
  const swX = rtl ? box.w - pad - sw : pad;
  const textX = rtl ? `x="${box.w - pad - sw - Math.round(fs * 0.7)}" text-anchor="start" direction="rtl"` : `x="${pad + sw + Math.round(fs * 0.7)}"`;
  const items = rows.map((r, i) => {
    const y = pad + line * (i + 1.5);
    const c = (r.color || '#999').replace(/[<>&]/g, _esc);
    const l = (r.label || '').replace(/[<>&]/g, _esc);
    return `<g><rect x="${swX}" y="${y - sw + Math.round(fs * 0.15)}" width="${sw}" height="${sw}" rx="2" fill="${c}" stroke="#222" stroke-width="0.5"/><text ${textX} y="${y}" font-family="Inter, sans-serif" font-size="${fs}" fill="#111">${l}</text></g>`;
  }).join('');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}">
      <rect width="${box.w}" height="${panelH}" fill="rgba(255,255,255,0.94)" stroke="#ccc"/>
      <text ${_textAt(spec, box, pad)} y="${pad + line * 0.6}" font-family="Inter, sans-serif" font-size="${Math.round(fs * 1.1)}" font-weight="700" fill="#111">${title}</text>
      ${items}
    </svg>`;
}

function _stubScaleSvg(_spec, box) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}">
      <rect x="0" y="${box.h - 18}" width="${box.w * 0.9}" height="6" fill="#000"/>
      <text x="0" y="${box.h - 22}" font-family="Inter, sans-serif" font-size="12" fill="#111">scale</text>
    </svg>`;
}

function _stubNorthSvg(_spec, box) {
  const s = Math.min(box.w, box.h);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${s} ${s}">
      <polygon points="${s/2},4 ${s*0.65},${s*0.85} ${s/2},${s*0.7} ${s*0.35},${s*0.85}" fill="#111"/>
      <text x="${s/2}" y="${s*0.98}" text-anchor="middle" font-family="Inter, sans-serif" font-size="${s*0.18}" fill="#111">N</text>
    </svg>`;
}

function _stubFooterSvg(spec, box) {
  const left  = (spec.slots?.footer?.left  || '').replace(/[<>&]/g, _esc);
  const right = (spec.slots?.footer?.right || '').replace(/[<>&]/g, _esc);
  // Mapbox attribution is mandatory.
  const attribution = (spec.slots?.footer?.attribution || '© Mapbox © OpenStreetMap');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}">
      <rect width="100%" height="100%" fill="rgba(255,255,255,0.92)"/>
      <text x="14" y="${box.h * 0.55}" font-family="Inter, sans-serif" font-size="12" fill="#222">${left}</text>
      <text x="${box.w / 2}" y="${box.h * 0.55}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" fill="#222">${attribution}</text>
      <text x="${box.w - 14}" y="${box.h * 0.55}" text-anchor="end" font-family="Inter, sans-serif" font-size="12" fill="#222">${right}</text>
    </svg>`;
}

function _esc(ch) {
  return ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;';
}
