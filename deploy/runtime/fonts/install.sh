#!/bin/sh
set -eu

font_manifest="${1:-$(dirname "$0")/downloads.sha256}"
font_destination="${2:-/usr/local/share/fonts/linksense-microsoft}"
font_cache="${3:-/var/cache/linksense-fonts}"
install -d -m 0755 "$font_cache"

verify_download() {
  printf '%s  %s\n' "$checksum" "$1" | sha256sum --check --status
}

jsdelivr_url_for() {
  raw_path="${1#https://raw.githubusercontent.com/}"
  [ "$raw_path" != "$1" ] || return 1
  owner="${raw_path%%/*}"
  remainder="${raw_path#*/}"
  [ "$remainder" != "$raw_path" ] || return 1
  repository="${remainder%%/*}"
  remainder="${remainder#*/}"
  revision="${remainder%%/*}"
  asset_path="${remainder#*/}"
  [ -n "$owner" ] && [ -n "$repository" ] && [ -n "$revision" ] || return 1
  [ "$asset_path" != "$remainder" ] && [ -n "$asset_path" ] || return 1
  printf 'https://cdn.jsdelivr.net/gh/%s/%s@%s/%s\n' \
    "$owner" "$repository" "$revision" "$asset_path"
}

github_proxy_url_for() {
  case "$1" in
    https://raw.githubusercontent.com/*)
      printf 'https://gh-proxy.com/%s\n' "$1"
      ;;
    *)
      return 1
      ;;
  esac
}

download_font() {
  download_url="$1"
  retry_count="$2"
  curl --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    --retry "$retry_count" --retry-all-errors --retry-delay 2 --retry-max-time 600 \
    --speed-time 30 --speed-limit 1024 --continue-at - \
    --output "$partial_font" "$download_url"
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
    if ! download_font "$url" 0; then
      mirror_url="$(jsdelivr_url_for "$url" || true)"
      if [ -z "$mirror_url" ]; then
        echo "Font download failed and no mirror is available: $filename" >&2
        exit 1
      fi
      printf '[fonts] Primary source failed; trying CDN mirror: %s\n' "$filename" >&2
      if ! download_font "$mirror_url" 0; then
        proxy_url="$(github_proxy_url_for "$url" || true)"
        if [ -z "$proxy_url" ]; then
          echo "Font download failed and no proxy is available: $filename" >&2
          exit 1
        fi
        printf '[fonts] CDN mirror failed; trying HTTPS proxy: %s\n' "$filename" >&2
        if ! download_font "$proxy_url" 2; then
          echo "Font download failed from all pinned sources: $filename" >&2
          exit 1
        fi
      fi
    fi
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
