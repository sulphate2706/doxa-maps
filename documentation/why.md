# Why doxa-maps

## The problem

You built a good map. Now ten partner teams want it on *their* websites — one runs
WordPress, one runs Nuxt, one is a plain landing page, one is a link-dashboard like Start.me.
The usual answers are all bad:

- **Rebuild the map for each site** — ten codebases to keep in sync.
- **Give everyone an iframe** — clunky, hard to style, another server to run.
- **Ship a framework widget** — now every host must adopt your framework and your build step.

And when the data or the design changes, you get to do it ten times.

## The answer: map islands

doxa-maps builds each map into a **self-contained island** — one `.js` file that registers a
standard HTML element. The host page drops it in like an image. It carries its own Vue, its own
CSS, its own logic; the host needs **no framework and no build step**.

```
   A PARTNER'S PAGE (theirs — any stack, or none)
   ┌───────────────────────────────────────────────┐
   │  their header                                  │
   │  their text …                                  │
   │  ┌─────────────────────┐                       │
   │  │  <doxa-map>          │ ← your island:        │
   │  │   pins · legend ·    │   one <script>,       │
   │  │   search · share     │   self-contained      │
   │  └─────────────────────┘                       │
   │  their footer                                  │
   └───────────────────────────────────────────────┘
        ten sites, same island, one build
```

Change the map once, rebuild once — every site that embeds it updates, because they all load the
same file from your CDN.

## A bundler, not a framework

doxa-maps is a **build-time tool**. What it outputs is the standard — plain
[web components](https://developer.mozilla.org/docs/Web/API/Web_components) — so the maps keep
working in any host that can render HTML, today and after any framework fashion changes. Hosts
never install anything from us; they paste two tags.

## JAMstack: the map is static, the wiring is runtime

Each island is a static file, but everything it *talks to* is a runtime setting read from the
page (`profile-config`, `window.MAP_APP_API_URL`): point it at a different API, different data,
a different Mapbox token — even a different map engine (Mapbox ↔ MapLibre) — with **no rebuild**.
That's the JAMstack trade: prebuild the app, decide the connections at load time.

## One build, three products

The same islands compose three ways — this is why there's one bundler, not three tools:

1. **Embeds** — each island on partner sites, docs, dashboards.
2. **A SPA** — several islands in one lazy-loaded layout = a full map site.
3. **A mobile app** — Capacitor wraps the same built folder into Android/iOS.

## Where this architecture thrives

The bundler is complete on its own — but it was built to thrive inside an **internal developer
platform**: one that detects the built bundles as plugins, onboards multiple users
(multi-tenant), gives them MCP/agent access to prototype new maps rapidly *without rebuilding
the platform*, funnels feedback, and runs the builds in CI/CD. The bundler ships with none of
that — it just supports all of it. Pair it with such a platform and the multiplication
compounds: one build multiplies maps; a platform that exports whole configured tenants
multiplies deployments; together they multiply each other.

## Prior art, honestly

None of the pieces are ours: web components are a browser standard, JAMstack is a movement,
Vite does the bundling, the islands idea comes from the wider frontend world (Jason Miller,
Katie Sylor-Miller; popularized by Astro). doxa-maps' contribution is small and deliberate —
one shared map library, N independent islands, one build.

---

*What it is: [explanation.md](./explanation.md) · learn: [tutorial.md](./tutorial.md) · tasks:
[how-to.md](./how-to.md) · lookup: [reference.md](./reference.md) · the deep end:
[architecture/](./architecture/)*
