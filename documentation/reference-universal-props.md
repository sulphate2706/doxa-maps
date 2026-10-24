# Universal props: the contract every plugin honours

The Plugin Studio header sets a few values that apply to **every** plugin on the page. A plugin
honours them when it reads them through the library's resolvers, never through its own literals.
This page lists each one: where it can come from (its **channels**), which channel wins
(**precedence**), and what happens when nothing sets it (**default**).

The set here is the one the header sets today: **engine, locale (with direction), Mapbox token and
token-service URL**, plus the **people-group list** (section 5), which every map must honour so the
same maps serve other projects' lists, not only DOXA's. Whether anything else counts as universal is an open decision
(DECIDE-UNIVERSAL-PROPS-SCOPE), not part of this contract.

`profile-config` is the element's JSON attribute (`<doxa-map profile-config='{"tk":"pk.…"}'>`).
File references are to `library/` unless they name another folder.

## How the studio hands them to a plugin

`paneConfig()` in `plugin-designs/plugin-studio/plugin-studio.vue` builds each pane's
`profile-config`, with these keys: `profile`, `instanceId`, `locale` (always), `tk` (when a token is
known), `tokenUrl` (when the host passed one), `provider` (when one is chosen) and `treeBase`. It also
publishes `window.MAP_TOKEN` and `window.MAP_PROVIDER` for maps nested inside composites.

A token or engine change re-mounts the panes. A locale change re-sets `profile-config` on the
**active** pane only.

The header keeps the reader's choices in this browser:

| Prop | localStorage key |
|---|---|
| engine | `plugin-studio:map-provider` |
| locale | `doxa-maps:locale` |
| token | `plugin-studio:mapbox-token` |
| token-service URL | `plugin-studio:mapbox-token-url` |

---

## 1. Engine: `'mapbox'` | `'maplibre'` (the header also offers "each map's own")

**The resolver:** `resolveMapProvider(profileConfig)` in `composables/useMapProvider.js`.
`useMapInstance` calls it when no `provider` argument is passed. Values are lowercased and
trimmed; anything unrecognised becomes the default.

| Rank | Channel | Name |
|---|---|---|
| 1 | profile-config | `provider` |
| 2 | URL | `?provider=` |
| 3 | window | `window.MAP_PROVIDER` |
| 4 | default | `'mapbox'` (`DEFAULT_PROVIDER`) |

- **The studio's own ladder:** the reader's choice (localStorage), then the studio's `provider` prop,
  then its `profile-config.provider`. Only the exact strings `mapbox` and `maplibre` survive.
  "Each map's own" sends no `provider`, so a pane falls to its own default: Mapbox for every map
  except the ones below.
- **Plugins that do not follow the ladder, by design:**
  - Prayer Walk Planner is keyless and always MapLibre.
  - key-cities is Mapbox-only (gated, and it uses `mapbox://` styles).
  - Research Dashboard's map panel (`DashboardMapPanel.vue`) accepts the page switch only when it
    resolves to `maplibre`; otherwise its bundle config pins `mapbox`.
- **Rule for plugins:** create maps through `useMapInstance`. A raw `new gl.Map` must take its
  engine from `resolveMapProvider`, its style from `styles/registry.js` (`resolveNamedStyle`), and
  every Marker, Popup or control from `engineFor(map)`. Never use a `mapbox://` URL or a bare
  `mapboxgl` global.

## 2. Locale (UI language) and its direction

**The resolvers:**
- `detectLocale` in `i18n/index.js`, used by `createAppI18n`.
- `ProfileLoader.vue`, which overrides it from profile-config, drives the app's i18n and
  `setRuntimeLocale`, and publishes `window.__DOXA_PAGE_LOCALE`.

| Rank | Channel | Name |
|---|---|---|
| 1 | profile-config | `locale`, or `lang` (base code, must be in `SUPPORTED_LOCALES`) |
| 2 | URL | `?lang=`, or `?locale=` |
| 3 | host page | `<html lang>` |
| 4 | default | `'en'` |

- **Supported codes:** `SUPPORTED_LOCALES` in `i18n/index.js` (11 codes).
- **Direction:**
  - `rtl` exactly when the locale is in `RTL_LOCALES` (today only `ar`).
  - ProfileLoader sets `dir` on the plugin's own root, never on the host page.
- **Composites:** read `lang || locale` and forward `lang` to their children.
- **The studio's ladder** is richer than the library's: profile-config `locale|lang` → `?lang|locale`
  → saved `doxa-maps:locale` → `navigator.language` → `'en'`. It passes the result to each pane as
  `profile-config.locale`.
- **Rule for plugins:**
  - Take every user-facing string from `t()` or `tStatic()`.
  - Format numbers with the active locale, never `toLocaleString('en-US')` or a bare `toLocaleString()`.
  - Take direction from the resolved locale.

## 3. Mapbox token (a public `pk.` token)

**The resolver:** `ProfileLoader.vue`, which provides it to children as `mapboxToken`.

| Rank | Channel | Name |
|---|---|---|
| 1 | profile-config | `tk` |
| 2 | page-wide shared token | `window.__doxaMapToken`, fed by `window.MAP_TOKEN` through `useSharedMapToken.js` |
| 3 | default | none (`''`) |

- **Where it's used:**
  - `useMapInstance` uses the token it is given, else `window.MAP_TOKEN`.
  - Mapbox maps require a `pk.` token; MapLibre needs none.
