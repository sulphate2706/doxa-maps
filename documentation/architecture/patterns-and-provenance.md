# Architecture — provenance & the two multi-map patterns

> Contributor front door: [../../documentation/CONTRIBUTING.md](../../documentation/CONTRIBUTING.md).

## Where this comes from — the migration story

These maps were built **modular-first**, as standalone embeddable widgets, while
the host site still ran on **WordPress**. Each map was a `<script src>` + a custom
element you could drop onto any page — never tied to WordPress internals, themes,
or plugins. It was just a self-contained bundle that booted itself.

When the host site **migrated from WordPress to Nuxt**, the maps came across
**unchanged**. Nothing in this project had to be ported, rewritten, or adapted to
the new framework. The Nuxt host simply loads the same IIFE bundle as a static
asset the same way the WordPress page did — `<script src>` then the custom
element. The build target moved from one site's static directory to another's;
the bundles themselves did not change a line.

That is the payoff of the modular-first design: **the maps are framework-agnostic
build outputs, not framework components.** A future migration to yet another host
would be the same story — re-point the build output, embed the script tag, done.

---


## Two patterns for multiple maps from one bundle

A single bundle can present **several different maps**. There are **two ways** to
do it, and they solve different problems. Neither is "more correct" — pick the one
that matches *why* your maps differ.

> **Vocabulary.** A **bundle** is one folder under `plugin-designs/<name>/` → one
> `<name>.js` script. A **profile** is a `.vue` file at that folder's root,
> discovered by `import.meta.glob('./*.vue')` in the bundle's `index.js`. The host
> picks which profile to mount with the `profile` field of `profile-config`; the
> rest of `profile-config` (token, data source, colors, instanceId…) are
> **parameters** passed to that profile.

### Pattern A — Preset element, a.k.a. parameterized (one profile, many instances)

**Use when:** the maps are *the same map* differing only by **configuration** —
data source, color set, starting tab, labels.

One bundle, **one** `.vue` profile. You mount the element as many times as you
like, each with a different `profile-config` — same `profile`, different
parameters. The bundle's script loads **once**; each element instance is
independent (its own Pinia + i18n).

**Example — `doxa-simple-map`:** a single `doxa-simple-map.vue` profile drives
three maps (Engagement / Prayer / Adoption). All three slots use
`profile: 'doxa-simple-map'`; only the surrounding config differs.

```html
<script src="/doxa-maps/doxa-simple-map/doxa-simple-map.js"></script>
<doxa-map profile-config='{"profile":"doxa-simple-map","tk":"pk…","dataSource":"engagement"}'></doxa-map>
<doxa-map profile-config='{"profile":"doxa-simple-map","tk":"pk…","dataSource":"prayer"}'></doxa-map>
```

### Pattern B — Multi-profile bundle (several profiles, selected by name)

**Use when:** the maps are **genuinely different map types** (different `.vue`
logic/layout), but you want them to **share one build** because they import the
same slice of the template.

One bundle, **multiple** `.vue` profiles at the folder root. The host chooses which
profile to mount via the `profile` field — `ProfileLoader` resolves it against the
bundle's `import.meta.glob('./*.vue')` registry (key `./<profile>.vue`). Still
**one script tag**; you select the map per element with `profile`.

**Example — `my-upg-100-list`:** two profiles in one bundle —
`upg-100-list.vue` and `research-map-clone.vue` — both served by the single
`my-upg-100-list-map` element.

```html
<script src="/doxa-maps/my-upg-100-list/my-upg-100-list.js"></script>
<my-upg-100-list-map profile-config='{"profile":"upg-100-list","tk":"pk…"}'></my-upg-100-list-map>
<my-upg-100-list-map profile-config='{"profile":"research-map-clone","tk":"pk…"}'></my-upg-100-list-map>
```

> **Note — profiles are selected by `profile`, not by separate script tags.** A
> bundle ships exactly one `<name>.js`. Whether it has one profile (Pattern A) or
> many (Pattern B), you load that one script and pick the profile per element via
> `profile-config`. (A bundle *may* additionally register more than one element
> **tag** — e.g. `doxa-simple-map` registers both `<doxa-map>` and
> `<doxa-simple-map>` for back-compat — but that's a tag-aliasing concern, separate
> from how many maps the bundle offers.)

### Which to pick

| | Pattern A — parameterized | Pattern B — multi-profile |
|---|---|---|
| `.vue` profiles in the bundle | one | several |
| Maps differ by | config **parameters** | distinct `.vue` **logic** |
| Select a map with | different `profile-config` (same `profile`) | the `profile` field |
| Script tags | one | one |
| Example | `doxa-simple-map` (3 instances) | `my-upg-100-list` (2 profiles) |

---

