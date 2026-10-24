<?php
/**
 * Admin: Settings → Doxa Maps — one field, the public catalog base URL.
 *
 * @package Doxa_Maps_Embed
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers a single option (doxa_maps_embed_base) via the WordPress Settings API.
 */
class Doxa_Maps_Embed_Settings {

	/** @var Doxa_Maps_Embed_Settings|null */
	private static $instance = null;

	const OPTION = 'doxa_maps_embed_base';

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_init', array( $this, 'register' ) );
		add_action( 'admin_menu', array( $this, 'menu' ) );
	}

	public function register() {
		register_setting(
			'doxa_maps_embed',
			self::OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( $this, 'sanitize_base' ),
				'default'           => DOXA_MAPS_EMBED_DEFAULT_BASE,
			)
		);

		add_settings_section(
			'doxa_maps_embed_main',
			__( 'Catalog', 'doxa-maps-embed' ),
			function () {
				echo '<p>' . esc_html__(
					'The public URL of the served doxa-maps built tree (the folder that contains manifest.json and each <bundle>/<bundle>.js). Bundles are loaded from here — nothing is stored in WordPress.',
					'doxa-maps-embed'
				) . '</p>';
			},
			'doxa_maps_embed'
		);

		add_settings_field(
			self::OPTION,
			__( 'Catalog base URL', 'doxa-maps-embed' ),
			array( $this, 'field' ),
			'doxa_maps_embed',
			'doxa_maps_embed_main'
		);
	}

	/**
	 * Only allow an absolute http(s) URL; fall back to the current value on bad input.
	 *
	 * @param mixed $value Raw submitted value.
	 * @return string
	 */
	public function sanitize_base( $value ) {
		$value = is_string( $value ) ? trim( $value ) : '';
		$url   = esc_url_raw( $value, array( 'http', 'https' ) );
		if ( '' === $url ) {
			add_settings_error(
				self::OPTION,
				'doxa_maps_embed_base_invalid',
				__( 'Catalog base URL must be an absolute http(s) URL.', 'doxa-maps-embed' )
			);
			return (string) get_option( self::OPTION, DOXA_MAPS_EMBED_DEFAULT_BASE );
		}
		return rtrim( $url, '/' );
	}

	public function field() {
		$value = get_option( self::OPTION, DOXA_MAPS_EMBED_DEFAULT_BASE );
		printf(
			'<input type="url" name="%1$s" value="%2$s" class="regular-text" placeholder="%3$s" />',
			esc_attr( self::OPTION ),
			esc_attr( $value ),
			esc_attr( DOXA_MAPS_EMBED_DEFAULT_BASE )
		);
		echo '<p class="description">' . esc_html__( 'Example:', 'doxa-maps-embed' ) . ' '
			. esc_html( DOXA_MAPS_EMBED_DEFAULT_BASE ) . '</p>';
	}

	public function menu() {
		add_options_page(
			__( 'Doxa Maps', 'doxa-maps-embed' ),
			__( 'Doxa Maps', 'doxa-maps-embed' ),
			'manage_options',
			'doxa_maps_embed',
			array( $this, 'page' )
		);
	}

	public function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Doxa Maps Embed', 'doxa-maps-embed' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'doxa_maps_embed' );
				do_settings_sections( 'doxa_maps_embed' );
				submit_button();
				?>
			</form>
			<hr />
			<h2><?php echo esc_html__( 'Usage', 'doxa-maps-embed' ); ?></h2>
			<p><?php echo esc_html__( 'Add a map to any post or page with the shortcode:', 'doxa-maps-embed' ); ?></p>
			<pre>[doxa_map bundle="doxa-simple-map" element="doxa-map" integrity="sha384-…"]</pre>
			<p><?php echo esc_html__(
				'Copy the integrity value for each bundle from manifest.json (embed.script). Leave token empty to let the map resolve its Mapbox token from your configured token endpoint.',
				'doxa-maps-embed'
			); ?></p>
		</div>
		<?php
	}
}
