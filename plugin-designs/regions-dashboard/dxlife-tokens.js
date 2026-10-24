// DX-LIFE'S SPACING AND TYPE SCALES, under their own token names.
//
// Before this file the three regions components carried 121 inlined magic numbers — 18 distinct
// values such as 23.5264px and 19.5312px — with no way for a reader to tell that those two are
// "--spacing-lg" and "--font-size-md" on the site being cloned.
//
// PLACEMENT (RULE 2, measured, and a deliberate deviation from the dispatch's wording):
// the dispatch says "their SCSS as shared tokens in library/styles". RULE 2 allows library/ only
// with a named SECOND consumer, so I counted:
//   grep across every plugin-designs/* for these values -> regions-dashboard 121, every other
//   plugin 0, library/ 0.
// There is no second consumer, so RULE 2's default applies and this lives in the plugin sandbox.
// Move it to library/styles the day a second bundle clones a dx-life surface.
//
// WHY PX AND NOT THEIR REM (the substitution this port forces):
// theirs are declared in rem against a 10px root — MEASURED on live /regions,
// getComputedStyle(documentElement) gives --spacing-lg: 2.352637rem with root font-size 10px.
// `rem` always resolves against the DOCUMENT root even inside a shadow root, and our components
// render inside whatever host page embeds them; neither :host nor .rl-root sets a 10px root, so
// rem values would resolve against the host's root (16px by default) and every space would be
// 1.6x too large. That is exactly why these were resolved to px in the first place.
//
// THE VALUES ARE NOW LIVE'S FULL PRECISION. They started as the rounded numbers this file was
// created to name (23.5264px for --spacing-lg, where live is 2.352637rem = 23.52637px), and the
// header said re-deriving them would be "a separate, separately measured step". THIS IS THAT STEP,
// and a measurement forced it: their country-list bullet is sized in em, 1.5em of --font-size-md,
// and against live it came out 29.2812px where theirs is 29.2969px. 0.0157px, which is nothing to
// look at — but it is the ROUNDING of --font-size-md (19.5312 for their 19.53125) multiplied by
// 1.5, and every other em- or percentage-derived length on the page inherits the same error. The
// scales are exact powers of their two ratios (type 1.25, spacing 1.33) on a 10px root, so full
// precision is available for free and there is no reason to ship a rounded clone.
//   type:    10px * 1.25^n   -> 15.625 / 19.53125 / 24.4140625 / 30.517578125 / ...
//   spacing: 10px * 1.33^n   -> 13.3 / 17.689 / 23.52637 / 31.2900721 / ...
// The vs-live diffs compare with a +/-0.5px tolerance, so this cannot be what turns one green; the
// bullet's exact-equality compare is what it is for.
//
// Mapping verified against live's own custom properties, not arithmetic:
//   spacing 3xs .5653230821rem · 2xs .7518796992 · md 1.7689 · lg 2.352637 · xl 3.12900721
//           2xl 4.1615795893 · 3xl 5.5349008538 · 4xl 7.3614181355
//   font    sm 1.5625 · md 1.953125 · lg 2.44140625 · xl 3.0517578125 · 2xl 3.8146972656
//           3xl 4.768371582 · 4xl 5.9604644775 · 5xl 7.4505805969
//
// --spacing-xs (10px) and --spacing-sm (13.3px) are deliberately NOT tokenised: "10px" is far too
// common a literal in this CSS to substitute safely, and a wrong substitution here is worse than
// a magic number because it reads as deliberate.
export const DXLIFE_TOKENS =
  ':host{' +
  '  --spacing-3xs:5.653230821px; --spacing-2xs:7.518796992px; --spacing-md:17.689px;' +
  '  --spacing-lg:23.52637px; --spacing-xl:31.2900721px; --spacing-2xl:41.615795893px;' +
  '  --spacing-3xl:55.349008538px; --spacing-4xl:73.614181355px;' +
  '  --font-size-sm:15.625px; --font-size-md:19.53125px; --font-size-lg:24.4140625px;' +
  '  --font-size-xl:30.517578125px; --font-size-2xl:38.146972656px; --font-size-3xl:47.68371582px;' +
  '  --font-size-4xl:59.604644775px; --font-size-5xl:74.505805969px;' +
    // ★ THEIR BASE LINE-HEIGHT, AND IT WAS MISSING ENTIRELY -- the same class of defect as the
    // box-sizing reset: a global rule of theirs that never crossed the shadow boundary.
    // _globals.scss:14 is `body { line-height: var(--line-height-normal) }` and
    // tokens/semantic/_typography.scss:37 is `$line-height-normal: 1.5`. We declared every spacing
    // and font token above and no line-height at all, so every text element in the clone inherited
    // whatever the EMBEDDING PAGE happened to set, while theirs is deterministically 1.5.
    // MEASURED CONSEQUENCE, in a browser: our goal cards came out 24px shorter than theirs (571 vs 595),
    // their big number sitting ~12px lower and its label ~24px lower. .rd-big carried
    // line-height:1.1 to compensate for this missing base; at --font-size-4xl (59.6046px) that is a
    // 65.6px line box against their 89.4px -- a 23.8px difference that accounts for the 24px almost
    // exactly, split roughly half above and half below the glyphs.
    // Their own tighter cases stay explicit and already agree: .region-stat__value is line-height:1
    // and so is our .rd-stat__value.
    '  --line-height-none:1; --line-height-tight:1.25; --line-height-normal:1.5;' +
    '  line-height:var(--line-height-normal);' +
  '}'
