# bless-india-posters — whole-India poster attempts (generative, experimental)

A preview surface for the hardest poster we make: every one of India's ~855 people groups on one
printable sheet. Each design attempt is **generated live** from the current people-group data — nothing
is stored — and shown the way Poster Design's Sizes view shows the big formats: the sheet split into its
printable sheets with the glue strips between them.

Every poster carries the blessing: the header **"Bless India in Jesus' name"** and, as the footer, the
Aaronic blessing (Numbers 6:24-26, public-domain World English Bible, British Edition — switchable).

- **Public + experimental.** The attempts ship in the public build for this plugin; the whole-country
  poster on Country Posters stays withheld (not shipped) until it prints legibly.
- **Phone-safe by default.** A phone sees the preview, but Print is blocked with a "desktop only" message
  until a design is proven to generate and print on a phone without crashing.
- **Prints as a document.** A flat image can't carry people-group photos (the photo hosts send no CORS),
  and a 60×96 sheet rasterised onto letter would be shrunk — so Print opens the poster as its own document
  at its true size.

## Files
- `index.js` — registers `<bless-india-posters>` and the `blessIndia` poster type (for the catalogue).
- `bless-india-posters.vue` — the view: generate live → the W via the shared library `PanelSheets` + print.
- `src/generate.js` — records + boundaries + format → the finished poster SVG/HTML (pure wiring).
- `src/generators/` — the plugin's own copy of the renderer (a stopgap; attempts move onto the shared
  `@map` circular-layout module when it lands, and this copy is deleted).
- `src/blessIndiaPosterType.js` — the poster-type adapter. `src/boundaries.js` — the India boundary fetch.
