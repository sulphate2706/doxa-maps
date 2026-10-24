#!/usr/bin/env node
// gen-presets.mjs (bun run gen:poster-sections-presets) — writes poster-sections.instances.json from each poster type's
// OWN regions: "<prefix>-all" plus one preset per scope its adapter's scopes() returns, titled by the type's own
// (English) section title, then "configure". The same source check:poster-sections holds the file to, so when the
// data's regions change, running this is the whole fix. A type whose file is not on the tree gets NO presets: its
// pages could only say "No posters".
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const FILE = join(ROOT, 'plugin-designs/poster-sections/poster-sections.instances.json')
const TYPES = [
  { type: 'country', prefix: 'countries', noun: 'Country posters', file: 'library/components/poster/types/countryPosterType.js' },
  { type: 'upg100-list', prefix: 'upg100', noun: 'UPG100 Posters', file: 'plugin-designs/my-upg-100-list/data/upg100-poster-type.js' },
]
const old = JSON.parse(readFileSync(FILE, 'utf8'))
const { createServer } = await import('vite')
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@map': join(ROOT, 'library') } } })
// English from the real catalogue (library/i18n/locales/en/<area>.json), so a title the type translates reads as the
// site's English; a key the catalogue lacks comes back as itself, which every adapter treats as "use the region name".
const english = (key) => {
  const [area, ...parts] = String(key).split('.')
  const f = join(ROOT, `library/i18n/locales/en/${area}.json`)
  if (!parts.length || !existsSync(f)) return key
  let o = JSON.parse(readFileSync(f, 'utf8'))
  for (const p of parts) { if (!o || typeof o !== 'object' || !(p in o)) return key; o = o[p] }
  return typeof o === 'string' ? o : key
}
const instances = []
try {
  for (const { type, prefix, noun, file } of TYPES) {
    if (!existsSync(join(ROOT, file))) continue
    const a = (await server.ssrLoadModule(join(ROOT, file))).default
    instances.push({ id: `${prefix}-all`, title: `${noun} — all regions`, props: { type, scope: 'all' } })
    for (const scope of a.scopes()) instances.push({ id: `${prefix}-${scope}`, title: `${noun} — ${a.title(scope, english)}`, props: { type, scope } })
  }
} finally { await server.close() }
instances.push({ id: 'configure', title: 'Configure — make a new preset', props: { configure: true } })
writeFileSync(FILE, JSON.stringify({ ...old, instances }, null, 2) + '\n')
const before = new Set(old.instances.map((i) => i.id)), after = new Set(instances.map((i) => i.id))
console.log(`poster-sections presets: ${instances.length} (removed: ${[...before].filter((x) => !after.has(x)).join(', ') || 'none'}; added: ${[...after].filter((x) => !before.has(x)).join(', ') || 'none'})`)
