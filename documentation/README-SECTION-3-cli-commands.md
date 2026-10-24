## 3. CLI commands + required installs (per deployment method)

Everything runs through `bun` and the scripts in `package.json`. The build loop
iterates every folder under **`plugin-designs/`** (each folder = one bundle), so once a
map exists there, `bun run build` picks it up automatically — no per-map wiring.

> **Install once (all methods):** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`) — Node ≥ 18 also works (`npm run <script>`; the scripts are identical). Then:
>
> ```bash
> bun install
> ```

The scripts these commands are grounded in (from this branch's `package.json`):

```jsonc
// TRANSCRIBED FROM package.json 2026-09-20. The previous copy had DRIFTED: it listed
// `check:drop` twice, omitted `check:template-literal` and `check:sri`, and still showed
// the old inline `build` pipeline — which has since moved behind a LOCK WRAPPER.
// ★ `build` is now `bash internal/build-lock.sh`; the real pipeline is `build:unlocked`.
//   The lock SERIALIZES concurrent builds (a `clean` rm -rf's the shared output tree at the
//   START of every build, so two builds racing give opposite answers seconds apart). Use
//   BUILD_LOCK_WAIT=600 to QUEUE rather than collide. Note the lock serializes but does NOT
//   dedupe: N queued builds = N full rebuilds.
// ★ THE PIPELINE RUNS IN PHASES, NOT AS ONE `&&` CHAIN (2026-09-23). Measured on the build
//   box AS IT WAS THAT DAY — the numbers below are a DATED BENCHMARK, not a running total.
//   The gate set has grown since (36 steps as of 2026-09-24: 7 pre + 29 post); the timings
//   and the "31 in, 31 out" count are kept verbatim because they are the EVIDENCE that the
//   phase change preserved the step set. Restating them as current would destroy that.
//   Then: the 29 gates cost 84.5s chained, but 21 of them finish under 700ms — they were
//   queueing behind check:mjs-parse (26.9s) and check:parse (18.7s), not working. The 22 vite
//   builds cost 129.0s and were never ordered at all: vite.config.js gives each bundle its own
//   outDir with emptyOutDir:false, so they only ever needed to not overwrite each other.
//   Now: gates:pre ‖ → library-index → clean → token → build:bundles ‖ → tree → gates:post ‖.
//   MEASURED end-to-end (both green, clean+token excluded as they are common to both):
//   165.7s → 65.3s mean of two rounds each. Concurrency: GATES_CONCURRENCY (default 6),
//   BUILD_CONCURRENCY (default 4 — 6 buys only 3-9%, and ambient load on this shared box moves
//   the same setting 40s→55s, so being a good neighbour costs nothing measurable).
//   ★ NO GATE WAS REMOVED, WEAKENED, SAMPLED, OR MADE CONDITIONAL ON WHAT CHANGED. The step set
//   is byte-identical (31 in, 31 out, asserted at edit time); only the start times moved. The
//   `&&` BETWEEN phases is load-bearing and stays: a source gate still blocks the build, and
//   the build still blocks every gate that reads its output. Within a phase the runner reports
//   ALL failures instead of stopping at the first, so three broken gates cost one cycle, not three.
// ⚠ check:quoted-scripts IS ITSELF IN gates:post, so adding or removing ANY gate changes the
//   very line this doc quotes — the update is self-referential and takes two passes: wire the
//   gate, then re-transcribe. That is the mechanism working, not a bug.
// If you edit package.json, re-transcribe this block — a doc that QUOTES a config is
// claiming to be ground truth, and this one had silently stopped being it.
"dev":             "bun x vite",
"build":           "bash internal/build-lock.sh",
"build:unlocked":"bun run gates:pre && bun run library-index && bun run check:library-index && bun run clean && bun run token && bun run build:bundles && bun run tree && bun run gates:post",
"gates:pre":"node internal/run-parallel.mjs --label=pre -- check:template-literal check:mjs-parse check:sfc-parse check:tab-radius check:synced-css check:doc-scripts",
"gates:post":"node internal/run-parallel.mjs --label=post -- check:drop check:parse verify check:sri check:public-hygiene check:label-joins check:facet-cascade check:facet-one-field check:heartbeat check:kpi-unit check:composite-reg check:descriptions check:no-abs-paths check:no-codename check:dep-names check:composite-srcs check:embed-targets check:nested-token check:i18n-parity check:tabs-localized check:packets-all check:packet-strings-parity check:zone-census check:share-policy check:library-index check:csv-shape check:capability-citations check:catalog-identity check:no-orphan-gates check:quoted-scripts check:script-flags check:capability-exemplars check:packet-fixture check:packet-browser check:provider-switch check:locale-reachable check:url-resolver check:manifest-covers check:one-palette check:pin-dim-slider check:legend-source check:clustering-modes check:composite-embed-knobs check:composite-locale-leaks check:linked-vocabulary check:wp-embed",
"build:bundles":   "node internal/run-parallel.mjs --bundles",   // the 22 vite builds, 4 at a time
"preview":         "bun x vite preview",
"serve":           "node internal/serve-strict.mjs",   // 404s a directory, like production
"cap:sync":        "./node_modules/.bin/cap sync android",
"cap:verify":      "test -f deployment/capacitor/android/app/src/main/assets/public/index.html && echo \"OK webDir copied\" || (echo \"FAIL: empty assets/public -> blank white screen. Check webDir.\" && exit 1)",
"apk:debug":       "bun run build && bun run cap:sync && bun run app:start-page && bun run cap:verify && cd deployment/capacitor/android && ./gradlew assembleDebug",
"apk:install":     "adb install -r deployment/capacitor/android/app/build/outputs/apk/debug/app-debug.apk",
"phone":           "bun run apk:debug && bun run apk:install"
```

`BUILD_ALLOW=1 bun run build` writes the whole deployable tree to `public/dx-maps/`, including
`manifest.json`: the machine-readable index that carries a ready-to-paste **iframe** snippet and a
**`<script src>` + SRI** snippet for every plugin.

### Summary table

| # | Deployment method | Install first | Command(s) | Status |
|---|---|---|---|---|
| 1 | **iframe** | Bun | `bun install` → `BUILD_ALLOW=1 bun run build` → drop `public/dx-maps/` on any host | ✅ production |
| 2 | **Mobile app (Android)** | Bun for the check; + Android SDK · `adb` · JDK 17 for the APK | `bun run check:mobile` (no toolchain) · `bun run phone` | ✅ built |
| 3 | **JavaScript embed** | Bun | `BUILD_ALLOW=1 bun run build`, then paste the `embed.script` snippet from `manifest.json` | ✅ production |
| 4 | **WordPress / Disciple Tools** | Bun (+ `php` for the check) | paste a snippet into a Custom HTML block, or install `deployment/wordpress/doxa-maps-embed/` · `bun run check:wp-embed` | 🧪 proof of concept |
| 5 | **Desktop (Tauri)** | Bun for the check; + Rust · Tauri CLI · webview libs for the binary | `bun run check:tauri` (no toolchain) · `bun run tauri:build` | 🧪 proof of concept |

---

### 1. iframe

**Install:** Bun.

```bash
bun install
BUILD_ALLOW=1 bun run build          # builds every plugin-designs/* bundle -> public/dx-maps/
bun run serve                        # optional: serves public/ at http://localhost:4173
```

Each profile in `manifest.json` carries an `embed.iframe` snippet:

```html
<iframe src="./all-people-groups/all-people-groups/index.html"
        width="100%" height="600"
        style="border:none;border-radius:12px;" allowfullscreen></iframe>
