#!/usr/bin/env node
/* check-regions-uses-library.mjs — `bun run check:regions-uses-library`. Source-only, headless.
 *
 * THE POINT, and the reason this check exists rather than a note: the negotiating position with the
 * DX-life author is that cloning their /regions page into this bundler MADE ITS COMPONENTS REUSABLE
 * for every future map plugin. That is a load-bearing assumption, and it can be proven wrong by opening
 * the private plugin folder for the Regions plugin and finding the components are not reusable after all.
 *
 * So this asserts the thing that can be checked by opening the folder: the regions plugin must USE the
 * shared components, and must NOT hold its own copy of what it uses. A claim about reusability that
 * only a human can audit is a claim that rots; this one fails on the day someone re-inlines a copy.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
let fails = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fails++ }
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

// area, library file, the plugin file that must consume it, the classes the library file now owns.
// `css` names the file(s) allowed to carry those rules -- normally the component itself, but a rule set
// two components share (the card surface) legitimately lives in one module both of them call.
const EXTRACTED = [
  {
    lib: 'library/components/regions/RegionSectionCard.vue',
    consumer: 'plugin-designs/regions-dashboard/regions-list.vue',
    tag: 'RegionSectionCard',
    owns: ['region-card', 'countries-grid', 'country-link'],
  },
  // ── REGLIB batch 2: the banners/cards that report prayer progress ──────────────────────────────
  {
    lib: 'library/components/regions/StatCard.vue',
    consumer: 'plugin-designs/regions-dashboard/region-dashboards.vue',
    tag: 'StatCard',
    owns: ['rd-stat'],
  },
  {
    lib: 'library/components/regions/GoalCard.vue',
    consumer: 'plugin-designs/regions-dashboard/region-dashboards.vue',
    tag: 'GoalCard',
    owns: ['rd-goal-card', 'rd-big', 'rd-goal'],
  },
  {
    lib: 'library/components/charts/ProgressBar.vue',
    consumer: 'plugin-designs/regions-dashboard/region-dashboards.vue',
    tag: 'ProgressBar',
    owns: ['rd-bar', 'rd-seg', 'rd-legend', 'rd-key'],
  },
]

for (const e of EXTRACTED) {
  const name = e.lib.split('/').pop()
  const dir = e.lib.split('/').slice(-2, -1)[0]
  ok(existsSync(resolve(ROOT, e.lib)), `${name} exists in library/`)
  const plugin = read(e.consumer)
  ok(plugin.includes(`@map/components/${dir}/${name}`), `${name}: the plugin IMPORTS it from @map/, not a local path`)
  ok(new RegExp(`<${e.tag}[\\s>]`).test(plugin), `and actually RENDERS <${e.tag}>`)

  // the half that makes it real: the plugin must no longer own what it delegated.
  const tpl = plugin.slice(plugin.indexOf('<template>'))
  for (const cls of e.owns) {
    ok(!new RegExp(`class="[^"]*\\b${cls}\\b`).test(tpl),
      `the plugin's own template no longer uses .${cls} — the library component owns that markup`)
    ok(!new RegExp(`'\\.${cls}[{ ]`).test(plugin),
      `and no longer ships CSS for .${cls} — one copy, in the library component`)
  }
  // ...and the library component must actually carry the design, or "reusable" means markup only.
  const lib = read(e.lib)
  for (const cls of e.owns) {
    ok(new RegExp(`'\\.${cls}[{ ]`).test(lib), `${name} DOES carry .${cls} styling, so a consumer gets the look`)
  }
}

// ── the card surface: ONE rule set, two components, one injected copy ───────────────────────────
// StatCard and GoalCard both need .rd-card. A copy in each is the shape that drifts, so it lives in a
// composable they both call, dedup'd on a stable label. This asserts that arrangement rather than
// trusting it: the module carries the rules, both cards call it, and the plugin has neither.
{
  const SURFACE = 'library/composables/useCardSurface.js'
  ok(existsSync(resolve(ROOT, SURFACE)), 'useCardSurface.js exists')
  const surface = read(SURFACE)
  for (const cls of ['rd-card', 'rd-card--small', 'rd-card--secondary']) {
    ok(new RegExp(`'\\.${cls}[{ ]`).test(surface), `the shared surface carries .${cls}`)
  }
  ok(/useShadowStyles\(CARD_SURFACE_CSS, 'dxlife-card-surface'\)/.test(surface),
    'and injects it under a STABLE label, so N calling components still put exactly one <style> in the root')
  for (const f of ['library/components/regions/StatCard.vue', 'library/components/regions/GoalCard.vue']) {
    ok(/useCardSurface\(\)/.test(read(f)), `${f.split('/').pop()} calls useCardSurface()`)
  }
  const dash = read('plugin-designs/regions-dashboard/region-dashboards.vue')
  ok(!/'\.rd-card[{ -]/.test(dash), 'the plugin ships NO .rd-card CSS of its own any more')
  ok(!/class="[^"]*\brd-card\b/.test(dash.slice(dash.indexOf('<template>'))),
    'and renders no .rd-card markup of its own -- all four cards are library components')
}

// ── the ONE substitution in the port, asserted rather than described ────────────────────────────
// A segment's colour moved from three prayer-specific classes (.rd-seg--full/--partial/--none) to a
// prop. That is only faithful if the VALUES are unchanged, so: the classes are gone tree-wide, and the
// consumer passes the very tokens they used to set.
{
  const bar = read('library/components/charts/ProgressBar.vue')
  const dash = read('plugin-designs/regions-dashboard/region-dashboards.vue')
  for (const dead of ['rd-seg--full', 'rd-seg--partial', 'rd-seg--none', 'rd-key--full', 'rd-key--partial', 'rd-key--none']) {
    ok(!new RegExp(`'\\.${dead}[{ ]`).test(bar) && !new RegExp(`'\\.${dead}[{ ]`).test(dash),
      `.${dead} is DELETED, not left behind unreachable`)
  }
  for (const token of ['var(--dx-accent)', 'var(--dx-partial)', 'var(--dx-track)']) {
    ok(dash.includes(`color: '${token}'`), `the consumer still passes ${token} -- the colour is unchanged, only its mechanism moved`)
  }
  ok(/segments: \{ type: Array/.test(bar), 'ProgressBar takes segments as a prop, so it needs no vocabulary about prayer')
  ok(/prefers-reduced-motion/.test(bar),
    'and carries its own reduced-motion guard -- the plugin\'s reset is scoped to .rd-root and would not follow it to another consumer')
}

// NEG CONTROLS: each assertion must be able to fail.
ok(/class="[^"]*\brl-root\b/.test(read('plugin-designs/regions-dashboard/regions-list.vue')),
  'NEG CONTROL: the plugin still uses its OWN classes (.rl-root), so the "no longer uses" checks above are not vacuously true')
ok(!/RegionSectionCard/.test(read('plugin-designs/regions-dashboard/region-dashboards.vue')),
  'CONTROL: the OTHER tab does not use the card yet — this check is about what is extracted, not a wish')

console.log(fails ? `\nREGIONS-USES-LIBRARY: ${fails} FAIL(s)` : '\nREGIONS-USES-LIBRARY: the plugin consumes the shared component and keeps no copy of it')
process.exit(fails ? 1 : 0)
