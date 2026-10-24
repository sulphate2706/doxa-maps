// check-i18n-parity — a key that exists in English must exist in every locale.
//
// ★ THE FAILURE IS SILENT BY DESIGN. vue-i18n falls back to English for a missing
// key, which is the right runtime behaviour and the reason this drifts unnoticed:
// the app looks fine, nothing errors, and a reader who chose Spanish simply gets
// English words with no indication anything is missing.
//
// Measured when this was written: buttons.json had 21 keys in English and 19 in
// every other locale. The two orphans were `share` and `shareSteps` — the Share
// button's own title and its five-step explainer, rendered on EVERY map. Ten
// locales had been shipping an English Share button since the key was added.
//
// It reports per-locale so a partial translation is visible as a number rather
// than as a vague sense that "some things aren't translated".
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠ REPO-RELATIVE, never an absolute path. This gate exists in MORE THAN ONE repo
// (doxa-maps-plugin-studio and wt-packet are separate repos, not worktrees), and a
// hardcoded /home/... made the studio copy silently grade wt-packet's locales —
// so a ceiling lowered in one repo left the other's stale and neither was wrong on
// its face. Each copy now checks ITS OWN tree. (check:no-abs-paths, 2026-09-24.)
const REPO = process.env.DOXA_REPO
  || resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(REPO, 'library/i18n/locales')
if (!existsSync(ROOT)) { console.error(`I18N-PARITY: FAIL — no locales at ${ROOT}`); process.exit(1) }

// Flatten so nested objects and arrays are compared key-by-key, not shallowly.
const flat = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out)
    else out[key] = v
  }
  return out
}

const read = (loc, area) => {
  const p = join(ROOT, loc, area)
  if (!existsSync(p)) return null
  try { return flat(JSON.parse(readFileSync(p, 'utf8'))) } catch { return undefined }
}

// A locale is a DIRECTORY. The old existsSync() test was true for anything readdir returned,
// including a file, so adding a README beside the folders made it read as a locale missing all
// 1,685 keys. Documentation belongs next to the thing it documents; the filter is what was wrong.
const locales = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
if (!locales.includes('en')) { console.error('I18N-PARITY: FAIL — no English catalog to compare against'); process.exit(1) }
const areas = readdirSync(join(ROOT, 'en')).filter((f) => f.endsWith('.json'))

// ── KNOWN DEBT, RATCHETED — AND THE MAP IS NOW EMPTY ────────────────────────
// ★ ALL ELEVEN LOCALES ARE COMPLETE. 2026-09-24: the last 162 keys closed
// (regions.json for it/ro/zh, 54 each), finishing the 429-key debt this gate
// found when it was written.
//
// THE MAP IS DELIBERATELY EMPTY RATHER THAN FULL OF ZEROS. A locale with no entry
// here MUST be complete — the gate fails it outright for a single missing key —
// so an empty DEBT is the strongest state this ratchet can be in, not an unset
// one. Writing `{ it: 0, ... }` would mean the same today and quietly permit a
// regression back up the moment someone "adjusted" a number.
//
// HOW IT WORKED, for whoever needs to add debt back: these were a CEILING, not a
// target — the gate failed when a locale got WORSE and printed a nudge when one
// improved, so the number could be lowered. That let real translation work sit in
// the backlog without blocking every build, which is what a gate everyone
// disables protects against. If a new English key lands ahead of its
// translations, add the locale here with its count and lower it as they arrive.
// Never raise a number; never add a locale that is already complete.
const DEBT = {
  // 2026-10-03, the Share menu's 10 new share.json keys (shareable pages P3): localization is English-only for now.
  // tStatic falls back to the English text, so these locales show English until the translations arrive;
  // lower each to 0 then, and empty the map again.
  // + the Embed tab's 9 keys (URL / Iframe / JavaScript, P3b), the same English-only rule.
  ar: 19, de: 19, es: 19, fr: 19, hi: 19, it: 19, pt: 19, ro: 19, ru: 19, zh: 19,
}

const fails = []
const improved = []
const rows = []
for (const loc of locales.filter((l) => l !== 'en').sort()) {
  let missing = 0
  let total = 0
  const examples = []
  for (const area of areas) {
    const en = read('en', area)
    const other = read(loc, area)
    total += Object.keys(en).length
    if (other === null) { missing += Object.keys(en).length; examples.push(`${area} (whole file)`); continue }
    if (other === undefined) { fails.push(`${loc}/${area} is not valid JSON`); continue }
    for (const k of Object.keys(en)) {
      if (!(k in other)) { missing += 1; if (examples.length < 3) examples.push(`${area}:${k}`) }
    }
  }
  rows.push({ loc, missing, total, examples })
  const ceiling = DEBT[loc]
  if (ceiling === undefined) {
    if (missing) fails.push(`${loc} is missing ${missing}/${total} key(s) and has no DEBT entry — `
      + `e.g. ${examples.join(', ')}`)
  } else if (missing > ceiling) {
    fails.push(`${loc} regressed: ${missing} missing key(s), was ${ceiling} — `
      + `e.g. ${examples.join(', ')}`)
  } else if (missing < ceiling) {
    improved.push(`${loc}: ${missing} missing, ceiling still says ${ceiling} — lower it`)
  }
}

