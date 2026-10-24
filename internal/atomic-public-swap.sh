#!/usr/bin/env bash
# atomic-public-swap.sh — swap a fully-built STAGE tree into the served public/ web-root atomically.
#
# WHY: `public/` is THREE things at once — the committed served web-root (`serve` = http.server on public/),
# vite's outDir, AND the holder of the flock build mutex at `public/.build.lock`. A naive whole-dir swap
# (`mv public public.old && mv staging public`) moves the lock file out from under the flock fd → silently
# voids the concurrent-build mutex, and briefly leaves NO web-root (a reader hits a half-populated or missing
# tree — the class of failure behind the live-down incident: an rsync --delete into a live web-root mid-churn).
#
# THE FIX (from RESULT-source-hygiene.md Card 3b): build fully into a STAGE dir, verify, then swap ONLY the
# swappable parts using same-filesystem rename(2) (POSIX-atomic — a reader sees old-tree or new-tree, never a
# half-tree):
#   1. rename public/doxa-maps  -> public/doxa-maps.old   (instant; old still fully valid)
#   2. rename STAGE/doxa-maps   -> public/doxa-maps        (instant; new fully valid, built+verified)
#   3. cp    STAGE/README.md    -> public/README.md        (the one other entry public/ holds)
#   4. rm -rf public/doxa-maps.old
# public/api/ (write-token) is NEVER touched — the flock handle stays valid.
#
# This is the LOCAL form of the atomic-publish discipline; the catalog MERGE (into platform/mfe-index) has its
# own hard-gate runbook. This script only makes the LOCAL public/ swap safe.
#
# USAGE:
#   internal/atomic-public-swap.sh <STAGE_DIR>
#     <STAGE_DIR> must contain a fully-built  <STAGE_DIR>/doxa-maps/  tree (with manifest.json) and an
#     <STAGE_DIR>/README.md. Typically produced by a build with BUILD_STAGE_DIR pointed here.
#   Env:
#     PUBLIC_DIR   (default: public)              the served web-root to swap into
#     DRY_RUN=1                                    print the plan, make no changes
set -euo pipefail

STAGE_DIR="${1:-}"
PUBLIC_DIR="${PUBLIC_DIR:-public}"
DRY_RUN="${DRY_RUN:-0}"

die() { echo "❌ atomic-public-swap: $*" >&2; exit 1; }

# The tree's name comes from the build config (internal/_tree-name.mjs), never a literal: this script
# renames live folders, so it must fail rather than swap the wrong one if the name cannot be read.
TREE="$(node "$(dirname "$0")/_tree-name.mjs")" || die "could not read the tree name (internal/_tree-name.mjs)"
[ -n "$TREE" ] || die "empty tree name from internal/_tree-name.mjs"

[ -n "$STAGE_DIR" ] || die "usage: atomic-public-swap.sh <STAGE_DIR>  (dir holding a built $TREE/ + README.md)"
[ -d "$STAGE_DIR" ] || die "STAGE_DIR '$STAGE_DIR' is not a directory"
[ -d "$PUBLIC_DIR" ] || die "PUBLIC_DIR '$PUBLIC_DIR' is not a directory (run from the studio root)"

STAGE_TREE="$STAGE_DIR/$TREE"
STAGE_README="$STAGE_DIR/README.md"   # public/ holds ONLY the output folder + README.md (BUILD-OUTPUT-IS-ONE-FOLDER)

# --- GATE: the stage must be a COMPLETE, verified tree before we touch the live web-root ---------------------
# (This is the same "verify is a GATE that aborts, never chained after the destructive op" lesson.)
[ -d "$STAGE_TREE" ]                 || die "stage tree missing: $STAGE_TREE"
[ -f "$STAGE_TREE/manifest.json" ]   || die "stage tree has no manifest.json — refusing to swap an incomplete build"
[ -f "$STAGE_DIR/$TREE/index.html" ] || die "stage front page missing: $STAGE_DIR/$TREE/index.html"

# a complete tree has >=15 bundle dirs (the known catalog size floor); guard against a mid-churn/empty stage.
tree_dirs=$(find "$STAGE_TREE" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
[ "$tree_dirs" -ge 15 ] || die "stage tree has only $tree_dirs bundle dirs (<15) — looks incomplete; refusing swap"

# every bundle referenced in the manifest must resolve to a real .js in the stage (no dangling entry).
missing=$(python3 - "$STAGE_TREE" <<'PY'
import json,os,sys
tree=sys.argv[1]
man=json.load(open(os.path.join(tree,'manifest.json')))
profiles=man.get('profiles',man) if isinstance(man,dict) else {}
missing=[]
# manifest shape: {"profiles": {name: {...embed.script...}}} — resolve each bundle's js if present
def bundles(m):
    if isinstance(m,dict):
        for k,v in m.items():
            if isinstance(v,dict):
                yield k,v
for name,prof in bundles(profiles):
    # each bundle folder should hold <name>/<name>.js  (best-effort: check the dir has a .js)
    d=os.path.join(tree,name)
    if os.path.isdir(d) and not any(f.endswith('.js') for f in os.listdir(d)):
        missing.append(name)
print(",".join(missing))
PY
)
[ -z "$missing" ] || die "stage bundles missing a .js: $missing — refusing to swap a broken tree"

echo "✅ stage verified: $tree_dirs bundle dirs + manifest.json + the front page, all bundles resolve."

# --- GUARD: stage and public must be on the SAME filesystem for rename() to be atomic ------------------------
stage_dev=$(stat -c '%d' "$STAGE_DIR")
pub_dev=$(stat -c '%d' "$PUBLIC_DIR")
[ "$stage_dev" = "$pub_dev" ] || die "STAGE_DIR and PUBLIC_DIR are on different filesystems ($stage_dev != $pub_dev) — rename() would not be atomic. Stage under the same volume as public/."

OLD_TREE="$PUBLIC_DIR/$TREE.old.$$"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN — plan (no changes):"
  echo "  1. mv $PUBLIC_DIR/$TREE  -> $OLD_TREE"
  echo "  2. mv $STAGE_TREE            -> $PUBLIC_DIR/$TREE"
  echo "  3. cp $STAGE_README          -> $PUBLIC_DIR/README.md (if present)"
  echo "  4. rm -rf $OLD_TREE"
  echo "  (NEVER touched: $PUBLIC_DIR/assets/  $PUBLIC_DIR/.gitignore  $PUBLIC_DIR/.build.lock)"
  exit 0
fi

# --- THE SWAP (scoped; rename-based; public/ itself and the lock never move) ---------------------------------
if [ -d "$PUBLIC_DIR/$TREE" ]; then
  mv "$PUBLIC_DIR/$TREE" "$OLD_TREE"          # 1. instant; old tree still fully valid under new name
fi
mv "$STAGE_TREE" "$PUBLIC_DIR/$TREE"          # 2. instant; new tree (built+verified) becomes live
[ -f "$STAGE_README" ] && cp "$STAGE_README" "$PUBLIC_DIR/README.md"   # 3. the generated README
rm -rf "$OLD_TREE"                                # 4. drop the superseded tree

echo "🔀 atomic swap complete — $PUBLIC_DIR/$TREE is the freshly-built tree; assets/ + .build.lock untouched."
