#!/usr/bin/env node
// check-readme-web-folder-size: the README's "The web folder" row states the size of public/dx-maps
// ("N files, M MiB"). It said 536 files / 76 MiB while the folder was 855 files / 119 MiB, and had gone stale
// twice. This measures the folder and fails when the stated numbers are more than 10% off, printing the line to
// paste. The folder grows as maps are added, so a new batch of posters or data trips it on purpose.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(ROOT, 'public', TREE_NAME)
const TOLERANCE = 0.10

let files = 0, bytes = 0
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) { files++; bytes += statSync(p).size } } }
walk(TREE)
const mib = bytes / 1048576

const row = readFileSync(join(ROOT, 'README.md'), 'utf8').split('\n').find((l) => l.includes('**The web folder**'))
const m = row && row.match(/([\d,]+) files, ([\d.]+) MiB/)
if (!m) { console.error('README-WEB-FOLDER-SIZE: FAIL: no "N files, M MiB" in the README row for **The web folder**.'); process.exit(1) }
const saidFiles = Number(m[1].replace(/,/g, '')), saidMib = Number(m[2])
const off = (said, real) => Math.abs(said - real) / real
const line = `${files} files, ${Math.round(mib)} MiB (about ${Math.round(bytes / 1e6 / 5) * 5} MB)`
if (off(saidFiles, files) > TOLERANCE || off(saidMib, mib) > TOLERANCE) {
  console.error(`README-WEB-FOLDER-SIZE: FAIL: the README says ${saidFiles} files, ${saidMib} MiB; public/dx-maps is ${files} files, ${mib.toFixed(1)} MiB.`)
  console.error(`  Paste into the README row: ${line}`)
  process.exit(1)
}
console.log(`README-WEB-FOLDER-SIZE: PASS: the README says ${saidFiles} files, ${saidMib} MiB; public/dx-maps is ${files} files, ${mib.toFixed(1)} MiB (within ${TOLERANCE * 100}%).`)
