<script setup>
/**
 * rudder-voice.vue — Rudder: private, offline, streaming voice-to-text.
 *
 * @element rudder-voice
 * @description A DESKTOP-target plugin (rudder-voice.meta.json "targets": ["desktop"]). The speech
 *   model runs in the local backend (backend/rudder-engine → NVIDIA NeMo-Speech.cpp + Nemotron 3.5
 *   ASR), never in the browser and never on a server. In the Plugin Studio, `bun run dev` starts that
 *   backend and forwards /api/rudder; in the desktop app, Tauri runs it as a sidecar and passes its
 *   address in `profile-config` {"apiBase": "http://127.0.0.1:<port>/api/rudder"}.
 *
 * Everything is agent-interfaceable (the old Rudder's prime directive): the 🐞 panel copies the
 * engine log + status with a header telling an agent what to do with it.
 */
import { computed, onBeforeUnmount, onMounted, ref, nextTick, watch } from 'vue'

defineOptions({ inheritAttrs: false })

// variant="widget": the Plugin Studio's corner panel — a compact header, the draft as the main element, and
// record + copy under it; language and microphone move behind the settings button.
const props = defineProps({ profileConfig: { type: String, default: '' }, variant: { type: String, default: '' } })
const compact = computed(() => props.variant === 'widget')
// `recording` (true/false) tells a host that Rudder started or stopped listening — the Plugin Studio's
// corner button turns red with it, so a collapsed corner still shows the mic is live.
const emit = defineEmits(['recording', 'activity'])

const cfg = computed(() => {
  try { return props.profileConfig ? JSON.parse(props.profileConfig) : {} } catch { return {} }
})
const apiBase = computed(() => (cfg.value.apiBase || '/api/rudder').replace(/\/$/, ''))
// The engine records THIS computer's microphone, so it can only ever run beside the reader: on a laptop's
// dev server, or as the desktop app's sidecar. Served from anywhere else (a cloud dev server), an absent
// engine is the expected state, not a failure, and the notice says where Rudder does work.
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|tauri\.localhost)$/
const onOwnComputer = computed(() => {
  try {
    if (/^https?:\/\//.test(apiBase.value)) return LOOPBACK.test(new URL(apiBase.value).hostname)
    return typeof location === 'undefined' || location.protocol === 'tauri:' || LOOPBACK.test(location.hostname)
  } catch { return true }
})

const LANGUAGES = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-US', 'Spanish (US)'], ['es-ES', 'Spanish (Spain)'],
  ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'],
  ['nl-NL', 'Dutch'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['tr-TR', 'Turkish'], ['ar-AR', 'Arabic'],
  ['hi-IN', 'Hindi'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['vi-VN', 'Vietnamese'], ['zh-CN', 'Mandarin'],
]

const STORE_KEY = 'rudder-voice:v1'
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { return {} }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ language: language.value, device: device.value, draft: draft.value, robotOn: robotOn.value, robotVoice: robotVoice.value })) } catch {}
}
const saved = load()

const engine = ref('connecting')   // connecting | starting | ready | error | offline
const engineError = ref('')
const runtime = ref('')
const model = ref('')
const recording = ref(false)
const busy = ref(false)
const language = ref(saved.language || cfg.value.language || 'en-US')
// The draft: a text area you type and paste into; every finished utterance is APPENDED to its end.
// (v1 kept a list of lines — migrate it so nothing already dictated is lost.)
const draft = ref(typeof saved.draft === 'string' ? saved.draft
  : Array.isArray(saved.lines) ? saved.lines.map((l) => l.text).join(' ') : '')
const partial = ref('')          // the utterance being heard right now (streamed into the box's live tail)
const box = ref(null)
const level = ref(0)
const notice = ref('')
const noticeKind = ref('info')
const copied = ref('')
const showDebug = ref(false)
const showInfo = ref(false)
const showSettings = ref(false)

// ─── ROBOT VOICE ───────────────────────────────────────────────────────────────────────────────────
// Speaks each finished sentence back in a synthetic voice, so a video can use dictation without the
// speaker's real voice in it. Providers (all on this computer, nothing leaves it):
//   piper:<voice>:<speaker>  the engine's Piper voice (tts.go) — offline neural TTS on the CPU
//   system:<voiceURI>        the browser's own voices, ONLY those with localService === true (some
//                            browsers synthesise "online" voices on a server — never offered here)
// Sentences, not words: TTS needs a few words of context for its intonation; single words sound choppy.
// speak(text) is the one entry point, so a future conversational mode can reuse the same voice.
const robotOn = ref(saved.robotOn === true)
const robotVoice = ref(typeof saved.robotVoice === 'string' ? saved.robotVoice : '')
const robotOptions = ref([])   // [{ value, label }]
const robotError = ref('')
// A handful of LibriTTS-R speakers as presets — 904 is too many to list, and the voice file does not say
// which are men. MEASURED 2026-09-28: the same sentence synthesised for 61 speakers, median pitch per
// speaker (men ~85–150 Hz, women ~170–260 Hz); the default was speaker 0, a woman; a man was asked for.
// Exactly five of each, no more ("5 male, 5 female, don't overdo it"); the first is the default.
const PIPER_SPEAKERS = [
  { n: 90, label: 'Male voice 1' },    // 92 Hz
  { n: 435, label: 'Male voice 2' },   // 96 Hz
  { n: 870, label: 'Male voice 3' },   // 97 Hz
  { n: 735, label: 'Male voice 4' },   // 99 Hz
  { n: 375, label: 'Male voice 5' },   // 108 Hz
  { n: 525, label: 'Female voice 1' }, // 206 Hz
  { n: 450, label: 'Female voice 2' }, // 208 Hz
  { n: 15, label: 'Female voice 3' },  // 216 Hz
  { n: 285, label: 'Female voice 4' }, // 223 Hz
  { n: 315, label: 'Female voice 5' }, // 237 Hz
]

async function loadRobotVoices() {
  const opts = []
  robotError.value = ''
  try {
    const r = await (await fetch(apiBase.value + '/tts/voices')).json()
    if (r.available) {
      for (const v of r.voices) {
        const speakers = v.speakers > 1 ? PIPER_SPEAKERS.filter((x) => x.n < v.speakers) : [{ n: 0, label: 'Voice' }]
        for (const x of speakers) opts.push({ value: `piper:${v.id}:${x.n}`, label: `${x.label} · offline` })
      }
    } else if (r.error) robotError.value = r.error
  } catch { /* engine offline: system voices may still work */ }
  // System voices are a FALLBACK only (the offline voices not installed), at most ten: Firefox on Linux alone
  // lists dozens of on-device eSpeak voices, which would bury the ten real choices.
  const synth = typeof window !== 'undefined' && window.speechSynthesis
  if (synth && !opts.length) {
    for (const v of synth.getVoices().filter((x) => x.localService).slice(0, 10)) opts.push({ value: 'system:' + v.voiceURI, label: 'System voice · ' + v.name })
  }
  robotOptions.value = opts
  if (!opts.some((o) => o.value === robotVoice.value)) {
    // Default: Male voice 5 (speaker 375) — chosen by ear as the clearest; 1–4 sounded muffled.
    const preferred = opts.find((o) => /:375$/.test(o.value))
    robotVoice.value = preferred ? preferred.value : opts[0] ? opts[0].value : ''
  }
}

