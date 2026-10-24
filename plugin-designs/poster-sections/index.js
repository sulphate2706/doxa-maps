import { defineMapElement } from '@map/elements/defineMapElement.js'
import { registerPosterSectionElement } from '@map/elements/posterSectionElement.js'
/**
 * plugin-designs/poster-sections/index.js
 *
 * Bundle entry. Registers TWO tags:
 *   - <poster-sections>      the Poster Sections page: a panel of choices over the live sections, plus the tag to copy
 *   - <dxm-poster-section>   the library's poster section element itself, so a website that loads ONLY this script
 *                            can place the tags the page hands out:
 *
 *   <script src="…/dx-maps/poster-sections/poster-sections.js"></script>
 *   <dxm-poster-section type="country" scope="africa" locale="ar" columns="3"></dxm-poster-section>
 */
const profileModules = import.meta.glob('./*.vue')

const PosterSectionsElement = defineMapElement({ profileModules })

if (typeof customElements !== 'undefined' && !customElements.get('poster-sections')) {
  customElements.define('poster-sections', PosterSectionsElement)
}

registerPosterSectionElement()

export default PosterSectionsElement
