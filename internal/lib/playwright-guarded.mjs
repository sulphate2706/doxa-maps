/**
 * internal/lib/playwright-guarded.mjs — the ONE way a repo gate reaches Playwright.
 *
 * Only the browser seat runs browsers, and only inside the shared slot (internal/browser-slot.sh, a
 * memory-floored semaphore). That rule used to be remembered, not enforced: an agent ran a gate it took
 * for a headless source check and it launched Chromium outside the slot. Every browser launch now goes
 * through this module, and launch()/launchPersistentContext()/launchServer()/connect()/connectOverCDP()
 * refuse unless browser-slot.sh has EXPORTED DOXA_BROWSER_SLOT (exported, so a `bash -c "…"` grandchild
 * inherits it). Refusal is exit 75, NOT MEASURED, never a failure and never a pass.
 * check:browser-gates-guarded fails any repo file that imports playwright directly instead.
 */
import * as pw from 'playwright'

export const NOT_MEASURED = 75

export function requireBrowserSlot(who = process.argv[1] || 'this gate') {
  if (process.env.DOXA_BROWSER_SLOT) return
  console.error(`${who}: this gate launches a browser. Browsers run only on the browser seat, inside the slot:\n` +
    '  internal/browser-slot.sh bun run <script>     (it exports DOXA_BROWSER_SLOT)\n' +
    'NOT MEASURED (exit 75).')
  process.exit(NOT_MEASURED)
}

const LAUNCHERS = new Set(['launch', 'launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP'])
function guarded(browserType) {
  return new Proxy(browserType, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target)
      if (typeof v !== 'function') return v
      if (LAUNCHERS.has(prop)) return (...args) => { requireBrowserSlot(); return v.apply(target, args) }
      return v.bind(target)
    },
  })
}

export const chromium = guarded(pw.chromium)
export const firefox = guarded(pw.firefox)
export const webkit = guarded(pw.webkit)
export const devices = pw.devices
export const errors = pw.errors
export default { chromium, firefox, webkit, devices, errors }
