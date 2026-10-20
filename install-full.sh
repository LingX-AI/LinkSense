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
bootstrap_download() {
  download_status=0
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$1" -o "$2" || download_status=$?
  case "$download_status" in
    0) ;;
    16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$1" -o "$2" ;;
    *) return "$download_status" ;;
  esac
}
bootstrap_download "$base/install-full.sh" "$tmp/install-full.sh"
if [ "${1:-}" = --check-network ] && ! grep -q -- '--check-network)' "$tmp/install-full.sh"; then
  if bootstrap_download https://raw.githubusercontent.com/LingX-AI/linksense/078668cd90d74513df1c03d3ba0937cccbadda67/deploy/release/linksense-host.sh "$tmp/linksense-host.sh" 2>/dev/null; then
    . "$tmp/linksense-host.sh"
    [ "$#" -eq 1 ] || host_fail invalid_config installer_arguments
    host_network_diagnostics "$base"
    exit $?
  fi
  case "${LINKSENSE_CLI_LANGUAGE:-${LANG:-zh-CN}}" in
    en*) message='Unable to download --check-network diagnostics. Check HTTPS connectivity and retry.' ;;
    es*) message='No se pudo descargar el diagnóstico de --check-network. Compruebe la conexión HTTPS y vuelva a intentarlo.' ;;
    pt*) message='Não foi possível baixar o diagnóstico de --check-network. Verifique a conexão HTTPS e tente novamente.' ;;
    fr*) message='Impossible de télécharger le diagnostic --check-network. Vérifiez la connexion HTTPS et réessayez.' ;;
    ja*) message='--check-network の診断モジュールをダウンロードできません。HTTPS 接続を確認して再試行してください。' ;;
    *) message='无法下载 --check-network 网络诊断模块，请检查 HTTPS 连接后重试。' ;;
  esac
  printf '%s\n' "$message" >&2
  exit 1
fi
sh "$tmp/install-full.sh" "$@"