const sayQueue = []
let saying = false
// ─── What the robot says: whole sentences, as soon as they're complete, cleaned up ───────────────
// The engine only sends a FINAL after a pause, so during a minute of continuous talk the robot fell silent
// and then read everything at once. The model already punctuates as it streams, so a sentence is ready the
// moment a word ending in . ! or ? is followed by more words: speak it then, without waiting for a pause.
// Fragments under 3 words ("Okay.") wait and ride along with the next sentence. robotSpoken counts the words
// of the current utterance already handed to the robot; the final speaks only what's left.
let robotSpoken = 0
const SENTENCE_END = /[.!?]["')\]]?$/
// ★ RUN-ONS (measured 2026-09-28): with no pause between sentences the model joins them with a COMMA, not
// a period ("…immediately afterwards, going along…"), so during non-stop ideation there may be no sentence
// end for 20+ seconds. So a long pending stretch also breaks at a clause: ≥14 words waiting → speak up to the
// last comma (keeping ≥8 words); ≥35 words with no comma at all → speak the first 25, so the robot never
// falls silent for long.
// ★ OVER-SPLITTING (measured 2026-09-28, first live use): at ≥14 words the comma rule also cut ordinary
// long sentences in two. Raised to ≥20 words waiting, keeping ≥10 in the piece spoken.
const CLAUSE_END = /[,;:]$/
function robotOnPartial(full) {
  if (!robotOn.value) return
  const w = wordsOf(full)
  const done = w.length - 1            // the last word may be half-streamed: only words before it are settled
  const pending = done - robotSpoken
  let end = -1
  for (let i = robotSpoken; i < done; i++) if (SENTENCE_END.test(w[i])) end = i
  if (end < 0 && pending >= 20) {
    for (let i = robotSpoken + 9; i < done; i++) if (CLAUSE_END.test(w[i])) end = i
    if (end < 0 && pending >= 35) end = robotSpoken + 24
  }
  if (end >= robotSpoken && end - robotSpoken + 1 >= 3) {
    speak(takeHeld() + w.slice(robotSpoken, end + 1).join(' '))
    robotSpoken = end + 1
  }
}
// ★ A PAUSE IS NOT A SENTENCE END. The engine finalises after 0.8 s of silence — a breath in the middle of a
// sentence included — and the robot used to speak that fragment on its own, so one sentence came out as two.
// A final that doesn't end in . ! or ? is HELD and joined to whatever is said next; if nothing follows within
// 2.5 s (or recording stops) it is spoken as it is.
let robotHeld = ''
let robotHoldTimer = null
function takeHeld() {
  clearTimeout(robotHoldTimer)
  const h = robotHeld
  robotHeld = ''
  return h ? h + ' ' : ''
}
function speakHeld() {
  const h = takeHeld().trim()
  if (h && robotOn.value) speak(h)
}
function robotOnFinal(text) {
  const rest = wordsOf(text).slice(robotSpoken)
  robotSpoken = 0
  if (!robotOn.value || !rest.length) return
  if (SENTENCE_END.test(rest[rest.length - 1])) {
    speak(takeHeld() + rest.join(' '))
  } else {
    robotHeld = (robotHeld ? robotHeld + ' ' : '') + rest.join(' ')
    clearTimeout(robotHoldTimer)
    robotHoldTimer = setTimeout(speakHeld, 2500)
  }
}

// A light clean-up of what the ROBOT says (the box keeps exactly what was said): drop filler sounds, collapse
// stuttered repeats ("the the"), tidy spacing, capitalise. Pure text rules, no model, no extra compute.
// A filler takes its commas with it (", um," → " "), but never a full stop that ends a sentence.
const FILLERS = /(?:,\s*)?\b(?:u+m+|u+h+m*|e+r+m+|h+m+|a+h+)\b(?:\s*,)?/gi
function cleanForSpeech(t) {
  let s = (t || '').replace(FILLERS, ' ')
  s = s.replace(/\b(\w+)(?:[,\s]+\1\b)+/gi, '$1')
  s = s.replace(/\s+([,.!?;:])/g, '$1').replace(/([,.!?;:])(?=[^\s\d])/g, '$1 ').replace(/\s{2,}/g, ' ').trim()
  s = s.replace(/^[,.;:!?\s]+/, '')
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

function speak(text) {
  const t = cleanForSpeech(text)
  if (!t || !robotVoice.value) return
  sayQueue.push(t)
  if (!saying) drainSpeech()
}
// While the robot talks, the engine feeds the transcriber silence (unless the sound goes to headphones),
// so a loudspeaker never transcribes the robot back into the box.
// ★ PIPELINED (robot mode only): the next sentence's audio is synthesised WHILE the current one plays, so the
// robot no longer pauses ~1 s between sentences to render the next — the same work, overlapped.
async function drainSpeech() {
  saying = true
  post('/duck', { on: true }).catch(() => {})
  const nextJob = () => {
    const text = sayQueue.shift()
    if (!text) return null
    const audio = robotVoice.value.startsWith('piper:') ? renderPiper(text) : null
    audio?.catch(() => {})   // awaited later; don't report it as unhandled meanwhile
    return { text, audio }
  }
  let job = nextJob()
  while (job) {
    const ahead = nextJob()   // start rendering the next sentence now
    try {
      if (job.audio) await playAudio(await job.audio)
      else await speakSystem(job.text)
      robotError.value = ''
    } catch (err) { robotError.value = String(err.message || err) }
    job = ahead || nextJob()
  }
  await new Promise((r) => setTimeout(r, 250))   // let the room's echo die down
  post('/duck', { on: false }).catch(() => {})
  saying = false
}
async function renderPiper(text) {
  const [, voice, speaker] = robotVoice.value.split(':')
  const r = await fetch(apiBase.value + '/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speaker: Number(speaker) || 0 }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The robot voice failed')
  return URL.createObjectURL(await r.blob())
}
async function playAudio(url) {
  try {
    await new Promise((done, fail) => {
      const a = new Audio(url)
      a.onended = () => done()
      a.onerror = () => fail(new Error('The robot voice could not be played'))
      // A browser can refuse to play sound until you have clicked in the page; say so instead of staying silent.
      a.play().catch((err) => fail(new Error(err && err.name === 'NotAllowedError'
        ? 'The browser blocked the robot voice — click anywhere in Rudder once, then it can speak'
        : 'The robot voice could not be played: ' + ((err && err.message) || err))))
    })
  } finally { URL.revokeObjectURL(url) }
}
async function speakSystem(text) {
  const v = robotVoice.value
  if (!v.startsWith('system:') || !window.speechSynthesis) return
  const voice = window.speechSynthesis.getVoices().find((x) => x.voiceURI === v.slice(7) && x.localService)
  if (!voice) throw new Error('That system voice is no longer available')
  await new Promise((done) => {
    const u = new window.SpeechSynthesisUtterance(text)
    u.voice = voice
    u.onend = u.onerror = () => done()
    window.speechSynthesis.speak(u)
  })
}
// ─── Thin-client by default; the robot voice is an EXPERIMENTAL opt-in ─────────────────────────────
// Default ("thin-client mode"): no robot process runs and no voice list is even loaded — the whole budget
// goes to speech-to-text, so Rudder stays light enough for a thin client. Ticking Robot voice first shows a
// warning; confirming switches the engine to "high performance mode" (POST /mode), which the engine refuses
// when the machine is short of memory.
const robotConfirm = ref(false)
let voicesHooked = false
function requestRobot(on) {
  robotError.value = ''
  if (on) { robotConfirm.value = true; return }
  disableRobot()
}
async function enableRobot(quiet) {
  robotConfirm.value = false
  try {
    await post('/mode', { robot: true })
  } catch (err) {
    robotOn.value = false
    robotError.value = String(err.message || err)
    save()
    return
  }
  robotOn.value = true
  save()
  if (!voicesHooked && window.speechSynthesis) {
    voicesHooked = true
    window.speechSynthesis.addEventListener?.('voiceschanged', loadRobotVoices)   // system voices load late
  }
  await loadRobotVoices()
  if (quiet !== true) speak('Robot voice on.')
}
function disableRobot() {
  robotOn.value = false
  robotConfirm.value = false
  sayQueue.length = 0
  window.speechSynthesis?.cancel?.()
  save()
  post('/mode', { robot: false }).catch(() => {})
}
const clientLog = ref([])

// ─── Microphones (the Jitsi device-selection pattern, served natively by the engine) ───
const devices = ref([])          // [{id,label,bus,default,muted,volume,state}]
const offCards = ref([])         // sound cards with a mic that are switched off (e.g. the laptop's own)
const deviceError = ref('')
const device = ref(saved.device || '')   // '' = follow the system default input
const testing = ref(false)
const testResult = ref(null)     // {ok, verdict, peak}

const BUS_ICON = { bluetooth: '🎧', usb: '🔌', pci: '💻' }
function deviceLabel(d) {
  const bits = [(BUS_ICON[d.bus] || '🎙') + ' ' + d.label]
  if (d.muted) bits.push('(muted)')
  else if (d.volume) bits.push('· ' + d.volume)
  return bits.join(' ')
}
const defaultDevice = computed(() => devices.value.find((d) => d.default))
const chosen = computed(() => devices.value.find((d) => d.id === device.value) || (device.value ? null : defaultDevice.value))

function applyDevices(list) {
  if (!list) return
  devices.value = list.devices || []
  offCards.value = list.offCards || []
  deviceError.value = list.error || ''
  // A saved choice that is gone (headset switched off) falls back to the default, and says so.
  if (device.value && !devices.value.some((d) => d.id === device.value)) {
    if (!recording.value) {
      say('Your chosen microphone is no longer connected — using the system default instead.', 'warn')
      device.value = ''
      save()
    }
  }
}

async function refreshDevices() {
  try { applyDevices(await (await fetch(apiBase.value + '/devices')).json()) } catch (err) { logc('devices fetch failed: ' + err) }
}

async function testMic() {
  if (testing.value || recording.value) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await post('/test', { device: device.value })
  } catch (err) {
    testResult.value = { ok: false, verdict: String(err.message || err) }
  } finally {
    testing.value = false
    level.value = 0
  }
}

let es = null
let retry = null

function logc(msg) {
  clientLog.value.push(new Date().toISOString().slice(11, 23) + ' ' + msg)
  if (clientLog.value.length > 200) clientLog.value.splice(0, clientLog.value.length - 200)
}

function say(msg, kind = 'info') { notice.value = msg; noticeKind.value = kind }

// ─── Writing into the box ────────────────────────────────────────────────────────────────────────
// Every word streams straight into the END of the box while you keep typing, pasting and editing
// anywhere. The sentence in progress lives in a "live tail" — the last `live.text.length` characters
// of the draft — and each new word rewrites only that tail.
//
// ★ TYPING WHILE TALKING (bug fixed 2026-09-27): once you type into or after the tail it is yours, and
// Rudder must continue with ONLY the words it hasn't written yet. v1 re-wrote the whole sentence-so-far
// after every keystroke, so each key press duplicated the utterance. Now `written` counts the words of
// this utterance already in the box, and the finished (punctuated) sentence is lined up word-by-word
// against them, so nothing is ever written twice.
let live = null    // { start, text, shown } — the tail Rudder may still rewrite; shown = words in it
let written = 0    // words of the current utterance committed to the box before the current tail

// The tail is still Rudder's while the box ENDS with it — wherever it now starts. Typing or pasting
// anywhere above it shifts its position, and that must not count as touching it (bug 2026-09-27: a
// position-based check released the tail on every keystroke above it, cutting "speaking" to "spe").
function liveIntact() {
  if (!live || !draft.value.endsWith(live.text)) return false
  live.start = draft.value.length - live.text.length
  return true
}

// Change only the end of the draft, keeping the person's caret/selection and scroll where they were.
function writeEnd(next) {
  const el = box.value
  const focused = el && el.getRootNode().activeElement === el
  const selStart = el ? el.selectionStart : 0
  const selEnd = el ? el.selectionEnd : 0
  const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 32
  draft.value = next
  save()
  nextTick(() => {
    if (!el) return
    if (focused) el.setSelectionRange(Math.min(selStart, next.length), Math.min(selEnd, next.length))
    if (atBottom || !focused) el.scrollTop = el.scrollHeight
  })
}

const sepFor = (text) => (!text || /\s$/.test(text) ? '' : ' ')
const wordsOf = (text) => (text || '').trim().split(/\s+/).filter(Boolean)

// The person typed into or after the tail, so it's theirs now. Count its words as written — except a
// HALF-FINISHED last word: the model streams words in pieces ("for" … "tnight"), and typing between the
// pieces used to freeze "for" and lose the rest (measured 2026-09-27: "for a for [typed]"). If the word
// has since grown, the fragment is removed (it sits just before the person's text; their caret is
// shifted so it stays put relative to what they typed) and the whole word is written after it.
const norm = (x) => (x || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
function releaseTail(utteranceWords) {
  const shownWords = wordsOf(live.text)
  const lastShown = shownWords[shownWords.length - 1] || ''
  const nowWord = utteranceWords[written + live.shown - 1]
  const grew = live.shown > 0 && nowWord !== undefined && norm(nowWord) !== norm(lastShown) && norm(nowWord).startsWith(norm(lastShown))
  // Find the tail by its text: typing above it may have moved it since it was written.
  const found = draft.value.lastIndexOf(live.text)
  if (found >= 0) live.start = found
  const tailEnd = live.start + live.text.length
  const prefixOk = found >= 0
  if (grew && prefixOk && lastShown) {
    let fragStart = tailEnd - lastShown.length
    if (fragStart > live.start && draft.value[fragStart - 1] === ' ') fragStart--
    const cut = tailEnd - fragStart
    const el = box.value
    const focused = el && el.getRootNode().activeElement === el
    const shift = (i) => (i >= tailEnd ? i - cut : i > fragStart ? fragStart : i)
    const a = el ? shift(el.selectionStart) : 0
    const b = el ? shift(el.selectionEnd) : 0
    draft.value = draft.value.slice(0, fragStart) + draft.value.slice(tailEnd)
    if (focused) nextTick(() => el.setSelectionRange(a, b))
    written += live.shown - 1
  } else {
    written += live.shown
  }
  live = null
}

// Write `words` as the live tail: rewrite it if it's still ours, otherwise open a new one at the end.
function writeTail(words, utterance) {
  const t = words.join(' ')
  if (liveIntact()) {
    const lead = live.text.match(/^\s*/)[0]
    live.text = t ? lead + t : ''
    live.shown = words.length
    writeEnd(draft.value.slice(0, live.start) + live.text)
    return
  }
  if (live) releaseTail(utterance)   // the person took over the old tail: keep it
  if (!t) return
  live = { start: draft.value.length, text: sepFor(draft.value) + t, shown: words.length }
  writeEnd(draft.value + live.text)
}

// ─── Hold the stream while the person is typing ─────────────────────────────────────────────────
// Typing and streaming both write at the end of the box; a word landing between two keystrokes splices
// into what is being typed (measured 2026-09-27: "he'[typed]ll"). So while keys are being pressed the
// stream is buffered, and flushed — in order, nothing dropped — 700 ms after the last keystroke.
const TYPING_HOLD_MS = 700
let lastTypedAt = 0
let pendingPartial = null
const pendingFinals = []
let flushTimer = null
function markTyping() { lastTypedAt = Date.now() }
function onUserInput() {
  markTyping()
  save()
}
function typingNow() { return Date.now() - lastTypedAt < TYPING_HOLD_MS }
function scheduleFlush() {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    if (typingNow()) return scheduleFlush()
    const finals = pendingFinals.splice(0)
    const p = pendingPartial
    pendingPartial = null
    for (const f of finals) finishUtterance(f)
    if (p !== null) streamPartial(p)
  }, TYPING_HOLD_MS)
}
function onPartial(full) {
  if (typingNow() || pendingFinals.length) { pendingPartial = full; scheduleFlush(); return }
  streamPartial(full)
}
function onFinal(text) {
  if (typingNow() || pendingFinals.length) { pendingFinals.push(text); pendingPartial = null; scheduleFlush(); return }
  finishUtterance(text)
}

