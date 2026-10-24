<script setup>
/**
 * GiDrawer.vue — one people group, in four sourced sections (see ../../README.md, "Honesty"):
 * what exists in their own language; the way in; the country's (and Indian state's) connectivity; pray.
 *
 * ★ GLUE to the kit's detail drawer (landing 5) with the `detail.sections` shape the kit spec names as a
 * gap (section 9): the four sections are data (`sections`, below), rendered by one loop, so the move to
 * the kit's drawer is a config handover, not a rewrite.
 *
 * HONESTY, on every open drawer: the approximate-pin notice; "found in the sources checked", never
 * "reached"; every internet line names its source and year and says it is the country's figure. Nothing
 * about who works where.
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useShadowStyles } from '@map/composables/useShadowStyles.js'
import { useBoardState } from '../useBoard.js'
import { useGiT } from '../useGiT.js'
import { wayInText } from '../columns.js'
import { safeHref, DETAIL_FILL, DETAIL_RIM, BAND_COLOR, label } from '../model.js'

const T = useGiT()
const board = useBoardState()
const r = computed(() => board.openRow.value)
const closeBtn = ref(null)
watch(r, async (v) => { if (v) { await nextTick(); try { closeBtn.value && closeBtn.value.focus({ preventScroll: true }) } catch (_) {} } })

const n = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString())
const LINKS = [
  ['scripture_url', 'gospelInternet.kind.scripture', 'Scripture'], ['film_url', 'gospelInternet.kind.film', 'Film'],
  ['audio_url', 'gospelInternet.kind.audio', 'Audio'], ['gospel_audio_url', 'gospelInternet.drawer.gospelAudio', 'Gospel recordings'],
  ['bible_video_url', 'gospelInternet.kind.video', 'Video'], ['stories_url', 'gospelInternet.kind.stories', 'Stories'],
  ['training_url', 'gospelInternet.drawer.training', 'Disciple-making training'],
]

const sections = computed(() => {
  const g = r.value
  if (!g) return []
  const own = LINKS.filter(([k]) => safeHref(g[k])).map(([k, key, en]) => ({ label: T(key, en), href: safeHref(g[k]) }))
  const wayLines = []
  if (g.way_in) wayLines.push({ label: T('gospelInternet.drawer.wayIn', 'Way in'), text: wayInText(g, T) })
  if (g.way_in === 'bridge') {
    const has = [g.bridge_has_scripture && T('gospelInternet.kind.scripture', 'Scripture'), g.bridge_has_film && T('gospelInternet.kind.film', 'Film')].filter(Boolean)
    if (has.length) wayLines.push({ label: T('gospelInternet.drawer.bridgeHas', 'In the bridge language'), text: has.join(' · ') })
  }
  if (g.deaf_bridge && g.way_in !== 'deaf') wayLines.push({ label: T('gospelInternet.wayIn.deaf', 'Deaf bridge'), text: g.deaf_bridge })
  if (g.deaf_bridge_publisher) wayLines.push({ label: T('gospelInternet.col.deafPublisher', 'Sign-language publisher'), text: g.deaf_bridge_publisher })
  const wayLinks = [
    safeHref(g.bridge_training_url) && { label: T('gospelInternet.col.bridgeTraining', 'Training (bridge)'), href: safeHref(g.bridge_training_url) },
    safeHref(g.deaf_bridge_url) && { label: T('gospelInternet.drawer.deafLink', 'Signed Scripture'), href: safeHref(g.deaf_bridge_url) },
  ].filter(Boolean)
  const wb = T('gospelInternet.drawer.wbSource', 'World Bank, {year}: the country\'s figure', { year: g.internet_year || '—' })
  const conn = [
    { label: T('gospelInternet.col.internet', 'Country online'), text: g.internet_pct == null ? T('gospelInternet.band.nodata', 'No data') : `${n(g.internet_pct)}%`, note: g.internet_pct == null ? '' : wb },
    { label: T('gospelInternet.col.band', 'Internet band'), text: label(T, 'band', g.internet_band), swatch: BAND_COLOR[g.internet_band] },
  ]
  if (g.mobile_per_100 != null) conn.push({ label: T('gospelInternet.col.mobile', 'Mobile per 100'), text: n(g.mobile_per_100), note: T('gospelInternet.drawer.mobileNote', 'Subscriptions per 100 people ({year}); one person may hold several.', { year: g.mobile_year || '—' }) })
  if (g.state_internet_women != null || g.state_internet_men != null) {
    conn.push({ label: T('gospelInternet.drawer.stateOnline', '{state}: ever used the internet', { state: g.province }),
      text: T('gospelInternet.drawer.womenMen', 'women {w} · men {m}', { w: g.state_internet_women == null ? '—' : n(g.state_internet_women) + '%', m: g.state_internet_men == null ? '—' : n(g.state_internet_men) + '%' }),
      note: T('gospelInternet.drawer.nfhsNote', 'NFHS-5, 2019-21, ages 15-49: the state\'s figure, not the group\'s.') })
  }
  // Platforms in the country: messaging (Apple top-free, iOS only) and social (StatCounter referrals),
  // never on one scale, each with its source. A country outside Apple's feed is "not measured".
  const pc = board.countries.value[g.iso3]
  const plat = []
  if (pc && pc.in_app_feed) {
    if (pc.messaging.length) plat.push({ label: T('gospelInternet.drawer.messaging', 'Messaging apps (iOS downloads)'), text: pc.messaging.map((m) => `${m.app} #${m.rank}`).join(' · '), note: board.meta.value.platforms?.ios_caveat || '' })
  } else {
    plat.push({ label: T('gospelInternet.drawer.messaging', 'Messaging apps (iOS downloads)'), text: T('gospelInternet.charts.notMeasured', 'Not measured'), note: T('gospelInternet.drawer.noFeed', 'This country is not in Apple\'s feed: its messaging apps are unknown here, not absent.') })
  }
  if (pc && pc.social.length) plat.push({ label: T('gospelInternet.drawer.social', 'Social platforms (web referrals)'), text: pc.social.map((x) => `${x.platform} ${n(x.pct)}%`).join(' · '), note: T('gospelInternet.drawer.platformNote', 'Share of web referrals among tracked social platforms in the country (StatCounter). Messaging apps such as WhatsApp are not measured.') })
  // Open data to start a translation from: five named, cited signals (no score). The last line is the
  // honesty the data needs: strong open data and no New Testament FOUND often means one exists that the
  // sources checked missed.
  const rd = board.readiness.value.byIso.get(g.iso639_3)
  const openLines = []
  const openLinks = []
  if (rd) {
    openLines.push({ label: T('gospelInternet.drawer.openCount', 'Open data'), text: T('gospelInternet.drawer.openOf', '{n} of 5 signals', { n: n(rd.signals) }) })
    openLines.push({ label: T('gospelInternet.col.openGrammar', 'Grammar (Glottolog)'), text: rd.grammar === null ? T('gospelInternet.drawer.notInSource', 'not in this source') : (rd.grammar || '—') })
    openLines.push({ label: T('gospelInternet.col.openBooks', 'Scripture books (eBible)'), text: n(rd.scripture_books) || '0' })
    openLines.push({ label: T('gospelInternet.col.openSpeech', 'Speech hours (Common Voice)'), text: rd.speech_hours ? n(rd.speech_hours) : '0' })
    openLines.push({ label: T('gospelInternet.col.openBench', 'MT benchmark (FLORES+)'), text: rd.benchmark || '—' })
    if (rd.wikipedia) openLinks.push({ label: T('gospelInternet.col.openWiki', 'Wikipedia') + ' (' + rd.wikipedia + ')', href: safeHref(`https://${rd.wikipedia}.wikipedia.org/`) })
    if (rd.grammar !== null && g.iso639_3) openLinks.push({ label: 'Glottolog', href: safeHref(`https://glottolog.org/glottolog?iso=${g.iso639_3}`) })
  }
  const openNote = rd && !rd.nt && rd.signals >= 3
    ? T('gospelInternet.drawer.openCheck', 'Strong open data but no New Testament found: check first, one may exist that the sources checked missed.')
    : T('gospelInternet.drawer.openNote', 'Sources: Glottolog (CC BY 4.0), eBible, Wikipedia (CC BY-SA 4.0), Common Voice (CC0), FLORES+ (CC BY-SA 4.0). A count of named facts, not a score.')
  return [
    { id: 'own', title: T('gospelInternet.drawer.own', 'In their own language'),
      lead: { dot: g.access_detail, text: label(T, 'detail', g.access_detail) },
      lines: g.scripture ? [{ label: T('gospelInternet.kind.scripture', 'Scripture'), text: g.scripture + (g.translated_by ? ` — ${g.translated_by}` : '') }] : [],
      links: own,
      note: g.access_detail === 'none' ? T('gospelInternet.drawer.noneNote', 'Nothing found in their own language in the sources checked. That is not a claim that nothing exists.') : T('gospelInternet.drawer.foundNote', 'Found in the sources checked.') },
    { id: 'way', title: T('gospelInternet.drawer.way', 'Way in'), lines: wayLines, links: wayLinks,
      note: wayLines.length ? T('gospelInternet.drawer.wayNote', 'A neighbouring language, not a recommendation: whether a group speaks it is a question for someone on the ground.') : '' },
    { id: 'conn', title: T('gospelInternet.drawer.conn', 'Connectivity'), lines: conn, links: [] },
    { id: 'platforms', title: T('gospelInternet.drawer.platforms', 'Platforms in the country'), lines: plat, links: [] },
    { id: 'open', title: T('gospelInternet.drawer.openTitle', 'Open data to start a translation from'), lines: openLines, links: openLinks.filter((l) => l.href), note: rd ? openNote : '' },
  ].filter((s) => s.lines.length || s.links.length || s.lead)
})

const copied = ref('')
async function copyLink() {
  const url = board.groupLink(r.value.slug)
  try { await navigator.clipboard.writeText(url); copied.value = T('gospelInternet.drawer.copied', 'Link copied') }
  catch (_) { copied.value = T('messages.copyFailed', 'Copy failed — press Ctrl/Cmd-C') + ' ' + url }
  setTimeout(() => { copied.value = '' }, 4000)
}
function onKey(e) { if (e.key === 'Escape') board.closeGroup() }

useShadowStyles(
  '.gid{position:absolute;inset-block:0;inset-inline-end:0;z-index:30;width:min(380px,100%);background:#fff;color:#3b463d;' +
  'border-inline-start:1px solid #d1d4cd;box-shadow:-8px 0 24px rgba(0,0,0,.10);display:flex;flex-direction:column;' +
  'font:13px/1.45 Roboto,-apple-system,"Segoe UI",sans-serif}' +
  '.gid-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px 10px;border-bottom:1px solid #e6e8e3}' +
  '.gid-name{font-size:17px;font-weight:700;line-height:1.25;margin:0}' +
  '.gid-sub{font-size:12px;color:#6d766e;margin-top:3px}' +
  '.gid-x{margin-inline-start:auto;border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:8px;min-width:32px;min-height:32px;cursor:pointer;font-size:14px}' +
  '.gid-body{overflow-y:auto;padding:4px 16px 16px;flex:1}' +
  '.gid-notice{margin:10px 0 4px;padding:7px 9px;border-radius:8px;background:#f3f3f1;border:1px solid #e1e4de;font-size:11.5px;color:#4d564f}' +
  '.gid-sec{padding:10px 0;border-bottom:1px solid #eef0ec}' +
  '.gid-h{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#6d766e;margin:0 0 6px}' +
  '.gid-lead{display:flex;align-items:center;gap:7px;font-weight:600;margin-bottom:4px}' +
  '.gid-dot{width:11px;height:11px;border-radius:50%;box-sizing:border-box;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2);flex:none}' +
  '.gid-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-inline-end:5px;vertical-align:-1px}' +
  '.gid-line{display:flex;justify-content:space-between;gap:12px;padding:3px 0}' +
  '.gid-line b{font-weight:600;text-align:end}' +
  '.gid-lnote{font-size:11px;color:#6d766e;margin:-1px 0 4px}' +
  '.gid-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.gid-links a{display:inline-flex;align-items:center;min-height:28px;padding:2px 10px;border-radius:999px;border:1px solid #92b195;color:#3b463d;text-decoration:none;font-size:12.5px}' +
  '.gid-links a:hover{background:#e3ece2}' +
  '.gid-note{font-size:11.5px;color:#6d766e;margin-top:6px}' +
  '.gid-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid #e6e8e3;background:#f9faf8}' +
  '.gid-pray{display:inline-flex;align-items:center;min-height:32px;padding:4px 14px;border-radius:8px;background:#3b463d;color:#fff;text-decoration:none;font-weight:600}' +
  '.gid-copy{border:1px solid #d1d4cd;background:#fff;color:#3b463d;border-radius:8px;min-height:32px;padding:4px 12px;font:inherit;cursor:pointer}' +
  '.gid-praying{font-size:12px;color:#6d766e;flex-basis:100%}' +
  '.gid-x:focus-visible,.gid-copy:focus-visible,.gid-links a:focus-visible,.gid-pray:focus-visible{outline:2px solid #92b195;outline-offset:2px}',
  'gi-drawer',
)
</script>

<template>
  <aside v-if="r" class="gid" role="dialog" :aria-label="r.people_group" data-region="drawer" @keydown="onKey">
    <div class="gid-head">
      <div>
        <h2 class="gid-name"><bdi>{{ r.people_group }}</bdi></h2>
        <div class="gid-sub">
          <bdi>{{ r.country }}</bdi><template v-if="r.province"> · <bdi>{{ r.province }}</bdi> ({{ T('gospelInternet.drawer.approx', 'approximate') }})</template>
          · <bdi>{{ r.language }}</bdi> ({{ r.iso639_3 }})
          <template v-if="r.population != null"> · {{ T('gospelInternet.drawer.people', '{n} people', { n: n(r.population) }) }}</template>
          <template v-if="r.religion"> · <bdi>{{ r.religion }}</bdi></template>
        </div>
      </div>
      <button ref="closeBtn" type="button" class="gid-x" :aria-label="T('controls.close', 'Close')" @click="board.closeGroup()">✕</button>
    </div>
    <div class="gid-body">
      <p class="gid-notice" data-notice="approximate-pin">
        {{ T('gospelInternet.notice.pin', 'The dot marks this people group, not a town.') }}
        <template v-if="r.shares_point"> {{ T('gospelInternet.notice.shares', 'It shares its point with {n} other group(s).', { n: r.shares_point }) }}</template>
      </p>
      <section v-for="s in sections" :key="s.id" class="gid-sec" :data-section="s.id">
        <h3 class="gid-h">{{ s.title }}</h3>
        <div v-if="s.lead" class="gid-lead"><span class="gid-dot" :style="{ background: DETAIL_FILL[s.lead.dot], borderColor: DETAIL_RIM[s.lead.dot] }"></span>{{ s.lead.text }}</div>
        <template v-for="(l, i) in s.lines" :key="i">
          <div class="gid-line"><span>{{ l.label }}</span><b><span v-if="l.swatch" class="gid-sw" :style="{ background: l.swatch }"></span><bdi>{{ l.text }}</bdi></b></div>
          <div v-if="l.note" class="gid-lnote">{{ l.note }}</div>
        </template>
        <div v-if="s.links.length" class="gid-links">
          <a v-for="k in s.links" :key="k.href" :href="k.href" target="_blank" rel="noopener noreferrer">{{ k.label }}</a>
        </div>
        <p v-if="s.note" class="gid-note">{{ s.note }}</p>
      </section>
    </div>
    <div class="gid-foot">
      <a v-if="safeHref(r.pray_url)" class="gid-pray" :href="safeHref(r.pray_url)" target="_blank" rel="noopener noreferrer">{{ T('buttons.prayForThem', 'Pray for them') }}</a>
      <button type="button" class="gid-copy" @click="copyLink">{{ copied || T('gospelInternet.drawer.copyLink', 'Copy link to this group') }}</button>
      <span v-if="r.people_praying != null" class="gid-praying">{{ T('gospelInternet.drawer.praying', '{n} people praying on DOXA', { n: n(r.people_praying) }) }}</span>
    </div>
  </aside>
</template>
