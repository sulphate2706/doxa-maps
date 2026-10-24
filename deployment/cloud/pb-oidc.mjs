// pb-oidc.mjs — make the team PocketBase (pb-dev) sign people in through the team's OIDC provider.
// Run by entry.sh at every start, against PocketBase on localhost, as the superuser (env, never printed).
// users: sign-in ONLY through OIDC (password sign-in off); the group check is the image's baked hook.
// The client secret comes from the environment; nothing here, or in PocketBase's data, is in git.
const env = process.env
const PB = env.PB_LOCAL_URL || 'http://127.0.0.1:8090'
const need = (k) => env[k] || (console.error(`[pb-oidc] ${k} is not set: team sign-in NOT configured`), process.exit(1))

const call = async (method, path, body, token) => {
  const r = await fetch(PB + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.message || ''}`)
  return j
}

const issuer = need('OIDC_ISSUER').replace(/\/$/, '')
const disc = env.PB_OIDC_DISCOVERY_JSON ? JSON.parse(env.PB_OIDC_DISCOVERY_JSON)
  : await (await fetch(issuer + '/.well-known/openid-configuration')).json()
const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
  { identity: need('PB_SUPERUSER_EMAIL'), password: need('PB_SUPERUSER_PASSWORD') })

await call('PATCH', '/api/collections/users', {
  passwordAuth: { enabled: false, identityFields: ['email'] },
  oauth2: {
    enabled: true,
    mappedFields: { id: '', name: 'name', username: '', avatarURL: '' },
    providers: [{
      name: 'oidc',
      displayName: env.OIDC_DISPLAY_NAME || 'Team sign-in',
      clientId: env.PB_OIDC_CLIENT_ID || 'dx-maps-pb-dev',
      clientSecret: need('PB_OIDC_CLIENT_SECRET'),
      authURL: disc.authorization_endpoint,
      tokenURL: disc.token_endpoint,
      userInfoURL: disc.userinfo_endpoint,
      pkce: true,
      extra: {},
    }],
  },
}, token)
if (env.PB_APP_URL) await call('PATCH', '/api/settings', { meta: { appURL: env.PB_APP_URL } }, token)
console.log(`[pb-oidc] users sign in through ${issuer} only (password sign-in off)`)
