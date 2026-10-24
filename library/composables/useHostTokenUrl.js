/**
 * useHostTokenUrl.js — a composite honours `tokenUrl` the way ProfileLoader does.
 *
 * THE DEFECT (PM-tok, PRODUCTION-MATRIX.md:285). `tokenUrl` is a token SERVICE a host names in its
 * profile-config instead of pasting a key: the element asks that URL when it was handed no token. Only
 * ProfileLoader ever read it. A pane composite bakes its children in rather than mounting them through
 * ProfileLoader, so a composite embedded BARE — the whole point of a composite, one tag on a partner's
 * page — dropped a tokenUrl-only config on the floor. With an outer ProfileLoader on the page it worked,
 * because THAT fetched and published the token; the composite was passing an exam somebody else sat.
 *
 * ★ THE FAILURE IS TOKENLESS MAPBOX, WHICH LOOKS LIKE A DIFFERENT BUG. No token means "No Mapbox access
 * token provided", 0 tiles and no canvas — the same symptom as a missing `tk`, which IS threaded, so the
 * obvious reading is that the host mis-typed their config rather than that a knob is unread.
 *
 * ★ AND IT LIVES HERE RATHER THAN IN EACH COMPOSITE because there are two composites today and the rule
 * has already been copied once (ProfileLoader.vue:132). A third and fourth copy of "ask only when no
 * token is at hand" is how one of them later learns to ask always, and a token service billed per call
 * notices that before we do.
 */
import { computed, watch } from 'vue'
import { useSharedMapToken, fetchMapToken } from './useSharedMapToken.js'
import { shouldFetchTokenUrl, readHostTokenUrl } from './host-token-url.js'

export { shouldFetchTokenUrl, readHostTokenUrl }

/**
 * Wire a composite's host config to the shared token service.
 * @param {import('vue').Ref} hostConfig parsed profile-config of the COMPOSITE
 * @param {import('vue').Ref} hostToken  the host's own `tk`, which always wins
 * @returns {import('vue').ComputedRef<string>} the tokenUrl, to forward into children's profile-config
 */
export function useHostTokenUrl(hostConfig, hostToken) {
  const sharedToken = useSharedMapToken()
  const tokenUrl = computed(() => readHostTokenUrl(hostConfig?.value))
  // immediate, because a host that set tokenUrl before mount is the ordinary case, not the edge one.
  watch(tokenUrl, (url) => {
    if (shouldFetchTokenUrl({ tokenUrl: url, token: hostToken?.value || '', sharedToken: sharedToken.value })) {
      fetchMapToken(url)
    }
  }, { immediate: true })
  return tokenUrl
}

export default useHostTokenUrl
