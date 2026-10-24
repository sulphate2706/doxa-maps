# dx-maps cloud dev server: one shared Vite dev server with hot reload for a whole team.
# This image is only a bootstrap: at start it clones the repo and runs deployment/cloud/entry.sh
# FROM THE REPO, so the recipe lives in git and updates with it. Paste this file as-is into a
# container host (Coolify "Dockerfile" build pack, Railway, or `docker build`).
FROM quay.io/oauth2-proxy/oauth2-proxy:v7.15.3 AS oauth2proxy
FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
COPY --from=oauth2proxy /bin/oauth2-proxy /usr/local/bin/oauth2-proxy
# Real Node for the repo's `node internal/...` scripts: bun's node shim runs `node --check` files
# instead of only parsing them, which hung the production build.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
# Go, to build Rudder's local engine (backend/rudder-engine, go 1.22) when RUDDER_ENGINE=1.
COPY --from=golang:1.22-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
# Rudder's speech runtime and model (~742 MB), baked into an early layer so a restart downloads nothing.
# Same pins and SHA-256 as backend/rudder-engine/setup-runtime.sh; if those move on, setup-runtime.sh fetches
# the new files at start (checksum mismatch) until these lines are bumped too. Never in git: the repo stays small.
ARG RUDDER_RT=nemo-speech-0.1.0-linux-x86_64-cpu
ARG RUDDER_RT_SHA=0f74131d631ad2c694cf0ec53490866bb6461147959589a69fb6fc231944065b
ARG RUDDER_MODEL_REV=ea30d66debe3
ARG RUDDER_MODEL=nemotron-3.5-asr-streaming-0.6b.q8_0.gguf
ARG RUDDER_MODEL_SHA=3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1
# get: resume + retry, and treat a stalled transfer (<100 KB/s for 30 s) as a failure; a mid-file reset
# from the model host was measured on the first cloud start.
RUN get() { for n in 1 2 3 4 5 6; do curl -fsSL -C - --speed-limit 100000 --speed-time 30 -o "$2" "$1" && return 0; sleep 5; done; return 1; } \
 && mkdir -p /opt/rudder/bin /opt/rudder/models \
 && get "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/${RUDDER_RT}.tar.gz" "/opt/rudder/bin/${RUDDER_RT}.tar.gz" \
 && echo "${RUDDER_RT_SHA}  /opt/rudder/bin/${RUDDER_RT}.tar.gz" | sha256sum -c - \
 && tar -xzf "/opt/rudder/bin/${RUDDER_RT}.tar.gz" -C /opt/rudder/bin \
 && get "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/${RUDDER_MODEL_REV}/${RUDDER_MODEL}" "/opt/rudder/models/${RUDDER_MODEL}" \
 && echo "${RUDDER_MODEL_SHA}  /opt/rudder/models/${RUDDER_MODEL}" | sha256sum -c -
# PocketBase, pinned and checked: the backend for plugins (a dev and a prod instance, see entry.sh).
ARG PB_VERSION=0.40.4
ARG PB_SHA256=9042ec818570e79c3628dadcd0a756c1496d9e1173918ec409d133c02f82e5fa
RUN curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
 && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
 && unzip -q /tmp/pb.zip pocketbase -d /usr/local/bin && rm /tmp/pb.zip && chmod 755 /usr/local/bin/pocketbase
# PocketBase team sign-in gate (a JS hook), baked here and pinned: the ONLY server-side hook that runs, in pb-dev.
# It lives in the image, never in the pulled repo, so a plugin writer's push can't change what it lets in.
# Changing it = edit these lines AND the SHA-256 below, then redeploy the image (an admin act).
RUN mkdir -p /app/pb_hooks_gate && printf '%s\n' \
  '// Team sign-in gate: only members of OIDC_ALLOWED_GROUPS (the groups claim from the identity provider) may sign in here.' \
  '// Baked into the image by deployment/cloud/Dockerfile and pinned by SHA-256: never read from the pulled repo.' \
  'onRecordAuthWithOAuth2Request((e) => {' \
  '  const allow = ($os.getenv("OIDC_ALLOWED_GROUPS") || "").split(",").map((s) => s.trim()).filter((s) => s)' \
  '  const raw = (e.oAuth2User && e.oAuth2User.rawUser) || {}' \
  '  const groups = []' \
  '  if (raw.groups) for (let i = 0; i < raw.groups.length; i++) groups.push(String(raw.groups[i]))' \
  '  if (!allow.length || !groups.some((g) => allow.indexOf(g) >= 0)) {' \
  '    throw new ForbiddenError("This account is not in a group allowed to use this team backend.")' \
  '  }' \
  '  e.next()' \
  '}, "users")' \
  > /app/pb_hooks_gate/team-gate.pb.js \
 && echo "2987055ba6067fc30d8162608da21c6c2b691fb6897a46d10b7075271a38f13d  /app/pb_hooks_gate/team-gate.pb.js" | sha256sum -c -
RUN printf '%s\n' \
  '#!/bin/bash' \
  'set -u; export GIT_TERMINAL_PROMPT=0' \
  'T="${GIT_TOKEN:-${FORGEJO_TOKEN:-}}"' \
  'if [ -n "$T" ]; then printf "#!/bin/sh\ncase \"\$1\" in *sername*) echo \"\$GIT_TOKEN_EFF\";; *) echo;; esac\n" > /tmp/askpass.sh; chmod 700 /tmp/askpass.sh; export GIT_ASKPASS=/tmp/askpass.sh GIT_TOKEN_EFF="$T"; fi' \
  ': "${REPO_URL:?set REPO_URL to the dx-maps git URL}"' \
  '[ -d /app/repo/.git ] || git clone -q --depth 1 --branch "${BRANCH:-main}" "$REPO_URL" /app/repo || { echo "clone failed"; sleep 60; exit 1; }' \
  'cp /app/repo/deployment/cloud/entry.sh /tmp/entry.sh && exec bash /tmp/entry.sh' \
  > /boot.sh && chmod 755 /boot.sh
ENV PORT=5173 BRANCH=main PULL_INTERVAL=15
VOLUME /data
EXPOSE 5173
CMD ["/boot.sh"]
