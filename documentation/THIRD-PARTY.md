# Third-party content in the shipped tree

Every non-original thing `dx-maps/` ships, what licenses it, and whether the licence or
attribution actually travels with it. Compiled 2026-09-28 by inspecting the SHIPPED tree, not the
source lists -- the question is what a recipient receives.

Notes live HERE and not beside the assets: `check:public-hygiene` fails on "documentation in a
served folder". The licence travels with the asset; the explanation travels with the repo.

| Item | Source | Licence | Does it travel? | Gap |
|---|---|---|---|---|
| Fonts: bebas-neue, figtree, noto-serif-devanagari, oswald, poppins | Google Fonts / foundry repos | OFL-1.1 | **Yes** — each `LICENSE` is the family's own upstream OFL, verbatim, with its real copyright line | none (closed 2026-09-28) |
| `data/vendor/vue/vue.global.prod.js` | vuejs/core | MIT | **Partly** — the minified banner carries `(c) 2018-present Yuxi (Evan) You` and `@license MIT`, but NOT the permission notice MIT asks to include | closed: upstream `LICENSE` now vendored beside it |
| `data/vendor/tabulator/tabulator.min.js` + `.min.css` | olifolkerd/tabulator v6.3.1 | MIT | **No** — the `.js` had only `(c) Oliver Folkerd 2025`; the `.css` had nothing | closed: upstream `LICENSE` now vendored beside it |
| `boundaries/gb-IND-ADM1*.geojson` (4 files) | geoBoundaries gbOpen, boundaryID `IND-ADM1-1811400` | **CC BY 2.5 IN**, licenceSource `github.com/datameet/maps`, year 2011 — fetched verbatim from the geoBoundaries API | **Yes** — `boundaries/ATTRIBUTION` now ships beside the data, plus the existing `.meta.json` sidecar | none (closed 2026-09-28) |
| `boundaries/gb-CHN-ADM1.geojson` | geoBoundaries gbOpen, boundaryID `CHN-ADM1-43563684` | **Public Domain**, licenceSource `commons.wikimedia.org`, year 2019 | recorded in `boundaries/ATTRIBUTION` | none — upstream records no attribution duty |
| `boundaries/world-adm0*.geojson` (2 files, 162 countries) | geoBoundaries gbOpen, assembled per country (its features carry geoBoundaries' own `iso3`/`shapeGroup`/`shapeName`; corrected — this register first guessed Natural Earth) | **MIXED, and ESTABLISHED per country as of 2026-09-28**: 162 upstream licences. **32** duty-free (28 Public Domain + 4 CC0) · **65** attribution-only · **65 SHARE-ALIKE CLASS** (58 ODbL 1.0 + 7 explicit ShareAlike: AGO GAB GEO GIN MMR NER TUR) | **Yes** — the per-country table (licence + licenseSource + boundaryID + boundarySource, fetched verbatim from the geoBoundaries API, 162 of 162, 0 failures) ships at `plugin-designs/my-upg-100-list/data/adm0/PROVENANCE.json`. `boundaries/ATTRIBUTION` references it by path rather than copying it | **OPEN, legal — not a measurement**: whether a redistributed boundary file is a "Derivative Database" under ODbL is unanswered, and half the duty-bearing countries turn on it. It needs an owner's decision on data licensing |
| `people-groups/*` (3 files, 8 MB) | peoplegroups.org | **not established** | no terms ship | **OPEN, judgment** — redistribution terms unknown |
| `pplr/*` (6 files, 16 MB) | **PPLR ArcGIS Online org** `services2.arcgis.com/S4ydGgujXcif36k3`, aggregating IMB (peoplegroups.org), Joshua Project, the ROP registry, and carrying WCD (World Christian Database) IDs. Built from a local 78 MB extract not present in this repo | **UNRESOLVED.** `aCountry` and `aIMBPeople` publish no `copyrightText`, description or licence (queried `f=json`) | nothing ships | **OPEN, judgment** — redistribution not established. WCD is a proprietary Brill database, so even the IDs need a check |
| `tables/*` (304 files, 36 MB) | derived by `library/scripts/research/fetch-*.mjs` from several upstream APIs | **varies, not established per table** | nothing ships; there is no source or licence doc in `tables/` | **OPEN, judgment** — the largest gap by volume |
| `images/worldmap.svg` | recorded in `images/PROVENANCE` | see that file | the PROVENANCE file ships and explains why no licence file sits beside it | none claimed; reasoning recorded rather than assumed |
| `previews/*` (378 files) | our own poster previews | ours | n/a | none |
| Natural Earth 1:10m populated places (`library/scripts/posters/data/ne-places.json`) | naturalearthdata.com | **public domain**, no attribution required | n/a | none. Their 1:10m ROADS were deliberately not shipped because of an ODbL attribution obligation |

## Provenance records

| Vendored file | Upstream URL | sha256 |
|---|---|---|
| `data/boundaries/ATTRIBUTION` | geoBoundaries API, per boundary (values verbatim) | see the file |
| `data/vendor/tabulator/LICENSE` | `https://raw.githubusercontent.com/olifolkerd/tabulator/master/LICENSE` | `191a2ee554684e1064c897b432f0e1bc6dfa714ca045d3f6ea2cf692cbd398b7` |
| `data/vendor/vue/LICENSE` | `https://raw.githubusercontent.com/vuejs/core/main/LICENSE` | `49190d1f742dd61e47fe816df4963e5186a2a62100d9122f9883a60ea32973ac` |
| `data/fonts/bebas-neue/LICENSE` | `https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/OFL.txt` | see `documentation/vendored-fonts.md` |
| `data/fonts/poppins/LICENSE` | `https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/OFL.txt` | see `documentation/vendored-fonts.md` |

## What is NOT closed, and why it is not mine to close

★ ONE FACT IN THIS FILE IS ALSO ASSERTED ELSEWHERE, AND THAT IS WHERE IT WILL DRIFT. The world-adm0
licence counts appear both here and in `plugin-designs/my-upg-100-list/data/adm0/PROVENANCE.json`.
**That file is the authority; if the two disagree, it wins.** They have already drifted once: this
register said the licence table was EMPTY on the very commit where it held all 162, because the two
landings crossed and neither author could see the other's tree. A register that still reads
"unestablished" after the work is done is settled-by-omission in reverse — the absence of an update
reads as the absence of the work.

Three rows above are marked OPEN. One is simply unverified and someone should look
(the `pplr` upstream). Two need a decision rather than a fetch:
**people-groups** and the 304 **tables** carry data whose redistribution terms are not established,
and 36 MB of derived tables is the largest exposure by volume. Attaching a licence I have not
confirmed would be worse than the present gap, so those need an owner's decision.

The geoBoundaries row is closable by work rather than judgment: CC BY needs attribution to
accompany the data, and the pattern already exists in this repo -- the `.meta.json` sidecar. Extending
it to the other boundary files plus one shipped attribution line would close it.