// A word arrived: show the words of this utterance that aren't in the box yet.
function streamPartial(full) {
  const w = wordsOf(full)
  if (live && !liveIntact()) releaseTail(w)
  writeTail(w.slice(written), w)
}

// The sentence is finished: the same span of words, now punctuated and capitalised.
function finishUtterance(text) {
  const w = wordsOf(text)
  if (live && !liveIntact()) releaseTail(w)
  writeTail(w.slice(written), w)
  live = null
  written = 0
}

function applyStatus(s) {
  if (!s) return
  if (s.engine) engine.value = s.engine
  engineError.value = s.error || ''
  if (s.runtime) runtime.value = s.runtime
  if (s.model) model.value = s.model
  if (s.audio) audioMode.value = s.audio
  if (typeof s.expected === 'boolean') engineExpected.value = s.expected
  // A browser session's state is this page's own; the server's shared status never reports it.
  if (typeof s.recording === 'boolean' && audioMode.value !== 'browser') recording.value = s.recording
}

function connect() {
  clearTimeout(retry)
  try { es?.close() } catch {}
  // No EventSource (a headless mount, an old WebView): show the engine-not-running state instead of throwing
  // in the mounted hook, which failed check:profiles-mount for every lane.
  if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
    engineError.value = 'The desktop engine is not running.'
    return
  }
  es = new window.EventSource(apiBase.value + '/events')
  es.onopen = () => logc('events connected')
  es.onmessage = (m) => onEvent(m.data)
  es.onerror = () => {
    engine.value = 'offline'
    if (audioMode.value !== 'browser') recording.value = false
    logc('events disconnected; retrying in 3s')
    fetchStatus()
    try { es.close() } catch {}
    retry = setTimeout(connect, 3000)
  }
}

