/**
 * trapDialog.js — make a Wall dialog a real dialog for the keyboard: focus moves into it, Tab stays
 * inside it, Escape closes it, and focus returns to where it was when it closes. Listens on the dialog
 * itself (never on document or window), so releasing it leaves nothing behind.
 *
 *   const release = trapDialog(containerEl, onClose)   …   release()
 */
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function trapDialog(container, onClose) {
  if (!container) return () => {}
  const root = container.getRootNode ? container.getRootNode() : document
  // The opener: the element that had focus, or (a click on a non-focusable surface leaves <body>)
  // the wall's canvas, so focus has somewhere sensible to come back to.
  let prev = root.activeElement || document.activeElement
  if (!prev || prev === document.body) prev = (root.querySelector && root.querySelector('canvas.wall-canvas-el')) || prev
  const focusables = () => [...container.querySelectorAll(FOCUSABLE)]
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const f = focusables()
    if (!f.length) { e.preventDefault(); return }
    const active = root.activeElement
    if (e.shiftKey && active === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && active === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  }
  container.addEventListener('keydown', onKey)
  ;(focusables()[0] || container).focus()
  return () => {
    container.removeEventListener('keydown', onKey)
    try { prev && prev.focus && prev.focus() } catch (_) { /* the opener is gone */ }
  }
}
