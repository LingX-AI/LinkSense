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
bootstrap_download() {
  download_status=0
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$1" -o "$2" || download_status=$?
  case "$download_status" in
    0) ;;
    16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 --retry-max-time 300 --connect-timeout 15 --max-time 300 -fsSL "$1" -o "$2" ;;
    *) return "$download_status" ;;
  esac
}
bootstrap_download "$base/repair-core.sh" "$tmp/repair-core.sh"
if [ "${1:-}" = --check-network ] && ! grep -q -- '--check-network)' "$tmp/repair-core.sh"; then
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
sh "$tmp/repair-core.sh" "$@"
