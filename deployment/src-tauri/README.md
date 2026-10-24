# `deployment/src-tauri/` — the desktop shell (deploy method 5)

A Tauri window around the **same `public/` tree** the CDN, Capacitor and local staging already
serve. This crate deliberately contains **no application logic**: the product is the web tree in
`plugin-designs/` → `public/`, and this is a window around it — the desktop counterpart of
`deployment/capacitor/android`.

## Why this file exists instead of comments in the config

`capacitor.config.json` documents itself with `"//key": [...]` comment entries, because Capacitor
ignores unknown keys. **Tauri does not.** Its config parser is strict and rejects unknown fields:

```
unknown field `//THE_TOKEN_CAVEAT`, expected one of `$schema`, `product-name`, `productName`,
`main-binary-name`, `mainBinaryName`, `version`, `identifier`, `app`, `build`, `bundle`, `plugins`
```

That is a hard build failure, found after `cargo check` compiled 228 crates. So the rationale
lives here and `tauri.conf.json` stays schema-pure. **Do not add `//` keys to it.**

## The two placement facts that cost a build each

1. **`tauri.conf.json` must live in `deployment/src-tauri/`, not the repo root.** `tauri-build` reads it from
   the crate directory; at the root it is invisible and the build dies with *"unable to read Tauri
   config file … because entity not found"*. `check:tauri` now asserts the canonical location and
   fails on a stray root copy.
2. **`frontendDist` is relative to this directory**, hence `../public`. It is a POINTER, NOT A
   COPY — one `bun run build` feeds four consumers:

   | # | Consumer | Reads |
   |---|---|---|
   | 1 | Railway / CDN | `public/` served statically |
   | 2 | Capacitor | `webDir: "public"` → copied into the Android assets |
   | 3 | local staging | `bun run serve` (public/ on :4173) |
   | 4 | **Tauri** | `build.frontendDist: "../public"` |

   `beforeBuildCommand` is deliberately **empty**. `bun run build` is the authoritative
   single-writer of `public/` (CI runs it as `build:unlocked`); wiring it here would make a desktop
   build a *second* writer of the shared tree — the concurrent-clean race the build lock exists to
   prevent. **Build first, then package.**

## The token / CORS caveat — read before debugging blank basemaps

A Tauri webview serves the app from a **custom origin** (`tauri://localhost`, or
`http://tauri.localhost` on Windows), *not* from your token host. Every map bundle fetches its
Mapbox token from the configured `tokenUrl`, so that endpoint **must send CORS headers permitting
the Tauri origin** — exactly the surprise `capacitor.config.json` documents for `https://localhost`.

**The fix is a response header on the token host, not a change in `tauri.conf.json`.**

Measured 2026-09-21: `https://doxa.life/api/maps/token` → **200**;
the test host's `/api/maps/token` → **404**. A desktop build pointed at that host would launch
with blank basemaps even though the window opens and the element mounts correctly. Separately, the
Mapbox token is **URL-restricted**: with the test host as Referer the style document returns 200 but
every **tile 403s**, while the same token with a `doxa.life` Referer returns 200. Verify the token
path before blaming the shell.

## Why the window opens on the cap-5 SPA

`app.windows[0].url` points at `doxa-maps/doxa-maps-spa/doxa-maps-spa/index.html` — the flagship
capability-5 app, not the gallery index. 1440×900 is the viewport the SPA is verified at (its rail
renders 11 rows there: 6 curated + 5 auto-discovered).

`security.csp` is `null` so the page inherits whatever it declares when served, matching CDN
behaviour. Do not tighten it without re-running the mount check: the leaf pages load their map
engine from a **CDN** — `api.mapbox.com/mapbox-gl-js/…` for Mapbox and `cdn.jsdelivr.net/npm/
maplibre-gl@5/…` for MapLibre (see the `ENGINES` registry in
`library/composables/useMapInstance.js`). A naive `script-src 'self'` would break every map.

> **Corrected 2026-09-21.** This previously claimed the bundles "self-host `mapbox-gl` from
> `public/assets/vendor/` (the no-CDN rule)". That is **false** — measured: `vendor/` contains only
> `tabulator`, and the leaves carry `src="https://api.mapbox.com/mapbox-gl-js/v3.24.0/mapbox-gl.js"`.
> A CSP written from the old sentence would have been wrong in exactly the way that produces a
> blank map, so the error mattered.

## Cargo.lock is committed — on purpose

`Cargo.lock` was originally gitignored here, grouped with `/target` and `/gen`. Those two are
genuinely regenerated; a lockfile is not. It is the **resolution record** — the only artifact that
makes `cargo build` reproducible. Cargo's rule splits on crate type: **commit it for a binary,
ignore it for a library.** `cargo metadata` reports this crate as `kinds = ['bin']`.

The stakes are concrete: `Cargo.toml` pins nothing tighter than `tauri = { version = "2" }`, while
the lockfile pins **430 packages**. Without it, an inheritor building next month resolves a different
dependency tree than the one that produced the shipped 64 MB binary. Verified 2026-09-22 that the
committed lockfile is consistent with the manifest (`cargo metadata --locked --offline` succeeds) and
contains no local paths or credentials.

## Commands

```sh
bun run check:tauri    # config contract — NO Rust, NO Tauri CLI needed (CI-safe)
cargo check            # typechecks the crate (needs Rust + webkit2gtk)
bun run tauri:build    # the real binary + .deb (CLI is a devDependency: @tauri-apps/cli)
```

## `bundle.targets` is `["deb"]`, not `"all"` — on purpose

`"all"` attempts **deb + rpm + appimage**. Measured on this box: `dpkg-deb` present, but
`rpmbuild` and `linuxdeploy` (AppImage) **absent**, so `"all"` would fail on two of three
formats after a full release compile. Narrowed to what the machine can actually produce.
Add targets back when the packaging tools exist — the failure comes at the very END of a
~6-minute release build, which is the expensive place to discover it.

## Status: BUILT — binary + .deb emitted; LAUNCH still unverified

Verified 2026-09-21 with the real toolchain (`tauri info`: webkit2gtk 2.50.6, rustc/cargo
1.96.1, frontendDist `../public`, framework Vue.js, bundler Vite — all ✔):

| Artifact | Result |
|---|---|
| `target/release/doxa-maps-desktop` | **65 MB ELF 64-bit executable** |
| `target/release/bundle/deb/*.deb` | **58 MB**, `Package: doxa-maps`, `Depends: libwebkit2gtk-4.1-0, libgtk-3-0` |

The web tree is **compiled INTO the binary** — not shipped as loose files, which is why the
`.deb` has only 6 entries. Confirmed by 19 distinct embedded `doxa-maps/...` asset paths in the
ELF (all bundle dirs + `assets/`), and by size: a logic-free shell is 65 MB only because the
132 MB `public/` tree is compressed inside it.

**What is still NOT proven: that the window opens and renders.** This VPS is headless — running
the binary panics in `tao` with *"Failed to initialize GTK"*, which is the absence of a display,
not a defect. No Xvfb is installed. A human on a desktop machine (or a CI job with a virtual
display) must run it once to move method 5 to *shot*.
