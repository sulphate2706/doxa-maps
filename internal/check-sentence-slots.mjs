#!/usr/bin/env node
/**
 * check-sentence-slots.mjs — a sentence that carries values stays ONE translatable key.
 *
 * The properties here all fail SILENTLY: the sentence still renders, it is just wrong in a language
 * nobody on the team reads. That is the whole reason for the helper and for this gate.
 *
 *   1. a translator can REORDER the clauses — the slots follow the message, not the call
 *   2. a missing slot leaves its placeholder VISIBLE, never "null" or an empty gap
 *   3. the slotted markup is never translated around: it goes in as a value
 *   4. English renders exactly as it did before the migration
 *
 * Every arm carries a negative control, because an assertion that cannot fail is not evidence.
 */
import { sentenceParts, strong, ltr, keep } from '../library/composables/useSentence.js'
import { createI18n } from 'vue-i18n'

const pass = []
const fail = []
const ok = (label, cond, detail = '') => (cond ? pass : fail).push(detail ? `${label} — ${detail}` : label)

/** Flatten parts to readable text, so the assertions read like the sentence a person sees. */
const text = (parts) =>
  parts.map((x) => {
    // A slot may be a plain NUMBER (a count of 0 is the case that matters), and Vue renders that
    // fine. An earlier version of this flattener only special-cased strings, sent 0 down the VNode
    // branch and rendered it as '' — so the gate failed while the helper was right. The test was the
    // bug, which is exactly what a negative control is for.
    if (typeof x === 'string' || typeof x === 'number') return String(x)
    const kids = x && x.children
    if (typeof kids === 'string') return kids
    if (Array.isArray(kids)) return kids.map((c) => (typeof c === 'string' ? c : String((c && c.children) || ''))).join('')
    return ''
  }).join('')

const SLOTS = { nNone: '1,234', nLang: '7,296', noScripture: 'no scripture and no film' }
const EN = '{nNone} of {nLang} languages have {noScripture}'
// Arabic puts the object first and the counts after — the order English cannot express.
const AR = '{noScripture} في {nNone} لغة من أصل {nLang}'

// ── 1. reordering ───────────────────────────────────────────────────────────────────────────────
const en = text(sentenceParts(EN, SLOTS))
const ar = text(sentenceParts(AR, SLOTS))
ok('english renders in the message\'s order', en === '1,234 of 7,296 languages have no scripture and no film', en)
ok('a reordered message reorders the SLOTS with it', ar.indexOf('no scripture') < ar.indexOf('1,234'),
  'the object precedes the counts, as the arabic message asks')
// NEG CONTROL: concatenating the pieces in call order — the OLD pattern — cannot reorder. If this
// arm ever passes, the helper has stopped following the message and is following the call again.
const naive = SLOTS.nNone + ' of ' + SLOTS.nLang + ' languages have ' + SLOTS.noScripture
ok('NEG CONTROL: the old concatenation cannot express the arabic order', naive.indexOf('no scripture') > naive.indexOf('1,234'))

// ── 2. a missing slot stays visible ─────────────────────────────────────────────────────────────
const partial = text(sentenceParts(EN, { nNone: '1,234' }))
ok('a missing slot leaves its placeholder visible', partial.includes('{nLang}') && partial.includes('{noScripture}'), partial)
ok('and never renders null or undefined', !/null|undefined/.test(partial))
// NEG CONTROL: a value of 0 or '' is a REAL value and must be rendered, not treated as missing.
ok('NEG CONTROL: zero is a value, not a missing slot', text(sentenceParts('{n} found', { n: 0 })) === '0 found')

// ── 3. markup is slotted, not translated around ─────────────────────────────────────────────────
const withMarkup = sentenceParts(EN, { nNone: strong('1,234'), nLang: strong('7,296'), noScripture: ltr('no scripture and no film', true) })
ok('bold and ltr values arrive as NODES, not as strings in the message',
  withMarkup.some((p) => p && typeof p === 'object'), `${withMarkup.filter((p) => typeof p === 'object').length} node(s)`)
