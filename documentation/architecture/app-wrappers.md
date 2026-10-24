# Architecture — app wrappers

> The simple overview is in `library/layouts/README.md`. This is the full contract for building and
> wiring an app wrapper.

Each folder in `library/layouts/` is an **app wrapper**: a host shell that composes doxa-maps plugin-designs
(the independently-built custom elements) into one application.

## Terminology (deliberate — don't drift)

| Thing | What it is |
|---|---|
| **app-profile** | An independently-built, self-contained custom element (a map, a dashboard, a list). **These are the micro-frontends.** |
| **app wrapper** (this folder) | The **host/shell** that mounts plugin-designs, provides nav/chrome/routing, and bounds resources. Not itself a micro-frontend — it's the container. |

A wrapper is a *host page*, **not** a regular app-profile. Keeping it a host (rather than a bundle
nested inside a bundle) avoids the relative-path/base-URL resolution problem that nesting one
position-independent bundle inside another would create.

## Wrappers today

- **`app-wrapper-material/`** — Material-styled wrapper. Structure/behaviour modelled on the
  Quasar YouTube layout gallery; conventional theming + nav model (`--ui-*` CSS custom properties,
  a `SidebarNavItem`-shaped tree). Two-mode sidebar, self-hosted icons.
- **`pane-wrapper/`** — a second wrapper beside it.

## The sidebar contract (`nav.js`)

`NAV` is an ordered list. Order = render order, top to bottom. Three `kind`s:

- `item` — a single entry. At top level these are **loose items in no group**.
- `section` — an **always-open** labelled group with an icon + name (the YouTube "guide" look).
- `folder` — a **collapsible** group (`open: false` by default).

Every entry carries **`target: 'both' | 'desktop' | 'mobile'`**.

`navForTarget(NAV, target)` filters the tree, and is used by **both**:
1. the **UI** — hides non-matching entries, and
2. the **packager** — the mobile/Capacitor build copies fewer bundles into `webDir`.

That's why a `Desktop only` folder both disappears on phones *and* is excluded from the app binary.

## Sidebar modes (intentionally different per platform)

|  | Collapsed | Expanded |
|---|---|---|
| **Desktop** (≥1024px) | icon **rail** stays visible (labels hidden) | full width: icons + labels + section headers |
| **Mobile** (<1024px) | **completely hidden** (saves space) | overlay drawer + scrim; choosing a profile closes it |

## Icons (`icons.js`)

`icons.js` ships **inline SVG** — no CDN, no icon font, no Google/YouTube request. This is a hard
requirement, not a preference: **F-Droid builds from source and rejects proprietary blobs / non-free
CDN dependencies**, and local icons also mean the wrapper works offline and inside Capacitor from
local assets. Paths follow the Lucide idiom (24×24, 2px stroke, round caps).

## Local staging

```bash
cd library/layouts/app-wrapper-material
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open it and narrow the window below 1024px (or use the browser device toolbar) to check the
mobile behaviour.

## The `PROFILES` registry (the wrapper's map catalog)

Beside `nav.js`, the wrapper's `index.html` declares `PROFILES` — one entry per mountable map:

```js
const PROFILES = {
  'prayer-progress': {
    tag: 'doxa-map',                                      // the element to mount (a bundle may register several)
    src: './doxa-maps/doxa-simple-map/doxa-simple-map.js', // the bundle IIFE, tree-relative
    views: ['map'],                                        // which sub-views (map/list/tree) this profile offers
    // + the profile-config the wrapper passes (copied from the generated instance page's BASE_CONFIG)
  },
}
```

`nav.js` ids route to `PROFILES` keys; the wrapper lazy-loads `src` on first visit and mounts
`tag`. Gotchas: an instance page's tag may differ from the bundle name (`doxa-simple-map`
registers `<doxa-map>` too), and `colorStrategy` values are registry keys derived from
FILENAMES (`prayer-progress.js` → `'prayerProgress'`).

## How a wrapper becomes the served SPA

`bun run shell` (`internal/install-shell.mjs`) **copies** `library/layouts/<wrapper>/` to the root of
`public/`, so `public/index.html` is the shell and `public/doxa-maps/…` are the bundles it
mounts — one served tree, two roles. Copy (not symlink) keeps Railway/Capacitor/file:// happy;
`--no-token` omits the local-only `token.local.js` (mandatory for release builds). Capacitor
also *requires* this root `index.html` (`cap copy` hard-fails without it).
