/**
 * check-instance-config-keys.mjs — a preset's profile-config keys must be keys the profile READS.
 *
 * ★ THE DEFECT (RQ20): people-groups-grid's "driven" preset declares "show-search":"false" and
 * "show-filters":"false", and the page renders the search box and the filters bar anyway. Nothing
 * errored — 0 console errors — because nothing was wrong at runtime. The key simply never reached
 * the component:
 *
 *   · the preset writes KEBAB ("show-search") into profile-config
 *   · ProfileLoader PROVIDES that object; it does not bind its keys as props
 *   · the profile reads props.showSearch (CAMEL), which therefore keeps its default of true
 *
 * A preset key nobody reads is indistinguishable from a working one by looking at the preset, which
 * is why this is a gate and not a comment. It is the same shape as the @element defect: an
 * annotation a build copies into a machine-read artifact is an INTERFACE, and a build that accepts
 * prose there is missing a validator.
 *
 * WHAT IT CHECKS, per preset key: either the profile declares a prop of that name, or it reads the
 * key off the injected config (cfg.key / cfg['key']). Generator-owned and transport keys are exempt
 * — they are consumed by ProfileLoader and the page, not by the profile.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../plugin-designs/', import.meta.url).pathname

// Consumed by ProfileLoader / the generated page itself, never by a profile component.
const TRANSPORT = new Set([
  'profile', 'instanceId', 'dataSource', 'assetsBase', 'colorSet', 'tk', 'token',
  'apiBaseUrl', 'locale', 'lang', 'provider', 'mapProvider',
])

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const fail = []
let checkedPresets = 0
let checkedKeys = 0

for (const bundle of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_'))) {
  const dir = join(ROOT, bundle.name)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.instances.json'))) {
    let doc
    try { doc = JSON.parse(readFileSync(join(dir, file), 'utf8')) } catch { continue }
    const profileName = doc.profile || file.replace('.instances.json', '')
    const vue = join(dir, `${profileName}.vue`)
    if (!existsSync(vue)) continue
    const src = readFileSync(vue, 'utf8')

    for (const inst of doc.instances || []) {
      checkedPresets++
      for (const rawKey of Object.keys(inst.props || {})) {
        if (TRANSPORT.has(rawKey)) continue
        checkedKeys++
        const asCamel = camel(rawKey)
        // A prop declaration, in either spelling…
        const declaresProp = new RegExp(`\\b${asCamel}\\s*:\\s*\\{`).test(src)
        // …or the profile reads the key off the injected config under ANY local name for it.
        // ★ THE FIRST VERSION OF THIS LINE LOOKED ONLY FOR `cfg.` AND REPORTED NINE FALSE POSITIVES
        // across four plugins: big-picture reads config.value.accent, doxa-simple-map reads
        // profileConfig?.value?.tabs. The config object's VARIABLE NAME is the profile's own
        // business, so matching on it was measuring my own naming habit rather than the contract.
        // What matters is that the key is read off SOMETHING, so the accessor is what gets matched.
        // ★ AND `props.` MUST NOT COUNT. Widening it to "any accessor" then matched
        // `props.showSearch` — the exact line that DOES NOT work — and the gate went green on the
        // defect it was written for. A prop read is the broken path: ProfileLoader provides the
        // config, it never binds its keys as props. So the accessor is matched everywhere EXCEPT
        // off `props`, which is the one object that cannot carry a profile-config key.
        const accessor = new RegExp(
          `(?<!\\bprops)(?:\\.value)?\\??\\.${asCamel}\\b|\\[['\"]${rawKey}['\"]\\]|\\[['\"]${asCamel}['\"]\\]`
        )
        // A key may also be read INDIRECTLY — resolved through a helper that is handed both
        // spellings as arguments, which is how the RQ20 fix reads them. A literal occurrence of the
        // kebab key anywhere OUTSIDE a props access counts: it cannot get into the file by accident.
        const masked = src.replace(/\bprops\.(\w+)/g, 'PROPSREAD_$1')
        const readsFromCfg = accessor.test(masked) || masked.includes(`'${rawKey}'`) || masked.includes(`"${rawKey}"`)
        if (!declaresProp && !readsFromCfg) {
          fail.push(`${bundle.name}/${inst.id}: "${rawKey}" — ${profileName}.vue declares no ${asCamel} prop and never reads it off the config`)
        } else if (rawKey !== asCamel && declaresProp && !readsFromCfg) {
          // THE RQ20 CASE: the prop exists in camel, the preset writes kebab, and nothing bridges
          // them — ProfileLoader provides the config, it does not bind keys as props.
          fail.push(`${bundle.name}/${inst.id}: "${rawKey}" is KEBAB but ${profileName}.vue reads props.${asCamel}; profile-config keys are not bound as props, so this preset key does nothing`)
        }
      }
    }
  }
}

if (fail.length) {
  console.error('INSTANCE-CONFIG-KEYS: FAIL — a preset declares a key its profile never reads.')
  for (const f of fail) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`INSTANCE-CONFIG-KEYS: PASS — ${checkedKeys} key(s) across ${checkedPresets} preset(s) reach the profile that renders them.`)
