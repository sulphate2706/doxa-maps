<!-- MOVED OUT OF THE SERVED FOLDER, 2026-09-24. This lived at
     public/assets/fonts/noto-serif-devanagari/README.md, where check:public-hygiene flagged it
     (twice — the source copy and the copy generate-tree stages into the tree) as "documentation in
     a served folder", and that finding was red-gating build:unlocked for every builder.
     The CONTENT is kept verbatim because it answers a question the files cannot: why this font is
     vendored at all, and why 400 and 700 resolve to one variable file.
     The font's LICENSE (SIL OFL 1.1) deliberately STAYS beside the woff2 — that one is a
     distribution obligation, not documentation, and removing it would breach the licence. -->

# Noto Serif Devanagari — the Devanagari subset only

**Why vendored:** the prayer packet's font stack is Georgia / Palatino Linotype /
serif, none of which carry Devanagari. Measured by rendering Devanagari at 48px
and READING THE PIXELS, Hindi came out as **tofu boxes** — this machine has zero
Devanagari fonts (`fc-list`). A `hi` translation without this file would ship a
page of empty rectangles.

**Licence:** SIL Open Font License 1.1 (see `LICENSE`). Free to bundle and serve.

**Subset:** `U+0900-097F` plus the Devanagari extensions Google's own subsetting
selects — the *devanagari* range ONLY, matching how `poppins/` ships `latin` and
`latin-ext` separately so a page downloads only what it needs. 124 KB, against
6-8 KB for a Latin subset; that is the cost of the script's glyph count, and it
loads only on a Hindi packet.

**Source:** the woff2 Google Fonts serves for
`Noto+Serif+Devanagari:wght@400;700` with a modern browser UA. Note the 400 and
700 faces resolve to the SAME file — it is a variable font, so one file covers
both weights and vendoring two would duplicate 124 KB for nothing.

To refresh: request that CSS with a Chrome user-agent (without one Google serves
unsubsetted TTF), take the `@font-face` block whose `unicode-range` contains
`U+0900`, and download its woff2.
