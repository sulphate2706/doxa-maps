=== Doxa Maps Embed ===
Contributors: doxamaps
Tags: maps, embed, custom-element, missions, prayer
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embed portable Doxa Maps bundles on any WordPress post or page. Deploy method 4 for the doxa-maps plugin studio.

== Description ==

Doxa Maps bundles are portable Web Components (custom elements). This plugin is a thin
**wrapper** that lets you drop one onto a post or page with a shortcode or a Gutenberg block.

It does **not** bundle any map into WordPress. It references the **public catalog** (the served
built tree + `manifest.json`) by URL and emits that catalog's ready-made `embed.script` snippet:
a `<script src>` (with Subresource Integrity + `crossorigin`) plus the custom-element tag carrying
a `profile-config` JSON payload. This is the "portable-consumer" pattern — the same bundle,
served once from a CDN, embedded on many sites.

= Shortcode =

`[doxa_map bundle="doxa-simple-map" element="doxa-map" integrity="sha384-…"]`

Attributes:

* `bundle` (required) — bundle slug, e.g. `doxa-simple-map`, `all-people-groups`, `big-picture`.
* `element` — the custom-element tag. Defaults to the bundle slug. Some bundles expose a
  differently-named element (bundle `doxa-simple-map` renders as `<doxa-map>`). See
  `manifest.json` → `bundles[].elements`.
* `profile` — profile key inside the bundle. Defaults to the bundle slug.
* `token` — Mapbox token (data, not a secret). Better: leave empty and configure a token endpoint.
* `utm` — utmSource string.
* `base` — per-embed catalog base override (defaults to the site-wide Settings value).
* `integrity` — the `sha384-…` SRI hash for the bundle script. **Recommended.** Copy it from
  `manifest.json` → `embed.script`. Without it, no SRI attribute is emitted.

= Gutenberg block =

The block "Doxa Map" (category: Embed) is server-rendered and takes the same attributes.

== Installation ==

1. Set the catalog base under **Settings → Doxa Maps** (default `https://doxa.life/js/doxa-maps`).
2. Add a `[doxa_map]` shortcode (or the Doxa Map block) to a post or page.
3. Paste the `integrity` value for your bundle from the catalog's `manifest.json`.

== Changelog ==

= 0.1.0 =
* Initial POC: `[doxa_map]` shortcode + server-rendered Gutenberg block, SRI injection, settings page.
