/**
 * posterSectionElement.js — registers <dxm-poster-section>: ONE poster section, any poster type, as an element.
 *
 *   <dxm-poster-section type="country" scope="africa" locale="ar"></dxm-poster-section>
 *
 * Attributes: type (default "country"), scope (a region / continent / list key), collapsible (default on;
 * collapsible="false" turns it off), collapsed (start shut), locale, assets-base, api-base-url, is-dark, columns
 * (posters per row, 1-5), min-card-px (the narrowest a card gets before a row holds one fewer), show-header (default
 * on; show-header="false" hides the section's head so the host's layout is its header), card-action ("dashboard": each
 * card reads "Show dashboard" and dispatches a bubbling, composed dxm-poster-dashboard { type, id, iso3, name, scope } for
 * the host to open its own page; absent = "Show on map").
 * They are mapped into the standard element's profile-config, so the element keeps defineMapElement's per-instance
 * i18n and store, and the profile (PosterSectionView.vue) reads them like every other profile reads its config.
 * Any bundle can call registerPosterSectionElement(); a second call is a no-op.
 */
import { defineMapElement } from './defineMapElement.js'

import { ATTRS, TAG, posterSectionConfig } from './posterSectionConfig.js'
export { posterSectionConfig }

export function registerPosterSectionElement(tag = TAG) {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  const Base = defineMapElement({ profileModules: { './poster-section.vue': () => import('../components/poster/PosterSectionView.vue') } })
  class PosterSectionElement extends Base {
    connectedCallback() {
      this.syncConfig()
      if (!this.attrWatch) {
        this.attrWatch = new MutationObserver(() => this.syncConfig())
        this.attrWatch.observe(this, { attributes: true, attributeFilter: ATTRS })
      }
      super.connectedCallback()
    }
    disconnectedCallback() {
      if (this.attrWatch) { this.attrWatch.disconnect(); this.attrWatch = null }
      super.disconnectedCallback()
    }
    syncConfig() {
      const next = JSON.stringify(posterSectionConfig(this))
      if (this.getAttribute('profile-config') !== next) this.setAttribute('profile-config', next)
    }
  }
  customElements.define(tag, PosterSectionElement)
}
export default registerPosterSectionElement
