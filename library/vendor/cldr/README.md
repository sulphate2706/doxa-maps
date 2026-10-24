# Vendored CLDR — `codeMappings.json`

The ISO 3166-1 alpha-2 / alpha-3 / numeric correspondences, used to turn the alpha-3 codes our data
speaks into the alpha-2 codes `Intl.DisplayNames` requires to produce a LOCALIZED country name.

|  |  |
|---|---|
| Package | `cldr-core` (unicode-org/cldr-json) |
| Version | **48.2.2** |
| Source | `https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/codeMappings.json` |
| Licence | **Unicode-3.0** — full text in `LICENSE` beside this file |
| Bytes | 35,948 |
| sha256 | `0d1ef50b92c1140e5847d22d96faf1a9c35543b0dedf8e9a2fcb87e4c51b9ed6` |
| Vendored | 2026-09-27 |

## Why vendored rather than a dependency

No npm package is added for this. A dependency would pull CLDR's whole supplemental tree, and it would
make the derivation of a shipped data file depend on an install step. The file is 35KB, it is
licensed for redistribution, and vendoring it means `bun run gen:iso3-to-alpha2` reproduces the derived
map OFFLINE — which is the actual point of vendoring, not merely having a copy.

## What is derived from it

`library/scripts/generate-iso3-to-alpha2.mjs` joins this file against the 242 alpha-3 codes in
`library/data/countries.json` and writes `library/data/iso3-to-alpha2.json`. The generator asserts its
own output (242 coverage, injectivity, the one documented exception) and exits non-zero if any of it
fails, so a bad refresh cannot land quietly.

## DO NOT CONFUSE THIS WITH THE RESEARCH MAP

`library/scripts/research/out/iso3-to-iso2.json` is a DIFFERENT map with a different job: it is the
176-country research spine that drives the data fetches, and expanding it changes what gets fetched —
a product decision about data scope, not a side effect of adding country names. The map
derived here is for DISPLAY NAMES ONLY and drives no fetch. CLDR agrees with all 176 values in the
research map, which is a useful independent check on it, but the two files are not interchangeable.

## Refreshing

Re-download the URL above, update the version, bytes and sha256 in this table, then run the generator
and let its assertions grade the result. If CLDR ever disagrees with a value in the research map, the
generator says so rather than silently overwriting anything.