- **Generated leaf pages** (`internal/generate-tree.mjs`) resolve the token before the element
  mounts: `profile-config.tk` → `?tk=` → localStorage `MAPS_STAGING_TK` → the token baked at build
  time → the token service (section 4).
- **The studio's ladder:** the reader's pasted token → a token fetched from the reader's URL → the
  studio's `tk` prop → its `profile-config.tk` → the page's baked `window.MAP_TOKEN`. Only `pk.`
  tokens are accepted. A secret `sk.` token is refused.
- **Rule for plugins:**
  - Read the token only from the injected `mapboxToken`, or pass nothing to `useMapInstance`.
  - Never use a private global or a literal.

## 4. Token-service URL

A URL that returns a public token as JSON (`{token|tk|accessToken}`) or as a bare string.

- **Generated leaf pages:** `window.MAP_TOKEN_URL` → the build config's `tokenUrl`, or
  `sources.json` `mapboxTokenUrl` → `/api/maps/token`. This runs only when no direct token was
  found; a token baked at build time wins.
- **The studio:** the reader's URL (localStorage). The studio fetches it itself, and the fetched
  token then travels as `tk` / `window.MAP_TOKEN`.
- **Plugins:** none reads `profile-config.tokenUrl` today. The studio and Deep Research
  forward it, but no element consumes it (see the open points below).

## 5. People-group list: `'doxa'` | `'unreached'` | `'frontier'` | `'frontier-500k'` | `'unengaged'`

Which people groups a map shows. The lists are defined in `lists/lists.json`, each as a filter over
the IMB / peoplegroups.org dataset (never a hand-kept roster). Aliases name them by project:
`2000` = `doxa`, `7000` = `unreached`, `4700` = `frontier`, `700` = `frontier-500k`.

| Precedence | Channel | Where it is read |
|---|---|---|
| 1 | `profile-config.list` | `lists/peopleGroupList.js` `resolvePeopleGroupList` |
| 2 | `?list=` in the page URL | the same |
| 3 | `window.MAP_LIST` | the same |
| 4 | default `'doxa'` | DOXA's live list, exactly as before: nothing fetched, nothing filtered |

- **How a map honours it:** every people-group fetch passes its rows through
  `applyPeopleGroupList(rows, profileConfig)`, which keeps the rows whose slug is in the list's
  membership file (`data/people-groups/lists/<id>.json`, served as `assets/people-groups/lists/`).
  `DataSourceManager` does it for maps that load through it (pass it `profileConfig`).
- **What a map shows (Tier A):** the DOXA groups in the list, because DOXA's API is where the rows
  and the prayer fields come from. The list's groups that DOXA does not carry are Tier B, per map.
- **Composites** thread `list` to their children like `provider` (`INHERITED_PAGE_KEYS`, and the
  stack composites' child `profile-config`).
- **Membership files** are generated: `bun run lists` (`scripts/people-groups/build-lists.mjs`,
  from the IMB CSV and the DOXA snapshot that `build-vision-funnel.mjs` saves).
- **An unknown list** falls back to `'doxa'` with a console warning. **A list whose membership
  cannot load** shows no groups (fails closed), never DOXA's whole list under another list's name.
- **Showing a list's name:** `listLabel(id, t)` and `listDefinition(id, t)` read the reader's catalogue
  (`i18n/locales/<lc>/lists.json`, area `lists`) through the caller's translator, and fall back to the
  registry's English. Never print `lists.json`'s `label` directly: it is the English fallback only.
- **Guarded by** `check:universal-props` (LIST-FETCH, LIST-DSM, LIST-KEYS) and
  `check:list-prop-unit`.

---

## Open points found while writing this down

Each is a defect or a decision, still open.

1. **`profile-config.tokenUrl` has no reader.** It is written by the studio and the gallery and
   read by nothing. The reader's own URL is also never forwarded as `tokenUrl`, only as the token
   it produced.
2. **A token fetched from a URL can arrive after the first pane has mounted.** The studio publishes
   it without re-mounting, so the pane keeps no token until something re-mounts it.
3. **Clearing the token in the studio leaves the old one in use.** `delete window.MAP_TOKEN` removes
   the accessor that `useSharedMapToken` installed and never reinstalls it. An empty value is also
   never published, so `window.__doxaMapToken` keeps the old token.
4. **Three raw maps read `window.DOXA_TOKEN`** instead of the injected `mapboxToken`:
   cities-internet `connectivity-map.vue`, gospel-resources `resources-map.vue` and key-cities
   `cities-map.vue`. Only some dev pages set `DOXA_TOKEN`, so on a built page or in the studio
   these maps ignore the page-wide token.
5. **`createAppI18n` still sets `<html dir="rtl">`** on the host page for an Arabic URL or page. It
   is set-only by design, but it contradicts ProfileLoader's own-root rule.
6. **The locale ladders disagree:**
   - The studio uses `navigator.language` and a saved locale; the library and the gallery do not.
   - The locale lists differ: 11 codes in `SUPPORTED_LOCALES` against 8 in `languages.js`.
   - The studio normalises `it`, `ro` and `zh` to `en`.
7. **A locale switch in the studio updates only the active pane.** Panes visited earlier keep the
   old language.
8. **Engine edges in the studio:**
   - A host `provider="MapLibre"` (mixed case) becomes "each map's own".
   - A host `provider` is not published to `window.MAP_PROVIDER` unless the reader chose one.
   - Choosing "each map's own" deletes a `window.MAP_PROVIDER` the host page set.
