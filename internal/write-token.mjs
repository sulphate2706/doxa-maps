#!/usr/bin/env node
/**
 * write-token.mjs — emit the static token endpoint into the served web-root.
 *
 * WHY THIS EXISTS
 * The maps need a Mapbox token at runtime, and the three surfaces that serve them
 * cannot supply one the same way:
 *   · a static host (GitHub Pages, the source-control service, a laptop) runs no
 *     server-side code at all, so there is nothing to compute a token;
 *   · the mobile app's origin is https://localhost, where a same-origin endpoint
 *     can never exist;
 *   · a partner site embedding a bundle has no reason to know our token.
 * The shared answer is a PLAIN FILE at a known URL. Every client already accepts
 * either a bare string or {token|tk|accessToken}, so a JSON file IS the endpoint.
 *
 * WHY THE TOKEN IS NOT IN THE REPO
 * It is written from the MAPBOX_TOKEN environment variable at build time and the
 * output path is gitignored. CI supplies the value from a secret, so the token
 * lives in deployment settings rather than in git history — rotating it is a
 * redeploy, not a rewrite of every commit that ever carried it.
 *
 * NO TOKEN, NO FILE. A missing endpoint is a clear 404 the token ladder can fall
 * through; a file containing an empty string looks like a successful fetch of a
 * broken token, which is much harder to diagnose.
 *
 * UPGRADE PATH: swapping this static file for a service that mints short-lived
 * tk.* tokens from a secret sk.* changes nothing on the client — the contract is
 * the URL, not the implementation behind it.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'api', 'maps')
const OUT = join(OUT_DIR, 'token.json')

const token = (process.env.MAPBOX_TOKEN || '').trim()

if (!token) {
  if (existsSync(OUT)) rmSync(OUT)
  console.log('[write-token] MAPBOX_TOKEN unset — no endpoint written (maps fall through the token ladder)')
  process.exit(0)
}

if (token.startsWith('sk.')) {
  console.error('[write-token] REFUSED: MAPBOX_TOKEN is a SECRET key (sk.*). This file is served publicly.\n' +
                '              Use a public pk.* token here, or put the sk.* behind a service that mints tk.* tokens.')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify({ token, type: token.slice(0, 2) }) + '\n')

// ★ WRITE THE EXTENSIONLESS PATH TOO — the client asks for `/api/maps/token`, NOT `token.json`.
// MEASURED 2026-09-20: the generated leaf requests `/api/maps/token` FOUR times and `.json` never;
// a static host returns 404 for the extensionless path and 200 for token.json. So the WRITER and the
// CLIENT disagreed on the path and ladder rung 6 (same-origin) COULD NEVER HAVE RESOLVED — on the
// web, in a dropped folder, or inside the Capacitor app. Two artifacts holding one fact with nothing
// forcing agreement; the fix is to satisfy the CONSUMER'S path rather than ask it to change.
// The extensionless copy is a BARE TOKEN STRING, not JSON: the client uses the response verbatim,
// and handing it `{"token":"pk..."}` makes it complain the token lacks a `pk.` prefix (measured).
// token.json stays for any consumer that wants the typed object.
writeFileSync(join(OUT_DIR, 'token'), token)
console.log(`[write-token] wrote public/api/maps/token.json + token (${token.slice(0, 6)}…, type ${token.slice(0, 2)})`)
