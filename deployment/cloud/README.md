# Run dx-maps in the cloud: one shared dev server for a team

One container runs the Plugin Studio with hot reload for everyone. It clones the repo, pulls the
branch every few seconds, and Vite hot-reloads whatever changed, so every change an agent lands
on `main` shows up in everyone's browser within seconds. No rebuild; `bun run build` is only for
publishing.

With **no OIDC settings** it runs open, like `bun run dev` on a laptop. With **OIDC settings** a
sign-in page ("Sign in with *your provider*") sits in front of everything: the Studio, every map,
and the hot-reload websocket. Only people in the allowed groups get in. Open is for a laptop or a
private network only: it has none of the public mode's guards. On a public host, use the sign-in or
[`ACCESS=public`](#public-studio-accesspublic).

## Deploy

1. Build the image from the repo-root [`Dockerfile`](../../Dockerfile). It's a small bootstrap (Bun, git,
   and the [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) binary); at start it clones the
   repo and runs [`entry.sh`](./entry.sh) from it, so the recipe updates with the repo. Point a
   container host at the repo, or paste the file into one: see [Where it runs](#where-it-runs).
2. Set the environment below and expose the container's `PORT` over HTTPS.
3. Give it about 2 GB of memory (Vite plus the dependency install).

| Variable | Needed | Meaning |
|---|---|---|
| `REPO_URL` | yes | the dx-maps git URL to clone |
| `BRANCH` | no (`main`) | the branch to follow |
| `PULL_INTERVAL` | no (`15`) | seconds between pulls; `0` never pulls (for a checkout mounted from your machine: a pull resets it hard) |
| `GIT_TOKEN` | private repos | a read token for the clone and pulls |
| `PORT` | no (`5173`) | the port the container serves on |
| `DEV_SERVER` | no (`on`) | `off` runs a tenant without the Plugin Studio dev server: no Vite, no pulls, no Rudder; `/` redirects to `/cdn/`. Needs the sign-in (`OIDC_ISSUER`); refused with `ACCESS=public` |
| `HMR_CLIENT_PORT`, `HMR_PROTOCOL` | behind HTTPS | `443` and `wss`, so browsers reach the hot-reload websocket |

## Where it runs

The container needs a Dockerfile build, a persistent volume at `/data` and about 2.5 GB of memory.

| Platform | Build | `/data` |
|---|---|---|
| Coolify | the "Dockerfile" build pack (default location `/Dockerfile`) | Persistent Storage, mount path `/data` |
| Dokploy | Build Type "Dockerfile" (path `Dockerfile`) | Advanced, Volumes: mount path `/data` |
| Railway | finds the root `Dockerfile` by itself; set `PORT=5173` | add a volume at `/data`. Railway deploys from GitHub, a local directory or an image |
| A server with Docker | `docker compose up -d --build`, with the root [`compose.yaml`](../../compose.yaml). It reads the repo-root `.env`, the same file `bun run dev` reads, so on a server keep only the container's settings there | the compose file's `dx-data` volume |
| Kubernetes | build the image in CI (BuildKit, Buildah) and push it to a registry | a PersistentVolumeClaim at `/data` |
| DigitalOcean App Platform | not suitable | it has no persistent volumes, so PocketBase's data would be lost on every deploy |

There is no Railpack file. Railpack is Railway's default builder (Coolify and Dokploy offer it too), but it
can't reuse this Dockerfile; the container is defined here, once.

## Sign-in (optional)

Set all of these to turn the gate on. Register a **confidential** client at your OIDC provider
with the redirect URL `https://<your-host>/oauth2/callback`; PKCE (S256) is used as well.

| Variable | Meaning |
|---|---|
| `OIDC_ISSUER` | the provider's issuer URL (its `/.well-known/openid-configuration` must resolve) |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | the registered client |
| `OIDC_REDIRECT_URL` | `https://<your-host>/oauth2/callback` |
| `OIDC_ALLOWED_GROUPS` | comma-separated groups allowed in; **required** (the server refuses to start without it, because many providers allow open sign-up) |
| `OIDC_DISPLAY_NAME` | the name on the button, e.g. "Sign in with *Acme*" |
| `OIDC_GROUPS_CLAIM` | the token claim holding groups (default `groups`) |
| `OIDC_COOKIE_SECRET` | 32 characters; keeps people signed in across restarts (random if unset) |

Secrets reach oauth2-proxy through its environment, never its command line.

## Public Studio (`ACCESS=public`)

For a team whose Plugin Studio should be open to everyone: no sign-in provider. The Studio, every map and the
backend's public API are open. The admin parts ask for a username and password, set when you deploy.

| Variable | Meaning |
|---|---|
| `ACCESS` | `public` turns this mode on. OIDC settings are then ignored; unset `ACCESS` to use the sign-in |
| `ADMIN_USER`, `ADMIN_PASSWORD` | guard `/admin/` (publishing), PocketBase's dashboard `/pb/_/` and its `_superusers`. `ADMIN_PASSWORD` is required (the container refuses to start without it); use a long random one. `ADMIN_USER` defaults to `admin` |

| Route | Who |
|---|---|
| `/` | anyone: the Plugin Studio, with hot reload |
| `/cdn/dx-maps/`, `/api-prod/api/` | anyone, as in the signed-in mode |
| `/pb/api/` | anyone, as PocketBase's own record rules allow. People sign in with PocketBase's own accounts |
| `/pb/_/`, `/pb/api/collections/_…`, `/admin/*` | `ADMIN_USER` / `ADMIN_PASSWORD` (the browser asks) |

Also in this mode:
- Rudder's voice engine stays off.
- Gated bundles (`gatedProfiles`) are refused even by URL.
- Vite's `/__open-in-editor` is refused.

In both modes, the Studio's own `/api/pb` goes through the same gates as `/pb/`.

## Backend and production (v1, experimental)

With the sign-in on, the container also runs PocketBase and can publish a production build:

| Route | Who | What |
|---|---|---|
| `/` | signed-in | the dev server (Plugin Studio, hot reload) |
| `/pb/` | signed-in (its `/_/` dashboard: `OIDC_ADMIN_GROUPS` only). With `PB_OIDC_CLIENT_SECRET`, its `/api/` is public and PocketBase signs people in itself (see below); `_superusers` and system collections stay admin-only | PocketBase **dev**, the team's shared backend |
| `/api-prod/api/` | **public** | PocketBase **prod**'s API; its dashboard, its superuser and its `_` system collections are never exposed |
| `/cdn/dx-maps/` | **public** | the last published build: `manifest.json` at a stable URL, CORS open for embeds |
| `POST /admin/build` | `OIDC_ADMIN_GROUPS` only | build and publish the pulled commit |
| `GET /admin/status` | signed-in | the published and pulled commits, and whether a build is running |

A build runs one at a time (a second gets `409`), on a snapshot of the pulled commit, with Node's heap
capped. It removes everything in [`public-exclusions.txt`](./public-exclusions.txt) **before**
building, checks the output again afterwards, and refuses to publish if anything excluded is still
there. Only then does it swap the new build in.

| Variable | Meaning |
|---|---|
| `OIDC_ADMIN_GROUPS` | comma-separated groups allowed to build and to open PocketBase's dashboard |
| `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` | PocketBase's superuser, set on start in both instances |
| `PB_OIDC_CLIENT_SECRET` (+ `PB_OIDC_CLIENT_ID`, default `dx-maps-pb-dev`) | turns pb-dev into the team backend: laptops use it directly (`DX_PB_URL=https://<host>/pb`), and people sign in to PocketBase through the same OIDC provider, with its own client whose redirect URI is `https://<host>/pb/api/oauth2-redirect`. Only members of `OIDC_ALLOWED_GROUPS` get in (a sign-in hook baked into the image and pinned; the repo's own hooks never run). Password sign-in is off, new collections are superuser-only until a migration opens them, and data never leaves `/data` |
| `PRODUCTION_BRANCH` | the branch `/cdn/` is built from (default `main`); the dev server keeps following `BRANCH`. It moves only on a publish |
| `EMBED_BASE_URL` | the address the published `dx-maps/` folder sits under, so the manifests' copy-paste snippets are absolute: `https://<host>/cdn` (it is served at `/cdn/dx-maps/`), or a research subdomain's `https://research.<host>` (served at `/dx-maps/`). Unset, the snippets stay relative (`./…`) and other sites can't paste them |
| `CDN_AUTOBUILD_MINUTES` | rebuild `/cdn/` by itself once `PRODUCTION_BRANCH` has held a new commit this long (default `2`; `0` = only the admin button) |
| `OIDC_AUTO_SIGNIN` | `1` skips the "Sign in with …" button and goes straight to the provider, so the Studio can sign in inside a frame (a dashboard tile) for anyone already signed in to the provider. Default off |
| `SUBDOMAIN_APPS` | publish plugins as their own PUBLIC sites: `host=bundle/profile`, comma-separated, e.g. `research-gallery.example.org=doxa-maps-spa/doxa-maps-spa`. Served from the `/cdn` build by a separate server on `SUBDOMAIN_PORT` (default `5176`) that answers only those hosts and only with published files; point each host's proxy route at that port. No sign-in is skipped anywhere else |
| `PUBLIC_API_BASE` | the public API URL written into the build's `runtime-config.js` (e.g. `https://<host>/api-prod`) |
| `BUILD_MAX_OLD_SPACE_MB` | Node heap cap for a build (default `1536`) |
| `RUDDER_ENGINE` | `1` runs Rudder's voice-to-text engine here, fed by the browser's microphone (about 1 GB more; its runtime and model, ~742 MB, are baked into the image at `/opt/rudder`, and `/data/rudder` wins when it holds a model). The site serves at once; Rudder shows "starting" until its engine is built, then the dev server restarts once to start it. Give the container at least 2 vCPUs, or transcription falls behind speech |
| `RUDDER_ALLOW_HOST` | every public host the engine accepts, comma-separated (it refuses others, so list each domain the container answers on); defaults to Coolify's `COOLIFY_FQDN`, else the host in `OIDC_REDIRECT_URL` |

Mount a persistent volume at **`/data`** (PocketBase data and published builds). Memory measured on
the running container: about 0.45 GB idle, up to about 1.5 GB more during a build, so give it
**2.5 GB** (**3.5 GB** with `RUDDER_ENGINE=1`).
