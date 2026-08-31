#!/bin/sh

set -eu

debian_mirror="${DEBIAN_MIRROR_URL:-http://deb.debian.org/debian}"
security_mirror="${DEBIAN_SECURITY_MIRROR_URL:-http://security.debian.org/debian-security}"
sources_file="${DEBIAN_SOURCES_FILE:-/etc/apt/sources.list.d/debian.sources}"
apt_config_directory="${APT_CONFIG_DIRECTORY:-/etc/apt/apt.conf.d}"

validate_mirror_url() {
  label="$1"
  value="$2"
  case "$value" in
    http://* | https://*) ;;
    *)
      echo "$label must be an HTTP or HTTPS URL" >&2
      exit 1
      ;;
  esac
  case "$value" in
    *[[:space:]]*)
      echo "$label must not contain whitespace" >&2
      exit 1
      ;;
  esac
}

validate_mirror_url "DEBIAN_MIRROR_URL" "$debian_mirror"
validate_mirror_url "DEBIAN_SECURITY_MIRROR_URL" "$security_mirror"

debian_mirror="${debian_mirror%/}"
security_mirror="${security_mirror%/}"

if [ ! -f "$sources_file" ]; then
  echo "Debian deb822 sources file does not exist: $sources_file" >&2
  exit 1
fi

temporary_sources="$(mktemp "${sources_file}.XXXXXX")"
trap 'rm -f "$temporary_sources"' EXIT HUP INT TERM

awk \
  -v debian_mirror="$debian_mirror" \
  -v security_mirror="$security_mirror" '
    $1 == "URIs:" && ($2 == "http://deb.debian.org/debian" || $2 == "https://deb.debian.org/debian") {
      print "URIs: " debian_mirror
      next
    }
    $1 == "URIs:" && ($2 == "http://deb.debian.org/debian-security" || $2 == "https://deb.debian.org/debian-security") {
      print "URIs: " security_mirror
      next
    }
    { print }
  ' "$sources_file" > "$temporary_sources"

if ! grep -Fqx "URIs: $debian_mirror" "$temporary_sources"; then
  echo "The Debian package source was not found in $sources_file" >&2
  exit 1
fi
if ! grep -Fqx "URIs: $security_mirror" "$temporary_sources"; then
  echo "The Debian security source was not found in $sources_file" >&2
  exit 1
fi

cat "$temporary_sources" > "$sources_file"
rm -f "$temporary_sources"
trap - EXIT HUP INT TERM

mkdir -p "$apt_config_directory"
cat > "$apt_config_directory/80linksense-network" <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
EOF
