# Architecture — the embeddability design (generated pages + manifest)

> The simple recipes are in [../how-to.md](../how-to.md). This is the design that makes
> **every map embeddable by default**: the build generates a self-contained page per map.

## What `bun run tree` generates

After the per-bundle vite builds, `internal/generate-tree.mjs` writes the served tree:

```
public/doxa-maps/
├── index.html                      ← staging root (semantic tree of every map)
├── manifest.json                   ← machine-readable catalog + ready-made embed snippets
└── <bundle>/
    ├── <bundle>.js                 ← the bundle IIFE (the island)
    ├── index.html                  ← per-bundle staging/showcase page
    ├── <profile>/index.html        ← ★ standalone page per profile — link it or iframe it
    └── <instance>/index.html       ← ★ same, per parameterized instance (e.g. prayer/)
```

The ★ pages are the **embeddable-by-default surface**: every `.vue` profile (and every
instance in a `*.instances.json`) automatically gets a directly linkable, iframe-able URL —
no per-map work.

## Anatomy of a generated profile page

Each `<profile>/index.html` is a **bare full-page map** — no chrome, so the URL *is* the map
("Share shares THE MAP"). It loads: the Mapbox GL peer (once, same realm), the bundle IIFE via
a relative `../<bundle>.js`, and mounts the element with that profile's config. The token
resolves by the ladder (prop → `?tk=` → baked → `window.MAP_TOKEN_URL` → `tokenUrl` →
same-origin `/api/maps/token`), fetched at page load — tokens are treated as data, never eval'd.

All URLs stay **relative** unless `embedBaseUrl` is set, so the whole tree can be dropped under
any web-root or subpath and keeps working (`check:drop` gates this).

## The manifest — embed snippets as data

`manifest.json` (`doxa-maps-manifest@1`) lists every bundle → profiles, each with `element`,
`scriptUrl`, `iframeUrl`, and a ready-made `embed` object:

- `embed.iframe` — a paste-ready `<iframe src=".../<profile>/index.html" …>` snippet
- `embed.script` — the `<script src>` + `<element profile-config='…'>` pair

Hosts, staging pages, and the share button all read this one catalog — snippets are generated
once, never hand-written.

## Two embed modes, one rule about iframes

| Mode | What | When |
|---|---|---|
| **script + element** | host page loads the IIFE, drops the tag | full integration: host styles/sizes it, passes config |
| **iframe / direct link** | point at the generated `<profile>/index.html` | zero-effort embeds, CMSs that only allow iframes, shared links |

Both are supported on **built** pages. The one "never iframe" rule applies only to the **dev
staging** script (the archived repo-root staging page, removed in afb998f17 — the plugin studio is the only entry now), which mounts elements directly because a dev-server
iframe crosses realms (`instanceof` breaks). Built pages have no such problem — the generated
staging (`staging-forge.js`) itself uses an iframe stage.

## Direct-embed vs staging — the framing contract (serving layer)

The built tree has TWO kinds of page, and they need DIFFERENT framing policy:

| Surface | Paths | `frame-ancestors` |
|---|---|---|
| **Direct embed** (the product) | `<bundle>/<profile>/index.html`, `<bundle>/<profile>/<instance>/index.html` — the bare map pages the manifest's `iframeUrl` points at | **`*`** — framable on any partner site (that's the whole point) |
| **Staging** (internal preview) | tree root `index.html`, per-bundle `<bundle>/index.html` | **`'self'`** — preview only |

Deep Research (`doxa-maps-spa/doxa-maps-spa/index.html`) is a direct-embed page like any
other leaf. Its full embed contract (script and iframe) is in
`plugin-designs/doxa-maps-spa/EMBED.md`.

**CORS is a separate requirement, and it covers the whole tree.** A script embed runs in the
partner's document, so everything a composed surface `fetch()`es — `manifest.json` at the tree
root, and `assets/` — needs `Access-Control-Allow-Origin: *`. Applying it only to the ≥2-segment
embed pages leaves `manifest.json` uncovered. `bun run check:gallery-embed` proves the whole
chain from a second origin.

`frame-ancestors` can ONLY be set by an HTTP response header (HTML `<meta>` cannot set it), so
**the server/CDN owns this split — the bundler cannot enforce it.** Whoever serves the tree must
apply it. Rule of thumb: **a path with ≥2 directory segments under the tree root is a direct-embed
page → serve it framable.**

Portable ways to implement the split, by host:
- **Traefik** (a self-hosted reverse proxy): a higher-priority router on `PathRegexp(^/plugin-assets/[^/]+/[^/]+/)`
  sets `Content-Security-Policy: frame-ancestors *` + clears `X-Frame-Options`. (Live example: a Traefik
  dynamic-configuration file on the test host.)
- **Cloudflare Pages / Netlify**: a `_headers` file — `/<bundle>/*/*  Content-Security-Policy: frame-ancestors *`.
- **Nginx**: `location ~ ^/[^/]+/[^/]+/ { add_header Content-Security-Policy "frame-ancestors *"; }`
- **GitHub Pages**: serves no custom headers → pages are framable by default (no frame-ancestors), which is already correct for direct embeds.

If you serve the WHOLE tree with one blanket `frame-ancestors 'self'`, direct embeds break on
partner sites (the staging policy leaks onto the product pages). That is the one mistake to avoid.
