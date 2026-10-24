// <dxm-poster-section>'s attributes → its profile-config. Pure (no Vue), so it is testable on its own.
export const ATTRS = ['type', 'scope', 'collapsible', 'collapsed', 'locale', 'assets-base', 'api-base-url', 'is-dark', 'columns', 'min-card-px', 'show-header', 'card-action']
export const TAG = 'dxm-poster-section'

export function posterSectionConfig(el) {
  const a = (n) => el.getAttribute(n)
  const flag = (n, dflt) => (el.hasAttribute(n) ? a(n) !== 'false' : dflt)
  const cfg = { type: a('type') || 'country', scope: a('scope') || '', collapsible: flag('collapsible', true), collapsed: flag('collapsed', false), isDark: flag('is-dark', false) }
  if (a('locale')) cfg.locale = a('locale')
  if (a('assets-base')) cfg.assetsBase = a('assets-base')
  if (a('api-base-url')) cfg.apiBaseUrl = a('api-base-url')
  // posters per row (1-5); absent = the wall's own default. A reader's saved choice still wins (PosterWall).
  const cols = Number(a('columns'))
  if (el.hasAttribute('columns') && Number.isInteger(cols) && cols >= 1 && cols <= 5) cfg.columns = cols
  // the narrowest a card may get before a row holds one fewer (PosterWall's minCardPx); absent = the wall's own default.
  // A host that wants two posters a row on a phone sets it low enough to fit (the Regions list: 150).
  const minCard = Number(a('min-card-px'))
  if (el.hasAttribute('min-card-px') && Number.isInteger(minCard) && minCard >= 80 && minCard <= 600) cfg.minCardPx = minCard
  // show-header="false": no section head, so the HOST's own layout is the header (a key only then: every other host's
  // config is unchanged). The head is also the collapse toggle, so a headless section never collapses (PosterSectionView).
  if (flag('show-header', true) === false) cfg.showHeader = false
  // card-action="dashboard": each card's sticker reads "Show dashboard" and asks the HOST to open its own page
  // (PosterSectionView dispatches dxm-poster-dashboard). Only a known value sets a key; absent = "Show on map".
  if (a('card-action') === 'dashboard') cfg.cardAction = 'dashboard'
  return cfg
}

