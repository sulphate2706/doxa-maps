# Tutorial — build your first map

*For people who build maps by **describing** them to an AI coding agent — not by writing
software. No coding required. You are the architect; the agent is the builder; the template
is a house that's already 90% built.*

By the end you'll have made a real, live, embeddable map — one that loads on a website, pans
and zooms, draws its own legend, and speaks eleven languages — just by describing what you
want in plain English.

---

## A few words, gently defined

| Word | What it means |
|---|---|
| **Clone** | Make your own copy of the project onto your computer. (One time, ever.) |
| **Terminal** | The text window where you type a command like `bun run dev`. You'll type maybe three commands total. |
| **A map** | One file ending in `.vue`. One map = one file. |
| **Staging** | A private preview page on *your* computer that shows all your maps and updates as you change them. Your workshop. Nobody else sees it. |
| **HMR** (Hot Module Reload) | When a file changes, the page updates itself instantly, no reload. |
| **Build** | The one moment you *publish* — packaging your maps into files a website can serve. |
| **`@map`** | The shared library every map borrows from — legends, toolbars, colors, data, languages. Free. |

---

## The lifecycle — six steps

Most days you live in steps 3 and 4.

1. **Clone the repo** to your computer. *(Once, ever.)*
2. **Go into the maps folder:** `cd doxa-maps-plugin-studio`. (The folder is the *studio* — a
   sibling `doxa-maps/` may also exist; it is a different, older tree and has no `plugin-designs/`.)
3. **Run `bun run dev`.** Your staging page opens, showing **all** your maps.
4. **Make changes** — or tell an AI agent to — and watch them appear **instantly**.
5. **When you're happy, run `BUILD_ALLOW=1 bun run build`.** This packages your maps for the website.
6. **The website picks them up** on the next page load.

> **Burn this in:** while you're *developing* you do **not** build. `bun run dev` is the
> workshop; `bun run build` is the loading dock. You only `build` when you're ready to ship.

---

## Your first five minutes

Open a terminal and step into the maps folder:

```bash
cd doxa-maps-plugin-studio
```

> **One-time setup:** this project uses **Bun**. Install it from <https://bun.sh>, then run
> `bun install` once in this folder.

Now run:

```bash
bun run dev
```

It prints a web address — usually `http://localhost:5173/` (that means *this computer, just
for you*). Click it. Your browser opens a page listing **every map in your project**, each
one a live, working map. You built nothing and configured nothing — you ran one command and
your maps showed up alive.

Now the magic trick. Tell your agent: *"On the simple map, change the ocean to a warm sand
color."* The agent edits one file. You don't touch the terminal — you glance at the browser
and the ocean is already sand. No reload, no rebuild. That's HMR, and that's the whole feel.

> **Leave `bun run dev` running** while you work. Close the window (or `Ctrl + C`) when done;
> run it again tomorrow.

### Why staging is genuinely magic

- **It finds every map by itself.** Staging auto-detects your maps by looking in the
  `plugin-designs/` folder. Add a folder or a `.vue` file and it appears. There is no roster to
  maintain, so you can never "forget to add a map to the index" — the folder *is* the list.
- **Your changes appear instantly (HMR).** Save, and the page updates in place. The feeling is
  less like programming and more like sculpting: nudge, watch, nudge again.
- **You never "build" while you work.** The dev server holds the whole project live for free.
  Nothing is committed to the world until you run `bun run build`.

---

## Know the three zones

Before you touch a file, know which zone you're in. This is the one rule that keeps every map
safe from every other map.

| Zone | What it is | Can you edit it? |
|---|---|---|
| **`library/`** (`@map`) | Reusable, shared building blocks — map, legends, toolbars, colors, data. You **reuse** these via the `@map/…` import alias. | **No — reuse only.** A change here can affect every map. |
| **`plugin-designs/<your-map>/`** | Your **sandbox**. Your one map lives here: its screens, colors, API wiring. | **Yes — build anything.** Nothing here leaks to another map. |
| **`internal/`** | The bundler's own build machinery. | **No — never.** It's the machine that builds the bundles. |

