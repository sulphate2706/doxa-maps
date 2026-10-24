#!/usr/bin/env node
/**
 * generate-library-index.mjs — builds documentation/reference-library-index.md (the auto-generated
 * companion to the hand-written documentation/reference.md) from the LIVE library/ code.
 *
 * WHY: a programmer (or their agent) building a new app-profile needs to know
 * WHICH reusable pieces the library offers, so it can CHOOSE what to import
 * instead of rebuilding. This scans library/ and emits a one-line-per-item
 * catalog with the import path. Regenerate any time the library changes:
 *
 *     node internal/generate-library-index.mjs
 *
 * The index is DERIVED, never hand-edited — so it can't drift from the code.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LIB = join(ROOT, 'library');

/** Pull the first meaningful doc line from a file's header comment. */
function firstDocLine(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return ''; }
  // A .json file has no header comment: its first line is data ('"_meta": {', '"value": "AFG",'), so read
  // the description a data file carries about itself, and otherwise say nothing rather than print a line of JSON.
  if (file.endsWith('.json')) {
    try {
      const j = JSON.parse(text);
      const m = j && typeof j === 'object' && !Array.isArray(j) ? j : {};
      const meta = m._meta && typeof m._meta === 'object' ? m._meta : {};
      const d = m._description || meta.description || meta.purpose || '';
      return typeof d === 'string' ? d.replace(/`/g, '').replace(/\s+/g, ' ').trim().slice(0, 110) : '';
    } catch { return ''; }
  }
  const lines = text.split('\n').slice(0, 16);
  for (let raw of lines) {
    let l = raw.trim();
    if (!l) continue;
    // structural markers carry no description — skip them entirely
    if (/^<template[>\s]/.test(l) || /^<\/?script/.test(l) || l === '<!--' || l === '-->') continue;
    if (/^<div|^<span|^<button/.test(l)) return '';   // hit real markup → no header comment
    // strip comment markers (JS block/line, HTML comment, leading stars)
    l = l.replace(/^<!--+/, '').replace(/--+>$/, '')
         .replace(/^\/\*+/, '').replace(/\*+\/$/, '')
         .replace(/^\/\/+/, '').replace(/^\*+/, '').trim();
    if (!l || l === '/' || l.startsWith('import') || l.startsWith('export') ||
        l.startsWith('const ') || l.startsWith('<')) continue;
    if (l.length > 3) return l.replace(/`/g, '').slice(0, 110);
  }
  return '';
}

/** List files (optionally recursive) matching a predicate, relative to LIB. */
function listFiles(dir, { recursive = false, ext = null } = {}) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries.sort()) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) { if (recursive) walk(full); continue; }
      if (name.startsWith('_') || name === 'README.md') continue;
      if (ext && !name.endsWith(ext)) continue;
      out.push(full);
    }
  }
  walk(dir);
  return out;
}

function section(title, dir, opts, importBase) {
  const files = listFiles(join(LIB, dir), opts);
  if (!files.length) return '';
  let md = `\n### ${title}\n\n`;
  for (const f of files) {
    const rel = relative(join(LIB, dir), f);
    const name = basename(f).replace(/\.(vue|js|json)$/, '');
    const doc = firstDocLine(f);
    const imp = `${importBase}/${rel}`;
    md += `- **${name}** — ${doc || '(no description)'}  \n  \`import … from '${imp}'\`\n`;
  }
  return md;
}

const now = process.env.INDEX_STAMP || 'run `node internal/generate-library-index.mjs` to refresh';

let md = `# REFERENCE-library-index — reusable pieces you can import into an app-profile

> **DERIVED FILE — do not hand-edit.** Regenerate: \`node internal/generate-library-index.mjs\`
> Generated: ${now}

**You are a programmer (or an agent) building a map.** This is the menu of REUSABLE,
parameterized pieces the shared \`library/\` offers. Import what you need with the \`@map/…\`
alias; **build your own custom code in your app-profile's \`src/\` folder.** Do NOT edit
anything listed here unless you know what you're doing — these are shared across every map,
and a change here can break other maps.

- **Three zones:** \`library/\` (this menu — reuse, don't edit) · \`plugin-designs/<map>/\` (your sandbox — build anything) · \`internal/\` (the build machine — never touch).
- **To make a new map:** copy \`plugin-designs/template-bundle/\`, read its README, list your requirements, pick from below.
`;

md += section('Components (reusable UI)', 'components', { recursive: true, ext: '.vue' }, '@map/components');
md += section('Composables (reusable logic — Vue Composition API)', 'composables', { recursive: true, ext: '.js' }, '@map/composables');
md += section('Utilities (pure helper functions)', 'utils', { ext: '.js' }, '@map/utils');
md += section('Stores (Pinia — shared state)', 'stores', { ext: '.js' }, '@map/stores');
md += section('Constants (never-change values)', 'constants', { ext: '.js' }, '@map/constants');
md += section('Data (static reference tables)', 'data', { ext: '.json' }, '@map/data');

// api/ + colors/ are registry-driven — describe the SEAM, not each file
md += `
### API / data sources (\`@map/api\`)

The library provides the data-source **mechanism**; you declare WHICH sources your map uses
in your own \`src/api/sources.json\`. Add a REST API, CSV, or MCP source by adding one entry —
no code. Mechanism (do not edit): \`@map/api/_registry.js\`, \`@map/api/DataSourceManager.js\`.

### Colors (\`@map/colors\`)

The library provides the color-strategy **registry** (the mechanism). Shared color taxonomies
(religion, adoption, engagement, language-family) live here. Your map's OWN colors live in your
app-profile's \`src/colors/\` folder — strategy \`.js\` files auto-merge OVER the shared set
for your map only, so editing them can't break other maps. Mechanism (do not edit): \`@map/colors/_registry.js\`.
`;

const outPath = join(ROOT, 'documentation', 'reference-library-index.md');
writeFileSync(outPath, md);
const count = md.split('\n').filter(l => l.startsWith('- **')).length;
console.log(`[library-index] wrote ${relative(ROOT, outPath)} — ${count} reusable items catalogued`);
