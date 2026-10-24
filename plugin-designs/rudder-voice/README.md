# rudder-voice — Rudder, private voice-to-text (desktop target)

**Rudder is a plugin that isn't a map.** It shows that the same dx-maps pattern — one folder in
`plugin-designs/`, developed live in the Plugin Studio — can ship a **desktop app with its own local
backend**, not only embeddable maps. It is also a genuinely useful tool for the people who build here:
talk to your agents instead of typing, with nothing leaving your computer.

- **Streaming.** Words appear in the text box while you speak; talk for as long as you like.
- **Type and talk at once.** Type, paste links or code anywhere in the box; everything you say is
  added to the end. While you're typing, Rudder holds its words and adds them when you pause.
- **CPU only.** No graphics card. About 1 GB of memory; keeps up with normal speech on a laptop CPU.
- **Offline, no telemetry.** NVIDIA Nemotron 3.5 ASR Streaming (0.6B) run by NVIDIA's open-source
  NeMo-Speech.cpp (ggml). Traced with `strace` while transcribing: zero sockets, zero DNS lookups.
- **Microphones like a video-call app.** Pick the input, hot-plug updates, a 3-second mic test, and
  plain-language errors (muted, disconnected, dead Bluetooth mic link — which it tries to recover).

- **Robot voice (optional).** Settings → *Robot voice*: every sentence you say is spoken back in a
  synthetic voice, so you can record a video that uses dictation without your real voice in it. Offline
  neural voices (Piper, run by the engine on the CPU) or the browser's own on-device voices; nothing leaves
  the computer. While the robot talks through loudspeakers, the engine stops listening, so it never
  transcribes itself; with headphones it keeps listening.

## Run it in the Plugin Studio

```bash
bash backend/rudder-engine/setup-runtime.sh   # once: runtime + model (verified by SHA-256) + engine build
bun run dev                                   # starts the engine too; open "rudder-voice" in the studio
```

Linux with PipeWire or PulseAudio (`parec`, `pactl`). The engine listens on `127.0.0.1` only.

## How it fits together

```
<rudder-voice> (this folder)  ──HTTP + SSE /api/rudder──►  backend/rudder-engine (Go)
                                                            ├─ parec / pw-record  (mic, open only while recording)
                                                            └─ WebSocket ► nemo-speech serve (127.0.0.1, model stays loaded)
```

`bun run dev` starts `backend/bin/rudder-engine` through `internal/backend-dev-plugin.mjs` and forwards
`/api/rudder` to it, so the plugin calls the same API in the browser as it will inside the desktop app,
where Tauri runs the engine as a sidecar and passes its address in `profile-config` (`apiBase`).

`rudder-voice.meta.json` declares `"targets": ["desktop"]`: on a plain website there is no local engine,
so this plugin is not meant for web embeds.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `RUDDER_PORT` | `5193` | engine HTTP port (loopback) |
| `RUDDER_NEMO_PORT` | `5194` | speech server port (loopback) |
| `RUDDER_MODEL` / `RUDDER_NEMO_BIN` | `~/.local/share/rudder/...` | model and runtime paths; the engine refuses a model that isn't a local file |
| `RUDDER_LANG` | `en-US` | default language (the model supports ~30) |
| `RUDDER_KEEP_MSBC` | unset | keep Bluetooth headsets on mSBC instead of switching them to the more stable CVSD |
| `RUDDER_BT_RESET` | unset | optional command that fully resets a Bluetooth headset, used when its mic link dies |

## Not yet

- The desktop app on macOS and Windows. On Linux it builds and runs: `bun run desktop:build rudder-voice`,
  see [HOWTO-build-the-desktop-app](../../documentation/HOWTO-build-the-desktop-app.md).
- A saved word-correction table (PocketBase) for technical terms the model mishears.