One line: **reuse `library/`, build in `plugin-designs/<your-map>/`, never touch `internal/`.**

---

## Add a brand-new map

A new map is a **copy of a great starter, renamed** — you never start from a blank page.

> **One map = one file.** A `.vue` file living **flat** in its own folder under
> `plugin-designs/`. The folder name is your map's name.

Inside `plugin-designs/` there's a folder called **`template-bundle/`** — a complete, working
example built to be copied. You don't study it; you copy it.

**The plain-English way (what you'll actually do)** — tell your agent:

> *"Copy `plugin-designs/template-bundle/` to a new folder called `plugin-designs/harvest-map/`,
> rename the inside files, then make it a map of Southeast Asia shaded by population, with a
> blue-to-orange legend on the right and labels in English and Thai."*

The moment that folder exists, staging picks it up. You watch, react, and ask for the next
change. Conversation in, map out.

**The by-hand way (if you want to see what happened):**

```bash
cp -r plugin-designs/template-bundle plugin-designs/harvest-map   # 1. copy the starter
# 2. change exactly four things: the folder name, the tag in index.js, the tag/profile
#    strings in index.html, and the .vue filenames (delete the second one if you want one
#    screen). Full checklist: plugin-designs/template-bundle/README.md
# 3. it shows up in staging automatically — no list to touch
BUILD_ALLOW=1 bun run build                                                 # 4. when ready, publish
```

### What the starter gives you for free

Behind every map sits the shared library (`@map`), doing the heavy lifting. Every map gets,
for free: **legends**, **toolbars**, **a color system**, **data connections**, and **eleven
languages** (English, Spanish, French, German, Italian, Portuguese, Romanian, Russian,
Arabic, Hindi, Chinese). The library is **Apache-2.0** — shared freely — but **your map folder
is entirely yours**.

> **Change colors by editing values, not logic.** Your map's colors live in your own folder,
> `plugin-designs/<your-map>/src/colors/`. Copy `example-mode.js`, rename it, change the hex
> values. Your colors merge *over* the shared set for your map only, so they can never break
> another map. Never edit `library/colors/` to recolor your own map.

---

## Publishing, and the one-line embed

```bash
BUILD_ALLOW=1 bun run build
```

This packages your map into the served web-root, `public/`. To put it on a page you get a
single script tag:

```html
<script src="/doxa-maps/harvest-map/harvest-map.js"></script>
<harvest-map profile-config='{"profile":"harvest-map","tk":"MAPBOX_PUBLIC_TOKEN"}'></harvest-map>
```

The element tag matches your map — the agent sets it when it renames the template. A
data-driven map also needs the Mapbox library loaded once on the page; the full embed recipe
is in **[how-to.md](./how-to.md)**.

---

## The two commands you actually need

| You type | What happens |
|---|---|
| `bun run dev` | Opens your live workshop showing **every** map. Changes appear instantly (HMR). No build. This is where you spend your time. |
| `bun run build` | Packages your maps into `public/` — the served web-root. The **only** build step you need. (Putting them on the live platform is a separate publish; see [develop-a-plugin-and-see-it-live.md](./develop-a-plugin-and-see-it-live.md).) |

`dev` is for **creating**; `build` is for **shipping**.

---

## When something feels confusing, just say so

Describe the confusion to your agent in ordinary words — you don't need the right technical
term. All of these work:

- *"My new map isn't showing up in the preview — can you check why?"*
- *"Make this look like the example map, but with my country data."*
- *"I changed my mind — put the legend back on the right side."*
- *"I'm ready to publish. Walk me through it."*

Your job is to **know what you want and say it.** That's a human skill, and you already have
it.

---

*Want the technical details? See **[how-to.md](./how-to.md)** (task recipes),
**[reference.md](./reference.md)** (the full lookup), and
**[explanation.md](./explanation.md)** (why it's built this way).*