// One vocabulary for both channels: the shared /events stream, and a browser session's own socket.
function onEvent(data) {
    let e
    try { e = JSON.parse(data) } catch { return }
    switch (e.type) {
      case 'status':
        applyStatus(e.status || e)
        if (e.engine === 'error') say(e.error || 'Speech engine error', 'error')
        if (e.engine === 'ready' && noticeKind.value !== 'error') say('')
        break
      case 'recording':
        recording.value = !!e.recording
        if (!e.recording) { level.value = 0; flushPartial(); closeStream() }
        break
      case 'partial':
        partial.value += e.text
        onPartial(partial.value)
        robotOnPartial(partial.value)
        break
      case 'final':
        partial.value = ''
        onFinal(e.text)
        robotOnFinal(e.text)
        break
      case 'recovering':
        say(e.message, 'warn')
        break
      case 'recovered':
        say(e.message, 'ok')
        setTimeout(() => { if (noticeKind.value === 'ok') say('') }, 4000)
        break
      case 'devices':
        applyDevices(e.devices)
        break
      case 'level':
        level.value = Math.min(1, (e.peak || 0) * 3)
        break
      case 'warning':
        say(e.message, 'warn')
        break
      case 'error':
        say(e.message, 'error')
        logc('engine error: ' + e.message)
        break
    }
}

// ─── BROWSER MICROPHONE (engine on a server, status.audio === 'browser') ─────────────────────────────
// The engine cannot hear the reader's microphone from a server, so this page captures it, turns it into
// 16 kHz mono 16-bit PCM in an AudioWorklet, and streams 100 ms frames to /api/rudder/stream. The words
// come back on that same socket, to this reader only.
const WORKLET = `class RudderPcm16k extends AudioWorkletProcessor {
  constructor () { super(); this.step = sampleRate / 16000; this.pos = 0; this.out = new Int16Array(1600); this.n = 0 }
  process (inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (; this.pos < ch.length; this.pos += this.step) {
      const v = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]))
      this.out[this.n++] = v < 0 ? v * 32768 : v * 32767
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(1600); this.n = 0 }
    }
    this.pos -= ch.length
    return true
  }
}
registerProcessor('rudder-pcm16k', RudderPcm16k)`
const audioMode = ref('local')
// The server is set up to run the engine (it reports expected=true while the engine is down): an absent
// engine there means "starting or failed to set up", not "this only runs on your computer".
const engineExpected = ref(false)
// An engine that records ITS OWN machine's microphone, reached from another machine: it would record the
// server, not this reader, so the page treats it as laptop-only.
const remoteLocalMic = computed(() => audioMode.value === 'local' && !onOwnComputer.value && engine.value === 'ready')
let sock = null, media = null, actx = null

async function startBrowser() {
  if (sock) { closeStream(); flushPartial() } // a previous session still draining its last words
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot share its microphone here (it needs a secure https:// page).')
  }
  media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  actx = new window.AudioContext()
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  await actx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new window.AudioWorkletNode(actx, 'rudder-pcm16k')
  const mute = actx.createGain()
  mute.gain.value = 0 // keeps the graph pulled without playing the mic back
  actx.createMediaStreamSource(media).connect(node)
  node.connect(mute).connect(actx.destination)
  const u = new URL(apiBase.value + '/stream', location.href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.searchParams.set('language', language.value)
  const ws = new window.WebSocket(u)
  sock = ws
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (m) => { if (sock === ws) onEvent(m.data) }
  ws.onclose = (c) => {
    if (sock !== ws) return // an older, draining session: the new one owns the mic and the box
    if (c.code === 4409) say(c.reason || 'Someone else is recording on this server.', 'error')
    sock = null
    releaseMic()
    if (recording.value) { recording.value = false; level.value = 0 }
    flushPartial()
  }
  node.port.onmessage = (e) => { if (sock && sock.readyState === 1) sock.send(e.data) }
}
function releaseMic() {
  try { media && media.getTracks().forEach((t) => t.stop()) } catch {}
  try { actx && actx.close() } catch {}
  media = null
  actx = null
}
// Stop: the mic goes off and the widget is idle at once (it read "Stop" for 12 s+ while a loaded
// server caught up). The socket stays open so the last words still land in the box; the engine closes the
// session with "recording false". Record again meanwhile simply lets go of that tail.
function stopBrowser() {
  releaseMic()
  recording.value = false
  level.value = 0
  if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'stop' }))
  else { closeStream(); flushPartial() }
}
function closeStream() {
  const ws = sock
  sock = null
  if (ws) { try { ws.close() } catch {} }
}

