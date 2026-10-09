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
download_status=0
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$base/install-full.sh" -o "$tmp/install-full.sh" || download_status=$?
case "$download_status" in
  0) ;;
  16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 -fsSL "$base/install-full.sh" -o "$tmp/install-full.sh" ;;
  *) exit "$download_status" ;;
esac
sh "$tmp/install-full.sh"
