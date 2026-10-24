#!/bin/bash
# dx-maps cloud dev server, run by the image's /boot.sh from the cloned repo (see Dockerfile).
#   1. install, 2. pull BRANCH every PULL_INTERVAL s (Vite hot-reloads what changed; 0 = never pull),
#   3. serve: Vite alone; behind an OIDC sign-in when OIDC_ISSUER is set; or, with ACCESS=public, the Studio
#      open to everyone and the admin parts behind ADMIN_USER/ADMIN_PASSWORD.
# DEV_SERVER=off (default on) runs a tenant WITHOUT the Plugin Studio dev server: no Vite, no pull loop, no
# Rudder. It keeps /cdn, PocketBase, the admin router and the sign-in, and / redirects to /cdn/. Vite is
# most of the container's memory, so an app-user tenant is a fraction of a building one.
set -u
cd /app/repo
BRANCH="${BRANCH:-main}"; PORT="${PORT:-5173}"; DEV_SERVER="${DEV_SERVER:-on}"
case "$DEV_SERVER" in on|off) ;; *) echo "refusing to start: DEV_SERVER must be on or off (got '$DEV_SERVER')" >&2; exit 1;; esac
if [ "$DEV_SERVER" = off ] && [ "${ACCESS:-}" = public ]; then
  echo "refusing to start: DEV_SERVER=off and ACCESS=public don't combine (the public Studio IS the dev server)" >&2
  exit 1
fi
echo "[dev-server] $DEV_SERVER"
echo "$(date -u +%FT%TZ) START at $(git rev-parse --short HEAD)" | tee -a /tmp/pull.log
bun install --frozen-lockfile || bun install

# PULL_INTERVAL=0: never pull, never reset. For a checkout mounted from someone's machine, where the
# loop's `git reset --hard` would wipe their work. The loop only feeds Vite, so DEV_SERVER=off has none.
# An if-block (not `[ ] && ( ) &`), so no background job ends at once and trips the `wait -n` at the bottom.
if [ "${PULL_INTERVAL:-15}" = 0 ]; then
  echo "$(date -u +%FT%TZ) PULL_INTERVAL=0: not following $BRANCH; the checkout is left as it is" | tee -a /tmp/pull.log
elif [ "$DEV_SERVER" = off ]; then
  echo "$(date -u +%FT%TZ) DEV_SERVER=off: no dev server, so no pull loop" | tee -a /tmp/pull.log
else
(
  while true; do
    sleep "${PULL_INTERVAL:-15}"
    OLD=$(git rev-parse HEAD)
    if git fetch -q --depth 1 origin "$BRANCH"; then
      NEW=$(git rev-parse FETCH_HEAD)
      if [ "$OLD" != "$NEW" ]; then
        CHANGED=$(git diff --name-only "$OLD" "$NEW" 2>/dev/null)
        git reset -q --hard FETCH_HEAD
        echo "$(date -u +%FT%TZ) PULLED ${OLD:0:8} -> ${NEW:0:8}" >> /tmp/pull.log
        # the engine binary is untracked, so rebuild it when its source changed
        if [ "${RUDDER_ENGINE:-0}" = 1 ] && echo "$CHANGED" | grep -q '^backend/rudder-engine/'; then
          (cd backend/rudder-engine && go build -o ../bin/rudder-engine .) >> /tmp/pull.log 2>&1 \
            && echo "$(date -u +%FT%TZ) rudder-engine rebuilt" >> /tmp/pull.log && ENGINE_STALE=1
        fi
      fi
    fi
    # Swap in a rebuilt engine once nobody is dictating: stop the old one by its own PID (never a process
    # group: inside a container that can be PID 1) and the dev server restarts it on the new binary.
    if [ "${ENGINE_STALE:-0}" = 1 ] && curl -s --max-time 3 http://127.0.0.1:5193/api/rudder/status | grep -q '"inUse":false'; then
      for p in /proc/[0-9]*; do
        case "$(readlink "$p/exe" 2>/dev/null)" in
          "/app/repo/backend/bin/rudder-engine (deleted)") kill -TERM "${p#/proc/}" \
            && echo "$(date -u +%FT%TZ) rudder-engine ${p#/proc/} stopped for the new build" >> /tmp/pull.log ;;
        esac
      done
      ENGINE_STALE=0
    fi
  done
) &
fi

CONFIG=/app/repo/deployment/cloud/vite.cloud.config.mjs

