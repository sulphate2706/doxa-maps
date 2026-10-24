<?php
/**
 * wp-stubs.php — the ~20 WordPress functions doxa-maps-embed actually calls, stubbed.
 * Deliberately minimal and DUMB: each stub does the least thing that lets the real plugin run,
 * so the test exercises THE PLUGIN rather than a re-implementation of WordPress.
 * Enumerated by grepping the plugin for its wp_, add_, esc_, get_option and shortcode_atts calls.
 */
/**
 * Minimal WordPress stub harness — renders the REAL doxa-maps-embed plugin with no WordPress.
 * Proves deploy-method-4's deliverable: that the emitted markup matches the catalog manifest's
 * embed.script contract (bundle src + SRI integrity + the custom element + profile-config).
 */
$SCRIPTS = []; $INLINE = []; $SHORTCODES = []; $FILTERS = [];
function add_action($h,$c,$p=10,$a=1){}
function add_filter($h,$c,$p=10,$a=1){ global $FILTERS; $FILTERS[$h][]=$c; }
function apply_filters($h,$v){ global $FILTERS; foreach(($FILTERS[$h]??[]) as $c){ $v=call_user_func_array($c, array_slice(func_get_args(),1)); } return $v; }
function add_shortcode($t,$c){ global $SHORTCODES; $SHORTCODES[$t]=$c; }
function do_shortcode_call($t,$a){ global $SHORTCODES; return call_user_func($SHORTCODES[$t],$a); }
function esc_attr($s){ return htmlspecialchars((string)$s, ENT_QUOTES); }
function esc_html($s){ return htmlspecialchars((string)$s, ENT_QUOTES); }
function esc_html__($s,$d=null){ return $s; }
function esc_url_raw($s){ return $s; }
function __($s,$d=null){ return $s; }
function get_option($k,$d=''){ return $d; }
function wp_json_encode($v,$f=0){ return json_encode($v,$f); }
function plugin_dir_path($f){ return dirname($f).'/'; }
function shortcode_atts($pairs,$atts,$sc=''){ $atts=(array)$atts; $out=[]; foreach($pairs as $n=>$d){ $out[$n]= array_key_exists($n,$atts)?$atts[$n]:$d; } return $out; }
function wp_register_script($h,$src,$deps=[],$ver=null,$args=[]){ global $SCRIPTS; $SCRIPTS[$h]=['src'=>$src]; }
function wp_enqueue_script($h,$src='',$deps=[],$ver=null,$args=[]){ global $SCRIPTS; if($src) $SCRIPTS[$h]=['src'=>$src]; }
function wp_script_add_data($h,$k,$v){ global $SCRIPTS; $SCRIPTS[$h][$k]=$v; }
function wp_add_inline_script($h,$code,$pos='after'){ global $INLINE; $INLINE[]=$code; }
function add_options_page(...$a){} function add_settings_error(...$a){} function add_settings_field(...$a){}
function add_settings_section(...$a){} function register_setting(...$a){} function register_block_type(...$a){}
function sanitize_text_field($s){ return $s; }
if(!defined('ABSPATH')) define('ABSPATH', __DIR__.'/');
