/**
 * host-token-url.js — the `tokenUrl` rule, with NO framework import, so a gate can run it.
 *
 * Split out of useHostTokenUrl.js deliberately. The composable needs vue's computed/watch; a headless
 * gate has no node_modules in a fresh worktree, so a module that imports vue is unloadable by the test
 * that proves it right. Same shape as library/packets/describeGroup.js keeping countryName injectable:
 * the DECISION lives where it can be executed, the WIRING lives where it needs a framework.
 */

/**
 * Ask the token service ONLY when nothing else supplied a token.
 * Mirrors ProfileLoader.vue:133 — `url && !tk && !shared` — because a composite must behave the way the
 * loader it replaces behaves, and because a service billed per call should be asked once, not always.
 */
export function shouldFetchTokenUrl({ tokenUrl = '', token = '', sharedToken = '' } = {}) {
  return Boolean(tokenUrl) && !token && !sharedToken
}

/** The `tokenUrl` a host actually wrote, or ''. A non-string is not a URL and is not passed on. */
export function readHostTokenUrl(cfg) {
  const u = cfg && cfg.tokenUrl
  return typeof u === 'string' && u ? u : ''
}
