# Vendored fonts — licences and why each one is here

The fonts ship in `data/fonts/<family>/`, which `bun run tree` stages into the served tree at
`dx-maps/assets/fonts/`. Each family's `LICENSE` is its OWN upstream OFL text, verbatim, carrying
that family's real copyright line. Nothing in this file is part of any licence.

★ THESE NOTES LIVE HERE, NOT BESIDE THE FONTS, AND THAT IS THE POINT. check:public-hygiene fails on
`documentation in a served folder`: a NOTES.md next to each LICENSE is prose a reader of the drop-in
tree should not be served. The old bebas-neue LICENSE said so in its own text -- "prose does not
belong in a public served folder" -- and I put three NOTES.md files there anyway before the gate
caught it. The licence travels with the font; the explanation travels with the repo.

## bebas-neue

| | |
|---|---|
| Licence source | `https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/OFL.txt` |
| sha256 | `72082f6cb4d04be2ecf7cc7d9e1e7d73787f0af8a5a278a47cade70c16b78341` |
| Fetched | 2026-09-28 |

```
Bebas Neue — SIL Open Font License, Version 1.1
Designer: Ryoichi Tsunekawa (Dharma Type). Distributed via Google Fonts.
Full text: https://openfontlicense.org/ (OFL-1.1)
WHY THIS FILE IS IN THIS REPO
DX-life's /regions pages set --font-family-heading to 'Bebas Neue'. Their own site does not
ship the file either — @nuxt/fonts downloads it at build and self-hosts it, which is why their
computed font-family reads "Bebas Neue", "Bebas Neue Fallback: ...". We cannot @font-face from
their origin: their font file is served without CORS headers, so a cross-origin face silently
fails and every heading fell back to a condensed system stack. That substitution was the ONLY
remaining difference between our regions dashboard and theirs (7 computed properties, all of
them this one font and its knock-on sizes).
So the font is vendored here, from Google Fonts, under the OFL that permits redistribution —
self-hosted, never a CDN, the same rule public/assets/vendor/tabulator/ follows.
Subsets and unicode-ranges are Google's own (css2 API, v16), reproduced verbatim in the
@font-face declared by library/composables/useDocumentFont.js.
NOTE ON THIS FILENAME — it is deliberately extensionless.
check:public-hygiene refuses *.md / *.markdown / *.txt anywhere in the served tree ("no docs in a
served folder", product rule 2026-09-16), and it is right to: prose does not belong in a public
mirror. But the OFL requires this licence to accompany the font files wherever they are
redistributed, and the font files DO ship — they are fetched by the @font-face at runtime. So the
licence travels with them under the conventional extensionless name, which satisfies the rule
without weakening it. Do not rename this to LICENSE.txt.
```

## poppins

| | |
|---|---|
| Licence source | `https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/OFL.txt` |
| sha256 | `6be04893d770899a015649c7aa3b582f871b272f8747a92b78b17c3e5c8b2573` |
| Fetched | 2026-09-28 |

```
Poppins — SIL Open Font License, Version 1.1
Designers: Indian Type Foundry, Jonny Pinhorn. Distributed via Google Fonts.
Full text: https://openfontlicense.org/ (OFL-1.1)
WHY THIS FILE IS IN THIS REPO
Poppins is DX-life's --font-family-base: the body face of every line of text on the pages the
regions plugin clones. Their own site self-hosts it via @nuxt/fonts; we could not use theirs, so
it is vendored here from Google Fonts under the OFL, which permits redistribution.
WHY IT WAS NEEDED — and why no CSS check caught it.
A computed-style diff of our region dashboard against live doxa.life reported 68 of 68 properties
IDENTICAL while our body text was rendering in a system fallback, because BOTH sides merely NAME
"Poppins" first in font-family and a first-family comparison therefore matched. The difference only
became visible against a glyph-width oracle: the same string at the same size measured 334.58px
here against 317px on their page — 5.5% wider, i.e. a different face.
document.fonts.check() is NOT a usable oracle for this: it returned true for families never
vendored (Oswald, Brandon Grotesque) and false for Bebas Neue on DX-life's own page.
See the builder-cycle probes: _probe-glyph-width.mjs.
WHAT IS HERE, AND WHY ONLY THIS
Weights 400/500/600/700 only — the four the regions surface actually asks for (measured across
their _globals, _cards, _buttons and _filters SCSS: medium x10, regular x4, bold x2, plus the
600 in the prayer-coverage legend). Subsets latin + latin-ext only. 44 KB in total, with Google's
own unicode-ranges reproduced in the @font-face so the subset split behaves as it does on their
site. Extra weights and scripts are deliberately NOT vendored — bloat is a repo rule here.
FILENAME: extensionless on purpose. check:public-hygiene refuses *.txt in a served folder and is
right to, while the OFL requires this licence to accompany redistributed font files. Do not
rename this to LICENSE.txt.
```

## figtree

Its LICENSE is the family's own OFL text, left intact (our prose was stripped from the top).

```
Figtree — SIL Open Font License, Version 1.1
Designer: Erik D. Kennedy. Distributed via Google Fonts.
Vendored as the free stand-in for Brandon Grotesque (commercial), by product decision
2026-09-24. Chosen by MEASUREMENT, not by name: at 500/19.5312px Figtree renders
'FULL PROFILE' at 126px against Brandon's 128px on live doxa.life — the closest of 19
libre grotesques tested. See _probe-glyph-width.mjs.
```

