# Backends, data, and users

Most plugins need no backend. A map that draws its own data files, fetches a public API, or reads
`data/` inside its bundle is complete without one. Reach for this page only when your plugin needs
a service or stored data.

## What exists today

`backend/` holds exactly two things:

| Folder | What it is |
|---|---|
| `backend/pocketbase/` | the database: migrations, and the local instance `bun run dev` starts |
| `backend/rudder-engine/` | the local speech engine for the Rudder voice plugin |

A plugin that needs one names it in its `<profile>.meta.json` `"backend"` key, as
`plugin-designs/rudder-voice/rudder-voice.meta.json` does with `"backend": "backend/rudder-engine"`.

A plugin that needs a local backend almost certainly also needs `"targets"` without `web`, which
keeps it out of Deep Research — see `targets.md`. Rudder declares both.

## The database rule: schema is a commit, never a click

**You never publish a database.** What travels between people is the *shape* — tables and fields —
as migration files committed to `backend/pocketbase/pb_migrations/`. Adding a field is a normal
change: edit, commit the migration, push it like any other file.

This is deliberate. A rule that opens data to the public arrives as **a commit someone can read**
rather than as a setting somebody clicked. `documentation/HOWTO-join-the-table.md` is the full
explanation.

**New collections start locked.** Your plugin's data is not readable until a migration opens it, so
nothing is public by accident.

### Which database your laptop talks to

By default, your own. `bun run dev` starts a local instance, keeps its data in `.pb/`, and gives
you an admin screen at `/api/pb/_/`. A fresh clone plus `bun run dev` is the whole setup.

Pointing at the team's shared test data is opt-in, one line in `.env.local`:

```
DX_PB_URL=https://<your team's dev server>/pb
```

`DX_PB_PORT` is the only other one, and only if the log says port 8090 is in use. The full set of
environment names is in `.env.example`: `VITE_MAPBOX_TOKEN`, `VITE_API_BASE_URL`, `DX_SYNC_REMOTE`,
`DX_SYNC_BRANCH`, `DX_SYNC_INTERVAL`, `DX_PB_URL`, `DX_PB_PORT`. Every line is optional; empty means
the all-local default.

---

## User tiers — DESIGN INTENT, NOT BUILT

> **Read this heading literally.** What follows is a *planned* model recorded in the project's
> architecture notes as an open, unproven assumption. **None
> of it is implemented in this repo.** Do not design your plugin around it, do not write code that
> assumes a tier exists, and do not tell anyone a plugin "supports" these. It is here so you
> recognise the vocabulary when it comes up, and so you do not invent a competing scheme.

The intended tiers, which parallel the five plugin capabilities:

| Tier | Intended meaning |
|---|---|
| anonymous | reaches the plugin by URL, no sign-in |
| access-code | temporary access without an account |
| plugin user | authenticated against the database |
| base OIDC member | signed in through the platform's identity provider |
| plugin admin | administers one plugin |
| PB plugin owner | owns a plugin's data |
| PB plugin writer | writes a plugin's data, with **no access to other plugins' data** |

Quantum Forms is named as the reference plugin that would exercise every tier.

**Source.** This is recorded in `ARCHITECTURE-EQUATION.md` §6, which lives in the project's QA
cycle **outside this code repository** (`_qa-cycle/03-deployment-cycle/`). It is quoted here rather
than linked because a reader who clones this repo will not have that file. If you need the
authoritative text, ask whoever maintains the QA cycle — do not reconstruct it from this summary.

### What to do in the meantime

If your plugin needs any notion of "who is this" today, use what is actually built: PocketBase auth
plus a migration that opens exactly the collection you need, and nothing wider. Do not hand-roll a
permission model to bridge the gap — the last tier above ("no access to other plugins' data") is the
property a hand-rolled scheme tends to break, and breaking it crosses plugins.

## Related

- `targets.md` — the `targets` and `backend` meta keys
- `workflow.md` — landing a migration on main like any other file
- `documentation/HOWTO-join-the-table.md` — the three databases, in full
