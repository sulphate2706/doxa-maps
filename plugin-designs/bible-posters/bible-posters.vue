<script setup>
/**
 * bible-posters.vue — the Bible Posters generator (Posterverse → Experimental).
 *
 * Shows an ENTIRE BOOK of the Bible on one poster, in the languages of the top unreached people groups.
 * Text is fetched at RENDER TIME from the Free Use Bible API (bible.helloao.org); no Bibles are stored.
 * v1 offers STRICT PUBLIC-DOMAIN translations only (the licence gate); the layout engine + credit line
 * are in src/. Print goes through the shared in-place printer (works for a human click and an agent).
 *
 * @description A whole book of the Bible on one poster, in justified columns under a bold title, from a public-domain text.
 * @profile bible-posters
 * @bundle  bible-posters
 * @element bible-posters
 */
import { inject, ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { printDocument } from '@map/composables/printInPlace.js'
import { PACKET_BOOKS, booksForTranslation } from './src/books.js'
import { TRANSLATIONS, TRANSLATION_BY_ID, DEFAULT_TRANSLATION_ID } from './src/translations.js'
import { BIBLE_POSTER_SIZES, SIZE_BY_ID, DEFAULT_SIZE_ID } from './src/sizes.js'
import { fetchBooks, fetchBook } from './src/bibleSource.js'
import { planBiblePoster, buildBiblePosterHtml, screenBiblePoster, MIN_READABLE_PT } from './src/biblePoster.js'

const { t } = useI18n()
const profileConfig = inject('profileConfig', null)
const cfg = (typeof profileConfig === 'object' && profileConfig) || {}

const translationId = ref(cfg.translation || DEFAULT_TRANSLATION_ID)
const bookId = ref(cfg.book || 'JHN')
const sizeId = ref(cfg.size || DEFAULT_SIZE_ID)

const availableBookIds = ref(PACKET_BOOKS.map((b) => b.id))   // narrows per translation (OT books need OT)
const book = ref(null)                                        // the fetched, normalized book
const loading = ref(false)
const progress = reactive({ done: 0, total: 0 })
const errorKey = ref('')
let inflight = null

const translation = computed(() => TRANSLATION_BY_ID[translationId.value] || TRANSLATIONS[0])
const size = computed(() => SIZE_BY_ID[sizeId.value] || BIBLE_POSTER_SIZES[0])
const offeredBooks = computed(() => booksForTranslation(availableBookIds.value))

// The layout plan + the fit hint. `book` may be null while loading; guard.
const plan = computed(() => (book.value ? planBiblePoster(size.value, book.value) : null))
const screen = computed(() => {
  if (!book.value) return null
  return screenBiblePoster(book.value, size.value, { credit: translation.value.credit, dir: translation.value.dir, lang: translation.value.bcp47 })
})

// Which of the ladder's sizes fit this book, for the "which size" guidance.
const ladder = computed(() => {
  if (!book.value) return []
  return BIBLE_POSTER_SIZES.map((s) => {
    const p = planBiblePoster({ widthIn: s.widthIn, heightIn: s.heightIn }, book.value)
    return { id: s.id, label: s.label, fits: p.fits, fontPt: p.fontPt }
  })
})
const smallestFitting = computed(() => ladder.value.find((l) => l.fits) || null)

async function loadBooksList() {
  try {
    const list = await fetchBooks(translationId.value)
    availableBookIds.value = list.map((b) => b.id)
    if (!availableBookIds.value.includes(bookId.value)) {
      const firstNt = offeredBooks.value.find((b) => b.testament === 'NT') || offeredBooks.value[0]
      if (firstNt) bookId.value = firstNt.id
    }
  } catch { /* keep the full list; the book fetch reports a real failure */ }
}

async function loadBook() {
  const controller = new AbortController()
  if (inflight) inflight.abort()
  inflight = controller
  loading.value = true; errorKey.value = ''; progress.done = 0; progress.total = 0
  try {
    const b = await fetchBook(translationId.value, bookId.value, {
      signal: controller.signal,
      dir: translation.value.dir,
      onProgress: (done, total) => { progress.done = done; progress.total = total },
    })
    if (controller.signal.aborted) return
    book.value = b
  } catch (e) {
    if (!controller.signal.aborted) { errorKey.value = 'biblePosters.fetchFailed'; book.value = null }
  } finally {
    if (inflight === controller) { inflight = null; loading.value = false }
  }
}

function print() {
  if (!book.value) return
  const html = buildBiblePosterHtml(book.value, size.value, { credit: translation.value.credit, dir: translation.value.dir, lang: translation.value.bcp47 })
  printDocument(html, { labels: { print: t('biblePosters.print'), close: t('biblePosters.close') } })
}

watch(translationId, async () => { await loadBooksList(); await loadBook() })
watch(bookId, loadBook)
onMounted(async () => { await loadBooksList(); await loadBook() })
onBeforeUnmount(() => { if (inflight) inflight.abort() })

// The preview scales the poster's world (widthIn×96 px) to fit the preview box.
const previewBox = ref(null)
const previewScale = ref(1)
function fitPreview() {
  const el = previewBox.value, s = screen.value
  if (!el || !s) return
  const pad = 24
  const sx = (el.clientWidth - pad) / s.worldW
  const sy = (el.clientHeight - pad) / s.worldH
  previewScale.value = Math.max(0.02, Math.min(sx, sy))
}
watch([screen, previewBox], fitPreview, { flush: 'post' })
let ro = null
onMounted(() => { ro = new ResizeObserver(fitPreview); if (previewBox.value) ro.observe(previewBox.value) })
onBeforeUnmount(() => { if (ro) ro.disconnect() })
</script>

<template>
  <div class="bpx">
    <header class="bpx-bar">
      <div class="bpx-title">{{ t('biblePosters.title') }}</div>
      <div class="bpx-controls">
        <label class="bpx-field">
          <span>{{ t('biblePosters.book') }}</span>
          <select v-model="bookId">
            <option v-for="b in offeredBooks" :key="b.id" :value="b.id">{{ t('biblePosters.books.' + b.id) }}</option>
          </select>
        </label>
        <label class="bpx-field">
          <span>{{ t('biblePosters.language') }}</span>
          <select v-model="translationId">
            <option v-for="tr in TRANSLATIONS" :key="tr.id" :value="tr.id">{{ tr.endonym }}</option>
          </select>
        </label>
        <label class="bpx-field">
          <span>{{ t('biblePosters.size') }}</span>
          <select v-model="sizeId">
            <option v-for="s in BIBLE_POSTER_SIZES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </label>
        <button type="button" class="bpx-print" :disabled="!book || loading" @click="print">
          {{ t('biblePosters.print') }}
        </button>
      </div>
    </header>

    <p class="bpx-hint" v-if="plan">
      <span v-if="plan.fits">{{ t('biblePosters.fitsAt', { pt: plan.fontPt, cols: plan.cols }) }}</span>
      <span v-else class="bpx-warn">
        {{ t('biblePosters.tooSmall') }}
        <template v-if="smallestFitting"> — {{ t('biblePosters.trySize', { size: smallestFitting.label }) }}</template>
      </span>
    </p>

    <div class="bpx-stage" ref="previewBox">
      <div v-if="loading" class="bpx-status">
        {{ t('biblePosters.loading') }}<span v-if="progress.total"> {{ progress.done }} / {{ progress.total }}</span>
      </div>
      <div v-else-if="errorKey" class="bpx-status bpx-warn">{{ t(errorKey) }}</div>
      <template v-else-if="screen">
        <div class="bpx-scaler" :style="{ width: screen.worldW + 'px', height: screen.worldH + 'px', transform: 'scale(' + previewScale + ')' }">
          <component :is="'style'">{{ screen.css }}</component>
          <div class="bp" :lang="screen.lang || null" :dir="screen.dir" v-html="screen.html"></div>
        </div>
      </template>
    </div>

    <p class="bpx-credit" v-if="book">{{ translation.credit }}</p>
  </div>
</template>

<style>
.bpx { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #f3f3f1; color: #3b463d;
  font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; }
.bpx-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; justify-content: space-between;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #d1d4cd; }
.bpx-title { font-size: 18px; font-weight: 700; }
.bpx-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.bpx-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #6d766e; }
.bpx-field select { min-height: 36px; padding: 0 10px; border: 1px solid #d1d4cd; border-radius: 8px;
  background: #fff; color: #3b463d; font: inherit; }
.bpx-print { min-height: 38px; padding: 0 18px; border: 0; border-radius: 8px; background: #3b463d; color: #fff;
  font: inherit; font-weight: 600; cursor: pointer; }
.bpx-print:disabled { background: #b7bdb4; cursor: default; }
.bpx-hint { margin: 0; padding: 8px 16px; font-size: 13px; color: #3b463d; }
.bpx-warn { color: #9a3b2f; }
.bpx-stage { flex: 1 1 0; min-height: 0; position: relative; overflow: hidden; display: flex;
  align-items: center; justify-content: center; padding: 12px; }
.bpx-scaler { transform-origin: center center; box-shadow: 0 6px 24px rgba(0,0,0,.18); background: #fff; }
.bpx-status { font-size: 14px; color: #6d766e; }
.bpx-credit { margin: 0; padding: 8px 16px; font-size: 11px; color: #6d766e; text-align: center;
  border-top: 1px solid #d1d4cd; background: #fff; }
</style>
