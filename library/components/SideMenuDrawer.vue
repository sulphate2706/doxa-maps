<!--
  SideMenuDrawer.vue — Slide-in side panel for the map application.

  Overlaps only the map area (stays inside the custom element boundary),
  so the staging environment's header and footer are never covered.

  Layout:
  • Drawer: 75% of the map width, slides in from the left
  • Right 1/4: map remains visible and interactive
  • No dimming backdrop — transparent click-catcher closes the drawer
    when the user taps/clicks the exposed right-side map area

  Props:
    isOpen — controls visibility and slide animation
    isDark — mirrors the app theme

  Emits:
    close       — fired when X button or outside area is clicked
    reload-map  — fired when the bottom "Reload map" button is clicked

  Slot (default):
    Content area of the drawer — empty placeholder, populated by the
    consuming app. Add navigation, filters, settings panels etc.
-->
<script setup>
import { useI18n } from 'vue-i18n'
import { useShadowStyles } from '../composables/useShadowStyles.js'

const { t } = useI18n()

useShadowStyles(`
/* ── Click-catcher — invisible, covers full map area when drawer is open ── */
.smd-catcher {
  position: absolute;
  inset: 0;
  z-index: 1050;
  background: transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.28s ease;
}
.smd-catcher.open {
  pointer-events: all;
  opacity: 1;
}

/* ── Drawer panel ── */
.smd-drawer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 75%;
  max-width: 420px;
  z-index: 1051;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  background: #fff;
  box-shadow: 2px 0 16px rgba(0,0,0,0.12);
  pointer-events: all;
}
.smd-drawer.open {
  transform: translateX(0);
}

/* Dark mode */
.smd-drawer.dark {
  background: #3b463d;
  box-shadow: 2px 0 20px rgba(0,0,0,0.5);
  border-right: 1px solid rgba(255,255,255,0.10);
}

/* ── Drawer header bar ── */
.smd-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 12px 0;
  flex-shrink: 0;
  height: 52px;
}

/* ── Close (X) button ── */
.smd-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.06);
  color: #333;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  flex-shrink: 0;
}
.smd-close:hover { background: rgba(0,0,0,0.12); }
.smd-drawer.dark .smd-close {
  background: rgba(255,255,255,0.10);
  color: #fff;
}
.smd-drawer.dark .smd-close:hover { background: rgba(255,255,255,0.18); }

/* ── Scrollable content area ── */
.smd-content {
  flex: 1 1 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
  color: #333;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.smd-drawer.dark .smd-content { color: #e0e0e0; }

/* ── Empty state placeholder ── */
.smd-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  opacity: 0.35;
  user-select: none;
}
.smd-placeholder-icon { font-size: 36px; }
.smd-placeholder-text { font-size: 13px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }

/* ── Reload map button ── */
.smd-footer {
  flex-shrink: 0;
  padding: 12px 20px 20px;
  border-top: 1px solid rgba(0,0,0,0.07);
}
.smd-drawer.dark .smd-footer { border-top-color: rgba(255,255,255,0.08); }
.smd-reload-btn {
  width: 100%;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.12);
  background: rgba(0,0,0,0.04);
  color: #555;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.15s, color 0.15s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.smd-reload-btn:hover { background: rgba(0,0,0,0.09); color: #222; }
.smd-drawer.dark .smd-reload-btn { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: #ccc; }
.smd-drawer.dark .smd-reload-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }

/* ★ REDUCED MOTION, OWNED BY THIS COMPONENT. A page-level rule cannot reach into a shadow root,
   and no generated leaf ships one anyway (measured: 0 across the whole tree), so a component
   that animates must carry its own. Additive only: it removes motion when the OS asks and
   changes nothing otherwise. */
@media (prefers-reduced-motion: reduce) {
  .smd-drawer, .smd-backdrop, .smd-item { transition: none !important; animation: none !important; }
}
`, 'side-menu-drawer')

defineProps({
  isOpen: { type: Boolean, default: false },
  isDark: { type: Boolean, default: false }
})

defineEmits(['close', 'reload-map'])
</script>

<template>
  <!-- Invisible click-catcher covers map area; clicking it closes the drawer -->
  <div class="smd-catcher" :class="{ open: isOpen }" @click="$emit('close')" />

  <!-- Drawer panel — slides in from left, stops propagation so catcher isn't triggered inside it -->
  <div
    class="smd-drawer"
    :class="{ open: isOpen, dark: isDark }"
    @click.stop
  >
    <div class="smd-header">
      <button class="smd-close" :title="t('buttons.closeMenu')" @click="$emit('close')">×</button>
    </div>

    <div class="smd-content">
      <!-- Default slot: add navigation links, filters, settings panels, etc. -->
      <slot>
        <!-- Placeholder shown until slot content is provided -->
        <div class="smd-placeholder">
          <span class="smd-placeholder-icon">☰</span>
          <span class="smd-placeholder-text">{{ t('messages.menuComingSoon') }}</span>
        </div>
      </slot>
    </div>

    <!-- Reload map button — always at the bottom of the drawer -->
    <div class="smd-footer">
      <button class="smd-reload-btn" @click="$emit('reload-map')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        {{ t('buttons.reloadMap') }}
      </button>
    </div>
  </div>
</template>
