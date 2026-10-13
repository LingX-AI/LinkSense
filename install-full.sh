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
  16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$base/install-full.sh" -o "$tmp/install-full.sh" ;;
  *) exit "$download_status" ;;
esac
if [ "${1:-}" = --check-network ] && ! grep -q -- '--check-network)' "$tmp/install-full.sh"; then
  case "${LINKSENSE_CLI_LANGUAGE:-${LANG:-zh-CN}}" in
    en*) message='This release does not support --check-network. Use a release with network diagnostics.' ;;
    es*) message='Esta versión no admite --check-network. Use una versión con diagnóstico de red.' ;;
    pt*) message='Esta versão não oferece --check-network. Use uma versão com diagnóstico de rede.' ;;
    fr*) message='Cette version ne prend pas en charge --check-network. Utilisez une version avec le diagnostic réseau.' ;;
    ja*) message='このリリースは --check-network に対応していません。ネットワーク診断に対応するリリースを使用してください。' ;;
    *) message='此发布版不支持 --check-network，请使用包含网络诊断的新发布版。' ;;
  esac
  printf '%s\n' "$message" >&2
  exit 64
fi
sh "$tmp/install-full.sh" "$@"
