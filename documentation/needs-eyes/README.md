# needs-eyes — partner-embed fixtures

A check that can only be seen has to be *openable by someone else*, not a construct that lives inside
one gate's process. These pages are generated on demand and are not committed; write them with:

```
node internal/check-embedded-rtl.mjs --emit
```

`check-embedded-rtl` builds its partner page on two ephemeral ports inside its own process. That is
fine for a headless assertion and useless for a human: "open a partner page at a foreign origin"
was not a thing anyone but the gate could do. `--emit` writes the same page to disk so the
needs-eyes item is reproducible.

## What each file is for

| file | channel under test | open it as |
|---|---|---|
| `partner-poster-wall.html` | `profile-config.locale` — the channel a **host** sets | plain |
| `partner-upg-100-mfe.html` | same, on the composite | plain |
| `partner-poster-wall-lang-ar.html` | `?lang=` — the channel a **reader** follows | **with `?lang=ar`** |

⚠ **The `?lang=ar` file deliberately carries no `locale` in its `profile-config`** (1100 bytes vs
1114). The two channels reach the document-direction code by different routes, and
`detectLocale()` reads the URL *first*. If the config also supplied the locale, a reader could
believe the URL had done it when it had not — and the defect this fixture exists for only fires on
the URL channel. An earlier version of the emit produced all three files byte-identical, which
would have handed a reviewer three pages they could not tell apart.

## How to use it

Two terminals, and **the origins must differ** — same-origin hides the bug:

```
# 1) the tree, WITH CORS (a partner embed uses crossorigin="anonymous", so the
#    browser demands Access-Control-Allow-Origin; `bun run serve` does not send it,
#    a real CDN does)
npx http-server public -p 47395 --cors -s

# 2) these fixtures
npx http-server documentation/needs-eyes -p 47393 -s

# 3) open
http://127.0.0.1:47393/partner-poster-wall-lang-ar.html?lang=ar
```

## What to look at

The partner page's own heading — **"Partner page"** — must stay **left**-aligned and the
document's `<html>` must carry no `dir`, while the plugin below it mirrors right-to-left.

If the heading jumps to the right, the embedded plugin flipped its host's whole page and the check
has **failed**. That was the real defect: an RTL locale was written to
`document.documentElement.dir` whenever it resolved, so a reader following a `?lang=ar` link to a
partner's site got the partner's headings, nav and footer flipped. The fix
(`window.MAP_OWNS_PAGE`, packet/vertical 2a502dd8) is that only a page the generator wrote may
have its direction set; absence of the flag means restraint.