console.log(`  locales : ${locales.length} (${locales.sort().join(' ')})`)
console.log(`  areas   : ${areas.length} catalog file(s), ${Object.keys(read('en', areas[0]) || {}).length}+ keys each`)
for (const r of rows) {
  const c = DEBT[r.loc]
  const tag = r.missing === 0 ? 'complete'
    : (c !== undefined && r.missing <= c ? `${r.missing} missing (known debt, ceiling ${c})`
       : `${r.missing} missing`)
  console.log(`  ${r.loc.padEnd(4)} ${tag}`)
}

if (fails.length) {
  console.error(`\nI18N-PARITY: FAIL — ${fails.length} problem(s)`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
if (improved.length) {
  console.log('\n  ↓ improved since the ceiling was set — lower DEBT in this file:')
  for (const i of improved) console.log('    ' + i)
}
const debt = rows.reduce((a, r) => a + r.missing, 0)
// ★ zh IS SIMPLIFIED, and a Traditional string in it renders mixed scripts in one row (buttons.json
// once had 禱告名單 beside 为他们祷告). This arm fails on any zh value containing a character that
// exists ONLY in Traditional. The list is a FLOOR, not a converter: a Traditional character missing
// from it passes unseen, so the PASS line says "from a known set", never "none remain". No converter
// (opencc) is installed; if one is added, replace this with a t2s round-trip.
const TRAD_ONLY = new Set([...'來個們價兒動務區問單國圖學實寫將對層師帶幣廠廣廳愛應懷戰戲擊據擴擺攝敵數斷時曬書會東條棄業樂樓標樣樹橋機歷歸殺毀氣滅漢潔濟為無燈營爭爾獨獲現瑪環產畫異當疊發盡監禮禱種稱積穩窮竊競筆節範簡籃籌粵糧紀約紅納純紙級細終組結絕絡給統絲經綠維網緊線緣編緩縣縮總績織繼續罰羅義習聯聰聲職聽肅腦臟與興舉舊華萬藝藥蘇蘭蟲衆術衛製複見規視親覺觀訂計訊討訓記訪設許診註評詞詢試詩話該詳誌認語誠誤說誰課調談請論諸講謝謹證識譜譯議護讀變讓讚豐貓財貧貨貪責貴買費賀資賊賓賜賞賢賣賤質購贊贏赴趕車軌軍軟載輕輛輪轉辦辭農這運過達違遠適遲遷選還邊鄉鄰醫釋針銀鋪鋼錢鍵鎖鐘鐵長門閉開閱闆闊關陣陳陽隊階雙雜雞離難雲電霧靈靜韓頁項順預頓領頭頻顆題顏願類顧顯風飄飛養餘館馬驗體魚鳥麼點'])
const zhTrad = []
{
  const walk = (o, p, area) => {
    if (typeof o === 'string') { const hit = [...o].filter((c) => TRAD_ONLY.has(c)); if (hit.length) zhTrad.push(`${area}:${p} (${hit.join('')})`) }
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k, area)
  }
  if (existsSync(join(ROOT, 'zh'))) for (const a of areas) { const p = join(ROOT, 'zh', a); if (existsSync(p)) walk(JSON.parse(readFileSync(p, 'utf8')), '', a) }
  // ★ AND THE PACKET'S OWN CATALOGUE. The printed prayer packet reads packet-strings.json, not these
  // areas, so its zh block was outside this arm entirely — and drifted to 18 Traditional keys (the
  // whole wheel and all 12 prayer points among them) while this arm stayed green. A Chinese packet
  // then switched script partway through the document.
  const PACKET = join(ROOT, '..', '..', 'scripts', 'posters', 'packet-strings.json')
  if (existsSync(PACKET)) { const zhp = JSON.parse(readFileSync(PACKET, 'utf8')).zh; if (zhp) walk(zhp, '', 'packet-strings') }
}
if (zhTrad.length) {
  console.log(`\nI18N-PARITY: FAIL — ${zhTrad.length} zh value(s) contain Traditional-only characters; zh is Simplified:`)
  for (const z of zhTrad.slice(0, 20)) console.log(`  - ${z}`)
  process.exit(1)
}
console.log(`  zh script: no Traditional-only characters from a known set of ${TRAD_ONLY.size} (a floor, not a converter)`)
console.log(`\nI18N-PARITY: PASS — no locale regressed. ${debt} key(s) of known translation debt remain.`)
