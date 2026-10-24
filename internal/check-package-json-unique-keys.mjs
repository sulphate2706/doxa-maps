#!/usr/bin/env node
/**
 * check-package-json-unique-keys.mjs — no object in package.json may carry the same key twice.
 *
 * WHY: JSON.parse keeps the LAST of two equal keys and says nothing, so a duplicate silently kills the
 * first entry. "check:religion-label-not-value" sat twice in //scripts, one description dead, while
 * check:doc-scripts passed (it reads the parsed object, where only one survives). It was a merge artifact:
 * the landing tooling unions both sides' package.json additions. Found during a landing; only Bun's parser
 * warned, while running something unrelated.
 *
 * HOW: a small JSON scanner that tracks every object's keys by position, so it sees what JSON.parse
 * discards. The self-test runs on every invocation (a poisoned sample must fail), so the gate cannot go blind.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.DOXA_REPO || join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every duplicated key, as "<path>: <key>". Assumes text that JSON.parse accepts. */
export function duplicateKeys(text) {
  const out = []
  const stack = []   // { keys:Set, path, isObj, expectKey }
  let i = 0
  const readString = () => {
    let s = ''; i++
    while (text[i] !== '"') { if (text[i] === '\\') { s += text[i] + text[i + 1]; i += 2 } else s += text[i++] }
    i++
    return s
  }
  let lastKey = null
  while (i < text.length) {
    const c = text[i]
    const top = stack[stack.length - 1]
    if (c === '{' || c === '[') {
      const path = top ? `${top.path}${top.isObj ? '.' + lastKey : '[]'}` : '$'
      stack.push({ keys: new Set(), path, isObj: c === '{', expectKey: c === '{' })
      i++
    } else if (c === '}' || c === ']') { stack.pop(); i++ }
    else if (c === '"') {
      const s = readString()
      if (top && top.isObj && top.expectKey) {
        if (top.keys.has(s)) out.push(`${top.path}: ${s}`)
        top.keys.add(s); lastKey = s; top.expectKey = false
      }
    } else if (c === ',') { if (top && top.isObj) top.expectKey = true; i++ }
    else i++
  }
  return out
}

// Self-test, every run: a duplicate at depth must be caught, and a clean sample must pass.
const poisoned = '{"scripts":{"a":"x","b":"y"},"//scripts":{"a":"1","c":"2","a":"3"},"v":["a","a"]}'
const selfBad = duplicateKeys(poisoned)
if (selfBad.length !== 1 || !selfBad[0].includes('a')) {
  console.error(`PACKAGE-JSON-UNIQUE-KEYS: self-test FAIL — expected exactly one duplicate in the poisoned sample, got ${JSON.stringify(selfBad)}`)
  process.exit(3)
}
if (duplicateKeys('{"a":{"b":1},"c":{"b":2},"d":"\\"b\\""}').length) {
  console.error('PACKAGE-JSON-UNIQUE-KEYS: self-test FAIL — a clean sample (same key in SIBLING objects, a quoted key in a value) was reported')
  process.exit(3)
}

const text = readFileSync(join(ROOT, 'package.json'), 'utf8')
JSON.parse(text)
const dups = duplicateKeys(text)
if (dups.length) {
  console.error(`PACKAGE-JSON-UNIQUE-KEYS: FAIL — ${dups.length} duplicated key(s); JSON.parse silently keeps only the last:`)
  for (const d of dups) console.error('  ✗ ' + d)
  process.exit(1)
}
console.log('PACKAGE-JSON-UNIQUE-KEYS: PASS — every object in package.json has unique keys (self-test: a poisoned duplicate is caught).')
