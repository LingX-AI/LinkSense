#!/bin/sh
set -eu

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "usage: scripts/create-public-snapshot.sh <absolute-empty-target-path>"

repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Run this script from the LinkSense Git worktree."
target=$1
case "$target" in
  /*) ;;
  *) fail "The snapshot target must be an absolute path." ;;
esac
[ ! -e "$target" ] && [ ! -L "$target" ] || fail "The snapshot target already exists: $target"

target_parent=$(dirname "$target")
target_name=$(basename "$target")
[ "$target_name" != . ] && [ "$target_name" != .. ] && [ -n "$target_name" ] || fail "The snapshot target name is invalid."
[ -d "$target_parent" ] || fail "The snapshot parent directory does not exist: $target_parent"
target_parent=$(cd "$target_parent" && pwd -P)
target="$target_parent/$target_name"

case "$target/" in
  "$repository_root/"*) fail "The public snapshot must be created outside the private worktree." ;;
esac

deleted_files=$(git -C "$repository_root" ls-files --deleted)
[ -z "$deleted_files" ] || fail "Tracked files are deleted in the worktree. Resolve them before creating a snapshot."

stage=$(mktemp -d "$target_parent/.${target_name}.tmp.XXXXXX")
cleanup() {
  if [ -n "${stage:-}" ] && [ -d "$stage" ]; then
    rm -r "$stage"
  fi
}
trap cleanup EXIT HUP INT TERM

(
  cd "$repository_root"
  git ls-files --cached --others --exclude-standard -z |
    tar --null \
      --exclude='requirements' \
      --exclude='requirements/*' \
      --exclude='training' \
      --exclude='training/*' \
      --exclude='design-qa.md' \
      --exclude='output' \
      --exclude='output/*' \
      --exclude='outputs' \
      --exclude='outputs/*' \
      --exclude='tmp' \
      --exclude='tmp/*' \
      -T - \
      -cf -
) | tar -xf - -C "$stage"

[ -f "$stage/AGENTS.md" ] || fail "AGENTS.md was not copied into the public snapshot."
[ -f "$stage/LICENSE" ] || fail "LICENSE was not copied into the public snapshot."
[ -f "$stage/README.md" ] || fail "README.md was not copied into the public snapshot."

for forbidden in requirements training design-qa.md output outputs tmp .env; do
  [ ! -e "$stage/$forbidden" ] && [ ! -L "$stage/$forbidden" ] || fail "Forbidden public snapshot path was copied: $forbidden"
done

mv "$stage" "$target"
stage=
trap - EXIT HUP INT TERM
printf 'Created LinkSense public source snapshot at %s\n' "$target"
