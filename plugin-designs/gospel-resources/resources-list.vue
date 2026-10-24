<script setup>
import { useOptionalT } from '@map/composables/useOptionalT.js'
import { resourceRows } from './gospel-resource-rows.js'
/**
 * resources-list.vue — GOSPEL RESOURCES, by language.
 *
 * @description Which people groups have Scripture in their own language and which have none, zero-resource languages first, with every link the verification pass proved and Open Bible Stories labelled as stories rather than as Scripture.
 *
 * Which DX people groups have scripture in their own language — and which have
 * NONE. The zero-resource languages lead, because they are the point of the app.
 *
 * ═══ WHAT THIS SHOWS, AND WHAT IT MUST NEVER SHOW ═══════════════════════════
 * RESOURCE AVAILABILITY per language: does a published translation exist. That is
 * public bibliographic fact — a library catalogue, not a map of people.
 *
 * It contains NO church, believer, fellowship or meeting-point data, and must
 * never gain any. "Which languages have scripture" is safe and mobilising;
 * "where are the Christians" is the join that gets people killed. That boundary is
 * a standing design ruling (2026-08-01), not a preference.
 *
 * ═══ THE HONESTY THE UI IS BUILT AROUND ═════════════════════════════════════
 * `has_scripture:false` means NOT FOUND IN THE POOLS CHECKED — eBible.org, PNG.Bible and
 * Faith Comes By Hearing for text, Arclight for film, Door43 for stories, and FCBH again
 * for audio, Scripture Earth for minority-language Scripture, and Global Recordings Network
 * for gospel audio. It does NOT mean no scripture exists: GRN has now been swept for every
 * language in the gap, at the crawl delay they ask for, but API.Bible, DBL, YouVersion and
 * progress.bible need keys. Every
 * card names its checked and unchecked pools, and a pool nobody queried renders as
 * "unknown" rather than "no".
 *
 * That distinction is the difference between a useful priority signal and a
 * dataset that misdirects real translation effort at a language already served.
 *
 * DATA: library/scripts/research/build-language-resources.mjs
 *   eBible.org translations.csv (public CSV, no key) × the DX people-group corpus,
 *   joined on ISO 639-3 — an EXACT code-to-code join. DX records already carry
 *   `primary_language` as ISO 639-3, so no fuzzy name matching is involved; name
 *   matching across scripts is exactly where scripture gets mis-attributed.
 */
import { computed, inject, ref, watch } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { resolveAssetsBase } from '@map/utils/embedBase.js'

/* Guarded like every other useI18n() in this bundle — the host may never have installed it,
   and the shipped English catalogue is the fallback rather than a broken key. */
// C4: the guard is library/composables/useOptionalT.js now. enLookup STAYS as the fallback, passed
// in, so a bare host renders the same ENGLISH it always did -- routing this to the catalogue default
// would make a bare host honour ?lang=ar, which is the plugin owner's call and not this migration's.
// C4 wave 3a, the plugin owner's call (2026-09-26): take the LOCALE-HONOURING fallback rather than
// enLookup's English. A partner host that never installed vue-i18n now gets the reader's language,
// with English as the last resort. tStatic resolves 'gospel.<key>' against the same catalogue.
const tr = useOptionalT('gospel')


const profileConfig = inject('profileConfig', ref(null))
const isDark = computed(() => profileConfig.value?.isDark === true)

