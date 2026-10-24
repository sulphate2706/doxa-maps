# layouts/ — app wrappers

Each folder here is an **app wrapper**: a host shell that composes doxa-maps plugin-designs (the
independently-built custom elements) into one application.

```
  layouts/<wrapper>/          ← the HOST page (not a bundle)
  ┌──────────┬──────────────────────────────┐
  │ sidebar  │  mounts an app-profile here    │
  │ (nav.js) │  ┌──────────────┐              │
  │  ├ item  │  │ <doxa-map>    │  ← a         │
  │  ├ section│ │  (a bundle)   │    micro-    │
  │  └ folder │ └──────────────┘    frontend  │
  └──────────┴──────────────────────────────┘
```

- **app-profile** = a self-contained custom element (the micro-frontend). **app wrapper** = the host
  that mounts them and provides nav/chrome. A wrapper is a host page, not a bundle-in-a-bundle.
- Wrappers today: `app-wrapper-material/`, `pane-wrapper/`.
- Icons are inline SVG only (no CDN) — an F-Droid/offline hard requirement.

**Sidebar contract, target filtering, sidebar modes, staging:**
**[../documentation/architecture/app-wrappers.md](../../documentation/architecture/app-wrappers.md)**.
