#!/bin/sh
set -eu

[ "$#" -ge 1 ] || {
  printf '%s\n' "usage: resolve-release-image.sh <tagged-image-reference> [required-platform ...]" >&2
  exit 64
}

reference=$1
shift
case "$reference" in
  *@*) repository=${reference%@*} ;;
  *:*) repository=${reference%:*} ;;
  *) repository=$reference ;;
esac

raw=$(mktemp)
trap 'rm -f "$raw"' EXIT HUP INT TERM
attempt=1
until docker buildx imagetools inspect --raw "$reference" > "$raw"; do
  [ "$attempt" -lt 3 ] || exit 1
  printf 'Image registry lookup failed; retrying (%s/3).\n' "$((attempt + 1))" >&2
  sleep "$((attempt * 2))"
  attempt=$((attempt + 1))
done

for platform in "$@"; do
  case "$platform" in
    linux/amd64) platform_os=linux; platform_architecture=amd64; platform_variants=default ;;
    linux/arm64) platform_os=linux; platform_architecture=arm64; platform_variants=arm64 ;;
    *) printf 'Unsupported required platform: %s\n' "$platform" >&2; exit 64 ;;
  esac
  platform_count=$(jq -r \
    --arg os "$platform_os" \
    --arg architecture "$platform_architecture" \
    --arg variants "$platform_variants" '
      if (.manifests | type) == "array" then
        [.manifests[] | select(
          .platform.os == $os and
          .platform.architecture == $architecture and
          (if $variants == "arm64" then
            ((.platform.variant // "") == "" or .platform.variant == "v8")
          else
            ((.platform.variant // "") == "")
          end)
        )] | length
      else
        0
      end
    ' "$raw")
  [ "$platform_count" -eq 1 ] || {
    printf '%s must contain exactly one %s image, found %s.\n' \
      "$reference" "$platform" "$platform_count" >&2
    exit 1
  }
done

if command -v sha256sum >/dev/null 2>&1; then
  index_hash=$(sha256sum "$raw" | awk '{print $1}')
else
  index_hash=$(shasum -a 256 "$raw" | awk '{print $1}')
fi
index_digest="sha256:$index_hash"
printf '%s@%s\n' "$repository" "$index_digest"
