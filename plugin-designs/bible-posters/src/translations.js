/**
 * translations.js — the LICENCE-VETTED text sources for the Bible Posters generator.
 *
 * ⚠ LICENSING GATE (this plugin's first task). A full BOOK is displayed IN FULL on a
 *   printed, white-label giveaway poster, so ONLY texts whose licence permits that may ship. This v1
 *   list is STRICT PUBLIC-DOMAIN ONLY — the exact translations the UPG-100 packet already ships as
 *   public domain, plus the WEB seed. It is safe under EITHER answer to the open licensing question
 *   (PD-only vs. a licensed/broader set), so it is what builds now.
 *
 *   The CC-BY / CC-BY-SA expansion (the IRV family — Hindi, Tamil, Telugu, Punjabi — and the wider
 *   UPG languages) is DEFERRED pending the open licensing decision; do not add a non-public-domain text
 *   here without explicit sign-off and a per-translation licence check (eBible details + Door43),
 *   never the transport's blanket "no restrictions" claim nor eBible's Redistributable flag alone.
 *
 * Transport: the Free Use Bible API (bible.helloao.org) — CORS, no key, per-chapter JSON, fetched at
 *   RENDER TIME. No whole Bibles are stored in the repo or public/. Each translation carries a
 *   `licenseUrl` back to its eBible record; `credit` is the poster's printed credit line.
 *
 * `iso639_3` is the text language, so the picker can offer the languages of the top unreached people
 *   groups (the Gospel Resources map data keys on iso639_3) once the CC-BY-SA set is approved.
 */

/** @typedef {Object} Translation
 *  @property {string} id         Free Use Bible API translation id (its URL segment)
 *  @property {string} iso639_3   text language code
 *  @property {string} language   English language name (UI grouping)
 *  @property {string} name       the translation's English name
 *  @property {'ltr'|'rtl'} dir   text direction
 *  @property {string} licence    the licence class (v1: all 'public-domain')
 *  @property {string} credit     the poster credit line
 *  @property {string} licenseUrl the licence record of source
 */

/** v1 STRICT PUBLIC-DOMAIN seed — the packet's 6 + WEB. Every entry has all 66 books (OT+NT). */
export const TRANSLATIONS = [
  { id: 'eng_web', iso639_3: 'eng', bcp47: 'en', language: 'English', endonym: 'English', name: 'World English Bible',
    dir: 'ltr', licence: 'public-domain',
    credit: 'World English Bible · public domain · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=eng-web' },
  { id: 'spa_r09', iso639_3: 'spa', bcp47: 'es', language: 'Spanish', endonym: 'Español', name: 'Reina Valera 1909',
    dir: 'ltr', licence: 'public-domain',
    credit: 'Reina Valera 1909 · dominio público · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=spaRV1909' },
  { id: 'fra_ost', iso639_3: 'fra', bcp47: 'fr', language: 'French', endonym: 'Français', name: 'French Ostervald Bible',
    dir: 'ltr', licence: 'public-domain',
    credit: 'Bible Ostervald · domaine public · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=fra_fob' },
  { id: 'deu_l12', iso639_3: 'deu', bcp47: 'de', language: 'German', endonym: 'Deutsch', name: 'German Luther Bible 1912',
    dir: 'ltr', licence: 'public-domain',
    credit: 'Lutherbibel 1912 · gemeinfrei · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=deu1912' },
  { id: 'rus_syn', iso639_3: 'rus', bcp47: 'ru', language: 'Russian', endonym: 'Русский', name: 'Russian Synodal Bible',
    dir: 'ltr', licence: 'public-domain',
    credit: 'Синодальный перевод · общественное достояние · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=russyn' },
  { id: 'arb_vdv', iso639_3: 'arb', bcp47: 'ar', language: 'Arabic', endonym: 'العربية', name: 'Arabic Van Dyck Bible',
    dir: 'rtl', licence: 'public-domain',
    credit: 'فان دايك · ملك عام · ebible.org · bible.helloao.org',
    licenseUrl: 'https://ebible.org/Scriptures/details.php?id=arb-vd' },
]

export const TRANSLATION_BY_ID = Object.fromEntries(TRANSLATIONS.map((t) => [t.id, t]))
export const DEFAULT_TRANSLATION_ID = 'eng_web'
