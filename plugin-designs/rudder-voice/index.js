/**
 * rudder-voice / index.js — Bundle entry (Capability-1 single element, DESKTOP target).
 *
 * <rudder-voice> — private, offline, streaming voice-to-text. The UI is this bundle; the speech model
 * runs in the local backend (backend/rudder-engine), started by `bun run dev` in the Plugin Studio and
 * by Tauri as a sidecar in the desktop app. See rudder-voice.vue for the contract.
 *
 * Desktop-only: rudder-voice.meta.json declares "targets": ["desktop"]. On a plain website there is no
 * local engine, so the element shows "Engine offline" instead of pretending to work.
 *
 * Usage (desktop shell / Plugin Studio):
 *   <rudder-voice profile-config='{"apiBase":"http://127.0.0.1:5193/api/rudder"}'></rudder-voice>
 */
import { defineCustomElement } from 'vue'
import RudderVoice from './rudder-voice.vue'

const RudderVoiceElement = defineCustomElement(RudderVoice)

if (typeof customElements !== 'undefined') {
  if (!customElements.get('rudder-voice')) customElements.define('rudder-voice', RudderVoiceElement)
}

export default RudderVoiceElement
