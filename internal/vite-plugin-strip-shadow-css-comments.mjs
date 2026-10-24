// vite-plugin-strip-shadow-css-comments — production bundles carry only CSS rules.
//
// Every component injects its shadow-DOM styles from a template literal passed to
// useShadowStyles(`…`). Those literals ship verbatim inside the built IIFE, so any
// CSS block comment written in them would reach the public drop-in as dead weight.
// This build-only plugin rewrites the source of every .vue and .js file under
// library/ and plugin-designs/ before the Vue compiler sees it (enforce: 'pre'):
// inside each such literal it removes the block comments and collapses the blank
// lines they leave behind. Nothing outside the literal changes, and dev mode is
// untouched so the comments stay readable while working.
//
// A literal is left exactly as written (with a build warning) when it cannot be
// rewritten safely: it contains a `${…}` substitution, or a comment, string or
// url() inside it never closes. Comment markers that sit inside a CSS string
// (`content:"*/"`) or an unquoted url() are string content and are preserved.
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOTS = ['library', 'plugin-designs'].map(d => resolve(ROOT, d) + sep)
const TAG = '[strip-shadow-css-comments]'

// The literals that ship as CSS, in the three shapes this tree writes them:
//   useShadowStyles(`…`)                          the literal passed directly;
//   useShadowStyles(PANE_GRID_STYLES + `…`)       a literal appended to shared styles;
//   const PS_SHADOW_CSS = `…` / export const PANE_GRID_STYLES = `…`   a named literal passed later.
// Only the first shape was matched until 2026-09-28, and regions found three plugins' comments shipping
// from the other two (check:public-hygiene) — the same mistake written independently, i.e. a trap.
const CALL = /\buseShadowStyles\(\s*(?:[A-Za-z_$][\w$]*\s*\+\s*)*`|\b(?:export\s+)?const\s+[A-Z][A-Z0-9_]*(?:_CSS|_STYLES)\s*=\s*`/g

/**
 * Find the end of a template literal whose opening backtick is just before `from`.
 * Returns { end } = index of the closing backtick, or { reason } when the literal
 * contains a substitution or never closes.
 */
function findTemplateEnd(code, from) {
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (c === '\\') { i++; continue }
    if (c === '`') return { end: i }
    if (c === '$' && code[i + 1] === '{') return { reason: 'contains a ${…} substitution', at: i }
  }
  return { reason: 'template literal never closes', at: code.length }
}

/**
 * Remove CSS block comments from one literal's text. Strings ('…' / "…") and
 * unquoted url(…) are copied through untouched so a comment marker inside them
 * is never mistaken for a comment. Returns { css, comments } or { reason }.
 */
export function stripCssComments(css) {
  const n = css.length
  let out = ''
  let comments = 0
  let i = 0
  while (i < n) {
    const c = css[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && css[j] !== c && css[j] !== '\n') { if (css[j] === '\\') j++; j++ }
      if (j >= n) return { reason: 'a CSS string never closes' }
      if (css[j] === '\n') { out += css.slice(i, j); i = j; continue }   // stray quote: only its own line is treated as a string
      out += css.slice(i, j + 1); i = j + 1; continue
    }
    if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2)
      if (j < 0) return { reason: 'a CSS comment never closes' }
      comments++; i = j + 2; continue
    }
    if ((c === 'u' || c === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && (i === 0 || !/[\w-]/.test(css[i - 1]))) {
      let j = i + 4
      while (j < n && (css[j] === ' ' || css[j] === '\t')) j++
      if (css[j] === '"' || css[j] === "'") { out += css.slice(i, j); i = j; continue }   // quoted url: the string branch owns it
      const k = css.indexOf(')', j)
      if (k < 0) return { reason: 'an unquoted url() never closes' }
      out += css.slice(i, k + 1); i = k + 1; continue
    }
    out += c; i++
  }
  if (comments > 0) {
    out = out.replace(/[ \t]+(?=\r?\n|$)/g, '')       // whitespace left behind at the end of a line
    out = out.replace(/\r?\n(?:[ \t]*\r?\n)+/g, '\n') // runs of blank lines
  }
  return { css: out, comments }
}

/**
 * Rewrite every useShadowStyles(`…`) literal in a module's source.
 * Returns { code, changed, literals, comments, bytes, skipped: [{ line, reason }] }.
 */
export function stripShadowStyleComments(code) {
  const result = { code, changed: false, literals: 0, comments: 0, bytes: 0, skipped: [] }
  let out = ''
  let last = 0
  CALL.lastIndex = 0
  let m
  while ((m = CALL.exec(code))) {
    const open = m.index + m[0].length
    const lit = findTemplateEnd(code, open)
    if (lit.reason) {
      result.skipped.push({ line: lineOf(code, m.index), reason: lit.reason })
      CALL.lastIndex = lit.at
      continue
    }
    result.literals++
    const original = code.slice(open, lit.end)
    const stripped = stripCssComments(original)
    if (stripped.reason) {
      result.skipped.push({ line: lineOf(code, m.index), reason: stripped.reason })
    } else if (stripped.css !== original) {
      out += code.slice(last, open) + stripped.css
      last = lit.end
      result.comments += stripped.comments
      result.bytes += original.length - stripped.css.length
      result.changed = true
    }
    CALL.lastIndex = lit.end + 1
  }
  if (result.changed) result.code = out + code.slice(last)
  return result
}

function lineOf(code, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (code[i] === '\n') line++
  return line
}

function isSourceModule(id) {
  const q = id.indexOf('?')
  if (q >= 0) return false                     // Vue sub-requests (?vue&type=…) read the already-rewritten descriptor
  if (!(id.endsWith('.vue') || id.endsWith('.js'))) return false
  return SOURCE_ROOTS.some(root => id.startsWith(root))
}

export function stripShadowCssCommentsPlugin() {
  let logger = console
  const totals = { files: 0, literals: 0, comments: 0, bytes: 0, skipped: 0 }
  return {
    name: 'doxa:strip-shadow-css-comments',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) { logger = config.logger },
    transform(code, id) {
      if (!isSourceModule(id)) return null
      const r = stripShadowStyleComments(code)
      for (const s of r.skipped) {
        totals.skipped++
        logger.warn(`${TAG} left untouched ${id.slice(ROOT.length + 1)}:${s.line} — ${s.reason}`)
      }
      if (!r.changed) return null
      totals.files++; totals.literals += r.literals; totals.comments += r.comments; totals.bytes += r.bytes
      return { code: r.code, map: null }
    },
    buildEnd() {
      logger.info(`${TAG} removed ${totals.comments} CSS comments (${totals.bytes} bytes) from ${totals.literals} shadow-style literals in ${totals.files} files` +
        (totals.skipped ? `; ${totals.skipped} literal(s) left untouched` : ''))
    },
  }
}