// Recording stopped mid-sentence: the streamed words are already in the box, so just let go of them.
function flushPartial() {
  robotSpoken = 0
  speakHeld()
  clearTimeout(flushTimer)
  const finals = pendingFinals.splice(0)
  const p = pendingPartial
  pendingPartial = null
  for (const f of finals) finishUtterance(f)
  if (p !== null) streamPartial(p)
  partial.value = ''
  live = null
  written = 0
  written = 0
}

async function post(path, body) {
  const r = await fetch(apiBase.value + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

async function toggle() {
  if (busy.value) return
  busy.value = true
  try {
    if (audioMode.value === 'browser') {
      if (recording.value) stopBrowser()
      else { say(''); await startBrowser() }
    } else if (recording.value) {
      await post('/stop')
    } else {
      say('')
      testResult.value = null
      applyStatus(await post('/start', { language: language.value, device: device.value }))
    }
  } catch (err) {
    if (audioMode.value === 'browser') { releaseMic(); closeStream() }
    say(err && err.name === 'NotAllowedError' ? 'Microphone permission was refused — allow it for this site to record.' : String(err.message || err), 'error')
    logc('toggle failed: ' + err)
  } finally {
    busy.value = false
  }
}

const words = computed(() => (draft.value.trim() ? draft.value.trim().split(/\s+/).length : 0))

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch {}
    ta.remove()
  }
  copied.value = what
  setTimeout(() => { if (copied.value === what) copied.value = '' }, 1500)
}

function clearAll() {
  if (draft.value.trim() && !window.confirm('Clear the whole text box? This cannot be undone.')) return
  draft.value = ''
  partial.value = ''
  live = null
  save()
}

// ★ PRIVACY: the report is meant to be pasted to an agent, so it describes the setup without
// identifying the person: no browser fingerprint (user-agent), no device names ("Anna's AirPods"), no
// device IDs (they embed the Bluetooth MAC address), and never the text in the box — only its length.
// The engine log it includes is already redacted at the source (MACs, home folder).
const MAC_RE = /\b([0-9a-f]{2}[:_]){5}[0-9a-f]{2}\b/gi
function privateDevices() {
  return devices.value.map((d, i) => ({ mic: 'mic ' + (i + 1), bus: d.bus, default: d.default, muted: d.muted, volume: d.volume, state: d.state }))
}
function browserFamily() {
  const ua = navigator.userAgent
  return /firefox/i.test(ua) ? 'Firefox' : /edg\//i.test(ua) ? 'Edge' : /chrom/i.test(ua) ? 'Chromium-based' : /safari/i.test(ua) ? 'Safari' : 'other'
}

async function copyDebug() {
  let engineLog = '(unreachable)'
  let status = '(unreachable)'
  try { engineLog = await (await fetch(apiBase.value + '/log')).text() } catch {}
  try { status = JSON.stringify(await (await fetch(apiBase.value + '/status')).json(), null, 2) } catch {}
  const text = [
    '// RUDDER DEBUG REPORT — for a coding agent.',
    '// Read the engine status and log below, find why transcription failed or misbehaved, and propose a fix',
    '// in backend/rudder-engine/main.go or plugin-designs/rudder-voice/rudder-voice.vue. Do not guess:',
    '// quote the log lines that prove the cause.',
    '',
    '== status ==', status,
    '== plugin ==', JSON.stringify({ apiBase: apiBase.value, draftChars: draft.value.length, engine: engine.value, recording: recording.value, language: language.value, device: device.value ? 'chosen mic' : '(system default)', browser: browserFamily() }, null, 2),
    '== microphones ==', JSON.stringify({ devices: privateDevices(), offCards: offCards.value.length, error: deviceError.value, lastTest: testResult.value }, null, 2),
    '== client log ==', clientLog.value.join('\n'),
    '== engine log ==', engineLog,
  ].join('\n').replace(MAC_RE, 'XX:XX:XX:XX:XX:XX')
  copy(text, 'debug')
}

function onKey(ev) {
  // Ctrl+Shift+Space toggles recording without reaching for the mouse.
  if (ev.ctrlKey && ev.shiftKey && ev.code === 'Space') { ev.preventDefault(); toggle() }
}

// The status also by plain request: a proxy that buffers the event stream (as a test harness did) must not
// leave the page guessing whether this server is meant to have an engine.
async function fetchStatus() {
  try { const r = await fetch(apiBase.value + '/status'); if (r.ok) applyStatus(await r.json()) } catch {}
}
// A backend can only exist on the dev server (bun run dev), in the desktop app (Tauri), or where the host
// says so (an explicit apiBase). A built page on a static host has none, so it makes NO network call there:
// it probed /api/rudder anyway and logged three 404s on every page that carried it.
const backendKnown = !!cfg.value.apiBase || import.meta.env.DEV ||
  (typeof window !== 'undefined' && (!!window.__TAURI__ || !!window.__TAURI_INTERNALS__ || location.protocol === 'tauri:'))