# ACCESS=public: the Plugin Studio (and every map, and the backend's public API) is open to everyone, with no
# sign-in. /admin/ (publishing), PocketBase's dashboard and _superusers ask for ADMIN_USER / ADMIN_PASSWORD
# instead (admin.mjs). OIDC stays the other mode: unset ACCESS and set OIDC_ISSUER.
if [ "${ACCESS:-}" = public ]; then
  : "${ADMIN_PASSWORD:?ACCESS=public needs ADMIN_PASSWORD (and ADMIN_USER, default admin): it guards publishing, /admin/ and the PocketBase dashboard}"
  if [ "${RUDDER_ENGINE:-0}" = 1 ]; then
    echo "[access] public: Rudder's voice engine stays off (a public one would take anyone's microphone traffic)" >&2
    RUDDER_ENGINE=0
  fi
  [ -z "${OIDC_ISSUER:-}" ] || echo "[access] public: OIDC_ISSUER is ignored; unset ACCESS to use the sign-in" >&2
fi

# Rudder (optional, RUDDER_ENGINE=1): its voice-to-text engine runs here, fed by the BROWSER's
# microphone (no server mic). The image carries the runtime and the pinned model (/opt/rudder); a copy on
# the persistent volume (/data/rudder) wins when it exists. Setup (checksums + building the engine) runs
# in the BACKGROUND so the site serves at once: until it finishes, /api/rudder answers "starting", then
# the cloud Vite config restarts the dev server once, which starts the engine. /api/rudder stays behind
# the sign-in (it is not a public route). About 1 GB resident.
if [ "${RUDDER_ENGINE:-0}" = 1 ] && [ "$DEV_SERVER" = off ]; then
  echo "[rudder] skipped: it runs inside the dev server, and DEV_SERVER=off"