// ── FETCHED, NOT BUNDLED, AND FROM THE INDEX THE MAP DRAWS ──────────────────────
// This profile used to `import data from './data/resources.json'` — 862 languages baked
// into the JS at build time, while every other surface in this bundle now reads the pin
// index and its 5,067. It was the last one still describing a sixth of the corpus.
//
// Fetching also takes 695KB of JSON out of the shipped bundle. A list view is not worth
// making every OTHER profile in the bundle carry its dataset, which is what a build-time
// import does: they all share one .js.
const assetsBase = computed(() => resolveAssetsBase(profileConfig.value))
const pins = ref(null)
const loadErr = ref(null)
const countryNames = ref({})
async function load() {
  if (pins.value) return
  try {
    const r = await fetch(`${assetsBase.value}/tables/people-group-pins.json`)
    if (!r.ok) throw new Error(`pin index not found (${r.status})`)
    pins.value = await r.json()
  } catch (e) { loadErr.value = String(e.message || e) }
  // Country NAMES, so a row reads "India, Nepal" rather than "IND, NPL". Allowed to fail:
  // without it the rows fall back to ISO3, which is worse-looking but not wrong.
  try {
    const r = await fetch(`${assetsBase.value}/tables/gospel-by-country.json`)
    if (r.ok) {
      const m = {}
      for (const c of (await r.json()).countries || []) if (c.iso3) m[c.iso3] = c.country
      countryNames.value = m
    }
  } catch (_) { /* ISO3 fallback */ }
}
watch(profileConfig, load, { immediate: true })

// Same shape the list has always rendered, rebuilt per LANGUAGE from codes[] + pins[].
const languages = computed(() => {
  const d = pins.value
  if (!d?.codes) return []
  const { codes, pins: rows } = d
  const by = new Map()
  for (const [, , , iso3, code, pop] of rows) {
    if (!code) continue
    let e = by.get(code)
    if (!e) {
      const c = codes[code] || {}
      const scope = c.ss || ''
      // resources[] is what the UI turns into links; Door43 entries keep their own
      // subject so Open Bible Stories is never presented as a translation.
      // Every resource this language has, from the one helper the other surfaces use. This
      // listed only c.s and c.d, so film, audio, Bible video, tracts, Scripture Earth and
      // GRN never appeared here — a language whose only resource was a Words of Life
      // recording rendered with no links while the map offered a working one.
      const res = resourceRows(c, tr)
      e = {
        iso: code,
        language: c.l || 'unknown',
        people_group_count: 0,
        population: 0,
        countries: new Set(),
        // TEXT Scripture from ANY checked pool, not just eBible. FCBH publishes Bible text
        // on bible.is, and while this read only c.s the page told 766 languages — 2,162
        // people groups, 1.37bn speakers — that no Scripture was found when there is text
        // Scripture in their language. That is not the same mistake as widening the pill to
        // mean "any resource": it is the same claim, finally counted in full.
        // full_bible stays eBible-only below, because FCBH's row carries no book scope and
        // "full Bible" is a claim this build cannot make for it — such a row reads "partial",
        // which says Scripture exists without overstating how much.
        has_scripture: !!c.s || !!(c.au && /text/.test(c.au.m || '')),
        full_bible: scope === 'Full Bible',
        nt: scope === 'Full Bible' || /New Testament|both Testaments/.test(scope),
        film_url: c.f || '',
        audio: c.au || null,
        bibleVideo: c.bv || null,
        resources: res,
        scripture_rows: res.filter((r) => r.type === 'Scripture').length,
        /* WHO MADE IT. Already on the index from the eBible catalogue and already shown on the
           map sheet and on both bridges; this is the third surface a reader can arrive at and
           it was the only one still answering "where" without "who". A name, never a link —
           the doctrine screen is an allowlist and a publisher must not enter through a data
           refresh. Empty where the catalogue names a licence rather than a body. */
        credit: c.cr || null,
      }
      by.set(code, e)
    }
    e.people_group_count += 1
    e.population += Number(pop) || 0
    if (iso3) e.countries.add(iso3)
  }
  // ★ AN ARRAY OF NAMES, because that is what the template consumes:
  // `l.countries.slice(0, 3).join(', ')`. I first emitted a COUNT here on the strength of a
  // comment I wrote rather than the template I was feeding, and the whole profile rendered
  // NOTHING — "x.countries.slice is not a function", a render-time TypeError that Vue logs
  // to the console and does not raise as a page error. The probe saw an empty page and
  // "no page errors", which is the most misleading pair of signals available.
  const nm = countryNames.value
  return Array.from(by.values()).map((e) => ({
    ...e,
    countries: [...e.countries].map((c) => nm[c] || c).sort(),
  }))
})

