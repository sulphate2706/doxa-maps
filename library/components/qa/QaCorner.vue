<script setup>
/**
 * QaCorner.vue — the embeddable QA corner widget (bottom-right of any map).
 *
 * Visible shell of the QA-agent bridge. OIDC-gated onboarding — NEVER a key.
 *
 * AUTH: the widget detects the host's session via a same-origin GET /api/auth/me.
 * That only succeeds when the plugin iframe is SAME-ORIGIN (allow-same-origin). When
 * the app-shell runs with NUXT_PUBLIC_PLUGIN_SANDBOX_ISOLATE_ORIGIN=true the frame is
 * origin-'null' and the call is blocked — login is then impossible from inside the
 * sandbox (a browser rule, not our bug), so the button falls back to a clear message.
 *
 * STYLES via useShadowStyles — a child component's <style> is dropped from the
 * custom element's shadow DOM.
 * OPT-IN via profile-config.qa (partner embeds off).
 *
 * PORTABILITY: this widget names NO specific host. The QA login is driven by
 * profile-config — a host that wants QA supplies its own `qaConnectUrl` (the
 * top-level connect page) and `qaProviderName` (the label shown on the button).
 * If `qaConnectUrl` is unset the login path simply doesn't render (opt-in anyway),
 * so dx-maps ships portable to any environment.
 */
import { ref, inject, computed, onMounted, onBeforeUnmount } from 'vue'
import { useShadowStyles } from '../../composables/useShadowStyles.js'

const uiStore = inject('uiStore', null)
const profileConfig = inject('profileConfig', null)
const isDark = computed(() => uiStore?.theme === 'dark')
const mapLabel = computed(() =>
  profileConfig?.value?.qaLabel || profileConfig?.value?.profile || 'this map'
)

// ── host-supplied QA identity provider (portable: dx-maps names none) ────────
// `qaConnectUrl` = the top-level connect page the host serves (same-origin with
// its auth API). `qaProviderName` = the label shown on the login button/notes.
// Both empty by default → the login path does not render (opt-in only).
const qaConnectUrl = computed(() => profileConfig?.value?.qaConnectUrl || '')
const qaProviderName = computed(() => profileConfig?.value?.qaProviderName || 'your account')
const canLogin = computed(() => !!qaConnectUrl.value)

const open = ref(false)
function toggle() { open.value = !open.value }

// ── Start a QA session: mint a gateway token → create a qhoot session → open room ──
const starting = ref(false)
const startErr = ref('')
async function startSession() {
  starting.value = true; startErr.value = ''
  const log = (...a) => { try { console.log('[QaCorner:start]', ...a) } catch (_) {} }
  try {
    // 1. resolve the org slug (prefer one the user can admin)
    const orgsRes = await fetch('/api/orgs', { credentials: 'include' })
    if (!orgsRes.ok) throw new Error('orgs ' + orgsRes.status)
    const orgs = (await orgsRes.json())?.orgs || []
    const org = orgs.find(o => (o.roles || []).some(r => /admin|owner|manage/i.test(String(r)))) || orgs[0]
    if (!org?.slug) throw new Error('no org membership')
    log('org', org.slug)
    // 2. mint an RS256 gateway token from the OIDC session
    const mintRes = await fetch(`/api/o/${encodeURIComponent(org.slug)}/mcp/mint`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({})
    })
    const mintText = await mintRes.text()
    if (!mintRes.ok) throw new Error('mint ' + mintRes.status + ': ' + mintText.slice(0, 160))
    // The mint returns an OAuth-shaped body: the JWT is `access_token` (not `token`).
    const token = (() => { try { const j = JSON.parse(mintText); return j.access_token || j.token || '' } catch { return '' } })()
    log('minted token?', !!token, 'len', token && token.length)
    if (!token) throw new Error('mint returned no token')
    // 3. create the qhoot QA session (same-origin /sessions, Bearer)
    const crRes = await fetch('/sessions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'public', kind: 'qa', question: 'QA on ' + mapLabel.value })
    })
    const crText = await crRes.text()
    if (!crRes.ok) throw new Error('create-session ' + crRes.status + ': ' + crText.slice(0, 200))
    const sess = (() => { try { return JSON.parse(crText) } catch { return {} } })()
    const code = sess.code || sess.Code || sess.id || sess.ID
    log('session created', code)
    if (!code) throw new Error('no session code returned')
    // 4. open the multiplayer room
    window.open('/qhoot/assembly.html?c=' + encodeURIComponent(code), '_blank')
  } catch (e) {
    startErr.value = String(e?.message || e)
    try { console.error('[QaCorner:start] FAILED:', e) } catch (_) {}
  } finally { starting.value = false }
}

// ── auth ──────────────────────────────────────────────────────────────────
const authState = ref('checking')   // checking | in | out | blocked
const authUser = ref(null)

