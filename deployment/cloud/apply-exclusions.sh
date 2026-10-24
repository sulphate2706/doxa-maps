#!/bin/bash
# apply-exclusions.sh <dir>            remove everything public-exclusions.txt excludes from <dir>
# apply-exclusions.sh --check <dir>    exit 1 if anything excluded is still in <dir> (nothing removed)
set -u
LIST="$(dirname "$0")/public-exclusions.txt"
MODE=apply; [ "${1:-}" = --check ] && { MODE=check; shift; }
DIR="${1:?usage: apply-exclusions.sh [--check] <dir>}"
[ -d "$DIR" ] || { echo "no such dir: $DIR" >&2; exit 2; }
keep=(); names=(); paths=(); contents=()
while IFS= read -r l; do
  case "$l" in ''|'#'*) ;; keep:*) keep+=("${l#keep:}") ;; name:*) names+=("${l#name:}") ;;
    content:*) contents+=("${l#content:}") ;; *) paths+=("$l") ;; esac
done < "$LIST"
found=0
for p in "${paths[@]}"; do
  # at the repo root, and anywhere below it (a built plugin sits at dx-maps/<name>)
  while IFS= read -r hit; do
    [ -e "$hit" ] || continue
    if [ $MODE = apply ]; then rm -rf "$hit"; echo "  excluded: $hit"; else echo "  PRESENT: $hit"; found=1; fi
  done < <( { [ -e "$DIR/$p" ] && echo "$DIR/$p"; find "$DIR" -path "*/$(basename "$p")" -not -path '*/node_modules/*' -prune 2>/dev/null; } | sort -u)
done
for n in "${names[@]}"; do
  while IFS= read -r f; do
    b=$(basename "$f"); skip=0; for k in "${keep[@]}"; do [ "$b" = "$k" ] && skip=1; done
    [ $skip = 1 ] && continue
    if [ $MODE = apply ]; then rm -rf "$f"; echo "  excluded: $f"; else echo "  PRESENT: $f"; found=1; fi
  done < <(find "$DIR" -iname "$n" -not -path '*/node_modules/*' 2>/dev/null)
done
if [ $MODE = check ]; then
  for c in "${contents[@]}"; do
    hits=$(grep -rIlE "$c" "$DIR" --exclude-dir=node_modules 2>/dev/null | head -5)
    [ -n "$hits" ] && { echo "  CONTENT /$c/ in:"; echo "$hits" | sed 's/^/    /'; found=1; }
  done
  [ $found = 1 ] && { echo "EXCLUSIONS: FAIL"; exit 1; }
  echo "EXCLUSIONS: clean"
fi
exit 0
