# PocketBase — the backend for plugins that need one

The cloud container ([deployment/cloud](../../deployment/cloud/README.md)) runs two PocketBase
instances: **dev** (behind the team sign-in, for building) and **prod** (its `/api/` public, for
published plugins). Both apply the migrations in [`pb_migrations/`](./pb_migrations/) on start, so
**the schema lives in git** and publishing never copies data from dev to prod.

A plugin reads its backend address at runtime (`profile-config` `apiBase`, or
`window.MAP_API_BASE` set by the published build's `runtime-config.js`), so moving the backend never
needs a rebuild.

v1 limits: collection rules are the only access control (lock collections by default); no per-plugin
isolation between plugin authors yet.