elif [ "${RUDDER_ENGINE:-0}" = 1 ]; then
  if [ -z "${RUDDER_HOME:-}" ]; then
    if ls /data/rudder/models/*.gguf >/dev/null 2>&1; then RUDDER_HOME=/data/rudder; else RUDDER_HOME=/opt/rudder; fi
  fi
  export RUDDER_HOME RUDDER_AUDIO=browser
  # The engine refuses a non-loopback Host header, and Vite's proxy passes the public host through, so
  # EVERY host the container answers on must be listed (an unlisted one leaves Rudder "offline" there).
  # An explicit list, never a wildcard: RUDDER_ALLOW_HOST if set, else the hosts Coolify gives the
  # container (COOLIFY_FQDN, comma-separated), else the host in OIDC_REDIRECT_URL.
  if [ -z "${RUDDER_ALLOW_HOST:-}" ] && [ -n "${COOLIFY_FQDN:-}" ]; then
    RUDDER_ALLOW_HOST=$(printf '%s' "$COOLIFY_FQDN" | sed -E 's#[a-z]+://##g; s#[/:][^,]*##g')
  fi
  if [ -z "${RUDDER_ALLOW_HOST:-}" ] && [ -n "${OIDC_REDIRECT_URL:-}" ]; then
    RUDDER_ALLOW_HOST=$(printf '%s' "$OIDC_REDIRECT_URL" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
  fi
  echo "[rudder] allowed hosts: ${RUDDER_ALLOW_HOST:-loopback only}"
  export RUDDER_ALLOW_HOST="${RUDDER_ALLOW_HOST:-}"
  # The state file is read by vite.cloud.config.mjs: running -> done | failed.
  echo running > /tmp/rudder-setup.state
  # disown: the `wait -n` at the end must not treat this job finishing as the container's exit.
  ( if bash /app/repo/backend/rudder-engine/setup-runtime.sh >&2; then echo done; else
      echo "[rudder] setup failed: the widget will report the engine offline" >&2; echo failed; fi \
    > /tmp/rudder-setup.state.new && mv /tmp/rudder-setup.state.new /tmp/rudder-setup.state ) &
  disown
fi

if [ -z "${OIDC_ISSUER:-}" ] && [ "$DEV_SERVER" = off ]; then
  # Without oauth2-proxy nothing stands in front of /pb and /admin (their admin check trusts its headers).
  echo "refusing to start: DEV_SERVER=off serves /pb and /admin, which need the sign-in; set OIDC_ISSUER" >&2
  exit 1
fi
if [ -z "${OIDC_ISSUER:-}" ] && [ "${ACCESS:-}" != public ]; then
  # Open, like a laptop: no sign-in, no backend.
  export VITE_HOST=0.0.0.0 VITE_PORT="$PORT"
  exec bun x vite --config "$CONFIG"
fi

if [ "${ACCESS:-}" != public ]; then
  # OIDC_AUTO_SIGNIN=1: no "Sign in with …" button page; an unsigned visitor goes straight to the provider. It lets
  # the Studio sign in INSIDE a frame (e.g. a dashboard tile): for a user already signed in to the provider the whole
  # round trip is redirects, so the provider's own no-framing headers never apply.
  AUTO=(); [ "${OIDC_AUTO_SIGNIN:-0}" = 1 ] && AUTO=(--skip-provider-button)
  # OIDC gate: oauth2-proxy owns the public port; Vite listens on localhost behind it, so the Plugin
  # Studio, every map and the hot-reload websocket are all behind the same sign-in.
  : "${OIDC_CLIENT_ID:?}" "${OIDC_CLIENT_SECRET:?}" "${OIDC_REDIRECT_URL:?}"
  if [ -z "${OIDC_ALLOWED_GROUPS:-}" ]; then
    echo "refusing to start: set OIDC_ALLOWED_GROUPS (comma-separated). With open sign-up, anyone could log in." >&2
    exit 1
  fi
  ALLOW=(); IFS=',' read -ra G <<< "$OIDC_ALLOWED_GROUPS"
  for g in "${G[@]}"; do g="${g// /}"; [ -n "$g" ] && ALLOW+=(--allowed-group="$g"); done

  # Secrets reach oauth2-proxy through its environment, never its command line.
  export OAUTH2_PROXY_CLIENT_SECRET="$OIDC_CLIENT_SECRET"
  export OAUTH2_PROXY_COOKIE_SECRET="${OIDC_COOKIE_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)}"
fi

# Backend: PocketBase DEV (/pb/, signed-in) and PROD (/api-prod/, public API only); data = the /data volume.
# The superuser comes from env, never printed. SCHEMA: dev runs the migrations in this checkout (BRANCH, the
# table); prod runs ONLY the production branch's (PRODUCTION_BRANCH), from its own snapshot under /data
# (pb-prod-migrations.sh), refreshed by build-cdn.sh when a publish lands. Never from this checkout.
MIG=/app/repo/backend/pocketbase/pb_migrations; mkdir -p "$MIG" /data/pb-dev /data/pb-prod /data/cdn
bash /app/repo/deployment/cloud/pb-prod-migrations.sh fetch
PROD_MIG=/data/pb-prod-migrations/current
for inst in dev prod; do
  if [ -n "${PB_SUPERUSER_EMAIL:-}" ] && [ -n "${PB_SUPERUSER_PASSWORD:-}" ]; then
    pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" --dir "/data/pb-$inst" >/dev/null 2>&1 \
      && echo "[pb-$inst] superuser set" || echo "[pb-$inst] superuser upsert failed"
  fi
done
# Server-side JS hooks from the REPO are OFF: --hooksDir never points into the pulled tree, so a pb_hooks/
# folder pushed by a plugin writer can't run code (v1 has no per-plugin isolation for hooks). prod runs
# none; dev runs only the team sign-in gate BAKED INTO THE IMAGE (Dockerfile, SHA-256 pinned).
NOHOOKS=/var/empty/pb_hooks_disabled
GATE=/app/pb_hooks_gate
DEV_HOOKS=$NOHOOKS; [ -f "$GATE/team-gate.pb.js" ] && DEV_HOOKS=$GATE
pocketbase serve --http 127.0.0.1:8090 --dir /data/pb-dev --migrationsDir "$MIG" --hooksDir "$DEV_HOOKS" &
# pb-prod runs in a restart loop: after a publish that changes its schema, build-cdn.sh stops it (PID in
# /tmp/pb-prod.pid) and it comes straight back on the new migrations, which PocketBase applies at start. The loop
# never ends, so a pb-prod exit restarts pb-prod, not the container. --automigrate=false: a change made in its
# dashboard writes no migration file anywhere.
( while :; do
    pocketbase serve --http 127.0.0.1:8091 --dir /data/pb-prod --migrationsDir "$PROD_MIG" --automigrate=false \
      --hooksDir "$NOHOOKS" &
    echo $! > /tmp/pb-prod.pid; wait $!
    echo "$(date -u +%FT%TZ) [pb-prod] exited ($?); starting again on $(basename "$(readlink "$PROD_MIG")")"; sleep 1
  done ) &
bun /app/repo/deployment/cloud/admin.mjs &
# The Studio's own /api/pb (the repo's dev backend plugin) goes through admin.mjs's /pb, so the same gates apply
# (the dashboard and _superusers for admins only), and plugins that use PocketBase reach it here too. Without
# this the plugin answered 503 (it found the port taken and started nothing).
export DX_PB_URL="${DX_PB_URL:-http://127.0.0.1:5175/pb}"
if [ "${ACCESS:-}" = public ]; then
  # Vite owns the public port; vite.cloud.config.mjs forwards /cdn/, /api-prod/, /pb/ and /admin/ to admin.mjs.
  export DX_PUBLIC_STUDIO=1
  echo "[access] public: the Plugin Studio is open on :$PORT; /admin/, publishing and PocketBase's dashboard ask for ADMIN_USER/ADMIN_PASSWORD"
  VITE_HOST=0.0.0.0 VITE_PORT="$PORT" bun x vite --config "$CONFIG" &
  wait -n
  exit $?
fi

# TEAM PB: laptops reach pb-dev's API WITHOUT the site sign-in (DX_PB_URL=https://<host>/pb), and PocketBase
# itself signs people in through the same OIDC provider, members of OIDC_ALLOWED_GROUPS only (the baked
# gate). Fails CLOSED: /pb/api/ is opened only when the gate is in place AND the OIDC setup succeeded;
# otherwise pb-dev stays behind the site sign-in, as before. /pb/_/ (dashboard) and _superusers never open.
PB_PUBLIC=()
if [ -n "${PB_OIDC_CLIENT_SECRET:-}" ]; then
  for _ in $(seq 60); do curl -s -o /dev/null http://127.0.0.1:8090/api/health && break; sleep 0.5; done
  PB_APP_URL="${PB_APP_URL:-$(printf '%s' "$OIDC_REDIRECT_URL" | sed -E 's#^([a-z]+://[^/]+).*#\1#')/pb}"
  if [ "$DEV_HOOKS" = "$GATE" ] && PB_APP_URL="$PB_APP_URL" bun /app/repo/deployment/cloud/pb-oidc.mjs; then
    PB_PUBLIC=(--skip-auth-route='^/pb/api/(health|realtime|oauth2-redirect|batch)$'
               --skip-auth-route='^/pb/api/files/'
               --skip-auth-route='^/pb/api/collections/[^_/][^/]*/')
    echo "[pb-dev] team API open at /pb/api/ (sign-in through PocketBase; dashboard stays gated)"
  else
    echo "[pb-dev] team sign-in NOT configured: /pb/ stays behind the site sign-in" >&2
  fi
