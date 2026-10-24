# documentation/architecture/ — the deep end

Everything complex lives here, on purpose. The rest of the docs stay simple ("what it does");
when a simple doc says *"full contract in architecture/…"*, this is where it points.

| Doc | What it holds |
|---|---|
| [file-map.md](./file-map.md) | every file, one line each, with the gotcha each carries |
| [data-sources.md](./data-sources.md) | the `api/` seam — connection contract + add-a-source checklist |
| [color-strategies.md](./color-strategies.md) | the color-strategy contract + legend wiring |
| [components.md](./components.md) | shared component catalog + shadow-DOM conventions |
| [i18n.md](./i18n.md) | the locale contract + add-a-language checklist |
| [embeddability.md](./embeddability.md) | the generated per-map pages + manifest that make every map embeddable by default |
| [app-wrappers.md](./app-wrappers.md) | the SPA shell: `nav.js` + `PROFILES` contracts, `bun run shell` pipeline |
| [poster-generation.md](./poster-generation.md) | the poster/preview generator pipeline |
| [patterns-and-provenance.md](./patterns-and-provenance.md) | the two multi-map patterns in depth + where the design comes from |

Simple docs: [../why.md](../why.md) · [../tutorial.md](../tutorial.md) · [../how-to.md](../how-to.md) ·
[../reference.md](../reference.md) · [../explanation.md](../explanation.md)
