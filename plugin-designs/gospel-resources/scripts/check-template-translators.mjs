#!/usr/bin/env node
/**
 * check-template-translators.mjs — every translator a gospel-resources template calls is bound in its <script setup>.
 *
 * WHY: data-tables.vue's template called t(...) while its translator is `tr`, and no top-level `t` existed. A
 * <script setup> template resolves an unbound name through the component proxy (_ctx.t), so the tables page threw
 * "_ctx.t is not a function" (minified "I.t") on every load, the loading line never drew, and nothing failed a gate.
 *
 * For each .vue in plugin-designs/gospel-resources: the translator-shaped calls in its template (t, tr, T, tShared,
 * tStatic) must each be a TOP-LEVEL binding of its <script setup> (const / let / function / import), not a name
 * that only appears inside a function. `--poison` runs the same check on the old data-tables.vue line and must fail.
 * Exit 0 pass · 1 fail.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POISON = process.argv.includes('--poison')
const NAMES = ['t', 'tr', 'T', 'tShared', 'tStatic']

function unbound(src) {
  const tpl = (src.match(/^<template>([\s\S]*)^<\/template>/m) || [])[1] || ''
  const script = (src.match(/^<script setup[^>]*>([\s\S]*?)^<\/script>/m) || [])[1] || ''
  // TOP-LEVEL bindings: declarations at column 0 of the script block, and imported names.
  const top = new Set()
  for (const m of script.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) top.add(m[1])
  for (const m of script.matchAll(/^(?:const|let|var)\s+\{([^}]*)\}\s*=/gm)) for (const n of m[1].split(',')) top.add(n.split(':').pop().trim())
  for (const m of script.matchAll(/^import\s+\{([^}]*)\}/gm)) for (const n of m[1].split(',')) top.add(n.split(/\s+as\s+/).pop().trim())
  const called = new Set([...tpl.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]).filter((n) => NAMES.includes(n)))
  return [...called].filter((n) => !top.has(n))
}

let fails = 0
if (POISON) {
  const src = readFileSync(join(DIR, 'data-tables.vue'), 'utf8').replace("{{ tr('gospel.sheet.loadingTable'", "{{ t('gospel.sheet.loadingTable'")
  const u = unbound(src)
  console.log(u.includes('t') ? 'POISON OK: the old data-tables.vue call t(...) is caught as unbound' : 'POISON FAILED')
  process.exit(u.includes('t') ? 0 : 1)
}
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.vue'))) {
  const u = unbound(readFileSync(join(DIR, f), 'utf8'))
  if (u.length) { fails++; console.log(`FAIL ${f}: the template calls ${u.map((n) => n + '(…)').join(', ')} but its <script setup> binds no such name at the top level`) }
  else console.log(`ok   ${f}`)
}
console.log(fails ? `FAIL check-template-translators: ${fails}` : 'PASS check-template-translators')
process.exit(fails ? 1 : 0)
