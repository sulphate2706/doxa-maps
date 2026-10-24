// The Subresource-Integrity form of a text's SHA-384 ("sha384-<base64>"), via WebCrypto, so a file fetched at
// print time can be compared with the pin baked into the bundle (poster-render.integrity.js) before it is used.
// The same value pin-poster-render.mjs computes with node:crypto.
export async function sha384(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-384', new TextEncoder().encode(text)))
  let bin = ''
  for (const b of d) bin += String.fromCharCode(b)
  return `sha384-${btoa(bin)}`
}

// ★ A PINNED FILE THAT FAILS ITS PIN IS FETCHED ONCE MORE, FRESH. The loaders fetch with cache: 'force-cache' (fast,
// and it works offline once cached), which returns ANY cached copy, however old. After a re-pin, a reader who had
// printed before kept the previous file: it failed its pin on every print, and the print fell back without a word
// (the stored poster for page 1, English for the packet text) until the browser evicted it. So a copy that is not
// served or does not match is fetched ONCE more with cache: 'reload', which skips the HTTP cache and refreshes it,
// and only that answer decides. Resolves with the verified text; rejects with the last reason (err.integrity is
// true when the bytes were wrong rather than missing).
export async function fetchPinned(url, pin) {
  let last = null
  for (const cache of ['force-cache', 'reload']) {
    try {
      const res = await fetch(url, { cache })
      if (!res.ok) { last = new Error(`not served (${res.status})`); continue }
      const text = await res.text()
      const got = await sha384(text)
      if (got === pin) return text
      last = Object.assign(new Error(`failed its integrity check (expected ${pin}, got ${got})`), { integrity: true })
    } catch (e) { last = e }
  }
  throw last
}
