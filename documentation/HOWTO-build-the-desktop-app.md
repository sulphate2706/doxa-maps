# HOWTO: build the Rudder desktop app (macOS / Windows)

Rudder (`plugin-designs/rudder-voice`) is voice-to-text that runs on your own computer: a web UI plus a
local engine (`backend/rudder-engine`, Go) that drives NVIDIA's NeMo-Speech.cpp speech server. The
desktop app is a Tauri window around the built web tree, with the engine started as a **sidecar**.

This page is written for an agent following it cold. **Read "What is proven" first**: the Linux app is
proven and in use; the macOS and Windows path has not been run yet, and the steps say so where that is
the case.

## What is proven, and what is not

| Piece | State |
|---|---|
| The web tree (`bun run build` → `public/dx-maps/`) | Proven. Every landing builds it. |
| The generic Tauri shell (`deployment/src-tauri/`) | Exists. It opens Deep Research, builds only a Linux `.deb`, and has never been packaged on macOS or Windows. |
| The engine on Linux (`bun run dev`, laptop mic) | Proven. |
| The engine taking the **webview's** microphone (`RUDDER_AUDIO=browser`) | Proven on Linux: audio streamed over `/api/rudder/stream` came back as the full test sentence. |
| The engine **compiling** for macOS (arm64, x86_64) and Windows (x86_64) | Proven by cross-compiling. It has **never been run** on either. |
| The engine accepting a WebSocket from the Tauri webview (`tauri://localhost`, `http://tauri.localhost`) | Proven against a running engine; another site's origin is refused. |
| NeMo-Speech.cpp runtime for macOS / Windows | Published by NVIDIA (release v0.1.0: `macos-aarch64-cpu`, `macos-aarch64-metal`, `macos-x86_64-cpu`, `windows-x86_64-cpu` / `-cuda` / `-vulkan`). **Never run here.** |
| `bun run desktop:build rudder-voice` on **Linux** | Proven: produced `Rudder_0.1.0_amd64.deb` (8.8 MB) holding the app and the `rudder-engine` sidecar side by side. The installed Linux app has since been launched and is in use: it is used to dictate the work on these maps. |
| The shell starting and stopping the engine sidecar | Built (`deployment/src-tauri/src/main.rs`), compiled into that installer. The installed Linux app works (the row above); not yet run on macOS or Windows. |
| First-run model download | **Not built.** Run `setup-runtime.sh` into the app's data folder by hand (step 7). |

## 1. Prerequisites

Both platforms:

- **Bun** (the repo's package manager and script runner): https://bun.sh
- **Go 1.22 or newer** (the engine).
- **Rust** (stable) via https://rustup.rs, then the Tauri CLI, which the repo already pins as a dev
  dependency (`@tauri-apps/cli` 2.x, run through `bun run tauri:build`).
- About 2 GB of free disk space (the speech model is 742 MB) and 2 GB of free RAM while it runs.

macOS:

- Xcode Command Line Tools: `xcode-select --install`.

Windows:

- Microsoft C++ Build Tools ("Desktop development with C++").
- WebView2 runtime (preinstalled on Windows 11).

Tauri's own prerequisite list is the reference if anything above is out of date:
https://v2.tauri.app/start/prerequisites/

## 2. Get the repo and its packages

```bash
git clone <your team's repo URL> dx-maps
cd dx-maps
bun install
```

## 3. No web build needed

`desktop:build` builds the one plugin it packages; `bun run build` (the web tree) is not a prerequisite.

## 4. Build the app: one command

```bash
bun run desktop:build rudder-voice
```

It packages ONE plugin whose `<profile>.meta.json` `"targets"` include `desktop` (see
`skills/plugin-designer/references/targets.md`), and nothing in `public/` or the committed tree changes:

1. the plugin is built into `.desktop/rudder-voice/`, with a one-element page that gives it the engine's
   address (`apiBase: http://127.0.0.1:5193/api/rudder`);
2. its `"backend"` (`backend/rudder-engine`) is built for this machine as
   `deployment/src-tauri/binaries/rudder-engine-<target triple>` (Tauri's sidecar naming);
3. `tauri build` runs with a `--config` override (the window opens that page, the app is named from the
   meta label, the engine is bundled); `tauri.conf.json` is not edited.

The first run compiles Tauri's dependencies (several minutes, about 2 GB under
`deployment/src-tauri/target/`); later runs reuse it.

The shell (`deployment/src-tauri/src/main.rs`) starts the bundled `rudder-engine` with
`RUDDER_AUDIO=browser` (the webview captures the mic; the engine's own recorders are Linux-only) and
`RUDDER_HOME=<the app's data folder>/rudder`, and stops it when the app quits. The engine accepts the
webview's origins (`tauri://localhost`, `http://tauri.localhost`).

## 5. The speech runtime and model (first run, still by hand)

`backend/rudder-engine/setup-runtime.sh` is the reference: it pins the runtime (NeMo-Speech.cpp
**0.1.0**) and the model (`nemotron-3.5-asr-streaming-0.6b.q8_0.gguf`, Hugging Face revision
`ea30d66debe3`, ~742 MB) by SHA-256, and refuses a mismatch. It is **bash and Linux x86_64 only**, so on
macOS and Windows the app must do the same on first run:

- Download the runtime for this platform from
  `https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.1.0`. Each asset has a published
  `.sha256` next to it; check it. On Apple Silicon, the **`macos-aarch64-metal`** build uses the GPU
  and should transcribe far faster than the CPU builds (unmeasured). On a server, the CPU build ran
  slower than real time.
- Download the model from the URL and SHA-256 in `setup-runtime.sh`. Verify before use.
- Put them under `RUDDER_HOME`: `bin/nemo-speech-0.1.0-<os>-<arch>-cpu/bin/nemo-speech[.exe]` and
  `models/<model file>`. The engine derives that runtime path for its own platform
  (`<os>` = `macos` / `windows`, `<arch>` = `aarch64` / `x86_64`). **Unverified:** the layout inside the
  macOS and Windows archives. If it differs, or you use the Metal build, set `RUDDER_NEMO_BIN` to the
  real path of the `nemo-speech` binary.
- Show progress: the first start downloads ~750 MB and warms the model (~20 s on a laptop CPU).

## 6. Where the installer lands

`desktop:build` prints the path. The installer lands under `deployment/src-tauri/target/release/bundle/`: `dmg/` on macOS, `nsis/` or
`msi/` on Windows.

- **macOS:** the webview needs `NSMicrophoneUsageDescription` in the app's `Info.plist` (Tauri: an
  `Info.plist` file next to `tauri.conf.json`), or the microphone request is refused silently. An
  unsigned app opens with right-click → Open the first time. Signing and notarising are only needed
  to give it to others.
- **Windows:** WebView2 asks for microphone permission on first use.

## 7. Check it works

1. Launch the app. Rudder's status reads "Loading speech model…" and then **Ready**.
2. Press **Record**, speak, and watch the words stream into the box. Press **Stop**: the last words
   still arrive.
3. `http://127.0.0.1:5193/api/rudder/status` in a browser on the same machine shows
   `"engine":"ready"` and `"audio":"browser"`.

## Known gaps (untested; report what you find)

- `desktop:build` has run on Linux only; the app it produced has not been launched yet. Nothing has run on macOS or Windows.
- The macOS/Windows runtime archive layout, and whether the engine's derived path matches it.
- The first-run download, including resuming an interrupted 742 MB download.
- Mapbox basemaps in Deep Research need the token host to allow the Tauri origin
  (`deployment/src-tauri/README.md`). Rudder itself needs no token.
- If the engine crashes, its speech server may keep running (and holding ~1 GB) until the app quits.
