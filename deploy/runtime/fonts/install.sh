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
  curl --disable --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 \
    --retry 0 \
    --speed-time 30 --speed-limit 1024 --continue-at - \
    --output "$partial_font" "$1"
}

download_verified_source() (
  # Resume only bytes from the exact same URL. A mirror can serve a different
  # representation (or an error page) even when curl reports success.
  source_url="$1"
  source_key="$(printf '%s' "$source_url" | sha256sum | awk '{ print $1 }')"
  partial_font="$cached_font.$source_key.part"
  if [ -f "$partial_font" ] && verify_download "$partial_font"; then
    mv "$partial_font" "$cached_font"
    exit 0
  fi
  resumed=0
  [ ! -s "$partial_font" ] || resumed=1
  for attempt in 1 2; do
    result=0
    download_font "$source_url" || result=$?
    if [ "$result" -eq 0 ] && verify_download "$partial_font"; then
      mv "$partial_font" "$cached_font"
      exit 0
    fi
    # A successful transfer with bad bytes, or a rejected range, is not a
    # verified font. Discard that source's partial and retry from zero once.
    case "$result" in
      0|22|33)
        rm -f "$partial_font"
        if [ "$attempt" -eq 1 ] && [ "$resumed" -eq 1 ]; then
          printf '[fonts] Invalid resumed download; restarting: %s\n' "$filename" >&2
          continue
        fi
        ;;
    esac
    # Preserve partial bytes only after transport errors for the next build.
    printf '[fonts] Source failed or checksum mismatch: %s (%s)\n' "$filename" "$source_url" >&2
    exit 1
  done
  exit 1
)

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
  mirror_url="$(jsdelivr_url_for "$url" || true)"
  proxy_url="$(github_proxy_url_for "$url" || true)"
  # Prefer the CDN so restricted GitHub access does not delay every file.
  downloaded=0
  for source_url in "$mirror_url" "$url" "$proxy_url"; do
    [ -n "$source_url" ] || continue
    printf '[fonts] Downloading/resuming: %s (%s)\n' "$filename" "$source_url"
    if download_verified_source "$source_url"; then
      downloaded=1
      break
    fi
  done
  if [ "$downloaded" -ne 1 ]; then
    echo "Font download failed from all pinned sources: $filename" >&2
    exit 1
  fi
done < "$font_manifest"

install -d -m 0755 "$font_destination"
while read -r checksum filename url; do
  install -m 0644 "$font_cache/$checksum-$filename" "$font_destination/$filename"
done < "$font_manifest"
