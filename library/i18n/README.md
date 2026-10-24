# library/i18n/ — the map's translations

One of the three customization seams (`colors/`, `api/`, **`i18n/`**). This one owns every
user-facing string. Translations are **one folder per locale, one JSON file per area**, inlined at
build time into a Vue I18n instance (one per `<doxa-map>`, so embeds don't bleed state).

```
  i18n/
  ┌───────────────────────────────┐
  │ index.js   ← engine, don't edit │
  │ locales/                        │
  │   en/  buttons.json legend.json …│  ← en is the source of truth + fallback
  │   es/ ar/ zh/ …  (same keys)     │  ← 11 shipped locales, drop in your own
  └───────────────────────────────┘
     filename → namespace:  buttons.json → $t('buttons.prayForThem')
```

- 11 shipped locales; `ar` renders right-to-left (`RTL_LOCALES`).
- Add a language by copying `locales/en/` to `locales/<code>/` — never by editing `index.js`
  (except adding the code to `SUPPORTED_LOCALES`).
- Missing keys fall back to English silently.

**Adding or overriding a locale?** The full contract (locale matrix, checklist, integration) is in
**[../../documentation/architecture/i18n.md](../../documentation/architecture/i18n.md)**.
