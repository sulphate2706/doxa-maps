// codeOnly(src) — blank out comments WITHOUT being fooled by comment-like text inside strings.
//
// PLACEMENT (RULE 2): this lives in the PLUGIN folder, not in library/, because it has exactly one
// committed consumer -- check-embedder-keys.mjs beside it. It started life in the gitignored
// _qa-cycle scratch area, which a committed gate cannot import: the gate would work here and fail on
// a fresh clone. The scratch copy now RE-EXPORTS this file, so there is one implementation rather
// than two that drift. If a second committed consumer appears, that is the moment it earns a move to
// library/utils/.
//
// WHY THIS EXISTS. Every _chk script in this folder used the same one-line helper:
//     s.replace(/\/\*[\s\S]*?\*\//g, ' ') ...
// It produced a FALSE GREEN on C5. `import.meta.glob('./*.vue')` contains `/*` INSIDE A STRING, so
// the regex opened a comment there and swallowed everything up to the next `*/` -- which happened to
// include the whole setRTLTextPlugin block the gate was looking for. The gate then reported "no
// plugin entry hand-rolls setRTLTextPlugin any more" while all six still did.
//
// That is worse than a red gate: a red gate gets investigated. This one would have certified the
// deletion as already-done. The fix has to be state-aware, because the ONLY way to know whether `/*`
// opens a comment is to know whether you are inside a string when you reach it -- which a regex
// cannot know. So: a character scanner, with its own negative tests below.
//
// Comments are replaced by SPACES, preserving length and line structure, so line numbers reported
// against the result still point at the real file.
// ★ WHAT THIS DOES NOT STRIP, and both gaps have already cost a real measurement:
//   - CSS comments inside a JS TEMPLATE LITERAL. A string is copied through verbatim, correctly for
//     JS, but useShadowStyles(`...`) contains CSS whose /* */ the BROWSER honours. Reading specificity
//     off such a file once gave (0,5,53) because a comment landed inside the selector.
//   - HTML comments in a .vue TEMPLATE. `<!-- ... -->` is invisible here, so any identifier quoted in
//     one is counted as code. That made a bare-useI18n census read 3 where the code had 2.
//   - A LONG SFC CAN DESYNCHRONISE IT. Measured 2026-09-27 in all-people-groups.vue: `tr('pray')` inside
//     a template literal was lost, because the `//` of an `https://` URL in that template was read as a
//     line comment -- the scanner had already lost template state somewhere earlier in a 1000+ line file.
//     The narrow cases all pass (a backtick template, a URL in a template, a nested ${} with a quote, a
//     regex holding a quote), so this is an accumulation problem, not one of those.
//     ★ THE RULE THAT FOLLOWS: when the question is "does X exist anywhere", prefer RAW source. Over-
//     including a commented-out hit makes a check STRICTER (a false red, cheap). Under-including a real
//     hit makes it claim completeness it does not have (a false green, expensive). Only use this stripper
//     when a comment mentioning the pattern would be a FALSE POSITIVE you cannot tolerate.
// A generalisation worth keeping: "any <!-- --> in a template that quotes an identifier
// will keep doing that to you". THE RULE: the stripper must match the LANGUAGE of the text being read.
// For a .vue file, strip HTML comments first, then call this for the script block.

export function codeOnly(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    // ── strings and template literals: copied through verbatim, never interpreted ──
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      out += c; i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue }
        out += src[i]
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    // ── line comment ──
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    // ── block comment ──
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '; i += 2
      continue
    }
    out += c; i++
  }
  return out
}

// ── SELF-TEST. A stripper that silently mis-strips is exactly how the false green happened, so this
// runs whenever the file is executed directly. Each case is one way the naive regex was wrong.
if (import.meta.url === `file://${process.argv[1]}`) {
  let fails = 0
  const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }
  const has = (s, re) => re.test(codeOnly(s))

  ok(has("const m = import.meta.glob('./*.vue')\nwindow.mapboxgl.setRTLTextPlugin(u)", /setRTLTextPlugin\(/),
    "THE REGRESSION: a `/*` inside import.meta.glob('./*.vue') no longer swallows the code after it")
  ok(!has("/* window.mapboxgl.setRTLTextPlugin(u) */", /setRTLTextPlugin\(/),
    'a real block comment is still stripped')
  ok(!has("// window.mapboxgl.setRTLTextPlugin(u)", /setRTLTextPlugin\(/),
    'a real line comment is still stripped')
  ok(has("const url = 'http://x/*/y'\ncall()", /call\(\)/),
    'a URL containing /*/ inside a string does not open a comment')
  ok(has('const s = "// not a comment"\ncall()', /call\(\)/),
    'a // inside a double-quoted string does not start a comment')
  ok(has('const s = `a /* b`\ncall()', /call\(\)/),
    'a /* inside a template literal does not start a comment')
  ok(has("const s = 'it\\'s /* fine'\ncall()", /call\(\)/),
    'an escaped quote does not end the string early')
  ok(codeOnly('a\n/* x\ny */\nb').split('\n').length === 4,
    'line count is preserved, so reported line numbers stay true')
  // POS control: the naive regex really did fail this, proving the case is not hypothetical
  const naive = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ')
  ok(!/setRTLTextPlugin\(/.test(naive("const m = import.meta.glob('./*.vue')\nwindow.mapboxgl.setRTLTextPlugin(u)\n/* end */")),
    'POS CONTROL: the OLD naive regex does lose the call on this input -- the bug was real, not imagined')

  console.log(fails ? `\nSTRIP-CODE: ${fails} FAIL(s)` : '\nSTRIP-CODE: comment stripping is string-aware')
  process.exit(fails ? 1 : 0)
}
