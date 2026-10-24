# People-group lists

Every map shows people groups. The **list** decides which ones, and it is a universal prop like the
engine, the locale and the token: the same map can show any project's list, and the choice is made
the same way everywhere.

## Choosing a list

First answer wins (`peopleGroupList.js`):

1. `profile-config` `list`: this embed, decided by whoever mounted the element;
2. `?list=` in the page URL: any generated leaf can be switched from the URL;
3. `window.MAP_LIST`: a host global, for a host that sets it programmatically;
4. `doxa`, the default: today's behaviour, nothing fetched and nothing filtered.

An id or an alias (`700`, `project-700`) is accepted. Anything unknown falls back to the default and
says so once in the console.

## The registry: `lists.json`

Each list is a **filter, never a hand-kept roster**:

| id | Label | Source | Definition | Count when measured |
|---|---|---|---|---|
| `doxa` | Project 2000: DOXA's people groups | the DOXA API | DOXA's live list | 2,107 |
| `unreached` | Project 7000 | IMB | Lostness Priority 0–2 (under 2% evangelical) | 7,341 |
| `frontier` | Project 4700 | IMB | Lostness Priority 0 (0.1% evangelical or less) | 4,754 |
| `frontier-500k` | Project 700 | IMB | frontier, population 500,000 or more | 737 |
| `unengaged` | Unengaged unreached | IMB | Lostness Priority 0–2 and unengaged | |

Counts are from the IMB file of 2026-08-02 and the DOXA API of 2026-09-26; they move when either
source is refreshed. Labels here are the English fallback: every locale's label and definition live
in `library/i18n/locales/<lc>/lists.json` (read them with `listLabel` / `listDefinition`), and
`check:list-prop-unit` fails if the English catalogue and this registry disagree.

**Membership is built, not computed in the browser.** `library/scripts/people-groups/build-lists.mjs`
writes `data/people-groups/lists/<id>.json` for each non-default list (the member keys, plus what a
map draws for IMB rows), and the tree serves them from its asset pool.

## How a map honours a list: two tiers

**Tier A: narrowing DOXA's rows.** Rows keep coming from the DOXA API, because that is where the
prayer fields live (praying, adopted, committed, the prayer link). `applyPeopleGroupList()` keeps the
rows whose slug belongs to the list. So under Project 700 a map shows the DOXA groups that are
Project 700 groups, and every map that loads through the library follows with no plugin change.

It **fails closed**: if a non-default list's membership cannot be loaded, the map gets no rows and the
console names the list and the URL. A map that silently showed all 2,107 while an embed asked for
Project 700 would be showing the wrong list with no sign of it.

**Tier B: IMB rows.** A list's groups that DOXA does not carry exist only in the IMB data, without
DOXA's prayer fields. A map that shows them must either hide those layers and figures or join them
where a DOXA row exists (1,745 of the 4,754 frontier groups are DOXA groups; inside DOXA's 2,107,
1,753 are frontier). This is per-map work. `all-people-groups` already draws the whole IMB set, so a
list there is Tier B by nature.

## The data

- **IMB / peoplegroups.org:** `data/people-groups/people_groups.csv`, 12,379 rows, one per people group
  per country (not distinct groups). A public download with no key or account; the attribution line
  is "People group data: peoplegroups.org".
- **DOXA API:** `GET /api/people-groups/list` returns DOXA's active list (2,107) whatever filter is
  passed, so every list beyond DOXA's comes from the IMB file.
- **The funnel** (the vision card, and page 2 of a prayer packet) is generated from the same two
  sources by `library/scripts/people-groups/build-vision-funnel.mjs`; its rules are in
  `plugin-designs/doxa-vision-card/HOW-THE-NUMBERS-ARE-COUNTED.md`.

## Open questions

- **Project 4000 and Project 3000** have no definition in the data held here. The nearest candidates:
  unengaged unreached groups (2,968) for 3,000; Frontier + Pioneer (5,950) or unengaged frontier
  (2,473) around 4,000. A list another organisation publishes would need that source.
- **The funnel's top step:** IMB counts 12,379 group-by-country rows; about 16–17k is Joshua Project's
  count. One funnel should use one source, or its steps do not nest.
- **"Unreached", two rules 34 apart:** Lostness Priority 0–2 (7,341, used today) or evangelical level
  under 2% (7,307).
- **peoplegroups.org terms:** the data is a public download with an attribution line, but no licence
  text is recorded; republishing counts and rows in maps, packets and partner embeds needs confirming.
