/**
 * photoUrl.js — a people group's photo at the size the Wall draws and prints it, not its original.
 *
 * Measured on the live list (939 distinct photos, 2026-09-30): the Joshua Project and doxa photos are already
 * small (150-250 px, 7-64 KB), but the 77 IMB photos (peoplegroupspublic.blob.core.windows.net and
 * images.peoplegroups.org, one Azure container behind both) are 1024 px originals of ~1.5 MB each: 114 MB of the
 * print's 133 MB. images.peoplegroups.org resizes on request (/cdn-cgi/image/), and at 320 px the 77 weigh 1.3 MB.
 * 320 px covers the largest printed photo (5 × 8 ft: ~0.97 in, 291 px at 300 dpi) and the canvas's own cap
 * (wallCanvas THUMB_PX). Every other URL is returned unchanged.
 */

const IMB_HOSTS = new Set(['peoplegroupspublic.blob.core.windows.net', 'images.peoplegroups.org'])
const IMB_PATH = /^\/(imbpeople-featured-images\/[^?#]+)$/
export const PHOTO_PX = 320

/** The URL to load for a photo: a resized copy where the host offers one, else the URL itself. */
export function lightPhoto(url) {
  let u
  try { u = new URL(url) } catch (_) { return url || '' }
  const m = IMB_HOSTS.has(u.hostname) && u.pathname.match(IMB_PATH)
  return m ? `https://images.peoplegroups.org/cdn-cgi/image/width=${PHOTO_PX},format=jpeg/${m[1]}` : url
}

/** For a URL lightPhoto() rewrote, the original to fall back to if the resized copy fails; else null. */
export function fullPhoto(light) {
  const m = String(light || '').match(/^https:\/\/images\.peoplegroups\.org\/cdn-cgi\/image\/[^/]+\/(imbpeople-featured-images\/.+)$/)
  return m ? `https://images.peoplegroups.org/${m[1]}` : null
}