async function checkAuth() {
  authState.value = 'checking'
  try {
    // Relative → resolves to the app-shell origin. Sends cookies only when the
    // frame is same-origin (allow-same-origin). Under origin-isolation this throws
    // or 401s → we surface 'blocked'/'out'.
    const r = await fetch('/api/auth/me', { credentials: 'include' })
    if (r.ok) { const d = await r.json(); authUser.value = d.user; authState.value = 'in'; return }
    authState.value = 'out'
  } catch (_) { authState.value = 'blocked' }
}

function login() {
  // Top-level connect page (host-supplied, same-origin with its auth API): checks
  // the session, posts the identity back here, then closes. Requires the sandbox
  // to permit it. No-op if the host did not configure a connect URL.
  if (!qaConnectUrl.value) return
  const w = window.open(qaConnectUrl.value, 'qa-login', 'width=480,height=640')
  if (!w) authState.value = 'blocked'
}

function onMsg(e) {
  if (e?.data?.type === 'qa-auth' && e.data.ok && e.data.user) {
    authUser.value = e.data.user; authState.value = 'in'
  }
}

onMounted(() => {
  try { console.log('[QaCorner] MOUNTED — QA widget is in the DOM (qa=', profileConfig?.value?.qa, ')') } catch (_) {}
  window.addEventListener('message', onMsg)
  checkAuth()
})
onBeforeUnmount(() => window.removeEventListener('message', onMsg))

useShadowStyles(`
  .qa-corner { position: absolute; right: 16px; bottom: 16px; z-index: 2147483000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .qa-fab { display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 15px; border: none; border-radius: 999px; cursor: pointer;
    font-size: 13px; font-weight: 800; letter-spacing: .04em;
    color: #fff; background: #1f2733; box-shadow: 0 3px 12px rgba(0,0,0,.28);
    transition: transform .12s ease, background .15s ease; }
  .qa-fab:hover { background: #000; transform: translateY(-1px); }
  .qa-dot { width: 8px; height: 8px; border-radius: 50%; background: #37c871;
    box-shadow: 0 0 0 3px rgba(55,200,113,.25); }
  .qa-panel { position: absolute; right: 0; bottom: 52px; width: 264px;
    background: #fff; color: #1f2733; border: 1px solid #e2e6ec; border-radius: 12px;
    padding: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.22); }
  .qa-head { display: flex; align-items: center; justify-content: space-between; }
  .qa-x { border: none; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: #6b7686; }
  .qa-sub { margin: 8px 0 12px; font-size: 12.5px; color: #4a5568; }
  .qa-btn { width: 100%; padding: 9px 12px; border: none; border-radius: 8px;
    font-size: 13px; font-weight: 700; color: #fff; background: #e67e22; cursor: pointer; }
  .qa-btn:disabled { cursor: default; opacity: .8; }
  .qa-who { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; margin: 4px 0 10px; }
  .qa-note { margin: 10px 0 0; font-size: 11px; color: #8a94a3; }
  .qa-corner.dark .qa-panel { background: #1b212b; color: #e7ebf0; border-color: #2c3542; }
  .qa-corner.dark .qa-sub, .qa-corner.dark .qa-x { color: #aeb7c2; }

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .qa-corner, .qa-panel { transition: none !important; animation: none !important; }
}
`, 'qa-corner')
</script>

<template>
  <div class="qa-corner" :class="{ dark: isDark }">
    <button class="qa-fab" type="button" :aria-expanded="open" aria-label="Open QA" @click="toggle">
      <span class="qa-dot" aria-hidden="true"></span>
      QA
    </button>

    <div v-if="open" class="qa-panel" role="dialog" aria-label="QA session">
      <div class="qa-head">
        <strong>QA session</strong>
        <button class="qa-x" type="button" aria-label="Close" @click="toggle">×</button>
      </div>
      <p class="qa-sub">Run a QA loop on <em>{{ mapLabel }}</em> with your team.</p>

      <template v-if="authState === 'in'">
        <div class="qa-who"><span class="qa-dot"></span>{{ authUser?.display_name || authUser?.email }}</div>
        <button class="qa-btn" type="button" :disabled="starting" @click="startSession">
          {{ starting ? 'Starting…' : 'Start QA session' }}
        </button>
        <p v-if="startErr" class="qa-note" style="color:#e06a5a">⚠ {{ startErr }}</p>
        <p v-else class="qa-note">Signed in via {{ qaProviderName }} — opens a multiplayer QA room for this map.</p>
      </template>

      <template v-else-if="authState === 'checking'">
        <button class="qa-btn" type="button" disabled>Checking sign-in…</button>
      </template>

      <template v-else-if="authState === 'blocked'">
        <button v-if="canLogin" class="qa-btn" type="button" @click="login">Log in with {{ qaProviderName }}</button>
        <p class="qa-note">This plugin is origin-isolated, so sign-in must open in a new window.</p>
      </template>

      <template v-else>
        <button v-if="canLogin" class="qa-btn" type="button" @click="login">Log in with {{ qaProviderName }}</button>
        <p v-if="canLogin" class="qa-note">Sign in with {{ qaProviderName }} to start or join a session.</p>
      </template>
    </div>
  </div>
</template>
