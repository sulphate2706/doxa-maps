# Embedding the gospel-resources map

The map's **URL is its interface**. A partner embeds one address in an iframe and never touches it
again, so every parameter below is a promise kept by a gate
(`bun run check:embed-contract`), not a convention.

```html
<iframe src="https://<host>/dx-maps/gospel-resources/resources-map/index.html?codes=kfr,cmn,npi"
        style="width:100%;height:600px;border:0" title="Gospel access"></iframe>
```

## The six addresses

| Address | What the reader gets |
|---|---|
| `?codes=<iso3,iso3,…>` | Only those languages' people groups, framed on them. Shows `74 / 2,107`, and that count is the button back to the whole map. |
| `?groups=<slug,slug,…>` | Exactly those **people groups**, by doxa.life's own slug, framed on them. Use this when your list is peoples rather than languages: a language filter shows every group speaking it, which for one bridge language was 55 pins against a list of 36. |
| `?country=<ISO3>` | That country's sheet open, framed on its groups. The country's own name also works (`?country=India`). |
| `?code=<iso3>` | The people group's sheet, with its resources. `&name=` and `&country=` disambiguate when a language has many groups. |
| `?view=zero` | The groups with **nothing found** — the question this map exists for. `?view=gap` is the same view. |
| `?tab=province&province=<name>` | On the data tables: that state's row — groups, people, what has nothing, the local way in, and who nobody is praying for. Accents are folded, so `Arunachal Pradesh` finds `Arunāchal Pradesh`. |

`?provider=maplibre` is not this map's parameter but the whole fleet's: it selects the keyless
engine, and no map ever substitutes a different one (`bun run check:engine-contract`).

## Bring your own list

The join is **ISO 639-3**, the key every resource in this map is already joined on. A partner's list
needs no agreement with Doxa's roster — only the codes their own data carries. That is the point:
this corpus is public so that other lists can stand on it.

Two things to know before you publish a link:

- **The denominator is Doxa's roster.** The research corpus holds 12,379 people groups; this map
  draws the **2,107** Doxa works, so `?codes=` intersects with those. A code outside the roster
  draws nothing.
- **It filters, it never invents.** A link matching none of its codes shows an empty map reading
  `0 / 2,107`. That is the truth about the link — showing the full map instead would tell you your
  broken list works.

## What the map does not promise

- **No zoom or centre parameter.** The frame is derived from the pins the link selects, so a link
  stays correct when the data moves under it.
- **Placement is approximate.** A dot marks a *people group*, not a town or a boundary,
  and 108 of the placed groups share a coordinate with another group. The sheet says so in the
  reader's language.
- **An unknown parameter is ignored, never fatal.** `?country=ZZZ` renders the map, not an error —
  a partner's typo must not break their page.
