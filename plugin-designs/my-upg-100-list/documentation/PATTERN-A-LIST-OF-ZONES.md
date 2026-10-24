# PATTERN — a project list becomes ~100 zones (what UPG-100 actually does)

Project 7000, 4700, 2000 and 700 each need their own clusters of roughly 100 groups. This document
is so the next one is built by FOLLOWING a pattern rather than by copying this plugin.

Two halves, and they are independent — that separation is the pattern's main structural claim:

| half | what it decides | where it lives | gated by |
|---|---|---|---|
| **which groups** | which people groups are in the list at all | `library/lists/` (shared) | `internal/check-list-prop-unit.mjs` |
| **which zones** | how those groups are cut into ~100-group territories | your plugin's `data/clusters.json` | `internal/check-group-set-standard.mjs` |

A new list needs the SECOND half only if it wants its own territories. The first half already
carries all five lists.

---

## Half 1 — the list prop. Already built; do not rebuild it.

`library/lists/peopleGroupList.js` is shared machinery, not UPG-100's. The registry
(`library/lists/lists.json`) already defines every list in scope:

| id | aliases | label |
|---|---|---|
| `doxa` | `2000`, `project-2000` | Project 2000: DOXA's people groups (the default) |
| `unreached` | `7000`, `project-7000` | Project 7000: unreached people groups |
| `frontier` | `4700`, `project-4700` | Project 4700: frontier people groups |
| `frontier-500k` | `700`, `project-700` | Project 700: frontier people groups of 500,000 or more |
| `unengaged` | — | Unengaged unreached people groups |

`resolvePeopleGroupList(profileConfig)` picks one, **first answer wins**: profile-config `list` →
`?list=` → `window.MAP_LIST` → `doxa`. An unknown value falls back to the default and warns once,
naming every known id.

MEASURED, so you can trust the counts rather than re-derive them — membership files under
`public/dx-maps/assets/people-groups/lists/`:

```
unreached      2082 slugs
unengaged      1929
frontier       1745
frontier-500k    71
doxa            (no file, and correctly so — the default is the unfiltered API result)
```

★ **The filter FAILS CLOSED.** If a non-default list's membership cannot be loaded, the map shows
NO rows and the console names the list and the URL. A map that silently showed all 2,107 while the
embed asked for Project 700 would be showing the wrong list with no sign of it — the failure mode
this design exists to prevent. Do not "improve" this into a fall-back-to-everything.

**To add a list:** a registry entry + a membership file from
`library/scripts/people-groups/build-lists.mjs` + label/definition keys in every
`library/i18n/locales/<lc>/lists.json`. The gate checks all three (24 cases) and will tell you which
locale you missed.

---

## Half 2 — the zoning. This is the judgement, and it cannot be automated.

**The rule:** geography FIRST so the poster maps make sense, balanced with
LANGUAGE — because languages usually cluster geographically, the zones are already a mixture of the
two, grouped manually.

That balance is a human call. What the pattern can do is give you the vocabulary to express the call
you made, so the next reader can see it. UPG-100's 29 entries use **seven selector types**, and the
type you pick IS the statement of how you zoned:

| selector | zones | what it says |
|---|---|---|
| `wagf_block` | 3 | a named regional bloc (west/east/central Africa) — pure geography |
| `wagf_region` | 1 | a whole region (europe) — geography, coarsest |
| `country_code` | 3 | one country is the territory (SDN, BRA, LAO) |
| `country_codes` | 6 | several countries make one territory (middle-east-core, maghreb-egypt) |
| `union` | 2 | a composite that no single rule expresses (oceania-indonesia) |
| `pg_slugs` | 12 | an explicit roster — every Indian state and Chinese province |
| `deaf_predicate` | 2 | not geographic at all (see the exception below) |

★ **THE `pg_slugs` BLOCK IS THE HONEST PART, NOT THE LAZY PART.** All 12 of India's states and
China's provinces are enumerated group-by-group rather than derived from a rule. That is not
technical debt: below the country level there is no ADM1 field on the records to select by, so a
rule would be a *fiction* that looks principled. An explicit roster is checkable; an invented
predicate is not. Expect a sub-national list to need the same, and do not let a reviewer talk you
into a clever selector that cannot be verified.

### 29 entries, 28 zones — the collapse is real, count the LEAVES

```
buildLegendNodes(clusters) → leafZones(...)   ⇒ 28
```
The two `deaf_lists` entries (`deaf-old-world`, `deaf-new-world-asia-pacific`) collapse into ONE
`deaf` leaf. So `clusters.json` has 29 list entries and the product has 28 posters/packets/zones.

⚠ **Never count zones from `clusters.json`'s buckets.** I did, called it 27 (forgetting `deaf`
entirely), and later deleted 30 files believing there were 28. `leafZones(buildLegendNodes(...))`
is the one answer that poster, packet and legend all agree on — ask it, don't count by hand.

### The deaf poster is the known exception. Leave it unsolved.

The deaf zone is global and non-geographic by construction (affinity bloc A017, 123 groups spanning
every region), so it breaks the geography-first rule the rest of the pattern rests on. **It is
recorded as not yet solved.** It is recorded here as an open exception, not papered over with
an invented zoning. If your list has a similar affinity-not-territory group, do the same: give it
its own bucket, let it collapse to one leaf, and say plainly that it is not geographic.

---

## What you get for free once your `clusters.json` exists

`documentation/STANDARD-GROUP-SET.md` is the fork contract for the offline generator: point it at
one folder and it produces a packet per zone, localized, with no code change. Its falsifier
(`internal/check-group-set-standard.mjs`) runs a synthetic 3-list toy set end-to-end on every gate
pass, so the contract cannot rot silently. Read it next; it covers data shapes, `PACKET_LANG`,
`ONLY=`, and which pages omit cleanly when optional repo data is absent.

## Not solved by this pattern

- **Posters for arbitrary sets.** The poster generator needs geo/bbox inputs this pattern does not
  define. Packets are generative today; posters are not.
- **Zone TITLES in other languages.** Tracked separately — only 10 of 28 titles are composable from
  already-translated parts, and `Intl.DisplayNames({type:'language'})` resolves just 9.5% of ISO
  639-3 codes and ECHOES the code on a miss, so it would print raw codes on a poster silently.
- **Multi-territory maps** and any authoring UI.
