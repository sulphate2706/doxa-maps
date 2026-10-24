/**
 * bibleSource.js — the RENDER-TIME text client for the Free Use Bible API (bible.helloao.org).
 *
 * Fetches a whole book on demand and returns a normalized structure the renderer can lay out.
 * NOTHING is written to the repo or public/: whole Bibles are never stored (the licence gate and the
 * §4 spec). A small in-memory (per-bundle, per-session) cache avoids re-fetching a book the reader
 * just looked at; it is discarded on reload.
 *
 * The API (verified 2026-09-30):
 *   {base}/{translationId}/books.json          → { books: [{ id, commonName, numberOfChapters, ... }] }
 *   {base}/{translationId}/{BOOK}/{chapter}.json → { chapter: { content: [ {type:'verse',number,content:[...]}
 *                                                                        | {type:'heading',content:[...]} ] } }
 * CORS is open (Access-Control-Allow-Origin: *) and no key is required.
 */

export const API_BASE = 'https://bible.helloao.org/api'

const booksCache = new Map()   // translationId -> [{id, name, chapters, order}]
const bookCache = new Map()    // `${translationId}/${bookId}` -> normalized book

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url)
  return res.json()
}

/** The translation's book table: id → localized name + chapter count. Used to build the picker and to
 *  know which of the 12 packet books this translation actually has (OT books need an OT translation). */
export async function fetchBooks(translationId, { signal } = {}) {
  if (booksCache.has(translationId)) return booksCache.get(translationId)
  const d = await getJson(`${API_BASE}/${translationId}/books.json`, signal)
  const raw = Array.isArray(d) ? d : (d.books || [])
  const books = raw.map((b) => ({
    id: b.id,
    name: b.commonName || b.name || b.id,
    chapters: b.numberOfChapters || 0,
    order: b.order || 0,
  }))
  booksCache.set(translationId, books)
  return books
}

/** One verse/heading item → plain text. Verse `content` is an array of strings and, occasionally,
 *  objects (poetry lines, notes). We keep the readable text and drop note apparatus. */
function itemText(item) {
  const parts = Array.isArray(item.content) ? item.content : [item.content]
  return parts
    .map((p) => {
      if (typeof p === 'string') return p
      if (p && typeof p === 'object') return p.text || (Array.isArray(p.content) ? p.content.filter((x) => typeof x === 'string').join(' ') : '')
      return ''
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetch an ENTIRE book: every chapter, flattened to an ordered list of blocks.
 * Returns { bookId, name, dir, chapters: N, blocks: [{kind:'heading'|'verse', chapter, number?, text}],
 *           verseCount, charCount }. `onProgress(done, total)` fires per chapter.
 */
export async function fetchBook(translationId, bookId, { signal, onProgress, dir = 'ltr', concurrency = 4 } = {}) {
  const key = `${translationId}/${bookId}`
  if (bookCache.has(key)) { onProgress?.(1, 1); return bookCache.get(key) }

  const books = await fetchBooks(translationId, { signal })
  const meta = books.find((b) => b.id === bookId)
  if (!meta) throw new Error(`${translationId} has no book ${bookId}`)
  const total = meta.chapters
  const chapterBlocks = new Array(total)   // keep chapter order regardless of fetch order
  let done = 0

  // One book is one atomic fetch: a chapter failure ABORTS the siblings (never a half book), while still
  // honouring the caller's own signal. An internal controller chains to it so we can abort from inside.
  const internal = new AbortController()
  const onExt = () => internal.abort()
  if (signal) { if (signal.aborted) internal.abort(); else signal.addEventListener('abort', onExt, { once: true }) }

  async function one(ch) {
    try {
      const d = await getJson(`${API_BASE}/${translationId}/${bookId}/${ch}.json`, internal.signal)
      const content = (d.chapter || d).content || []
      const blocks = []
      for (const item of content) {
        if (item.type === 'heading') { const t = itemText(item); if (t) blocks.push({ kind: 'heading', chapter: ch, text: t }) }
        else if (item.type === 'verse') { const t = itemText(item); if (t) blocks.push({ kind: 'verse', chapter: ch, number: item.number, text: t }) }
      }
      chapterBlocks[ch - 1] = blocks
      done += 1
      onProgress?.(done, total)
    } catch (e) { internal.abort(); throw e }   // stop the other workers on the first failure
  }

  // bounded-concurrency pool over chapters 1..total
  const queue = []
  for (let ch = 1; ch <= total; ch++) queue.push(ch)
  const workers = new Array(Math.min(concurrency, total)).fill(0).map(async () => {
    while (queue.length && !internal.signal.aborted) { const ch = queue.shift(); await one(ch) }
  })
  try { await Promise.all(workers) }
  finally { if (signal) signal.removeEventListener('abort', onExt) }

  const blocks = chapterBlocks.flat().filter(Boolean)
  let verseCount = 0, charCount = 0
  for (const b of blocks) { if (b.kind === 'verse') verseCount++; charCount += b.text.length }
  const book = { bookId, name: meta.name, dir, chapters: total, blocks, verseCount, charCount }
  bookCache.set(key, book)
  return book
}

/** Test seam: clear the session caches. */
export function _clearCache() { booksCache.clear(); bookCache.clear() }
