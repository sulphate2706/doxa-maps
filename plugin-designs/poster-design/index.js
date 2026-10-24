/**
 * plugin-designs/poster-design/index.js: the Poster Design bundle entry.
 *
 * One tag, <poster-design>, and three profiles in this folder:
 *   poster-design-mfe  the two-tab element (Styles + Sizes), the one a gallery mounts;
 *   poster-styles      every poster template, one card per configuration;
 *   poster-sizes       every poster size.
 *
 *   <script src="…/poster-design/poster-design.js"></script>
 *   <poster-design profile-config='{"profile":"poster-design-mfe"}'></poster-design>
 */
import { defineMapElement } from '@map/elements/defineMapElement.js'

// Flat: './*.vue' finds the profiles beside this file (src/ holds private components, not profiles).
const profileModules = import.meta.glob('./*.vue')

const PosterDesignElement = defineMapElement({ profileModules })

if (typeof customElements !== 'undefined' && !customElements.get('poster-design')) {
  customElements.define('poster-design', PosterDesignElement)
}

export default PosterDesignElement
