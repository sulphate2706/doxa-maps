<?php
/**
 * Core: shortcode + block render + SRI-aware script registration.
 *
 * @package Doxa_Maps_Embed
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Emits the manifest `embed.script` snippet for a doxa-maps bundle against a configurable
 * public catalog base. Reproduces, from PHP, what public/doxa-maps/manifest.json ships as data.
 */
class Doxa_Maps_Embed {

	/** @var Doxa_Maps_Embed|null */
	private static $instance = null;

	/**
	 * Handles enqueued this request keyed by bundle, so N maps on a page load one <script>.
	 *
	 * @var array<string,bool>
	 */
	private $enqueued = array();

	/**
	 * SRI hash per script handle, filled at register time and read back in script_loader_tag.
	 *
	 * @var array<string,string>
	 */
	private $integrity = array();

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_shortcode( 'doxa_map', array( $this, 'render_shortcode' ) );
		add_filter( 'script_loader_tag', array( $this, 'inject_sri' ), 10, 2 );
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * The configured catalog base (Settings override → default), trailing slash stripped.
	 *
	 * @return string
	 */
	public function catalog_base() {
		$base = get_option( 'doxa_maps_embed_base', DOXA_MAPS_EMBED_DEFAULT_BASE );
		$base = is_string( $base ) && '' !== trim( $base ) ? trim( $base ) : DOXA_MAPS_EMBED_DEFAULT_BASE;
		return rtrim( $base, '/' );
	}

	/**
	 * A bundle's script URL in the catalog: <base>/<bundle>/<bundle>.js (the built-tree layout).
	 *
	 * @param string $bundle Sanitized bundle slug.
	 * @return string
	 */
	private function script_url( $bundle ) {
		return $this->catalog_base() . '/' . $bundle . '/' . $bundle . '.js';
	}

	/**
	 * Sanitize a bundle / element / profile slug to the safe charset the tree uses.
	 * Bundles and elements are kebab-case ASCII; anything else is not a real catalog entry.
	 *
	 * @param string $slug Raw input.
	 * @return string Sanitized slug (may be empty).
	 */
	private function slug( $slug ) {
		return preg_replace( '/[^a-z0-9-]/', '', strtolower( (string) $slug ) );
	}