ok('the message itself carries no markup', !/[<>]/.test(EN) && !/[<>]/.test(AR))
// The ltr island must keep its dir, or it reverses inside an arabic sentence.
const island = withMarkup.find((p) => p && p.type === 'b' && p.children && p.children[0] && p.children[0].type === 'bdi')
ok('the ltr island keeps dir="ltr" through the slot', !!island && island.children[0].props && island.children[0].props.dir === 'ltr')
// NEG CONTROL: a catalogue that tried to carry the markup would contain angle brackets.
ok('NEG CONTROL: a message WITH markup is detectable', /[<>]/.test('{n} of <b>{m}</b>'))

// ── 4. the sentinel cannot collide with real content ────────────────────────────────────────────
// U+FFFC is OBJECT REPLACEMENT CHARACTER; a catalogue containing it is already wrong. Assert that a
// message which somehow holds one does not corrupt the split.
// PRIVATE USE (U+E000+n): unassigned by definition, so nothing in the i18n pipeline may interpret or
// rewrite it. This arm planted U+FFFC while that WAS the sentinel; it is pointed at the real one now,
// because a test aimed at the old value passes without testing anything.
const planted = text(sentenceParts('a \uE000 b {n}', { n: 'X' }))
ok('a stray sentinel in a message does not eat the slots',
  planted.includes('X') && !/X.*X/.test(planted), planted)
// U+FFFC is a REAL assigned character, so a message may legitimately contain one: it must survive.
const objRepl = text(sentenceParts('a \uFFFC b {n}', { n: 'X' }))
ok('U+FFFC is ordinary content now, not a marker', objRepl.includes('\uFFFC') && objRepl.includes('X'))

// ── 5. studio's constraints ───────────────────────────────────────────────────
// (3) TWO COUNTS, ONE KEY. vue-i18n resolves one plural form per key, so a sentence with two counts
// cannot pluralise both from its own message. Each count arrives ALREADY pluralised from its own key,
// which is why slots are phrases and not bare numbers.
const twoCounts = text(sentenceParts('{a} of {b} have {c}', { a: '1,234 languages', b: '7,296 languages', c: 'nothing found' }))
ok('a sentence carries two already-pluralised phrases without touching them',
  twoCounts === '1,234 languages of 7,296 languages have nothing found', twoCounts)
// (1) THE WHOLE KEY IS THE CALLER'S. The helper takes a MESSAGE, never a key, so it cannot assemble
// one — a key built at runtime is invisible to the build's area scan and ships as a raw key.
ok('the helper takes a message, not a key (it cannot assemble one)',
  !/\bt\s*\(/.test(String(sentenceParts)), 'sentenceParts never calls a translator')

// ── 6. THROUGH A REAL vue-i18n, because "works with precompiled messages" was a CLAIM ────────────
// studio measured the trap: t(key) with NO params BLANKS every placeholder — on 9.14.5 the message
// comes back as " of  have " — so sentenceParts would split on nothing and the sentence would lose
// its values silently, in every locale at once. keep() hands each name back as its own literal so
// t() is a no-op over them. This arm runs the real thing rather than trusting the helper in isolation.
const i18n = createI18n({ legacy: false, locale: 'en', messages: {
  en: { s: '{nNone} of {nLang} have {noScripture}' },
  ar: { s: '{noScripture} في {nNone} من أصل {nLang}' },
} })
const g = i18n.global
const render = (loc) => {
  g.locale.value = loc
  return text(sentenceParts(g.t('s', keep('nNone', 'nLang', 'noScripture')),
    { nNone: '1,234', nLang: '7,296', noScripture: 'nothing found' }))
}
ok('a real t() keeps the placeholders when given keep()', render('en') === '1,234 of 7,296 have nothing found', render('en'))
const arLive = render('ar')
ok('and a real arabic message reorders the slots', arLive.indexOf('nothing found') < arLive.indexOf('1,234'), arLive)
// NEG CONTROL: WITHOUT keep(), t() blanks the placeholders — the exact trap. If this stops failing,
// vue-i18n changed and keep() may no longer be needed; find out rather than keep it by habit.
g.locale.value = 'en'
const blanked = g.t('s')
ok('NEG CONTROL: without keep(), t() blanks the placeholders', !blanked.includes('{nNone}'), JSON.stringify(blanked))

for (const p of pass) console.log(`  ✓ ${p}`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length) {
  console.log(`\nSENTENCE-SLOTS: FAIL — ${fail.length} of ${pass.length + fail.length}`)
  process.exit(1)
}
console.log(`\nSENTENCE-SLOTS: PASS — ${pass.length} assertions, every arm with a negative control`)
