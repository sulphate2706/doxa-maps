#!/usr/bin/env bash
# setup-runtime.sh — fetch Rudder's speech runtime + model, verified by SHA-256, then build the engine.
#
# Rudder (plugin-designs/rudder-voice) transcribes on THIS computer. It needs two things that are too big
# for git: NVIDIA's NeMo-Speech.cpp runtime (~4 MB, CPU build) and the Nemotron 3.5 ASR Streaming GGUF
# (~742 MB). Both are pinned by version and checksum; a mismatch aborts instead of running an unverified
# file. After this, `bun run dev` starts the engine and Rudder appears in the Plugin Studio.
#
#   bash backend/rudder-engine/setup-runtime.sh          # installs into ~/.local/share/rudder
#   RUDDER_HOME=/some/dir bash backend/rudder-engine/setup-runtime.sh
#
# Linux x86_64 only for now (the runtime ships other platforms; add them when a desktop build needs them).
set -euo pipefail

RUDDER_HOME="${RUDDER_HOME:-$HOME/.local/share/rudder}"
RT_VER="0.1.0"
RT_NAME="nemo-speech-${RT_VER}-linux-x86_64-cpu"
RT_URL="https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${RT_VER}/${RT_NAME}.tar.gz"
RT_SHA="0f74131d631ad2c694cf0ec53490866bb6461147959589a69fb6fc231944065b"
# NVIDIA re-converted the GGUF on 2026-09-10 (embedded tokenizer); this revision is the one Rudder is tested with.
MODEL_REV="ea30d66debe3"
MODEL_FILE="nemotron-3.5-asr-streaming-0.6b.q8_0.gguf"
MODEL_URL="https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/${MODEL_REV}/${MODEL_FILE}"
MODEL_SHA="3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1"
# Robot voice (optional text-to-speech): Piper 2023.11.14-2 (MIT; ONNX Runtime 1.14.1 inside — no telemetry
# client, 0 network calls in a traced synthesis) and one CC BY 4.0 voice (LibriTTS-R, 904 speakers).
PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
PIPER_SHA="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
VOICE_REV="c10ece1aade47bb51c153c893d14e5bf8e5b7117"
VOICE="en_US-libritts_r-medium"
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/${VOICE_REV}/en/en_US/libritts_r/medium"
VOICE_SHA="10bb85e071d616fcf4071f369f1799d0491492ab3c5d552ec19fb548fac13195"
VOICE_JSON_SHA="b471dc60d2d8335e819c393d196d6fbf792817f40051257b269878505bc9afb3"

say() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || die "This script currently supports Linux x86_64 only."
command -v curl >/dev/null || die "curl is required."
command -v sha256sum >/dev/null || die "sha256sum is required."

fetch() { # url dest sha
  local url="$1" dest="$2" sha="$3"
  if [ -f "$dest" ] && [ "$(sha256sum "$dest" | cut -d' ' -f1)" = "$sha" ]; then
    say "already have $(basename "$dest") (checksum OK)"; return
  fi
  say "downloading $(basename "$dest")"
  curl -fL --retry 3 -C - -o "$dest.part" "$url"
  [ "$(sha256sum "$dest.part" | cut -d' ' -f1)" = "$sha" ] || { rm -f "$dest.part"; die "checksum mismatch for $(basename "$dest") — refusing to use it"; }
  mv "$dest.part" "$dest"
}

mkdir -p "$RUDDER_HOME/bin" "$RUDDER_HOME/models"
fetch "$RT_URL" "$RUDDER_HOME/bin/$RT_NAME.tar.gz" "$RT_SHA"
tar -xzf "$RUDDER_HOME/bin/$RT_NAME.tar.gz" -C "$RUDDER_HOME/bin"
fetch "$MODEL_URL" "$RUDDER_HOME/models/$MODEL_FILE" "$MODEL_SHA"

mkdir -p "$RUDDER_HOME/tts"
fetch "$PIPER_URL" "$RUDDER_HOME/tts/piper_linux_x86_64.tar.gz" "$PIPER_SHA"
tar -xzf "$RUDDER_HOME/tts/piper_linux_x86_64.tar.gz" -C "$RUDDER_HOME/tts"
fetch "$VOICE_BASE/$VOICE.onnx" "$RUDDER_HOME/tts/$VOICE.onnx" "$VOICE_SHA"
fetch "$VOICE_BASE/$VOICE.onnx.json" "$RUDDER_HOME/tts/$VOICE.onnx.json" "$VOICE_JSON_SHA"

if command -v go >/dev/null; then
  say "building backend/bin/rudder-engine"
  (cd "$(dirname "$0")" && go build -o ../bin/rudder-engine .)
else
  printf '! Go not found — install Go, then: cd backend/rudder-engine && go build -o ../bin/rudder-engine .\n'
fi

for tool in parec pactl; do command -v "$tool" >/dev/null || printf '! %s not found — install pipewire-pulse or pulseaudio-utils for microphone capture.\n' "$tool"; done

say "done. Runtime: $RUDDER_HOME/bin/$RT_NAME   Model: $RUDDER_HOME/models/$MODEL_FILE"
say "run \`bun run dev\` and open Rudder (rudder-voice) in the Plugin Studio."
