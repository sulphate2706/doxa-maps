/**
 * apiBaseUrl.js — Resolve the API base URL at runtime.
 *
 * Priority order:
 *   1. window.MAP_APP_API_URL        — set by the host (WordPress, CMS) at runtime, no rebuild needed
 *   2. import.meta.env.VITE_API_BASE_URL — baked in at Vite build time (.env file)
 *   3. '' (empty string)              — relative URLs; works when API is on the same origin
 *
 * Host usage (inject before the IIFE loads):
 *   WordPress (functions.php):
 *     wp_add_inline_script('your-map-app', "window.MAP_APP_API_URL='https://api.example.com';", 'before');
 *
 *   Plain HTML:
 *     <script>window.MAP_APP_API_URL = 'https://api.example.com';</script>
 *     <script src="map-app.iife.js"></script>
 *
 * This lets the host control the API URL without requiring a Vite rebuild.
 */
export function getApiBaseUrl() {
  return (typeof window !== 'undefined' && window.MAP_APP_API_URL)
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL)
    || ''
}
