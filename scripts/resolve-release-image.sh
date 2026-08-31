#!/bin/sh
set -eu

[ "$#" -eq 1 ] || {
  printf '%s\n' "usage: resolve-release-image.sh <tagged-image-reference>" >&2
  exit 64
}

reference=$1
case "$reference" in
  *@*) repository=${reference%@*} ;;
  *:*) repository=${reference%:*} ;;
  *) repository=$reference ;;
esac

raw=$(mktemp)
trap 'rm -f "$raw"' EXIT HUP INT TERM
docker buildx imagetools inspect --raw "$reference" > "$raw"

platform_digest=$(jq -r '
  if (.manifests | type) == "array" then
    [.manifests[] | select(
      .platform.os == "linux" and
      .platform.architecture == "amd64" and
      ((.platform.variant // "") == "")
    ) | .digest] |
    if length == 1 then .[0] else empty end
  else
    empty
  end
' "$raw")

if [ -z "$platform_digest" ]; then
  platform_digest="sha256:$(sha256sum "$raw" | awk '{print $1}')"
fi

printf '%s@%s\n' "$repository" "$platform_digest"
