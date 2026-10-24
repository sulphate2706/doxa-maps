# Working when your agent lives on a server

Most people do not need this page. If you are editing on your own laptop, start with
[HOWTO-join-the-table.md](./HOWTO-join-the-table.md) — a fresh clone and `bun run dev` gives you
everything, with nothing to configure.

This page is for one situation: **your coding agent runs on a server, not on your laptop.** Then the edits
appear somewhere you are not sitting, and you want to see them.

There are two ways. **The first is better for almost everyone.** The second is here because it is
sometimes the right answer, and because you should know what it costs before you choose it.

---

## Option 1 — keep working locally, and follow the remote (recommended)

Your laptop keeps running `bun run dev` exactly as before. You add **one line** so it follows the branch
your agent pushes to, and your browser hot-reloads when the agent lands something.

In `.env` (or `.env.local`) at the repo root:

```
DX_SYNC_REMOTE=https://<host>/<owner>/<repo>.git
```

A remote name like `origin` works too. Both files are gitignored; if both set it, `.env.local` wins.

That really is the whole setup. You keep everything good about working locally — the Plugin Studio,
dictation, your own database — and you additionally see your agent's work arrive.

### Two conditions, and the second one catches people

**If the repo is private**, your laptop needs git credentials that work without a prompt: either a
credential helper you already use, or a token in the URL. It never asks interactively. A token in the URL
is never written to a log.

**Your checkout has to be in a state where a fast-forward is safe.** All three of these:

- you are on the branch it follows (`DX_SYNC_BRANCH`, default `development`)
- you have no unsaved edits
- you have no local commits of your own

> **This is the one that surprises people.** If you have your own work in progress, the sync **stops
> pulling** — it will not touch your files. It reports `development is N commits ahead` instead and waits.
>
> That is deliberate and it is protecting you. But it means: **push your own work, or you will drift.**
> If you leave local commits sitting for a day while your agent lands twenty changes, the pull you
> eventually do has a day of divergence in it. Push little and often and this never happens.

Two optional dials:

| | what it does | default |
|---|---|---|
| `DX_SYNC_BRANCH` | which branch to follow | `development` |
| `DX_SYNC_INTERVAL` | seconds between checks | `5` |

---

## Option 2 — run the shared cloud dev server

Instead of your laptop rendering the branch, a container on a server does, and everyone opens the same URL.

From the repo root:

```bash
docker build -t dx-maps-dev deployment/cloud
docker run -d -p 5173:5173 \
  -e REPO_URL=https://<host>/<owner>/<repo>.git \
  -e BRANCH=main \
  -v dx-maps-data:/data \
  dx-maps-dev
```

Add `-e GIT_TOKEN=<read token>` for a private repo. Then `http://<server>:5173/` is the Plugin Studio.

You can also paste the Dockerfile into a host like Coolify using its "Dockerfile" build pack and give it a
domain, so it is `https://<your-domain>/`. The full settings table is in `deployment/cloud/`'s own README.

> **If it is reachable from the internet, put a sign-in in front of it.** Add the `OIDC_*` settings from
> that README. Do not expose it publicly without them.

### What this costs you

This is the honest list. None of it is a dealbreaker; all of it is worth knowing first.

- **No dictation.** The speech engine can run there, but on a 2-CPU server it falls about 4 seconds behind
  the speaker, so it is switched off. Dictation is a laptop feature.
- **Nobody edits on it.** Changes only arrive by pushing to the branch; it pulls every 15 seconds and
  reloads. It is a shared *viewer* of the branch, not a workspace.
- **Everyone shares one running copy.** A push that breaks the build breaks it for everybody until someone
  fixes it.
- **It needs a real server** — roughly 2.5 GB of RAM and 2 vCPUs.
- **Its database is the shared team one**, not a private one per person.

---

## Which to pick

**Option 1**, unless you have a specific reason not to. You keep dictation, you keep your own database, a
broken push only breaks your own screen, and the setup is one line in a file you already have.

Option 2 earns its place when the *point* is that everyone looks at the same thing — a review, a demo, a
room full of people who should not each be running a build. It is a viewing gallery, not a workshop.

You can use both: follow the remote on your laptop for daily work, and open the shared server when the
team wants to look at something together.
