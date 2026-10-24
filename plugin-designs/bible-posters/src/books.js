/**
 * books.js — the 12 books the UPG-100 prayer packet cites, in packet-citation order.
 *
 * The Bible Posters generator shows an ENTIRE BOOK on one poster. These 12 are the starting set
 * (the approved starting set): every book referenced by the en packet in
 * library/scripts/posters/packet-strings.json. The verse list is the index; the poster offers the book.
 *
 * `id`        — the USFM/OSIS book id the Free Use Bible API (bible.helloao.org) uses in its URLs.
 * `en`        — an English fallback label for the UI picker BEFORE the fetched translation is known;
 *               the POSTER HEADER itself uses the fetched translation's own `commonName` (in the text
 *               language), so a reader sees "يوحنا" / "Johannes", never the English name.
 * `testament` — 'OT' books (Genesis, Joshua) exist only in a translation that HAS an Old Testament,
 *               which narrows the offered language set; the other 10 are New Testament and fetch from
 *               any NT-only translation too.
 * `chaptersHint` — the chapter count for the WEB text (eng_web), used only to size a progress bar and a
 *               fit pre-estimate; the real count comes from the translation's own books.json at render.
 */
export const PACKET_BOOKS = [
  { id: 'ACT', en: 'Acts',           testament: 'NT', chaptersHint: 28 },
  { id: 'MAT', en: 'Matthew',        testament: 'NT', chaptersHint: 28 },
  { id: 'JHN', en: 'John',           testament: 'NT', chaptersHint: 21 },
  { id: 'MRK', en: 'Mark',           testament: 'NT', chaptersHint: 16 },
  { id: 'LUK', en: 'Luke',           testament: 'NT', chaptersHint: 24 },
  { id: 'HEB', en: 'Hebrews',        testament: 'NT', chaptersHint: 13 },
  { id: 'GEN', en: 'Genesis',        testament: 'OT', chaptersHint: 50 },
  { id: '1JN', en: '1 John',         testament: 'NT', chaptersHint: 5  },
  { id: 'COL', en: 'Colossians',     testament: 'NT', chaptersHint: 4  },
  { id: '1CO', en: '1 Corinthians',  testament: 'NT', chaptersHint: 16 },
  { id: '1PE', en: '1 Peter',        testament: 'NT', chaptersHint: 5  },
  { id: 'JOS', en: 'Joshua',         testament: 'OT', chaptersHint: 24 },
]

export const BOOK_BY_ID = Object.fromEntries(PACKET_BOOKS.map((b) => [b.id, b]))

/** Books this translation can serve: OT books need a translation whose books.json includes them. */
export function booksForTranslation(availableBookIds) {
  const have = new Set(availableBookIds || [])
  return PACKET_BOOKS.filter((b) => have.has(b.id))
}
