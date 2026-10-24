# Which gates need a browser

There are **238** checks in this repo. **97 need a real browser**; the rest run anywhere. If you are not
the person who owns the browser seat, that second group is not yours to run — and knowing which is
which saves you from a whole class of wrong answer.

> **The short version.** A gate that reads *files* is headless. A gate that asks *what the page
> actually painted* needs a browser. Run the first kind freely; hand the second kind to whoever owns
> the browser.

---

## Telling them apart

**Ask the repo, don't grep:**

```bash
bun run browser-gates      # lists every script that launches a browser
```

That is the authoritative answer — the same detector `check:browser-gates-guarded` uses, so it
cannot drift from what is enforced. A grep for `playwright|chromium` also works today and is fine
for a quick look, but it is a heuristic: it finds files that *mention* the word, and it would miss a
file that reached the package by path. The name tells you nothing either. `check:packet-render` sounds like a file check and drives a browser;
`check:composites-mount` sounds like it needs one and does not (it mounts every composite through
Vite's SSR loader, no browser at all).

### Measured on `main` (2026-09-28)

| | Count |
|---|---:|
| headless — run these yourself | the remainder |
| **browser — not yours unless you own the seat** | **97** |
| neither (shells out to `bun`/`php`) | 3 — `check:mobile`, `check:wp-embed`, `smoke:playground` |

The browser group is, broadly: everything that renders a map (`check:map-paints`,
`check:map-data-painted`, `check:auto-engine`, `check:maplibre-drops`), everything about layout
(`check:fits-screen`, `check:shell-scroll`, `check:filter-width`, `check:scrim-viewport`),
everything that prints (`check:poster-prints`, `check:print-geometry`, `check:packet-render`),
everything about right-to-left shaping (`check:rtl-shaping`, `check:embedded-rtl`), the English-leak
family (`check:english-leaks`, `check:leaf-english-leaks`, `check:host-locale-contract`), and every
`smoke:*`.

## Why the split exists, and why it is not negotiable

One machine, one browser seat. Two agents running Playwright at once fight over it, and the loser
does not fail — **it reports that it could not look**, which is a third outcome most people's mental
model does not have (see below). So the rule is: **one person runs the browser gates.** In this
repo that is the QA agent; ask them rather than starting a second browser.

This is not a limitation to work around. A source read and a render are *different measurements*,
and confusing them is the most common way to report something false:

- `check:leaf-english-leaks` can only find a leak by comparing what the catalogue says with **what
  the page shows**. Four catalogue gates can all pass — keys exist, differ per locale, are reachable,
  are in scope — while a page still paints English. Catalogue-green is not render-green.
- Equally, a headless check often settles a question people assume needs pixels. Of 16 cards parked
  as "needs a browser", **7 turned out to be about markup, a path, a manifest field or a gate** —
  all readable without one.

**Ask what property the claim is about**, then pick the tool. Not the other way round.

---

## The guard: you cannot launch a browser by accident any more

The rule above used to be remembered. It is now **enforced**. Every browser gate reaches Playwright
through `internal/lib/playwright-guarded.mjs`, which refuses to launch unless
`internal/browser-slot.sh` has exported `DOXA_BROWSER_SLOT`:

```bash
internal/browser-slot.sh bun run check:packet-render     # the only way to run one
```

Run a browser gate outside the slot and it does not fail — **it exits 75 and tells you the command**:

```
this gate launches a browser. Browsers run only on the browser seat, inside the slot:
  internal/browser-slot.sh bun run <script>     (it exports DOXA_BROWSER_SLOT)
NOT MEASURED (exit 75).
```

`check:browser-gates-guarded` fails any repo file that reaches Playwright directly instead of
through the guard.

**The slot is a counting semaphore, not a mutex.** A single lock made every agent's browser proof
queue behind one chrome — measured 2026-09-25, the queue sat 10–19 deep for hours. The real
constraint is memory (~300–500 MB per headless chrome), not exclusivity, so the slot admits as many
browsers as the box can hold and refuses when free memory is below the floor. A slot that is free
while the box is out of memory is an invitation to be OOM-killed mid-measurement, which reads as a
flaky gate rather than as what it is.

> **If you are not the browser seat, none of this is your invitation.** The guard stops the accident;
> it does not make the run yours to take. Send the command to whoever owns the seat. Testing whether
> the guard refuses *is itself a browser launch* — that one has been learned the hard way.

## ★ Exit 75 means NOT MEASURED. It is not a pass and it is not a failure.

This is the one that bites hardest, because it looks like success.

`internal/run-parallel.mjs:262` states the contract:

> THREE OUTCOMES, never two. Exit **75** (`EX_TEMPFAIL`) from ANY step is **NOT MEASURED**: the gate
> could not look (no browser seat, no slot, no built tree), which is neither a pass nor a failure. A
> gate that exits **0 while announcing SKIP** is also NOT MEASURED. Only any other non-zero exit is a
> FAIL.

Two traps follow from that, and both have caught people here:

1. **Exit 0 is not enough.** A gate can exit 0 and print `SOMETHING: SKIP` — it looked at nothing.
   The runner marks that NOT MEASURED; a human reading only `$?` records a pass.
2. **Your own `timeout` produces exit 124, which is also not a failure.** Killing a gate at 180 s
   because you were impatient tells you nothing about the code. If you must bound a run, bound it
   generously and read exit 124 as "I stopped it", never as "it failed".

The runner prints all three: `✓` pass, `✗` fail, `⊘` not measured. **Read the symbol, not the tail of
the log** — a truncated log with a green last line looks exactly like a pass.

---

## What to do, depending on who you are

**Landing a change:** run `bun run gates:pre` (all headless, 15 checks, ~30 s on a fresh clone) plus
whichever headless gates cover what you touched. Do not run the browser group.

**You think a browser gate would catch your bug:** say so, name the gate, and say what result would
change your mind. A prediction someone else can falsify is worth more than a run you did yourself.

**You own the browser seat:** you are the only one. When a gate comes back NOT MEASURED, say
"not measured" — resist reporting it as either colour.

## A worked example of getting this wrong

`check:packets-all` reads generated packets from a gitignored scratch directory. It went red on 43
files left over from a run three days earlier, reporting *"0 prayer tick boxes"* about packets
generated before tick boxes existed. Nothing was broken. The gate was grading leftovers.

The fix was not to loosen it: it now skips any packet older than the renderer that produces it, and
says so. **A stale input is NOT MEASURED, not FAIL** — the same three-outcome rule, one level down.
