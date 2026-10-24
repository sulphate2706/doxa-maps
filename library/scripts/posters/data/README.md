# Vendored map data

## `ne-places.json` — capitals and major cities

**Source:** Natural Earth 1:10m populated places (`ne_10m_populated_places_simple`)
**Licence:** **Public domain.** Natural Earth explicitly places its data in the public
domain: no attribution required, no notice to carry onto a printed packet.
**URL:** https://www.naturalearthdata.com/

### Why vendored rather than fetched

A build must be reproducible offline and must not add a runtime dependency — the
posters are generated token-free and the packets are printed and carried. Vendoring
also pins the data, so a poster regenerated next year looks like the one printed
today.

### How it was trimmed (4.9 MB → 170 KB, 7,342 → 2,573 places)

Kept:
- every national capital (`Admin-0 capital`, `Admin-0 capital alt`)
- every first-order administrative capital (`Admin-1 capital`, and the
  `Admin-0/1 region capital` variants)
- ordinary populated places only where `pop_max >= 250000`

A poster cannot legibly carry 7,342 dots, and the packet is downloaded, so the
filter serves legibility and weight at once. Field names are single letters for the
same reason:

    n  name (ascii)      c  ISO3 country
    k  0 national capital / 1 admin-1 capital / 2 city
    p  pop_max           y  latitude          x  longitude

To regenerate, fetch `ne_10m_populated_places_simple.geojson` from
`nvkelso/natural-earth-vector` and apply that filter.

## ⚠ Why there is no `ne-roads.json`

Roads were requested and **deliberately not shipped**. Natural Earth's 1:10m roads
layer was fetched (50 MB) and measured: it has **ZERO features** for

    LAO  MMR  KHM  VNM  THA  NPL  BTN  TCD  NER  MLI  SOM  AFG  YEM  IDN  IND  CHN

Its attributed coverage is essentially USA (7,417 segments), Canada (900) and
Mexico (897); 47,262 of 56,600 segments carry no country at all.

Shipping it would draw a dense road network on a United States map and **nothing**
on every country these packets are actually for — which reads as a broken map
precisely where it matters most. A roads layer needs a source with real coverage in
South/Southeast Asia and Africa (an OpenStreetMap extract), which is a much larger
dependency with an attribution obligation (ODbL). That is a separate piece of work,
carded rather than half-shipped.
