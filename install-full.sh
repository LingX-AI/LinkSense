#!/bin/sh
set -eu
if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then
  base=${LINKSENSE_RELEASE_BASE_URL%/}
elif [ -n "${LINKSENSE_VERSION:-}" ]; then
  printf '%s' "$LINKSENSE_VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    printf '%s\n' "LINKSENSE_VERSION must be a v-prefixed SemVer release." >&2
    exit 64
  }
  base="https://github.com/LingX-AI/linksense/releases/download/$LINKSENSE_VERSION"
else
  base=https://github.com/LingX-AI/linksense/releases/latest/download
fi
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT HUP INT TERM
curl --proto '=https' --tlsv1.2 -fsSL "$base/install-full.sh" -o "$tmp/install-full.sh"
sh "$tmp/install-full.sh"