// Derived, not read from a baked stats block — the numbers have to move with the data.
const stats = computed(() => {
  const l = languages.value
  const without = l.filter((x) => !x.has_scripture)
  return {
    languages_without: without.length,
    people_groups_without_scripture: without.reduce((n, x) => n + x.people_group_count, 0),
    population_without_scripture: without.reduce((n, x) => n + x.population, 0),
    ebible_languages: l.filter((x) => x.has_scripture).length,
    // Counts TEXT Scripture rows only. `resources` now carries film, audio, Bible video,
    // tracts, Scripture Earth and GRN as well, and this line sits under a sentence that
    // names eBible.org — widening the number without changing the label would have made
    // the page overstate how many translations exist.
    ebible_translations: l.reduce((n, x) => n + x.scripture_rows, 0),
  }
})

// 'none' first — the whole app exists to make the gap visible.
const filter = ref('none')
const FILTERS = [
  { id: 'none', labelKey: 'gospel.list.noText' },
  { id: 'some', labelKey: 'gospel.list.hasScripture' },
  { id: 'all',  labelKey: 'gospel.list.allLanguages' },
]

const shown = computed(() => {
  const l = languages.value
  if (filter.value === 'none') return l.filter((x) => !x.has_scripture)
  if (filter.value === 'some') return l.filter((x) => x.has_scripture)
  return l
})

// ★ THE HEADLINE NUMBER IS TRUE AND DANGEROUSLY MISREADABLE, so the page names its own
// limit beside it. Widening the corpus from 862 to 5,067 languages moved this figure to
// 2.99 BILLION people — verified against an independent count, all three totals matching
// exactly. But the largest entries are Javanese (113M), Western Panjabi (101M),
// Shanghainese (92M), Egyptian Arabic (81M) and Cantonese (77M): major world languages
// that plainly DO have Scripture, which eBible simply does not host. Read as "3 billion
// people have no Bible" the number is false; read as "no Scripture found in the pools we
// can reach" it is exactly right. The gap between those two readings is the whole reason
// this list names its examples.
const biggestUnfound = computed(() =>
  languages.value.filter((l) => !l.has_scripture)
    .sort((a, b) => b.population - a.population).slice(0, 4)
    .map((l) => `${l.language} (${fmtShort(l.population)})`).join(', '))
const fmtShort = (n) => {
  const v = Number(n) || 0
  return v >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : v.toLocaleString()
}

/* ═══ NUMBER FORMAT IS HELD FLEET-WIDE ════════════════════════════════════════════════
 * This briefly formatted with the locale i18n resolved, which is almost certainly the right
 * answer — but it decides number format for THIS map alone, and the decision belongs to every
 * map at once or none. Reverted on that ground, not because the finding was wrong.
 *
 * THE FINDING, kept here so it is not re-derived: toLocaleString() with no argument formats for
 * the JS RUNTIME's locale, i.e. the browser's, which has nothing to do with the locale this
 * plugin was asked to render in. The same page therefore shows different numbers to different
 * readers — Hindi grouping in lakhs, French and Russian spaces — depending on their browser and
 * not on the locale the page is in. Pinning numberingSystem to latn would change the DIGITS for
 * region tags only (ar-EG resolves to arab, fa to arabext); the eleven tags this bundle ships,
 * plain "ar" included, already resolve to latn.
 */
const fmt = (n) => (Number(n) || 0).toLocaleString()