	/**
	 * [doxa_map] shortcode.
	 *
	 * Attributes:
	 *   bundle   (required)  bundle slug, e.g. "doxa-simple-map"
	 *   element  (optional)  custom-element tag; defaults to bundle. Some bundles expose a
	 *                        differently-named element (e.g. bundle doxa-simple-map → <doxa-map>),
	 *                        so authors can override. See manifest.json → bundles[].elements.
	 *   profile  (optional)  profile key inside the bundle; defaults to bundle
	 *   token    (optional)  Mapbox token (data, not a secret) — better: leave empty and let the
	 *                        page resolve it via tokenUrl / window.MAP_TOKEN_URL
	 *   utm      (optional)  utmSource
	 *   base     (optional)  per-embed catalog base override
	 *   integrity(optional)  SRI hash (sha384-…) for this bundle's script. STRONGLY recommended:
	 *                        copy it from manifest.json → embed.script. Without it, no SRI is set.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string HTML.
	 */
	public function render_shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'bundle'    => '',
				'element'   => '',
				'profile'   => '',
				'token'     => '',
				'utm'       => '',
				'base'      => '',
				'integrity' => '',
			),
			$atts,
			'doxa_map'
		);

		$bundle = $this->slug( $atts['bundle'] );
		if ( '' === $bundle ) {
			return $this->author_notice( __( 'Doxa Maps: a "bundle" attribute is required.', 'doxa-maps-embed' ) );
		}

		$element = '' !== $atts['element'] ? $this->slug( $atts['element'] ) : $bundle;
		$profile = '' !== $atts['profile'] ? $this->slug( $atts['profile'] ) : $bundle;
		if ( '' === $element ) {
			return $this->author_notice( __( 'Doxa Maps: invalid element name.', 'doxa-maps-embed' ) );
		}

		return $this->render(
			array(
				'bundle'    => $bundle,
				'element'   => $element,
				'profile'   => $profile,
				'token'     => (string) $atts['token'],
				'utm'       => (string) $atts['utm'],
				'base'      => (string) $atts['base'],
				'integrity' => (string) $atts['integrity'],
			)
		);
	}

	/**
	 * The shared renderer for shortcode + block.
	 *
	 * Emits, in order:
	 *   1. (once, if a per-embed base is given) a <script> setting window.MAP_EMBED_BASE_URL so the
	 *      bundle's tree-relative share/iframe URLs resolve back to the catalog.
	 *   2. the bundle <script src> — enqueued through WP so SRI + crossorigin are attached and it
	 *      loads once per page even with several maps.
	 *   3. the custom element with a `profile-config` JSON payload.
	 *
	 * @param array $args Sanitized args.
	 * @return string HTML.
	 */
	private function render( $args ) {
		$base = '' !== $args['base'] ? rtrim( trim( $args['base'] ), '/' ) : $this->catalog_base();

		// Enqueue the bundle once per page. Handle is per-bundle+base so two catalog bases coexist.
		$handle = 'doxa-maps-' . $args['bundle'] . '-' . substr( md5( $base ), 0, 8 );
		if ( empty( $this->enqueued[ $handle ] ) ) {
			$src = $base . '/' . $args['bundle'] . '/' . $args['bundle'] . '.js';
			wp_register_script( $handle, $src, array(), null, true );
			wp_script_add_data( $handle, 'doxa_crossorigin', 'anonymous' );
			if ( '' !== $args['integrity'] && preg_match( '/^sha(256|384|512)-[A-Za-z0-9+\/=]+$/', $args['integrity'] ) ) {
				$this->integrity[ $handle ] = $args['integrity'];
			}
			wp_enqueue_script( $handle );
			$this->enqueued[ $handle ] = true;
		}

		// profile-config JSON — only include keys the author actually set.
		$config = array( 'profile' => $args['profile'] );
		if ( '' !== $args['token'] ) {
			$config['tk'] = $args['token'];
		}
		if ( '' !== $args['utm'] ) {
			$config['utmSource'] = $args['utm'];
		}
		// If a per-embed base is given, hand it to the element too (embedBase.js ladder step 1),
		// so its OWN share/iframe URLs resolve without relying on a page global.
		if ( '' !== $args['base'] ) {
			$config['embedBaseUrl'] = $base;
		}

		$config_json = wp_json_encode( $config );

		$html = '';

		// A page global for the base (belt + suspenders alongside embedBaseUrl above). Emitted once
		// per distinct base. Printed inline BEFORE the element markup so it is set when the IIFE runs.
		if ( '' !== $args['base'] && empty( $this->enqueued[ 'base-global-' . md5( $base ) ] ) ) {
			$html .= sprintf(
				"<script>window.MAP_EMBED_BASE_URL=%s;</script>\n",
				wp_json_encode( $base )
			);
			$this->enqueued[ 'base-global-' . md5( $base ) ] = true;
		}

		// The custom element. Tag + attribute value are escaped. profile-config is single-quoted
		// (the JSON contains double quotes) with esc_attr on the JSON string.
		$html .= sprintf(
			"<%1\$s profile-config='%2\$s'></%1\$s>",
			esc_html( $args['element'] ),
			esc_attr( $config_json )
		);

		return $html;
	}

	/**
	 * script_loader_tag filter — attach SRI + crossorigin to our registered bundle scripts.
	 *
	 * WordPress does not offer a portable API to set `integrity` on an enqueued script across all
	 * supported versions, so the WP-idiomatic path is to register the script normally and rewrite
	 * ITS tag here (only ours — matched by handle). This keeps the dependency graph intact instead
	 * of echoing a raw <script> and bypassing wp_enqueue_script.
	 *
	 * @param string $tag    The <script> tag HTML.
	 * @param string $handle The script handle.
	 * @return string
	 */
	public function inject_sri( $tag, $handle ) {
		// Defensive: this filter runs for EVERY script on the page, and a null/non-string handle
		// from another plugin would raise "strpos(): Passing null to parameter #1" on PHP 8.1+
		// (a hard TypeError in PHP 9). Core always passes a string, so this is hardening rather
		// than a fix for an observed production failure — surfaced by the stub-harness contract
		// test, which reaches this filter with an empty handle on its negative path.
		if ( ! is_string( $handle ) || '' === $handle ) {
			return $tag;
		}
		$is_ours = 0 === strpos( $handle, 'doxa-maps-' );
		if ( ! $is_ours ) {
			return $tag;
		}

		$attrs = '';
		if ( ! empty( $this->integrity[ $handle ] ) ) {
			$attrs .= sprintf( ' integrity="%s"', esc_attr( $this->integrity[ $handle ] ) );
		}
		// crossorigin is required for SRI on a cross-origin CDN, and harmless otherwise.
		$attrs .= ' crossorigin="anonymous"';

		// Insert our attributes right before the closing of the opening <script ...> tag.
		return preg_replace( '/(<script\b[^>]*?)(\s*><\/script>|\s*\/?>)/', '$1' . $attrs . '$2', $tag, 1 );
	}

	/**
	 * Register a simple dynamic (server-rendered) Gutenberg block that wraps the same renderer.
	 * Server-rendered so the emitted snippet always matches the shortcode and stays escaped.
	 */
	public function register_block() {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}
		register_block_type(
			'doxa-maps/embed',
			array(
				'api_version'     => 2,
				'title'           => __( 'Doxa Map', 'doxa-maps-embed' ),
				'category'        => 'embed',
				'attributes'      => array(
					'bundle'    => array( 'type' => 'string', 'default' => '' ),
					'element'   => array( 'type' => 'string', 'default' => '' ),
					'profile'   => array( 'type' => 'string', 'default' => '' ),
					'token'     => array( 'type' => 'string', 'default' => '' ),
					'utm'       => array( 'type' => 'string', 'default' => '' ),
					'base'      => array( 'type' => 'string', 'default' => '' ),
					'integrity' => array( 'type' => 'string', 'default' => '' ),
				),
				'render_callback' => array( $this, 'render_block' ),
			)
		);
	}

	/**
	 * Dynamic block render — reuse the shortcode path so there is exactly one code path.
	 *
	 * @param array $attributes Block attributes.
	 * @return string
	 */
	public function render_block( $attributes ) {
		return $this->render_shortcode( is_array( $attributes ) ? $attributes : array() );
	}

	/**
	 * An author-facing notice, only shown to users who can edit posts (never leaks to visitors).
	 *
	 * @param string $message Message text.
	 * @return string
	 */
	private function author_notice( $message ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return '';
		}
		return '<div class="doxa-maps-embed-notice" style="padding:.5em;border:1px solid #c00;color:#c00">'
			. esc_html( $message ) . '</div>';
	}
}