```

**The folder is position-independent.** Snippet URLs are relative to the tree root, so `dx-maps/`
works dropped on any static host. For absolute URLs, set `embedBaseUrl` in the build config.

### 2. Mobile app — Android / Capacitor

**Install:** Bun · **Android SDK** (`sdkmanager`, `adb` on your PATH) · **JDK 17** · a device or
emulator. The `@capacitor/*` packages are already devDependencies.

```bash
bun run check:mobile   # contract check — needs NO JDK, SDK or device
bun run phone          # the full path: build → cap:sync → cap:verify → gradlew assembleDebug → adb install
bun run apk:debug      # or the halves separately: build the APK only
bun run apk:install    # push the built APK to a connected device
```

**`check:mobile` runs anywhere.** It copies the built tree into the Android project and asserts
`deployment/capacitor/android/app/src/main/assets/public/index.html` exists, which catches the one
silent failure: a wrong `webDir` launches to a blank white screen, not an error. Only Android is
scaffolded; iOS is not set up.

### 3. JavaScript embed

**Install:** Bun. Build, then paste the plugin's `embed.script` snippet from `manifest.json`: a
`<script src>` with a Subresource-Integrity hash, plus the custom element.

```html
<script src="./all-people-groups/all-people-groups.js"
        integrity="sha384-…" crossorigin="anonymous"></script>
<all-people-groups
  profile-config='{"profile":"all-people-groups","tk":"YOUR_MAPBOX_TOKEN"}'>
</all-people-groups>
```

**The hash pins the exact bytes.** Whenever the bundle changes, the old hash stops matching and the
browser refuses to run the script, so re-copy the snippet from the current `manifest.json` after each
release. (An iframe embed updates automatically.) The element
takes props and emits events, so it can wire into the surrounding page.

**On a partner's site, a JS embed needs two values an iframe does not.** An iframe carries its own
document base; a script runs in the host's document, so relative asset and API paths would resolve
against the host and 404. The snippet already ships both:

| | iframe | JavaScript embed |
|---|---|---|
| `assetsBase` | not needed | **required**, in `profile-config` (`YOUR_TREE_URL/assets` until you set `assetsBaseUrl`) |
| API base | not needed | **required**, `window.MAP_APP_API_URL` (a host global) |
| Mapbox token | inherited by the leaf page | replace `YOUR_MAPBOX_TOKEN` |

### 4. WordPress / Disciple Tools — proof of concept

**No plugin needed for the simple path:** build, then paste the iframe or script snippet into a
WordPress **Custom HTML** block.

**The plugin path:** `deployment/wordpress/doxa-maps-embed/` adds a `[doxa_map]` shortcode and a
Gutenberg block, registering the bundle through WordPress's own dependency graph so the SRI hash and
`crossorigin` survive and the script loads once per page.

```bash
bun run check:wp-embed     # renders the REAL shortcode with no WordPress installed
```

**What is proven, and what is not.** The check renders the shortcode against the real `manifest.json`
and asserts the element tag, valid `profile-config` JSON, the script `src`, the injected SRI hash and
`crossorigin` — and rejects a malformed hash. It does not prove that WordPress renders the page or a
browser runs it; that needs a live install (`wp-env start`, see
`deployment/wordpress/doxa-maps-embed/HOW-TO-TEST.md`).

### 5. Desktop — Tauri — proof of concept

**Install:** Bun for the check. For the binary: Rust (`rustup`), the Tauri CLI
(`cargo install tauri-cli`) and the platform's webview libraries.

```bash
bun run check:tauri    # contract check — needs NO Rust, NO Tauri CLI
bun run tauri:build    # the binary and a .deb — needs the toolchain above
```

**The desktop app wraps the same tree.** `deployment/src-tauri/tauri.conf.json` points
`build.frontendDist` at `../public`, the desktop twin of Capacitor's `webDir`; the Rust crate carries
no application logic. `check:tauri` asserts that path resolves, every window `url` exists in the built
tree, the identifier matches Capacitor's `appId`, and the crate files are present.

**Token caveat:** a Tauri webview serves from `tauri://localhost` (or `http://tauri.localhost` on
Windows), so a `tokenUrl` endpoint must send CORS headers for that origin. The fix is a response header
on the token host, not a change in `tauri.conf.json`. Details:
[`deployment/src-tauri/README.md`](../deployment/src-tauri/README.md).

---

## Notes and history

The measurements behind the sections above.

- **Mobile — `check:mobile` needs no toolchain (verified 2026-09-20).** With `java`, `gradle`, `adb` and
  `sdkmanager` all absent, sync exited 0, the whole `public/` tree was staged into the native assets and
  `cap:verify` passed; removing `index.html` made it exit 1. The doc once said "21 bundles staged"; that
  count named the wrong unit (`cap sync` copies `webDir` wholesale) and went stale, so it says "the whole
  tree" now.
- **JavaScript embed — foreign-host run (2026-09-20).** Both embed methods were run on a foreign host page
  until they failed: the iframe needed nothing; the script embed needed `assetsBase` and the API base,
  which the snippet now emits. Same-root and foreign-host both then passed (map painted, attribution
  shown, 0 errors, 0 404s).
- **WordPress — corrected 2026-09-20.** This section once said no WordPress build step existed; the
  shortcode + block plugin and its contract check were added after. The check stubs the ~20 WordPress
  functions the plugin calls (`deployment/wordpress/tests/`).
- **Tauri — the build ran (2026-09-21).** With the real toolchain (`tauri info` all ✔: webkit2gtk 2.50.6,
  rustc/cargo 1.96.1) `bun run tauri:build` produced a 65 MB ELF executable and a 58 MB `.deb`
  (`Depends: libwebkit2gtk-4.1-0, libgtk-3-0`); a later run measured 67 MB and 60 MB. The web tree is
  compiled into the binary, which is why the `.deb` holds only 6 entries. `bundle.targets` is `["deb"]`
  because `rpmbuild` and `linuxdeploy` were absent, so `"all"` would fail two formats at the end of a
  ~6-minute build. The window has not been opened: the build box is headless, and the binary stops with
  "Failed to initialize GTK" (no display, not a defect). `check:tauri` is negative-tested five ways
  (wrong `frontendDist`, missing window url, identifier drift, empty windows array, missing crate file).
