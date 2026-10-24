# How to test the Doxa Maps Embed plugin

This plugin is a wrapper around the portable doxa-maps custom elements. You do **not** need a
running WordPress to review it (the PHP + the emitted snippet are the deliverable), but here is
how to prove it end-to-end.

## 0. What "correct" means

A correct wrapper emits the same three things the catalog's `manifest.json` ships as `embed.script`,
against a configurable catalog base:

1. (when a per-embed `base` is set) a `<script>window.MAP_EMBED_BASE_URL=…</script>` so the bundle's
   tree-relative share/iframe URLs resolve back to the catalog.
2. the bundle `<script src=".../<bundle>/<bundle>.js" integrity="sha384-…" crossorigin="anonymous">`
   — registered through WordPress so it loads once per page.
3. the custom element: `<element profile-config='{"profile":"…",…}'></element>`.

## 1. Fastest: wp-env (Docker)

From this plugin directory:

```bash
npm -g install @deployment/wordpress/env   # once
wp-env start                    # boots WordPress with THIS folder mounted as a plugin
```

Then in wp-admin (http://localhost:8888/wp-admin, admin/password):

1. Plugins → activate **Doxa Maps Embed**.
2. Settings → **Doxa Maps** → set the catalog base to a real served tree, e.g.
   `https://doxa.life/js/doxa-maps` (or your own CDN / GitHub Pages / a Forgejo host you run).
3. Create a page and add the shortcode:

   ```
   [doxa_map bundle="doxa-simple-map" element="doxa-map" integrity="sha384-Kwtrpp2S3X7zOmiYWDqDLzmm2/9UyYlxpb8OXP0H+S0ltABmd5OhselH5LolJeF4"]
   ```

   (copy the `integrity` for each bundle from the catalog's `manifest.json` → `embed.script`.)
4. View the page. Confirm in the page source that a `<script src>` with `integrity` +
   `crossorigin="anonymous"` was emitted and the `<doxa-map profile-config='…'>` element mounts.

## 2. Manual WordPress

Copy `deployment/wordpress/doxa-maps-embed/` into `wp-content/plugins/`, activate, then follow steps 2–4 above.

## 3. No-WordPress sanity check (what a reviewer can do now)

`php -l` passes on all three files (verified). To eyeball the exact HTML the shortcode produces
without a full WP, stub the handful of WP functions used and call the renderer — but the simplest
review is to read `includes/class-doxa-maps-embed.php::render()` and compare its output shape to a
`manifest.json` `embed.script` entry. They match by construction:

- script URL = `<base>/<bundle>/<bundle>.js` (the built-tree layout `generate-tree.mjs` emits)
- SRI + `crossorigin` attached via the `script_loader_tag` filter
- `profile-config` = `{"profile":…,["tk":…],["utmSource":…],["embedBaseUrl":…]}`

## What is proven vs. needs a live WordPress

| Claim | Status |
|---|---|
| Plugin header + boot are WP-conventional | Proven (readable, `plugins_loaded`, singleton) |
| PHP is syntactically valid | Proven (`php -l` clean on all 3 files) |
| Emitted snippet matches `manifest.json` `embed.script` shape | Proven by construction (see §3) |
| Output is escaped (element tag, attr, JSON, URL) | Proven (esc_html/esc_attr/esc_url_raw/wp_json_encode) |
| SRI + crossorigin actually render on the tag | Needs a live WP (the `script_loader_tag` filter runs at enqueue) |
| The map visibly renders on a partner page | Needs a live WP + a reachable catalog + a Mapbox token endpoint |