// ── EVERY LINK THE ROW ACTUALLY HAS, not just the scripture ones ─────────────────────────────
// THE DEFECT THIS FIXES (measured 2026-09-23 over all 862 languages in resources.json):
//   resources[] non-empty ............ 120
//   film_url present ................. 306
//   film_url but resources[] EMPTY ... 218   <- a real, verified link the UI never offered
//
// The template rendered `v-if="l.resources.length"` only, and `resources[]` holds SCRIPTURE
// editions (eBible entries with ot_books/nt_books/redistributable). The JESUS Film lives in its own
// pair of fields — has_film/jesus_film plus film_url — and was never read. So 218 languages showed
// no link at all while carrying a working one: e.g. Arabic, Sudanese (apd, 66 people groups,
// 18.7M speakers) has film_url https://www.jesusfilm.org/watch/?languageId=13562 and rendered
// nothing.
//
// ★ THE PILL IS NOT THE BUG AND IS DELIBERATELY LEFT ALONE. It reads full_bible / has_scripture,
// so "none found" is TRUE — of scripture. Those 218 rows genuinely have no scripture. Widening the
// pill to mean "no resources at all" would make it say something false about a language that has a
// film, and this list exists to show the gap honestly. The row now says both things at once: the
// pill reports the scripture gap, the links report what does exist.
const linksFor = (l) => {
  // The kind is taken from the row's own TYPE, never assumed. This used to tag the first two
  // rows "scripture" whatever they were, which was harmless while the list only held text
  // Scripture and became a doctrinal error the moment it held gospel audio: Words of Life is
  // gospel messages with songs, and styling it as Scripture tells a reader they have a
  // translation when they do not.
  const RES_KEY = {
    'JESUS Film': 'gospel.res.jesusFilm',
    'Scripture in this language': 'gospel.list.scriptureHere',
    'Bible video': 'gospel.res.bibleVideo',
    'Gospel audio': 'gospel.res.gospelAudio',
    'Gospel presentation': 'gospel.res.gospelPresentation',
    'Scripture Earth': 'gospel.res.scriptureEarth',
    'Zume discipleship training': 'gospel.res.training',
  }
  const KIND = {
    Scripture: 'scripture',
    'Bible Stories': 'scripture',
    Film: 'film',
    'Audio Scripture': 'audio',
    'Gospel audio': 'audio',
    'Bible video': 'video',
    'Gospel presentation': 'film',
    'Discipleship training': 'film',
  }
  // Film, audio and Bible video used to be appended here by hand as well as arriving in
  // `resources`; the helper returns them once, so appending again would double them.
  return (l.resources || []).slice(0, 4).map((r) => ({
    url: r.url,
    /* The GENERIC resource names are chrome and translate; a publisher's own title —
       "Hoffnung für alle", "German ELBBK Bible" — is data and passes through untouched.
       The map's chips already read these keys, so the two surfaces name a resource the
       same way in every locale. */
    title: RES_KEY[r.title] ? tr(RES_KEY[r.title]) : r.title,
    kind: KIND[r.type] || 'scripture',
  }))
}