onMounted(() => {
  if (!backendKnown) {
    engine.value = 'offline'
    window.addEventListener('keydown', onKey)
    return
  }
  fetchStatus()
  connect()
  refreshDevices()
  // Robot voice was left on last time: re-enter high performance mode (the engine re-checks memory).
  if (robotOn.value) enableRobot(true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  clearTimeout(retry)
  try { es?.close() } catch {}
  releaseMic()
  closeStream()
  window.removeEventListener('keydown', onKey)
})

watch(recording, (v) => emit('recording', v))

// `activity` feeds a host's collapsed pill while recording: whether speech is heard right now (the level,
// held briefly so the icon doesn't flicker between words) and the last few words, so a reader with the
// panel closed can see they are being heard.
let speakingUntil = 0, activityTimer = null, lastActivity = ''
function sendActivity() {
  activityTimer = null
  const speaking = recording.value && Date.now() < speakingUntil
  // ★ READ THE TAIL, NOT THE WHOLE TRANSCRIPT. This split the ENTIRE draft to take five words, on
  // every activity tick while recording — O(n) in a string that only grows. Measured at 3,000 words:
  // 1.61ms per tick against 0.051ms for a bounded tail, 31x. 300 characters is far more than five
  // words of any language this dictates, so the answer is identical; trim() comes BEFORE the slice
  // because the draft ends in a space and slicing first would drop a word.
  const tail = recording.value ? draft.value.trim().slice(-300).split(/\s+/).slice(-5).join(' ') : ''
  const key = speaking + '|' + tail
  if (key === lastActivity) return
  lastActivity = key
  emit('activity', { speaking, words: tail })
}
function queueActivity() { if (!activityTimer) activityTimer = setTimeout(sendActivity, 150) }
watch(level, (v) => { if (v > 0.12) speakingUntil = Date.now() + 400; queueActivity(); setTimeout(queueActivity, 450) })
watch([draft, recording], queueActivity)

const statusText = computed(() => ({
  connecting: 'Connecting…',
  starting: 'Loading speech model… (about 20 s the first time)',
  ready: remoteLocalMic.value ? 'Runs on your computer' : recording.value ? 'Listening' : 'Ready',
  error: 'Engine error',
  offline: onOwnComputer.value ? 'Engine offline' : engineExpected.value ? 'Not running yet' : 'Runs on your computer',
}[engine.value] || engine.value))

</script>

<template>
  <div class="rudder" :class="{ rec: recording, compact, more: compact && (showSettings || showInfo) }">
    <header v-if="compact" class="bar">
      <b class="name">Rudder</b>
      <div class="status" :data-state="engine" role="status">
        <span class="dot" aria-hidden="true"></span>{{ statusText }}
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" :aria-expanded="showSettings" title="Settings" aria-label="Settings" @click="showSettings = !showSettings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      </button>
      <button class="icon-btn" :aria-expanded="showInfo" title="What is Rudder?" aria-label="What is Rudder?" @click="showInfo = !showInfo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>
      </button>
    </header>
    <header v-else class="top">
      <div class="brand">
        <span class="logo" aria-hidden="true">⎈</span>
        <div>
          <h1>Rudder</h1>
          <p class="sub">Voice-to-text for vibe coders · private · runs on this computer · no internet</p>
        </div>
      </div>
      <button class="info-btn" :aria-expanded="showSettings" title="Settings" aria-label="Settings" @click="showSettings = !showSettings">⚙</button>
      <button class="info-btn gap0" :aria-expanded="showInfo" title="What is Rudder?" aria-label="What is Rudder?" @click="showInfo = !showInfo">ⓘ</button>
      <div class="status" :data-state="engine" role="status">
        <span class="dot" aria-hidden="true"></span>{{ statusText }}
      </div>
    </header>

    <section v-if="showInfo" class="info">
      <h2>What is Rudder?</h2>
      <p>A voice-to-text tool for vibe coders: talk to your agents instead of typing to them. Paste links, code
        and notes into the box while you talk; everything you say is added to the end, ready to copy into a chat.</p>
      <ul>
        <li><b>Streaming.</b> Words appear while you speak, and you can keep talking for as long as you like —
          an hour is fine. There is no time limit and nothing to wait for at the end.</li>
        <li><b>Runs on your CPU.</b> No graphics card needed. The model uses about 1 GB of memory and keeps up with
          normal speech on an ordinary laptop processor.</li>
        <li><b>Private and offline.</b> Your voice never leaves this computer. No account, no cloud, no telemetry —
          checked with a network tracer: zero connections while transcribing.</li>
        <li><b>The model.</b> NVIDIA Nemotron 3.5 ASR Streaming (0.6B), run by NVIDIA's open-source
          NeMo-Speech.cpp. It adds punctuation and capital letters by itself.</li>
        <li><b>Why it lives in dx-maps.</b> Rudder is a plugin like the maps: built in the Plugin Studio, tested in the
          browser, and shipped as a desktop app with its own local backend — proof that one dx-maps codebase can
          build desktop apps, not only maps.</li>
      </ul>
      <p class="fine">Bluetooth headsets: Rudder switches them to their stable voice mode (CVSD), because the
        higher-quality mode (mSBC) kept dropping the mic after a few words.</p>
    </section>

    <section v-if="!compact || showSettings" class="controls">
      <button
        class="mic"
        :class="{ on: recording }"
        :disabled="busy || engine !== 'ready' || remoteLocalMic"
        :aria-pressed="recording"
        :aria-label="recording ? 'Stop recording' : 'Start recording'"
        @click="toggle"
      >
        <span class="mic-icon" aria-hidden="true">{{ recording ? '■' : '●' }}</span>
        {{ recording ? 'Stop' : 'Record' }}
      </button>
      <div class="meter" aria-hidden="true"><div class="fill" :style="{ width: (level * 100).toFixed(0) + '%' }"></div></div>
      <label v-if="showSettings" class="lang">
        <span>Language</span>
        <select v-model="language" :disabled="recording" @change="save">
          <option v-for="[code, name] in LANGUAGES" :key="code" :value="code">{{ name }}</option>
        </select>
      </label>
    </section>

    <section v-if="showSettings && audioMode !== 'browser'" class="mics">
      <label class="mic-pick">
        <span>Microphone</span>
        <select v-model="device" :disabled="recording || testing" @change="save(); testResult = null">
          <option value="">System default{{ defaultDevice ? ' — ' + defaultDevice.label : '' }}</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ deviceLabel(d) }}</option>
        </select>
      </label>
      <button class="small" :disabled="testing || recording || engine === 'offline'" @click="testMic">
        {{ testing ? 'Testing… speak now' : 'Test mic' }}
      </button>
      <button class="small ghost" title="Look for microphones again" aria-label="Look for microphones again" :disabled="recording" @click="refreshDevices">↻</button>
    </section>
    <section v-if="showSettings" class="robot">
      <label class="robot-on">
        <input type="checkbox" :checked="robotOn || robotConfirm" @click.prevent="requestRobot(!robotOn && !robotConfirm)" />
        <span><b>Robot voice</b> <span class="exp">experimental</span> — speaks what you say in a synthetic voice, so you can
          record a video without your real voice</span>
      </label>
      <div v-if="robotConfirm" class="notice robot-warn" data-kind="warn" role="alertdialog" aria-label="Robot voice is experimental">
        <p><b>Experimental: switches Rudder to High performance mode.</b> The robot voice runs an extra voice engine. It
          uses more CPU, and about 150 MB of memory while it speaks. On a smaller laptop or a shared dev server it can slow
          down voice-to-text. Leave it off for the lightest, most reliable setup.</p>
        <div class="robot-warn-actions">
          <button class="small" @click="enableRobot">Turn on anyway</button>
          <button class="small ghost" @click="robotConfirm = false">Cancel</button>
        </div>
      </div>
      <p class="robot-mode">Mode: <b>{{ robotOn ? 'High performance (experimental)' : 'Thin-client (default)' }}</b></p>
      <select v-if="robotOn" v-model="robotVoice" aria-label="Robot voice" @change="save(); speak('This is my robot voice.')">
        <option v-for="o in robotOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        <option v-if="!robotOptions.length" value="" disabled>No voice installed</option>
      </select>
      <p v-if="robotError" class="hint">{{ robotError }}</p>
    </section>
    <p v-if="testResult" class="notice" :data-kind="testResult.ok ? (testResult.peak < 0.01 ? 'warn' : 'ok') : 'error'">
      {{ testResult.ok ? '✓ ' : '✗ ' }}{{ testResult.verdict }}
    </p>
    <p v-if="chosen && chosen.muted" class="notice" data-kind="warn">“{{ chosen.label }}” is muted in your system sound settings — Rudder won't hear anything until it's unmuted.</p>
    <p v-if="deviceError && audioMode !== 'browser'" class="notice" data-kind="error">{{ deviceError }}</p>
    <p v-else-if="!devices.length && engine !== 'offline' && audioMode !== 'browser' && onOwnComputer" class="notice" data-kind="warn">No microphone found. Connect a headset or turn on your computer's microphone in Sound settings.</p>
    <p v-if="offCards.length" class="hint">Also available but switched off in Sound settings: {{ offCards.join(', ') }}. Turn it on there to use it here.</p>

    <p v-if="notice" class="notice" :data-kind="noticeKind">{{ notice }}</p>
    <p v-else-if="engine === 'offline' && !onOwnComputer && engineExpected" class="notice" data-kind="warn">
      The voice engine on this server isn't running yet (it is starting, or it failed to set up). Try again in a minute.
    </p>
    <p v-else-if="(engine === 'offline' || remoteLocalMic) && !onOwnComputer" class="notice" data-kind="warn">
      Voice to text runs on your own computer, not on this server: it listens to the microphone of the machine
      the engine runs on. Open the Plugin Studio on your computer (<code>bun run dev</code>) or use the Rudder desktop app.
    </p>
    <p v-else-if="engine === 'offline'" class="notice" data-kind="warn">
      The local speech engine isn't reachable at <code>{{ apiBase }}</code>. It needs <b>Go 1.22 or newer</b> and a
      one-time setup that downloads the speech model (about 750 MB): <code>bash backend/rudder-engine/setup-runtime.sh</code>.
      Then <code>bun run dev</code> starts it here. For the desktop app, <code>bun run desktop:build rudder-voice</code>;
      both are described in <code>documentation/HOWTO-build-the-desktop-app.md</code>.
    </p>

    <section class="compose">
      <textarea
        ref="box"
        v-model="draft"
        class="draft"
        spellcheck="true"
        aria-label="Your text. Type or paste here; everything Rudder hears is added to the end."
        placeholder="Type or paste here — and press Record (Ctrl+Shift+Space) to talk. Your words stream into the end of this box as you speak."
        @input="onUserInput"
        @keydown="markTyping"
      ></textarea>
      <p class="hearing" aria-live="polite">
        <template v-if="recording"><span class="tag">listening</span> words appear at the end of the box as you speak — keep typing or pasting anywhere</template>
      </p>
    </section>

    <footer class="bottom">
      <button
        v-if="compact"
        class="mic sm"
        :class="{ on: recording }"
        :disabled="busy || engine !== 'ready' || remoteLocalMic"
        :aria-pressed="recording"
        :aria-label="recording ? 'Stop recording' : 'Start recording'"
        @click="toggle"
      >
        <span class="mic-icon" aria-hidden="true">{{ recording ? '■' : '●' }}</span>
        {{ recording ? 'Stop' : 'Record' }}
      </button>
      <button :disabled="!draft.trim()" @click="copy(draft, 'all')">{{ copied === 'all' ? 'Copied ✓' : 'Copy all' }}</button>
      <button v-if="!compact || showSettings" :disabled="!draft.trim() || recording" @click="clearAll">Clear</button>
      <span class="count">{{ words }} {{ words === 1 ? 'word' : 'words' }}</span>
      <span class="spacer"></span>
      <button v-if="!compact || showSettings" class="ghost" :aria-expanded="showDebug" @click="showDebug = !showDebug">🐞 Debug</button>
    </footer>

    <section v-if="showDebug" class="debug">
      <dl>
        <dt>API</dt><dd><code>{{ apiBase }}</code></dd>
        <dt>Runtime</dt><dd>{{ runtime || '—' }}</dd>
        <dt>Model</dt><dd>{{ model || '—' }}</dd>
        <dt>Engine</dt><dd>{{ engine }}<span v-if="engineError"> — {{ engineError }}</span></dd>
      </dl>
      <button @click="copyDebug">{{ copied === 'debug' ? 'Copied ✓' : 'Copy debug report for an agent' }}</button>
    </section>
  </div>
