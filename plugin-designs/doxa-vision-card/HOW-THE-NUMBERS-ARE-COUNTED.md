# How the Vision Card's numbers are counted

**Every number on the card is computed from data. None is typed in.**
`library/scripts/people-groups/build-vision-funnel.mjs` writes them to
`data/people-groups/vision-funnel.json`, and the card compiles that file in.

| Step | Rule | Source field |
|---|---|---|
| **People groups** | Every row of the IMB people-group data: one people group in one country | all rows of `people_groups.csv` |
| **Unreached** | Less than 2% evangelical | IMB `LostnessPriority` 0–2 (Frontier, Pioneer, Expanding Unreached) |
| **Frontier** | Less than 0.1% evangelical, a subset of the unreached | IMB `LostnessPriority` 0 ("Frontier Unreached People Group") |
| **DOXA people groups** | Every group on DOXA's prayer list, matched to the IMB row by people (ROP3) and country | `doxa-groups-snapshot.json`, saved from `pray.doxa.life/api/people-groups/list` |

**The first three steps nest:** frontier ⊂ unreached ⊂ all. **DOXA groups do not nest inside
frontier.** Most are frontier, but not all, so the card states how many are ("1,745 of them are
frontier") instead of drawing DOXA as a slice of frontier.

**Populations** sum the IMB `Population` of each step's rows. For DOXA groups, that is the rows the
list matched; the few list entries with no IMB row count as groups but add no population.

**Why the total is not 16–17 thousand.** That figure counts people groups the way Joshua Project
does. This card uses the IMB (peoplegroups.org) dataset that ships in this repository, which lists
12,379 people groups by country. doxa.life's own "Who are the unengaged?" funnel uses its own
research data, so its figures differ slightly from these.

**To refresh:** replace `data/people-groups/people_groups.csv`, then run
`node library/scripts/people-groups/build-vision-funnel.mjs` (add `--offline` to keep the saved
DOXA list), then rebuild the bundle. The card shows the date of both sources.