fi

if [ "$DEV_SERVER" = on ]; then
  VITE_HOST=127.0.0.1 VITE_PORT=5174 bun x vite --config "$CONFIG" &
  ROOT=http://127.0.0.1:5174/
else
  ROOT=http://127.0.0.1:5175/   # the admin router: / redirects to /cdn/
fi
oauth2-proxy \
  --provider=oidc \
  --oidc-issuer-url="$OIDC_ISSUER" \
  --client-id="$OIDC_CLIENT_ID" \
  --redirect-url="$OIDC_REDIRECT_URL" \
  --code-challenge-method=S256 \
  --scope="${OIDC_SCOPE:-openid profile email groups}" \
  --oidc-groups-claim="${OIDC_GROUPS_CLAIM:-groups}" \
  "${ALLOW[@]}" \
  --email-domain='*' \
  --provider-display-name="${OIDC_DISPLAY_NAME:-your identity provider}" \
  "${AUTO[@]}" \
  --upstream="$ROOT" \
  --upstream=http://127.0.0.1:5175/cdn/ \
  --upstream=http://127.0.0.1:5175/api-prod/ \
  --upstream=http://127.0.0.1:5175/pb/ \
  --upstream=http://127.0.0.1:5175/admin/ \
  --skip-auth-route='^/cdn/' \
  --skip-auth-route='^/api-prod/api/' \
  "${PB_PUBLIC[@]}" \
  --http-address="0.0.0.0:$PORT" \
  --reverse-proxy=true \
  --cookie-secure=true \
  --cookie-samesite=lax &
wait -n
exit $?