</template>

<style>
.robot { display: flex; flex-direction: column; gap: 6px; }
.info-btn.gap0 { margin-left: 0; }
.robot-on { display: flex; align-items: flex-start; gap: 8px; font-size: 13.5px; line-height: 1.4; cursor: pointer; }
.robot-on input { margin-top: 3px; accent-color: var(--accent); }
.robot select { align-self: flex-start; max-width: 100%; }
.robot .exp { display: inline-block; padding: 0 6px; border-radius: 999px; background: #3b2a06; color: var(--warn); font-size: 11px;
  text-transform: uppercase; letter-spacing: .04em; vertical-align: 1px; }
.robot-warn p { margin: 0 0 8px; }
.robot-warn-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.robot-mode { margin: 0; color: var(--muted); font-size: 12.5px; }
:host { display: block; }
.rudder {
  --bg: #0b0f14; --panel: #111823; --line: #1f2937; --text: #e5e7eb; --muted: #9ca3af;
  --accent: #38bdf8; --rec: #ef4444; --ok: #22c55e; --warn: #f59e0b;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; min-height: max(100%, 480px);
  padding: 18px; background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 15px;
}
.rudder *, .rudder *::before, .rudder *::after { box-sizing: border-box; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 30px; color: var(--accent); line-height: 1; }
h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
.sub { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
.status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--line);
  border-radius: 999px; font-size: 13px; color: var(--muted); background: var(--panel); }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.status[data-state='ready'] .dot { background: var(--ok); }
