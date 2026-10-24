#!/usr/bin/env node
/**
 * check-preset-config-merge — a preset page keeps its profile's defaults. Headless.
 *
 * A preset (<bundle>/<profile>/<instance>/index.html) bakes a config made of the profile's
 * <profile>.meta.json `config` with the instance's `props` MERGED over it. It used to REPLACE it: the
 * upg-neighbor presets lost the profile's pinHint:false. For every built preset page this asserts each
 * meta `config` key is present, with the instance's own value where the instance sets one.
 * Rule stated in documentation/PRESET-PLUGIN-STANDARD.md.
 * EXIT 0 pass · 1 fail · 0 with SKIP when there is no built tree
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_NAME } from './_tree-name.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TREE = join(ROOT, 'public', TREE_NAME)
if (!existsSync(TREE)) { console.log('PRESET-CONFIG-MERGE: SKIP — no built tree'); process.exit(0) }

const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
let pages = 0, bad = 0
for (const bundle of readdirSync(join(ROOT, 'plugin-designs'))) {
  const dir = join(ROOT, 'plugin-designs', bundle)
  if (!statSync(dir).isDirectory()) continue
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.instances.json'))) {
    const raw = json(join(dir, f))
    const list = Array.isArray(raw) ? raw : (raw && raw.instances) || []
    for (const inst of list) {
      const profile = inst.profile || f.replace(/\.instances\.json$/, '')
      const cfg = (json(join(dir, `${profile}.meta.json`)) || {}).config || {}
      const id = inst.id || inst.key || inst.name
      const page = join(TREE, bundle, profile, String(id), 'index.html')
      if (!id || !existsSync(page) || !Object.keys(cfg).length) continue
      pages++
      const m = readFileSync(page, 'utf8').match(/var BASE_CONFIG = (\{.*?\});?\n/)
      const baked = m ? JSON.parse(m[1]) : {}
      const props = inst.props || {}
      for (const [k, v] of Object.entries(cfg)) {
        const want = k in props ? props[k] : v
        if (JSON.stringify(baked[k]) !== JSON.stringify(want)) {
          bad++
          console.log(`  FAIL  ${bundle}/${profile}/${id}: "${k}" is ${JSON.stringify(baked[k])}, want ${JSON.stringify(want)} (${k in props ? 'the instance' : 'the profile meta'})`)
        }
      }
    }
  }
}
if (bad) { console.log(`PRESET-CONFIG-MERGE: FAIL — ${bad} key(s) lost on ${pages} preset page(s) with profile defaults. Rebuild the tree (bun run tree).`); process.exit(1) }
console.log(`PRESET-CONFIG-MERGE: PASS — ${pages} preset page(s) with profile defaults keep every one, instance values winning.`)
