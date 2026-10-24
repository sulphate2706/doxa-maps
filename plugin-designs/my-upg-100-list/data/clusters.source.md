# clusters.json — source provenance

**Promoted:** 2026-06-10 

## Origin (read-only mirror — the RICHER copy)

```
<earlier-bundler-checkout>/plugin-designs/my-upg-100-list/data/clusters.json
```

- **md5:** `3040eadf7d8526de396618b15d7e97f0`
- **Why this copy:** it carries `asia_lists`, `asia_unsolved`, `asia_solved_validation`,
  `uncovered_scatter`, `source_endpoint`, `validation_run` that the `05-apps/DOXA-MAPS` copy lacks.
  (Per qa §2 S1-D1: promote the richer Asia-solved mirror.)
- `version: 1` · `source_total: 2106`
- 13 regional `lists` + 2 `deaf_lists`.

> Note: the qa pre-ask round labelled the mirror md5 as `5758f88…` and the DOXA-MAPS copy as `3040ead…`.
> The two md5s appear transposed in that note — the file actually promoted here (the one WITH
> `asia_solved_validation`, i.e. the richer mirror per S1-D1's intent) hashes to `3040eadf7d8526de396618b15d7e97f0`.
> Promoted by content (richest copy), as the qa Agreement intends.

## Selector shapes observed in this file (drives selector-evaluator.js)

- `{"type":"country_code","value":"SDN"}`
- `{"type":"country_codes","values":["VNM","MYS",...]}`   (note: plural `values`)
- `{"type":"wagf_block","value":"west_africa"}`
- `{"type":"wagf_region","value":"europe"}`
- `{"type":"union","selectors":[ <selector>, <selector> ]}`
- `{"type":"deaf_predicate","regions":["africa","middle_east","europe"]}`
  — deaf = slug/name contains "deaf" (case-insensitive) AND `wagf_region.value ∈ regions`.

List identifiers use the `id` field (e.g. `"west-africa"`), not `slug`. Regional lists carry `count`;
deaf lists carry `expected_count`.

## Live data shape (BUG#1)

`GET https://pray.doxa.life/api/people-groups/list?fields=slug,name,country_code,wagf_region,wagf_block,primary_language&lang=en`
returns `{posts:[...2106], total}` where `country_code`, `wagf_region`, `wagf_block`, `primary_language`
are nested `{value,label}` dicts — NOT flat strings. `normalize.js` flattens each to `.value` at load time.