.status[data-state='starting'] .dot, .status[data-state='connecting'] .dot { background: var(--warn); animation: pulse 1.2s infinite; }
.status[data-state='error'] .dot, .status[data-state='offline'] .dot { background: var(--rec); }
.rec .status .dot { background: var(--rec); animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.mic { display: inline-flex; align-items: center; gap: 10px; padding: 12px 22px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--accent); color: #04121c; font-weight: 700; font-size: 16px; cursor: pointer; }
.mic.on { background: var(--rec); color: #fff; }
.mic:disabled { opacity: .45; cursor: not-allowed; }
.mic:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mic-icon { font-size: 14px; }
.meter { flex: 1 1 140px; min-width: 100px; height: 8px; border-radius: 4px; background: var(--panel); border: 1px solid var(--line); overflow: hidden; }
.meter .fill { height: 100%; background: linear-gradient(90deg, var(--ok), var(--warn), var(--rec)); transition: width .12s linear; }
.lang { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 14px; }
.notice { margin: 0; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); font-size: 13.5px; line-height: 1.45; }
.notice[data-kind='error'] { border-color: #7f1d1d; background: #1f0f12; }
.notice[data-kind='warn'] { border-color: #78350f; background: #1c140a; }
.notice[data-kind='ok'] { border-color: #14532d; background: #0b1a11; }
.mics { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mic-pick { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; flex: 1 1 260px; }
.mic-pick select { flex: 1; min-width: 0; }
.small { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13.5px; }
.small:disabled { opacity: .45; cursor: not-allowed; }
.small.ghost { background: transparent; }
.hint { margin: 0; color: var(--muted); font-size: 12.5px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #c4b5fd; overflow-wrap: anywhere; }
.compose { flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; min-height: 260px; }
.draft { flex: 1 1 auto; width: 100%; min-height: 240px; resize: vertical; padding: 14px; border: 1px solid var(--line);
  border-radius: 12px; background: var(--panel); color: var(--text); font: inherit; font-size: 16px; line-height: 1.6; }
.draft:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.draft::placeholder { color: #6b7280; }
.hearing { margin: 0; min-height: 1.5em; color: var(--accent); font-size: 14px; overflow-wrap: anywhere; }
.hearing .tag { display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 999px; background: #0c2a3a;
  color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.count { color: var(--muted); font-size: 12.5px; }
.bottom { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.bottom button, .debug button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 14px; }
.bottom button:disabled { opacity: .45; cursor: not-allowed; }
.bottom .ghost { background: transparent; }
.spacer { flex: 1; }
.info-btn { margin-left: auto; background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 999px;
  width: 30px; height: 30px; font-size: 16px; cursor: pointer; }
.info-btn:hover, .info-btn[aria-expanded='true'] { color: var(--accent); border-color: var(--accent); }
.info { border: 1px solid var(--line); border-radius: 12px; background: var(--panel); padding: 14px 16px; font-size: 14px; line-height: 1.55; }
.info h2 { margin: 0 0 6px; font-size: 16px; }
.info p { margin: 0 0 8px; }
.info ul { margin: 0 0 8px; padding-left: 18px; }
.info li { margin-bottom: 6px; }
.info .fine { color: var(--muted); font-size: 12.5px; margin: 0; }
.debug { border: 1px dashed var(--line); border-radius: 10px; padding: 12px; font-size: 13px; }
.debug dl { display: grid; grid-template-columns: 90px 1fr; gap: 6px 10px; margin: 0 0 10px; }
.debug dt { color: var(--muted); }
.debug dd { margin: 0; overflow-wrap: anywhere; }
/* The corner panel (variant="widget"): no page header, the draft fills the panel. */
.rudder.compact { height: 100%; min-height: 0; overflow: hidden; padding: 10px 12px 12px; gap: 8px; font-size: 14px; }
/* Like a messaging app: the panel itself never scrolls; the draft does. With settings or info open, the
   panel scrolls instead so they stay reachable. */
.rudder.compact.more { overflow-y: auto; }
.bar { display: flex; align-items: center; gap: 8px; }
.bar .name { font-size: 14px; }
.bar .status { padding: 3px 9px; font-size: 12px; gap: 6px; }
.icon-btn { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--muted); cursor: pointer; }
.icon-btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.icon-btn[aria-expanded='true'], .icon-btn:hover { color: var(--accent); border-color: var(--accent); }
.compact .controls .mic { display: none; }
/* ★ NO FLOOR ON A SHORT PANEL. min-height:120px kept the compose column from shrinking, so when a
   notice makes the header tall the draft is pushed past the panel's clip and its last line cannot be
   reached — its own scrollbar is useless, because the overflow is OUTSIDE the scrollable area.
   Measured in the corner widget with the engine offline (header 237px): at 390x560 the panel leaves
   99px and the floor forces 120, overflowing by exactly 21px; at 375x450 it leaves 33px and overflows
   by 87. Both numbers were reproduced independently.
   The floor is unconditional and must stay so: a viewport-height guard would not help, because what
   eats the room is the HEADER, and a notice can make that 237px at any viewport. The draft already
   carries min-height:0 and overflow-y:auto, so a floor here buys nothing a flex basis does not. */
.compact .compose { flex: 1 1 0; min-height: 0; }
.compact.more .compose { flex: 0 0 auto; height: 200px; }
.compact .draft { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  resize: none; padding: 10px 12px; font-size: 16px; line-height: 1.5; }
.compact .hearing { display: none; }
.compact .bottom { order: 2; gap: 8px; }
.compact .bottom button { padding: 7px 12px; }
.compact .bottom .mic.sm { padding: 9px 18px; font-size: 15px; gap: 6px; border-radius: 999px; }
.compact .bottom .mic.sm:not(.on) { background: var(--accent); color: #04121c; border-color: var(--accent); }
.compact .bottom .mic.sm.on { background: var(--rec); color: #fff; border-color: var(--rec); }
/* ★ NOTICES SIT BELOW THE DRAFT IN THE CORNER PANEL, for the same reason they do on a phone: the
   panel is short, and an engine-offline notice is several lines, so above the draft it eats the room
   the draft needs. This used to say `order: 0`, which SILENTLY CANCELLED the phone rule below —
   `.compact .notice` is (0,2,0) and the media query's `.notice` is (0,1,0), and a media query adds no
   specificity, so the more specific rule won at every width and the notice stayed on top. The phone
   rule (bac2431d0, 19:59) was already there; the corner widget (4e94e9216, 21:58) overrode it two
   hours later without meaning to. Ordering it here fixes the widget at EVERY width, not only under
   480px, because the corner panel is short regardless of the viewport. No floor is involved: a floor
   is what clipped the draft in the first place. */
.compact .notice, .compact .hint { order: 1; font-size: 12.5px; padding: 8px 10px; }
/* ★ AND THE NOTICE YIELDS. Ordering it below the draft fixes the reading order but NOT the height:
   .notice is flex:0 1 auto and .compact .compose is flex:1 1 0, so the draft still gives up whatever
   the notice's content asks for. Measurement showed the result at 375x450 — a 20px draft whose wheel moves
   nothing. The engine-offline notice is the long one (apiBase, Go 1.22, the setup command), ~132px at
   375 and ~179px at 390, and it is REFERENCE text: a reader needs it once, not a third of a short
   panel forever. Capping it and letting it scroll gives the draft 58px at 375x450 and 124px at
   390x560, measured against the 60vh panel the corner widget actually gets (plugin-studio.vue:466),
   not the viewport — sizing off the viewport is what made my first estimate wrong by 58px.
   Again: no floor anywhere. A floor is what clipped the draft to begin with. */
.compact .notice { max-height: 96px; overflow-y: auto; overscroll-behavior: contain; }
.compact .debug { order: 4; }
/* A phone-sized panel: less padding, and a shorter draft so it stays in view below the controls. */
@media (max-width: 480px) {
  /* ★ THE TEXT AREA GETS THE LEFTOVER SPACE AND SCROLLS. On a phone the header can take most of the panel, leaving the draft unscrollable and its
     last lines unreachable. The
     panel is capped at 60vh here, and a min-height on the draft cannot fix that: a MINIMUM makes
     the box refuse to shrink, so whatever the header takes is pushed off the bottom and the
     draft's own scrollbar never appears. Lowering it from 240 to 180 only moved the threshold.
     So the column owns the height (min-height:0 is what lets a flex child shrink BELOW its
     content, and is the whole fix), the draft takes what is left and scrolls inside it, and the
     header gives back the space it was holding. */
  .rudder { min-height: 0; height: 100%; padding: 10px; gap: 8px; display: flex; flex-direction: column; }
  .compose { min-height: 0; flex: 1 1 0; display: flex; flex-direction: column; }
  .draft { min-height: 0; flex: 1 1 0; overflow-y: auto; resize: none; padding: 10px; }
  .top { gap: 8px; row-gap: 6px; }
  .bar .name { font-size: 13px; }
  .bar .status { padding: 2px 7px; font-size: 11.5px; }
  /* Notices (engine offline, mic muted, …) sit below the draft here, so the draft stays in view. */
  .notice, .hint { order: 1; }
  .bottom { order: 2; }
  .debug { order: 3; }
}
</style>
