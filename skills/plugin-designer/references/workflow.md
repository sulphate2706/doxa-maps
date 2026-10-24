# The workflow: empty folder to landed on development

## 1. Develop in the Plugin Studio

```bash
bun install          # once
bun run dev          # the Plugin Studio at http://localhost:5173/
```

- Your plugin appears in the studio as soon as its folder exists; edits reload live.
- One screen on its own: `http://localhost:5173/__leaf/<your-plugin>/<screen>`.
- Test the universal props from the studio header: switch the **engine**, the **language**
  (include Arabic), and the **token** (none, a token, a token service). Your plugin must work in
  every combination — that is the point of the header.
- `bun run check:dev-assets` checks that every map's data files load under the dev server.

Your plugin's rail entry comes from `<profile>.meta.json` `"label"`, and
`bun run check:studio-rail` fails a bare id. Give it a human name.

## 2. Build

```bash
BUNDLE=<your-plugin> bun x vite build      # just your bundle → public/dx-maps/<your-plugin>/
BUILD_ALLOW=1 bun run build                 # every bundle, the tree, the manifest, the studio
```

The full build rewrites **every** plugin's output. It refuses to run without `BUILD_ALLOW=1`, and
on a team one agent owns it. **Build only your own bundle unless you are that agent.**
`public/dx-maps/manifest.json` then lists your plugin with ready-to-paste embed snippets.

## 3. Check

Run the gates that cover what you touched. The ones most often relevant:

| Gate | What it protects |
|---|---|
| `bun run check:i18n-parity` | every new key exists in all 11 catalogues |
| `bun run check:i18n-never-translated` | a key that was copied rather than translated |
| `bun run check:capability-derived` | your declared `type` agrees with what you compose |
| `bun run check:studio-rail` | your rail entry is a label, not a bare id |
| `bun run check:embed-targets` | the embed targets in the manifest exist |
| `bun run check:dev-assets` | data files load under the dev server |

`package.json` holds the full list; they are all prefixed `check:`.

## 4. Land it on development

`development` is where everyone lands; `main` is production and moves only when `development` is merged
into it, so never push to `main`.

Three commands, in this order, every time:

```bash
git add -A && git commit -m "what you changed"
git pull --rebase origin development
git push origin HEAD:development
```

**A rejected push is normal, not an error.** Someone landed first: run the middle command again and
push again. In a ten-writer stress test at a far faster rate than a human works, 95% of pushes were
rejected and retried, **zero** became merge conflicts, averaging 1.1 retries per edit
(`documentation/HOWTO-join-the-table.md`).

That result is the one-folder-per-person rule paying off: everyone pushes to one branch, so you
collide on *who goes first*, never on the same lines. A real conflict means two people edited one
file — stop and talk to them; that is a coordination problem, not a git problem.

**Stage only your own files.** `git add -A` is safe when you own your folder and nothing else is
dirty; check `git status` first if you are unsure. Never commit another agent's uncommitted work.

## 5. Done means

- `BUNDLE=<your-plugin> bun x vite build` succeeds, and your plugin is in `manifest.json`.
- It works in the Plugin Studio under **both engines**, **with and without a token**, in
  **English and Arabic**.
- Every new string is in all 11 catalogues (`bun run check:i18n-parity`).
- Your layer expressions parse under MapLibre (SKILL.md section 5, rule 7).
- You changed nothing in `library/` or in another plugin's folder, or you handed that change to the
  build owner.

## Working when your agent runs on a server

If your coding agent runs somewhere other than your laptop, one line in `.env` or `.env.local`
makes your local dev server follow the branch the agent pushes to:

```
DX_SYNC_REMOTE=origin
```

A full repo URL works too. It only ever fast-forwards, and only when all three are true: you are on
that branch, you have no unsaved edits, and you have no local commits. Otherwise it leaves your
files alone and says `main is N commits ahead` in the log. So **push your own work often**, or you
will drift. `documentation/CLOUD-DEVELOPMENT-ENVIRONMENT.md` covers this and the shared-container
alternative.

## Related

- `glossary.md` — the vocabulary
- `targets.md` — capabilities and where a plugin runs
- `backend.md` — databases and migrations