useShadowStyles(
  '.gr{position:absolute;inset:0;overflow-y:auto;padding:20px 18px 44px;background:#f6f7f9;color:#0f1419;' +
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  '.gr.is-dark{background:#0a1410;color:#e5e7eb}' +
  '.gr-h{margin:0 0 4px;font-size:19px;font-weight:700;text-align:center}' +
  '.gr-sub{margin:0 auto 16px;max-width:660px;font-size:12.5px;line-height:1.55;text-align:center;opacity:.78}' +
  '.gr-sub strong{opacity:1}' +
  // The headline number: people groups whose language has no scripture found.
  '.gr-hero{max-width:660px;margin:0 auto 18px;padding:14px 16px;border-radius:10px;text-align:center;' +
  'background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.18)}' +
  '.is-dark .gr-hero{background:rgba(220,38,38,.12);border-color:rgba(248,113,113,.25)}' +
  '.gr-hero-n{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}' +
  '.gr-hero-t{font-size:12px;margin-top:4px;opacity:.8}' +
  '.gr-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:16px;flex-wrap:wrap}' +
  '.gr-tab{font:600 12px inherit;padding:6px 14px;border-radius:999px;cursor:pointer;' +
  'border:1px solid rgba(0,0,0,.14);background:transparent;color:inherit}' +
  /* HOUSE ACCENT, NOT TAILWIND EMERALD. #10b981 is not in this product's palette
     (#f3f3f1 #fff #3b463d #92b195 #d1d4cd #6d766e), and the three gospel leaves did not
     even agree with each other: the map's active mode was near-black while the list and
     the tables were emerald, so the same control looked like two different controls
     depending on which tab you were on. Light uses the house dark on white text, dark uses
     the house sage on near-black. MEASURED contrast: 9.86:1 and 7.89:1, both well past AA
     for 12px bold. Sage with #3b463d text was the obvious pairing and was rejected — 4.20:1,
     under the 4.5 this size needs. */
  '.gr-tab.on{background:#3b463d;border-color:#3b463d;color:#fff}' +
  '.is-dark .gr-tab.on{background:#92b195;border-color:#92b195;color:#0f1419}' +
  '.list{max-width:1080px;margin:0 auto}' +
  '.row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;' +
  'padding:10px;border-bottom:1px solid rgba(0,0,0,.07)}' +
  '.is-dark .row{border-bottom-color:rgba(255,255,255,.08)}' +
  '.r-lang{font-size:14px;font-weight:700}' +
  '.r-code{font-size:10.5px;opacity:.55;font-family:ui-monospace,monospace;margin-inline-start:6px}' +
  '.r-meta{font-size:11.5px;opacity:.68;margin-top:2px;line-height:1.45}' +
  '.r-credit{font-size:11.5px;color:#6d766e;margin-top:2px;line-height:1.35}' +
  '.is-dark .r-credit{color:#d1d4cd}' +
  '.r-pop{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:end;white-space:nowrap}' +
  '.pill{font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap}' +
  '.pill.no{background:rgba(220,38,38,.13);color:#a12020}' +
  '.pill.nt{background:rgba(245,158,11,.16);color:#8a6414}' +
  '.pill.full{background:rgba(16,185,129,.15);color:#0b7a5b}' +
  '.res{margin-top:4px;font-size:11px}' +
  '.res a{color:#0b7a5b;text-decoration:none;font-weight:600}' +
  '.res a:hover{text-decoration:underline}' +
  // Two links on one row need separating, or "Holy Bible" and "JESUS Film" read as one string.
  '.res a + a{margin-inline-start:10px}' +
  // The film link is a DIFFERENT KIND of resource from a scripture edition, so it is marked rather
  // than left to look like another Bible. Muted against the scripture green: a film is a real
  // resource but not a text, and this list is about text availability first.
  '.res a.is-film{color:#6d766e;font-weight:500}' +
  '.res a.is-film::before{content:"▸ "}' +
  // Audio reads as its own kind, so a recording is never mistaken for a text to read.
  '.res a.is-audio{color:#6d766e;font-weight:500}' +
  '.res a.is-audio::before{content:"♪ "}' +
  '.res a.is-video{color:#6d766e;font-weight:500}' +
  '.res a.is-video::before{content:"▤ "}' +
  '.caveat{max-width:1080px;margin:18px auto 0;padding:12px 14px;border-radius:8px;' +
  'background:rgba(0,0,0,.04);font-size:11.5px;line-height:1.65;opacity:.85}' +
  '.is-dark .caveat{background:rgba(255,255,255,.06)}' +
  '.caveat b{font-weight:700}',
  'doxa-gospel-resources',
)
</script>

