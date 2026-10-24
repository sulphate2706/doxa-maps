<?php
/**
 * Plugin Name:       Doxa Maps Embed
 * Plugin URI:        https://doxa.life/
 * Description:       Embed portable Doxa Maps bundles (custom elements) on any post or page via the [doxa_map] shortcode or a Gutenberg block. Loads the bundle from a public catalog (CDN) — nothing is bundled into WordPress (portable-consumer pattern).
 * Version:           0.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Doxa Maps
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       doxa-maps-embed
 *
 * DEPLOY METHOD 4 (WordPress) for the doxa-maps plugin studio.
 *
 * This plugin is a thin WRAPPER around the portable doxa-maps custom elements. It does NOT
 * ship a copy of any bundle: it references the PUBLIC catalog (the served built tree +
 * manifest.json) by URL and emits the manifest's `embed.script` snippet — a <script src>
 * with SRI + a <element profile-config='…'> tag — exactly as documented in
 * docs/architecture/embeddability.md ("The manifest — embed snippets as data").
 *
 * The one job of a WordPress wrapper is to reproduce that snippet from PHP against a
 * configurable catalog base, escape everything on the way out, and register the bundle
 * script through WordPress's own dependency graph (so SRI + crossorigin survive and the
 * script loads once even if a page has several maps).
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DOXA_MAPS_EMBED_VERSION', '0.1.0' );
define( 'DOXA_MAPS_EMBED_FILE', __FILE__ );
define( 'DOXA_MAPS_EMBED_DIR', plugin_dir_path( __FILE__ ) );

/**
 * The default public catalog base — the served root of the built doxa-maps tree, i.e. the
 * directory that contains manifest.json and every <bundle>/<bundle>.js. It maps 1:1 to the
 * bundle's own `window.MAP_EMBED_BASE_URL` / embedBase.js "tree root" concept.
 *
 * Override per-site in Settings → Doxa Maps, or per-embed with the shortcode `base=""` attr.
 * This illustrative default matches the one used in library/utils/embedBase.js.
 */
if ( ! defined( 'DOXA_MAPS_EMBED_DEFAULT_BASE' ) ) {
	define( 'DOXA_MAPS_EMBED_DEFAULT_BASE', 'https://doxa.life/js/doxa-maps' );
}

require_once DOXA_MAPS_EMBED_DIR . 'includes/class-doxa-maps-embed.php';
require_once DOXA_MAPS_EMBED_DIR . 'includes/class-doxa-maps-embed-settings.php';

/**
 * Boot the singleton on plugins_loaded.
 */
function doxa_maps_embed_boot() {
	Doxa_Maps_Embed::instance();
	if ( is_admin() ) {
		Doxa_Maps_Embed_Settings::instance();
	}
}
add_action( 'plugins_loaded', 'doxa_maps_embed_boot' );
