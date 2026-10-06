#!/bin/sh
set -eu

source_file=/etc/apt/sources.list.d/ubuntu.sources
for mirror in "${UBUNTU_MIRROR_URL:-}" "${UBUNTU_SECURITY_MIRROR_URL:-}"; do
  case "$mirror" in
    '') ;;
    http://*|https://*) case "$mirror" in *[[:space:]]*) exit 64;; esac ;;
    *) echo 'Ubuntu mirror must be an HTTP or HTTPS URL.' >&2; exit 64 ;;
  esac
done
test -f "$source_file"
temporary_sources=$(mktemp)
trap 'rm -f "$temporary_sources"' EXIT HUP INT TERM
awk -v main="${UBUNTU_MIRROR_URL:-}" -v security="${UBUNTU_SECURITY_MIRROR_URL:-}" '
  BEGIN { RS=""; ORS="\n\n" }
  {
    target = ($0 ~ /Suites:[^\n]*-security/) ? security : main
    if (target != "") {
      count=split($0, lines, "\n")
      for (i=1;i<=count;i++) if (lines[i] ~ /^URIs:/) lines[i]="URIs: " target
      value=lines[1]
      for (i=2;i<=count;i++) value=value "\n" lines[i]
      print value
    } else print
  }
' "$source_file" > "$temporary_sources"
install -m 0644 "$temporary_sources" "$source_file"
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' > /etc/apt/apt.conf.d/80linksense-network
apt-get update
apt-get dist-upgrade --yes
apt-get install --yes --no-install-recommends ca-certificates curl openssl libstdc++6
rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm
rm -f /usr/local/bin/npm /usr/local/bin/npx

# Normalize the stock Ubuntu account to the identities used by LinkSense.
# Refuse an unexpected account rather than replacing a configured identity.
existing_user=$(getent passwd 1000 | cut -d: -f1 || true)
if [ -n "$existing_user" ]; then
  test "$existing_user" = ubuntu
  userdel --remove ubuntu
fi
existing_group=$(getent group 1000 | cut -d: -f1 || true)
if [ -n "$existing_group" ]; then
  test "$existing_group" = ubuntu
  groupdel ubuntu
fi
groupadd --gid 1000 node
useradd --uid 1000 --gid node --create-home --shell /bin/bash node
node --version
