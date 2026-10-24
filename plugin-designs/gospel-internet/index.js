import { defineMapElement } from '@map/elements/defineMapElement.js'
/**
 * plugin-designs/gospel-internet/index.js — bundle entry for the GOSPEL x INTERNET BOARD.
 *
 * Registers ONE custom-element tag:
 *   <gospel-internet-board profile-config='{"profile":"board"}'></gospel-internet-board>
 *
 * Folder = bundle, each flat .vue = a profile (`profile` is the FILENAME). ProfileLoader lives in @map
 * and cannot glob into a bundle folder, so the bundle hands its registry over via provide.
 *
 * appI18n is PROVIDED (as doxa-simple-map does) so a host's profile-config `lang`/`locale` drives the
 * catalogue, not only ?lang= — two channels a real host uses, and both must reach the strings.
 *
 * The RTL text plugin is installed by the map panel itself (installRtlTextPlugin before `new Map`), on
 * whichever engine resolveMapProvider picked.
 */

const profileModules = import.meta.glob('./*.vue')

function buildBoardElement() {
  return defineMapElement({
  profileModules,
  configureApp: (app, { pinia, i18n }) => {
      // Per-instance Pinia + i18n so two boards on one page never share state.
  },
})
}

const GospelInternetBoard = buildBoardElement()

// Guarded: customElements.define() is one-shot per tag per page.
if (typeof customElements !== 'undefined' && !customElements.get('gospel-internet-board')) {
  customElements.define('gospel-internet-board', GospelInternetBoard)
}

export default GospelInternetBoard
