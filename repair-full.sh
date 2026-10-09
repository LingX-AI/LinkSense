#!/bin/sh
set -eu
install_dir=${LINKSENSE_INSTALL_DIR:-/opt/linksense}
state_file=$install_dir/install-state.env
if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then
  base=${LINKSENSE_RELEASE_BASE_URL%/}
elif [ -r "$state_file" ]; then
  [ -f "$state_file" ] && [ ! -L "$state_file" ] && [ "$(stat -c '%u:%a' "$state_file" 2>/dev/null || true)" = "0:600" ] || {
    printf '%s\n' "LinkSense installation state must be a root-owned regular file with mode 0600." >&2
    exit 1
  }
  version=$(sed -n 's/^STATE_RELEASE_VERSION=//p' "$state_file" | head -n 1)
  printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
    printf '%s\n' "Invalid LinkSense installation state." >&2
    exit 1
  }
  base="https://github.com/LingX-AI/linksense/releases/download/$version"
else
  base=https://github.com/LingX-AI/linksense/releases/latest/download
fi
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT HUP INT TERM
download_status=0
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$base/repair-full.sh" -o "$tmp/repair-full.sh" || download_status=$?
case "$download_status" in
  0) ;;
  16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 -fsSL "$base/repair-full.sh" -o "$tmp/repair-full.sh" ;;
  *) exit "$download_status" ;;
esac
sh "$tmp/repair-full.sh"