<template>
  <div class="gr" :class="{ 'is-dark': isDark }">
    <h2 class="gr-h">{{ tr('gospel.pages.listTitle') }}</h2>
    <p class="gr-sub" dir="ltr">
      Which unengaged people groups have scripture <strong>in their own language</strong> —
      and which have none yet found.
    </p>

    <div class="gr-hero" dir="ltr">
      <div class="gr-hero-n" dir="ltr">{{ fmt(stats.people_groups_without_scripture) }}</div>
      <div class="gr-hero-t" dir="ltr">
        people groups across {{ fmt(stats.languages_without) }} languages
        — no text Scripture found in the pools checked
        <br>≈ {{ fmt(stats.population_without_scripture) }} people
        <template v-if="biggestUnfound">
          <br><small>The largest are {{ biggestUnfound }} — major languages that DO have
          Scripture, which the pools reachable here simply do not host. This counts what was
          not FOUND in eBible, JESUS Film and Door43, not what does not exist.</small>
        </template>
      </div>
    </div>

    <div class="gr-tabs">
      <button v-for="f in FILTERS" :key="f.id" type="button"
        class="gr-tab" :class="{ on: filter === f.id }" @click="filter = f.id">
        {{ tr(f.labelKey) }}
      </button>
    </div>

    <div class="list">
      <div v-for="l in shown" :key="l.iso639_3" class="row">
        <div>
          <div class="r-lang">
            {{ l.language }}<span class="r-code">{{ l.iso639_3 }}</span>
          </div>
          <div class="r-meta">
            {{ l.people_group_count }} {{ l.people_group_count === 1 ? tr('gospel.list.peopleGroup') : tr('gospel.list.peopleGroups') }}
            · {{ l.countries.slice(0, 3).join(', ') }}<template v-if="l.countries.length > 3">
              +{{ l.countries.length - 3 }}</template>
          </div>
          <!-- Data, not chrome: an organisation's name is the same in every locale, which is
               why it needs no catalogue entry and why it can sit beside translated labels
               without leaving a hole in them. -->
          <div v-if="l.credit" class="r-credit" dir="ltr">{{ l.credit.o
            }}<template v-if="l.credit.y">, {{ l.credit.y }}</template></div>
          <div v-if="linksFor(l).length" class="res">
            <a v-for="(r, i) in linksFor(l)" :key="i" class="res-a" :class="'is-' + r.kind"
              :href="r.url" target="_blank" rel="noopener">{{ r.title }}</a>
          </div>
        </div>
        <div class="r-pop">{{ fmt(l.population) }}</div>
        <span class="pill" :class="l.full_bible ? 'full' : l.has_scripture ? 'nt' : 'no'">
          <!-- "no text" rather than "none found". The pill has always meant the TEXT
               Scripture gap, and that was fine while text was all the row could show. Now a
               row can carry audio Scripture and a 27-part Bible video and still be pilled
               "none found" — Arabic Moroccan does exactly that — which reads as the row
               contradicting itself. Naming the medium keeps the same honest claim and stops
               it being misread as "nothing exists for these people". -->
          {{ l.full_bible ? 'full Bible' : l.has_scripture ? 'partial' : 'no text' }}
        </span>
      </div>
    </div>

    <!-- The caveat is IN the UI, not buried in a data file. A reader acting on
         this needs to know what "none found" does and does not mean. -->
    <div class="caveat">
      <b>{{ tr('gospel.list.noTextMeans') }}</b> <bdi dir="ltr">It is the TEXT Scripture gap, and nothing wider: a row
      pilled “no text” may still show audio Scripture, a film or a Bible video beside it, and
      several do. Not found in the resource pools checked so far —
      currently</bdi> <b>eBible.org</b> <bdi dir="ltr">({{ fmt(stats.ebible_translations) }} translations across
      {{ fmt(stats.ebible_languages) }} languages, public data), plus PNG.Bible, the JESUS
      Film catalogue, Door43, and Faith Comes By Hearing for both text and audio Scripture. It does</bdi>
      <b>not</b> <bdi dir="ltr">mean no scripture exists: Scripture Earth and Global Recordings Network are
      searched too, GRN swept for every language in the gap at the crawl delay they ask for;
      api.bible, the Digital Bible Library, progress.bible and YouVersion need credentials
      this build does not have. A pool nobody has queried shows as unknown, never as “no”.
      Languages are joined to people groups by exact ISO&nbsp;639-3 code.</bdi>
      <br><br>
      {{ tr('gospel.list.pageLists') }} <b><bdi dir="ltr">published resource availability only</bdi></b><bdi dir="ltr">. It carries no information
      about churches, believers or gatherings, by design.</bdi>
    </div>
  </div>
</template>
