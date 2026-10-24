# The preset plugin standard — how to ship named variants that appear by themselves

A **preset** is one profile rendered N ways by different props: doxa-simple-map ships `prayer`,
`engagement` and `adoption` from a single `<doxa-simple-map>` element. Presets are **discovered, never
registered** — nothing in Plugin Studio, the gallery or the manifest generator holds a list of them.
Verified on the tree as it stands: the only match for "prayer|engagement|adoption" anywhere in
`plugin-studio.vue` is an unrelated comment about a layout bug.

## Declare one file

Put `<name>.instances.json` beside your profile in `plugin-designs/<bundle>/`. That file's PRESENCE is
the whole registration: `discover.mjs` (`detectProfileType`) types a bundle **parameterized** — capability
2 — because it ships one, and `null` otherwise. Nothing else is consulted.

```
plugin-designs/doxa-simple-map/
  doxa-simple-map.vue            the profile
  simple-map.instances.json      the presets            <- this is the registration
```

Two accepted shapes, both read by `discover.mjs`: a bare array `[{ id, title, props }]`, or an object
`{ profile, apiBaseUrl, instances: [...] }` when the presets need a base URL or name their profile
explicitly. Each instance needs `id` (url-safe, becomes the folder), `title` (what a reader sees) and
`props` (exactly what you would pass the element).

## What you get without asking

- **A standalone embeddable page per preset** at `<tree>/<bundle>/<instance>/index.html`, nested under
  the profile, each with its own SRI-pinned script tag.
- **A manifest entry per preset** under the profile's `instances`, so every consumer sees them at once.
- **A rail row and a gallery card per preset**, from that same manifest.
- **Capability 2**, derived. Do not hand-declare `"type": "parameterized"` to get it.

## The rules that keep it automatic

1. **Never add your preset to a list elsewhere.** If a preset needs a change in Plugin Studio to show
   up, that is a defect in the discovery path, not something to work around. The one bundle-name list
   that used to exist is exactly the thing this standard replaced.
2. **The base profile still stands on its own.** Presets SPLIT one profile into named render targets;
   they do not replace it. `doxa-simple-map/doxa-simple-map/` still accepts live props.
3. **A preset's `props` MERGE OVER its profile's defaults; they never replace them.** A preset page's
   config is the profile's `<profile>.meta.json` `config`, then the preset's `props` over it, key by key
   (a shallow merge). A default the preset does not repeat is kept: set it in `props` only to change it.
   `check:preset-config-merge` asserts this on the built tree.
4. **`props` is the whole difference between presets.** If two presets differ by anything the element
   cannot be told through props, they are two profiles, not two presets.
5. **Presets are not tabs.** A tab nests several components inside one element; a preset renders the
   same element several ways. Choosing the wrong one shows up later as a capability that will not
   derive: tabs make a bundle a composite (cap 4+), presets keep it parameterized (cap 2).
6. **An `id` is a URL.** It becomes a folder under the tree and is embedded in partner pages, so
   renaming one breaks links already shared. Treat it like the share-link vocabulary: additive.

## How to check it worked

Build the tree, then read the manifest rather than the screen: your bundle's profile should carry an
`instances` array with one entry per preset, and `check:capability-derived` should report the profile as
a real tier. A preset that does not appear is almost always a filename that does not end
`.instances.json`, or an `instances` key that is not an array — `discover.mjs` treats both as "no
presets" and types the bundle `single`, silently.
