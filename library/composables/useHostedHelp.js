/**
 * useHostedHelp — a map's "?" that its HOST answers.
 *
 * A map embedded in the Doxa Maps app (doxa-maps-spa) does not carry its own explainer: the app
 * holds the what/how text for every Experimental map. So the map's "?" does not open anything
 * itself. It dispatches `doxa:help`, bubbling and COMPOSED, which crosses every shadow root between
 * the button and the page, and the app answers with that map's text.
 *
 * WHERE THE BUTTON SHOWS. Only under a host that answers: an ancestor, across shadow roots, carrying
 * `data-doxa-help` (the app sets it on the pane of every tab that has text). The same bundle
 * embedded on a partner page has no such ancestor, so it shows no "?" rather than a dead one.
 *
 * Two callers: the library HelpButton (a map control) and the few maps whose "?" belongs in their
 * own bar instead (the Wall, the vision card). One mechanism, so the two cannot drift apart.
 *
 *   const { hosted, askForHelp } = useHostedHelp()
 *   <button v-if="hosted" @click="askForHelp($event.currentTarget)">?</button>
 */
import { getCurrentInstance, onMounted, ref } from 'vue'

/** Is `node` inside a host that answers doxa:help? Walks up, stepping out of each shadow root. */
export function underHelpHost(node) {
  for (let n = node; n; n = n.parentNode || n.host) {
    if (n.nodeType === 1 && n.hasAttribute('data-doxa-help')) return true
  }
  return false
}

/** Ask the host for this map's help, from `el` (the button, so the host can return focus to it). */
export function askForHelp(el) {
  if (el && el.dispatchEvent) el.dispatchEvent(new CustomEvent('doxa:help', { bubbles: true, composed: true }))
}

export function useHostedHelp() {
  const self = getCurrentInstance()
  const hosted = ref(false)
  // Mounted means connected: a custom element mounts from connectedCallback, so the chain up to the
  // host's pane is already in place. $el may be a comment or fragment anchor; it is in the tree too.
  onMounted(() => { hosted.value = underHelpHost(self && self.proxy && self.proxy.$el) })
  return { hosted, askForHelp: (el) => askForHelp(el || (self && self.proxy && self.proxy.$el)) }
}
