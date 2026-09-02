#!/bin/sh
set -eu

GITLEAKS_VERSION=8.30.1
repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '%s\n' "Run this script from the LinkSense Git worktree." >&2
  exit 1
}

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    archive="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
    expected_sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Darwin:arm64)
    archive="gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz"
    expected_sha256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5
    ;;
  *)
    printf 'Unsupported Gitleaks host: %s %s\n' "$(uname -s)" "$(uname -m)" >&2
    exit 1
    ;;
esac

temporary_directory=$(mktemp -d)
cleanup() {
  if [ -d "$temporary_directory" ]; then
    rm -r "$temporary_directory"
  fi
}
trap cleanup EXIT HUP INT TERM

curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors --retry-delay 2 \
  --connect-timeout 15 --max-time 300 --continue-at - -fsSL \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}" \
  -o "$temporary_directory/$archive"

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum "$temporary_directory/$archive" | awk '{ print $1 }')
else
  actual_sha256=$(shasum -a 256 "$temporary_directory/$archive" | awk '{ print $1 }')
fi
[ "$actual_sha256" = "$expected_sha256" ] || {
  printf 'Gitleaks checksum mismatch: expected %s, got %s.\n' \
    "$expected_sha256" "$actual_sha256" >&2
  exit 1
}

tar -xzf "$temporary_directory/$archive" -C "$temporary_directory" gitleaks
"$temporary_directory/gitleaks" git \
  --redact \
  --verbose \
  --log-opts=HEAD \
  --no-banner \
  --exit-code 1 \
  "$repository_root"
