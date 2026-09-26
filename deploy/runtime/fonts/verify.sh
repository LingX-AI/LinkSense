#!/bin/sh
set -eu

font_manifest="${1:-$(dirname "$0")/families.tsv}"
replacement_manifest="${2:-$(dirname "$0")/replacements.tsv}"
while IFS="$(printf '\t')" read -r file family style; do
  expected="$(printf '%s\t%s\t%s' "$family" "$style" "$file")"
  actual="$(fc-match --format '%{family[0]}\t%{style[0]}\t%{file}' "$family:style=$style")"
  if [ "$actual" != "$expected" ]; then
    printf 'Font mismatch for %s (%s): %s\n' "$family" "$style" "$actual" >&2
    exit 1
  fi
done < "$font_manifest"

while IFS="$(printf '\t')" read -r source replacement; do
  actual="$(fc-match --format '%{family[0]}' "$source")"
  if [ "$actual" != "$replacement" ]; then
    printf 'Font replacement mismatch for %s: expected %s, got %s\n' "$source" "$replacement" "$actual" >&2
    exit 1
  fi
done < "$replacement_manifest"
