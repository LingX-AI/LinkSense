#!/bin/sh
set -eu

font_manifest="${1:-$(dirname "$0")/families.tsv}"
font_destination="${2:-/usr/local/share/fonts/linksense-microsoft}"
while IFS="$(printf '\t')" read -r filename family style; do
  expected="$(printf '%s\t%s\t%s/%s' "$family" "$style" "$font_destination" "$filename")"
  actual="$(fc-match --format '%{family[0]}\t%{style[0]}\t%{file}' "$family:style=$style")"
  if [ "$actual" != "$expected" ]; then
    printf 'Font mismatch for %s (%s): %s\n' "$family" "$style" "$actual" >&2
    exit 1
  fi
done < "$font_manifest"
