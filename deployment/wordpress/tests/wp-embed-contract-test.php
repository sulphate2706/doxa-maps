<?php
/**
 * wp-embed-contract-test.php — prove deploy-method-4 (WordPress) EMITS THE RIGHT MARKUP,
 * with no WordPress installed.
 *
 * WHY THIS EXISTS — it graduates a status, not just a test. The WordPress plugin was
 * "BUILT, not shot": the PHP was complete but had never been RUN, so the 5x5 deploy matrix
 * could only ever claim 2 proven methods. wordpress/doxa-maps-embed/HOW-TO-TEST.md states
 * the correctness bar exactly: the wrapper must emit the same three things the catalog's
 * manifest.json ships as embed.script. That is checkable without wp-env or Docker -- stub the
 * ~20 WordPress functions the plugin actually calls (see wp-stubs.php), render the REAL
 * shortcode, and assert the output against the REAL built manifest.
 *
 * WHAT IT PROVES (and what it does not):
 *   PROVES  - the shortcode emits the element, a valid profile-config JSON payload, the bundle
 *             script at the correct catalog URL, the SRI integrity attribute via the
 *             script_loader_tag filter, and crossorigin=anonymous; and that a MALFORMED
 *             integrity is REJECTED (the negative test -- the format regex must actually fire).
 *   DOES NOT PROVE - that WordPress itself renders the page, that the block editor registers,
 *             or that a browser executes the result. Those still need a real WP install.
 *             Say "contract-proven, not WP-shot" and nothing stronger.
 *
 * Usage: php wordpress/tests/wp-embed-contract-test.php   (exit 0 pass / 1 fail / 2 no target)
 * Requires: php CLI + a BUILT tree (public/<tree>/manifest.json; <tree> = the build config's name).
 */
require __DIR__.'/wp-stubs.php';
$PLUGIN = dirname(__DIR__).'/doxa-maps-embed';
require $PLUGIN.'/includes/class-doxa-maps-embed.php';

// Read the AUTHORITATIVE contract from the built catalog manifest.
// dirname(__DIR__,3) — THREE levels, not two: wordpress/ moved under deployment/ on
// 2026-09-21, so tests/ is now deployment/wordpress/tests and the repo root is 3 up.
// The output folder's name comes from the build config (vite.doxa-maps-build-config.json "name"), never a literal:
// the tree is renamed by that one line, and a hardcoded 'doxa-maps' here would silently test a missing folder.
$cfg = json_decode(@file_get_contents(dirname(__DIR__,3).'/vite.doxa-maps-build-config.json'), true);
$tree = (is_array($cfg) && !empty($cfg['name']) && preg_match('/^[a-z0-9][a-z0-9._-]*$/i', $cfg['name'])) ? $cfg['name'] : 'doxa-maps';
$mfPath = dirname(__DIR__,3).'/public/'.$tree.'/manifest.json';
if(!is_file($mfPath)){ fwrite(STDERR,"no built tree at public/$tree/manifest.json -- build first (this gate runs in gates:post)\n"); exit(2); }
$mf = json_decode(file_get_contents($mfPath), true);
$bundles = $mf['bundles'];
$target = null;
foreach($bundles as $b){ foreach(($b['profiles']??[]) as $p){ if(!empty($p['element']) && !empty($p['integrity'])){ $target=['bundle'=>$b['name']??$b['bundle'],'profile'=>$p,'b'=>$b]; break 2; } } }
if(!$target){ foreach($bundles as $b){ foreach(($b['profiles']??[]) as $p){ if(!empty($p['element'])){ $target=['bundle'=>$b['name']??$b['bundle'],'profile'=>$p,'b'=>$b]; break 2; } } } }
if(!$target){ fwrite(STDERR,"no profile with an element in manifest\n"); exit(2); }

$prof = $target['profile'];
$integrity = $prof['integrity'] ?? ($target['b']['integrity'] ?? '');
echo "TARGET bundle={$target['bundle']} element={$prof['element']} integrity=".($integrity?substr($integrity,0,22).'…':'(none)')."\n\n";

$inst = Doxa_Maps_Embed::instance();
$out = do_shortcode_call('doxa_map', [
  'bundle'    => $target['bundle'],
  'element'   => $prof['element'],
  'profile'   => $prof['id'] ?? $prof['name'] ?? $target['bundle'],
  'base'      => 'https://cdn.example.org/plugin-assets/'.$tree,
  'integrity' => $integrity,
]);
global $SCRIPTS, $INLINE;
echo "--- SHORTCODE OUTPUT ---\n$out\n";
echo "--- REGISTERED SCRIPTS ---\n"; print_r($SCRIPTS);
echo "--- INLINE ---\n"; print_r($INLINE);

// ── CONTRACT ASSERTIONS ────────────────────────────────────────────────────
echo "\n--- ASSERTIONS ---\n";
$fail = 0;
$assert = function($name, $cond, $detail='') use (&$fail){
  echo ($cond ? "  PASS " : "  FAIL ") . $name . ($detail ? "  [$detail]" : '') . "\n";
  if(!$cond) $fail++;
};
// 1. the element tag is present and matches the manifest
$assert('element tag emitted', str_contains($out, "<{$prof['element']} "), $prof['element']);
// 2. profile-config decodes to valid JSON after HTML-unescaping
preg_match("/profile-config='([^']*)'/", $out, $m);
$json = html_entity_decode($m[1] ?? '', ENT_QUOTES);
$cfg  = json_decode($json, true);
$assert('profile-config is valid JSON', is_array($cfg), $json ? substr($json,0,60) : 'no match');
// 3. the script src equals the manifest's catalog path for this bundle
$src = reset($SCRIPTS)['src'] ?? '';
$want = "https://cdn.example.org/plugin-assets/{$tree}/{$target['bundle']}/{$target['bundle']}.js";
$assert('script src matches catalog path', $src === $want, $src);
// 4. SRI: the filter must add integrity to the emitted <script> tag
$handle = array_key_first($SCRIPTS);
$tag = apply_filters('script_loader_tag', "<script src='$src' id='$handle-js'></script>", $handle, $src);
$assert('SRI integrity injected by filter', str_contains($tag, 'integrity="'.$integrity.'"'), substr($tag,0,140));
$assert('crossorigin anonymous present', str_contains($tag, 'crossorigin="anonymous"') || str_contains($tag,"crossorigin='anonymous'"), '');
// 5. a BAD integrity must be REJECTED (negative test — the format regex must actually fire)
$SCRIPTS = [];
$out2 = do_shortcode_call('doxa_map', ['bundle'=>$target['bundle'],'element'=>$prof['element'],
  'profile'=>$prof['id']??$target['bundle'],'base'=>'https://cdn.example.org/plugin-assets/'.$tree,
  'integrity'=>'not-a-valid-hash!!']);
$h2 = array_key_first($SCRIPTS);
$tag2 = apply_filters('script_loader_tag', "<script src='x' id='$h2-js'></script>", $h2, 'x');
$assert('NEGATIVE: malformed integrity is rejected', !str_contains($tag2,'integrity='), substr($tag2,0,120));
echo $fail ? "\nWP-EMBED-CONTRACT: FAIL — $fail assertion(s)\n" : "\nWP-EMBED-CONTRACT: PASS — all assertions hold\n";
exit($fail ? 1 : 0);
