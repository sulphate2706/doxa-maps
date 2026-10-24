# documentation/ — pick your path

```
        "what is this?"          "teach me"        "how do I …?"       "look it up"      "all the detail"
             │                       │                   │                  │                  │
         why.md  ──────────►  tutorial.md  ────►  how-to.md  ────►  reference.md  ───►  architecture/
        (2 min, 1 diagram)   (first map)         (task recipes)     (tables)           (contracts)
```

- **[why.md](./why.md)** — the problem and the "map islands" idea. Start here.
- **[tutorial.md](./tutorial.md)** — build your first map, no jargon.
- **[how-to.md](./how-to.md)** — recipes: embed, iframe, SPA, colors, CDN, mobile, tokens.
- **[reference.md](./reference.md)** — config fields, build scripts, the `profile-config` contract.
- **[explanation.md](./explanation.md)** — the model in 15 lines.
- **[architecture/](./architecture/)** — the deep end: full contracts, the per-file catalog.
- **[README-embed-example.md](./README-embed-example.md)** — the drop-in README used when this bundler is embedded inside a host repo.
- **[README-embed-gospel-resources.md](./README-embed-gospel-resources.md)** — the gospel map's URL contract for partner embeds: bring your own ISO 639-3 list, one country, one group, or the zero-access view.

Working on the repo:

- **[develop-a-plugin-and-see-it-live.md](./develop-a-plugin-and-see-it-live.md)** — ★ the golden path: zero to a plugin live, in 6 steps.
- **[README-SECTION-3-cli-commands.md](./README-SECTION-3-cli-commands.md)** — every command, per deployment method, with prerequisites.
- **[reference-capability-exemplars.md](./reference-capability-exemplars.md)** — which bundle is at which capability tier (generated).
- **[reference-library-index.md](./reference-library-index.md)** — the reusable `library/` pieces you can import (generated).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** and **[contributing/](./contributing/)** — how to contribute, and the bar for `library/`.

Nothing on the simple path is longer than a few minutes; everything complex lives in
`architecture/`, linked from where you'd need it.
