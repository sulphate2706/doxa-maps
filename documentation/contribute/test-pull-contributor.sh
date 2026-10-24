#!/usr/bin/env bash
# Runs the sync step of pull-contributor.yml against throwaway local repos and
# checks what it accepts and refuses. Needs only git and bash; touches no network.
# Usage: bash test-pull-contributor.sh [path/to/pull-contributor.yml]
# What it can't check: GitHub's own behaviour (checkout auth, GITHUB_TOKEN, the schedule).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wf="${1:-$here/pull-contributor.yml}"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
# the run: block, unindented: exactly what GitHub executes
sed -n '/run: |/,$p' "$wf" | tail -n +2 | sed 's/^          //' > "$t/sync.sh"
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid
fails=0
c() { git -C "$t/$1" "${@:2}" -q; }
sync() { # $1 = receiver bare repo, $2 = contributor bare repo, $3 = clone depth (0 = full)
  rm -rf "$t/runner"
  if [ "${3:-0}" = 0 ]; then git clone -q "$t/$1" "$t/runner"; else git clone -q --depth "$3" "file://$t/$1" "$t/runner"; fi
  (cd "$t/runner" && URL="$t/$2" bash --noprofile --norc -eo pipefail "$t/sync.sh" >/dev/null 2>&1)
}
check() { # $1 = name, $2 = expected (ok|refused), then the sync arguments
  local name="$1" want="$2"; shift 2
  local before after got; before=$(git -C "$t/$1" rev-parse -q --verify refs/heads/contributor || echo none)
  if sync "$@"; then got=ok; else got=refused; fi
  after=$(git -C "$t/$1" rev-parse -q --verify refs/heads/contributor || echo none)
  if [ "$got" = refused ] && [ "$before" != "$after" ]; then got="refused BUT the branch moved"; fi
  if [ "$got" = "$want" ]; then echo "PASS  $name ($got)"; else echo "FAIL  $name: wanted $want, got $got"; fails=$((fails+1)); fi
}
commit() { (cd "$t/$1" && git add -A && git commit -qm "$2"); }

# A receiver whose main already has workflows; the contributor works on top of it.
git init -q --bare -b main "$t/gh.git"; git init -q --bare -b release "$t/up.git"
git init -q -b main "$t/pm"; mkdir -p "$t/pm/.github/workflows"
echo ci > "$t/pm/.github/workflows/ci.yml"; echo m > "$t/pm/m"; commit pm m1; c pm push "$t/gh.git" main
git clone -q "$t/gh.git" "$t/cw"; c cw checkout -b release
echo work > "$t/cw/w"; commit cw w1; c cw push "$t/up.git" release
echo pull > "$t/pm/.github/workflows/pull-contributor.yml"; commit pm add-pull; c pm push "$t/gh.git" main
check "receiver has workflows; release = its main + 1 commit" ok gh.git up.git
echo ci2 > "$t/pm/.github/workflows/ci.yml"; commit pm ci2; c pm push "$t/gh.git" main
echo more >> "$t/cw/w"; commit cw w2; c cw push "$t/up.git" release
check "receiver changed .github/ since; contributor didn't" ok gh.git up.git
good=$(git -C "$t/cw" rev-parse HEAD)
reset() { c cw reset --hard "$good"; c cw push -f "$t/up.git" release; }
echo evil > "$t/cw/.github/workflows/ci.yml"; commit cw edit; c cw push "$t/up.git" release
check "contributor edits a workflow" refused gh.git up.git
reset; echo new > "$t/cw/.github/workflows/new.yml"; commit cw add; c cw push "$t/up.git" release
check "contributor adds a workflow" refused gh.git up.git
reset; rm "$t/cw/.github/workflows/ci.yml"; commit cw delete; c cw push "$t/up.git" release
check "contributor deletes a workflow" refused gh.git up.git
reset
c cw fetch origin; (cd "$t/cw" && git merge -q --no-edit origin/main)
echo m3 >> "$t/cw/w"; commit cw w3; c cw push "$t/up.git" release
check "contributor merges the receiver's main (its .github/ changes come along)" ok gh.git up.git
(cd "$t/cw" && git commit -q --amend -m rewritten); c cw push -f "$t/up.git" release
check "contributor rewrites history (no force-push)" refused gh.git up.git

# A fresh-history release: no history shared with the receiver.
git init -q --bare -b main "$t/gh2.git"; git init -q --bare -b release "$t/up2.git"
git init -q -b main "$t/pm2"; mkdir -p "$t/pm2/.github/workflows"; echo ci > "$t/pm2/.github/workflows/ci.yml"
commit pm2 init; c pm2 push "$t/gh2.git" main
git init -q -b release "$t/fr"; echo app > "$t/fr/app"; commit fr fresh; c fr push "$t/up2.git" release
check "fresh history without .github/" ok gh2.git up2.git
mkdir -p "$t/fr/.github/workflows"; echo x > "$t/fr/.github/workflows/x.yml"; commit fr add-gh; c fr push "$t/up2.git" release
check "fresh history with .github/ (nothing shared to compare: strict)" refused gh2.git up2.git

# Fails closed when the checkout is shallow and no shared base can be found.
git init -q --bare -b main "$t/gh3.git"; git init -q --bare -b release "$t/up3.git"
git init -q -b main "$t/pm3"; mkdir -p "$t/pm3/.github/workflows"; echo ci > "$t/pm3/.github/workflows/ci.yml"
commit pm3 m1; echo 2 > "$t/pm3/f2"; commit pm3 m2; echo 3 > "$t/pm3/f3"; commit pm3 m3; c pm3 push "$t/gh3.git" main
git clone -q "$t/gh3.git" "$t/cw3"; c cw3 checkout -b release; c cw3 reset --hard HEAD~2
echo evil > "$t/cw3/.github/workflows/ci.yml"; commit cw3 edit; c cw3 push "$t/up3.git" release
check "shallow checkout + a workflow edit" refused gh3.git up3.git 1

[ "$(git -C "$t/gh.git" rev-list --count main)" = 3 ] && echo "PASS  the receiver's main was never touched" || { echo "FAIL  main moved"; fails=$((fails+1)); }
echo; [ "$fails" = 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
