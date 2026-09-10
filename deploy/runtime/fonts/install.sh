#!/bin/sh
set -eu

font_manifest="${1:-$(dirname "$0")/downloads.sha256}"
font_destination="${2:-/usr/local/share/fonts/linksense-microsoft}"
font_cache="${3:-/var/cache/linksense-fonts}"
install -d -m 0755 "$font_cache"

verify_download() {
  printf '%s  %s\n' "$checksum" "$1" | sha256sum --check --status
}

# Only install after every pinned download has passed its checksum.
while read -r checksum filename url; do
  case "$filename" in
    ''|.*|*[!a-z0-9.]*) echo "Invalid font filename: $filename" >&2; exit 1 ;;
  esac
  case "$checksum" in
    ''|*[!a-f0-9]*) echo "Invalid font checksum: $filename" >&2; exit 1 ;;
  esac
  [ "${#checksum}" -eq 64 ] || { echo "Invalid font checksum: $filename" >&2; exit 1; }
  cached_font="$font_cache/$checksum-$filename"
  if [ -f "$cached_font" ] && verify_download "$cached_font"; then
    printf '[fonts] Cached: %s\n' "$filename"
    continue
  fi
  rm -f "$cached_font"
  partial_font="$cached_font.part"
  if ! { [ -f "$partial_font" ] && verify_download "$partial_font"; }; then
    printf '[fonts] Downloading/resuming: %s\n' "$filename"
    # Keep partial bytes in the BuildKit cache after network errors or cancellation.
    curl --fail --silent --show-error --location \
      --proto '=https' --proto-redir '=https' \
      --connect-timeout 15 --max-time 300 --retry 2 --retry-max-time 600 \
      --speed-time 30 --speed-limit 1024 --continue-at - \
      --output "$partial_font" "$url"
  fi
  if ! verify_download "$partial_font"; then
    rm -f "$partial_font"
    echo "Font checksum mismatch: $filename" >&2
    exit 1
  fi
  mv "$partial_font" "$cached_font"
done < "$font_manifest"

install -d -m 0755 "$font_destination"
while read -r checksum filename url; do
  install -m 0644 "$font_cache/$checksum-$filename" "$font_destination/$filename"
done < "$font_manifest"
