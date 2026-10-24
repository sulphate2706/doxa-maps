# What doxa-maps is

A portable bundler for embeddable maps. One shared `library/`, many `plugin-designs/<map>/`
folders; one build turns each map into a self-contained web component.

**The one idea worth knowing:** each map builds to a standard web component, so it drops into
any host unchanged — it runs standalone, embedded in a site's `public/` folder, or inside
another platform, no modifications. Same build → embed one map, compose several into a
lazy-loaded SPA, or wrap a Capacitor mobile app.

That's the model. For the story of *why* it's shaped this way, read **[why.md](./why.md)**.
For the practical docs:

- **[tutorial.md](./tutorial.md)** — build your first map
- **[how-to.md](./how-to.md)** — do a specific task
- **[reference.md](./reference.md)** — config + library lookup
