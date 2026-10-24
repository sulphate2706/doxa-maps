# Locale catalogues (`locales/`)

This note sits beside `locales/`, not in it: several gates and the build read every entry in
that folder as a locale.

One folder per locale, one JSON file per top-level area. `SUPPORTED_LOCALES` in
`library/i18n/index.js` is the list the runtime will actually try to resolve; the folders
here are what happens to exist on disk. A missing area file is fine — those namespaces
resolve through `fallbackLocale: 'en'`.

**Nothing in these files is a comment.** Every string ships to every reader of that locale,
so notes about the catalogue belong here, not in a `_note` key. An English `_note` inside
`ar/gospel.json` was downloaded by every Arabic reader and — because it was text present in
`ar` and absent from `en` — it also satisfied a gate probing for "does this bundle contain
Arabic translations?", hiding the fact that every Arabic character had been stripped. A
value that no reader is meant to see is a value no check should be able to count.

## gospel.json holds SHORT UI LABELS ONLY

The explanatory prose on the gospel-resources surfaces stays in English on purpose and is
not in this area. It carries doctrinal and statistical precision — which pools were
searched, what "nothing found" does and does not claim, why Open Bible Stories is not
Scripture — and a mistranslated caveat there would read as authoritative. `gospel.prose.english`
is the one translated line that says so.

When a human-reviewed translation of that prose exists, it gets its own area file and that
line comes out.

## upgMap.json holds strings only the UPG-100 map shows

A bundle carries an area when its code names it (`internal/i18n-areas.mjs`), so strings that only one
plugin shows belong in an area of their own rather than in `messages`, which every bundle carries.
`upgMap` is that area for the UPG-100 map's selection and data-failure messages: 11 locales × those keys
stay out of country-posters, which sits just under the bundle size ceiling.
