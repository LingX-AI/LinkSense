#!/bin/sh
set -eu

[ "$#" -eq 4 ] || {
  printf '%s\n' 'usage: scan-release-images.sh <image-references> <release-inputs> <reports> <linux/amd64|linux/arm64>' >&2
  exit 64
}
image_directory=$1
input_directory=$2
report_directory=$3
platform=$4
case "$platform" in
  linux/amd64|linux/arm64) architecture=${platform#linux/} ;;
  *) printf 'Unsupported release scan platform: %s\n' "$platform" >&2; exit 64 ;;
esac

mkdir -p "$report_directory"
report_directory=$(cd "$report_directory" && pwd)
inventory="$report_directory/inventory.tsv"
records="$report_directory/images.jsonl"
: > "$inventory"
: > "$records"
jq -n --arg platform "$platform" \
  '{status:"incomplete", scanner:"Trivy 0.75.0", platform:$platform, images:[]}' \
  > "$report_directory/summary.json"

fail() {
  printf '%s\n' "$1" >&2
  jq --arg error "$1" '.status="failed" | .error=$error' \
    "$report_directory/summary.json" > "$report_directory/summary.tmp"
  mv "$report_directory/summary.tmp" "$report_directory/summary.json"
  exit 1
}

add_image() {
  jq -en --arg reference "$2" \
    '$reference | test("^[a-z0-9./-]+@sha256:[0-9a-f]{64}$")' >/dev/null ||
    fail "Image $1 must have exactly one immutable OCI reference."
  printf '%s\t%s\n' "$1" "$2" >> "$inventory"
}

# Validate the complete inventory before any registry or scanner invocation.
for name in api web migrate runner worker; do
  [ -f "$image_directory/$name" ] || fail "Missing LinkSense image: $name."
  reference=$(cat "$image_directory/$name")
  add_image "LINKSENSE_$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')" "$reference"
done
[ -f "$input_directory/upstream-images.env" ] || fail 'Missing frozen upstream image inventory.'
for name in POSTGRES REDIS MINIO MINIO_CLIENT BUSYBOX GATEWAY ELASTICSEARCH DOCLING; do
  reference=$(sed -n "s/^IMAGE_${name}=//p" "$input_directory/upstream-images.env")
  add_image "$name" "$reference"
done
[ "$(wc -l < "$input_directory/upstream-images.env" | tr -d ' ')" -eq 8 ] ||
  fail 'Frozen upstream inventory must contain exactly the eight release image roles.'

# Do not inherit policy overrides, remote scanner settings or local ignore files.
# Registry authentication is read from Docker's existing credential configuration.
for variable in $(env | sed -n 's/^\(TRIVY_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$variable"
done
cache_directory=$(mktemp -d)
trap 'rm -r "$cache_directory"' EXIT
trap 'exit 1' HUP INT TERM

timeout --kill-after=30s 30 trivy --version > "$report_directory/trivy-version.log" 2>&1 ||
  fail 'Trivy version check failed; see trivy-version.log.'
trivy_version=$(sed -n 's/^Version: //p' "$report_directory/trivy-version.log")
[ "$trivy_version" = 0.75.0 ] || fail 'Release scanning requires the checksum-pinned Trivy 0.75.0 binary.'

# A new cache forces database downloads on every gate run. Failed updates cannot
# fall back to a previous run's database or cached scan result.
timeout --kill-after=30s 360 trivy image --config '' --cache-dir "$cache_directory" \
  --timeout 5m --disable-telemetry --skip-version-check \
  --db-repository ghcr.io/aquasecurity/trivy-db:2 --download-db-only \
  > "$report_directory/vulnerability-db.log" 2>&1 ||
  fail 'Vulnerability database download failed; see vulnerability-db.log.'
timeout --kill-after=30s 360 trivy image --config '' --cache-dir "$cache_directory" \
  --timeout 5m --disable-telemetry --skip-version-check \
  --java-db-repository ghcr.io/aquasecurity/trivy-java-db:1 --download-java-db-only \
  > "$report_directory/java-db.log" 2>&1 ||
  fail 'Java database download failed; see java-db.log.'
for database in db java-db; do
  jq -e '.Version > 0 and (.UpdatedAt | type == "string") and (.NextUpdate | type == "string")' \
    "$cache_directory/$database/metadata.json" >/dev/null ||
    fail "Missing or invalid $database metadata after database download."
done
cp "$cache_directory/db/metadata.json" "$report_directory/vulnerability-db.json"
cp "$cache_directory/java-db/metadata.json" "$report_directory/java-db.json"

record() {
  jq -cn --arg role "$role" --arg indexReference "$reference" \
    --arg manifestReference "${manifest_reference:-}" --arg platform "$platform" \
    --arg status "$1" --arg detail "$2" \
    '{role:$role,indexReference:$indexReference,manifestReference:$manifestReference,platform:$platform,status:$status,detail:$detail}' \
    >> "$records"
}

failed=0
tab=$(printf '\t')
while IFS="$tab" read -r role reference; do
  manifest_reference=
  index_file="$report_directory/$role.index.json"
  log_file="$report_directory/$role.log"
  report_file="$report_directory/$role.json"
  set --
  if [ "$role" = MINIO ]; then
    vex_file="$(dirname "$0")/../deploy/security/silo-fixed.vex.json"
    test -f "$vex_file" || fail 'Missing version-scoped SILO vendor fix evidence.'
    cp "$vex_file" "$report_directory/silo-fixed.vex.json"
    set -- --vex "$vex_file"
  fi
  if ! timeout --kill-after=30s 120 docker buildx imagetools inspect --raw "$reference" > "$index_file" 2> "$log_file"; then
    record error 'Registry lookup failed; see the role log.'
    failed=1
    continue
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    index_hash=$(sha256sum "$index_file" | awk '{print $1}')
  else
    index_hash=$(shasum -a 256 "$index_file" | awk '{print $1}')
  fi
  if [ "sha256:$index_hash" != "${reference##*@}" ]; then
    record error 'Registry index bytes do not match the frozen digest.'
    failed=1
    continue
  fi
  # Attestation descriptors have unknown platforms and are not runnable images.
  # Both target architectures must remain present, even in a single matrix job.
  if ! jq -e '
    .schemaVersion == 2 and
    (.manifests | type == "array")
  ' "$index_file" >/dev/null 2>> "$log_file"; then
    record error 'Invalid multi-platform image index.'
    failed=1
    continue
  fi
  if ! jq -e '
    . as $index | ["amd64","arm64"] | all(. as $arch |
      [$index.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch and
        (if $arch == "arm64" then ((.platform.variant // "") == "" or .platform.variant == "v8") else (.platform.variant // "") == "" end))] |
      length == 1 and (.[0].digest | test("^sha256:[0-9a-f]{64}$")))
  ' "$index_file" >/dev/null 2>> "$log_file"; then
    record error 'Index must contain exactly one linux/amd64 and one linux/arm64 manifest.'
    failed=1
    continue
  fi
  manifest_digest=$(jq -r --arg architecture "$architecture" \
    '.manifests[] | select(.platform.os == "linux" and .platform.architecture == $architecture and ((.platform.variant // "") == "" or ($architecture == "arm64" and .platform.variant == "v8"))) | .digest' "$index_file")
  manifest_reference="${reference%@*}@$manifest_digest"
  rm -f "$report_file"
  scan_status=0
  timeout --kill-after=30s 960 trivy image --config '' --cache-dir "$cache_directory" \
    --timeout 15m --disable-telemetry --skip-version-check \
    --skip-db-update --skip-java-db-update \
    --image-src remote --platform "$platform" --scanners vuln --pkg-types os,library \
    --severity HIGH,CRITICAL --ignore-unfixed=false --ignorefile '' \
    --format json --exit-code 1 --output "$report_file" "$@" "$manifest_reference" \
    >> "$log_file" 2>&1 || scan_status=$?
  if ! jq -e --arg reference "$manifest_reference" --arg architecture "$architecture" '
    .SchemaVersion == 2 and .Trivy.Version == "0.75.0" and
    .ArtifactType == "container_image" and .ArtifactName == $reference and
    .Metadata.ImageConfig.os == "linux" and .Metadata.ImageConfig.architecture == $architecture and
    (.Results == null or (.Results | type == "array")) and
    all((.Results // [])[]; (.Vulnerabilities == null or (.Vulnerabilities | type == "array")) and
      all((.Vulnerabilities // [])[]; (.Severity | IN("UNKNOWN","LOW","MEDIUM","HIGH","CRITICAL"))))
  ' "$report_file" >/dev/null 2>> "$log_file"; then
    record error 'Missing, invalid or mismatched scan report; see the role log.'
    failed=1
  elif jq -e 'any((.Results // [])[] | (.Vulnerabilities // [])[]; .Severity == "HIGH" or .Severity == "CRITICAL")' "$report_file" >/dev/null; then
    record vulnerabilities 'HIGH or CRITICAL vulnerabilities block release, including unfixed vulnerabilities.'
    failed=1
  elif [ "$scan_status" -ne 0 ]; then
    record error "Scanner failed with exit status $scan_status; see the role log."
    failed=1
  else
    record passed 'No HIGH or CRITICAL vulnerabilities.'
  fi
done < "$inventory"

status=passed
[ "$failed" -eq 0 ] || status=failed
jq -sn --arg status "$status" --arg platform "$platform" --slurpfile images "$records" \
  '{status:$status,scanner:"Trivy 0.75.0",platform:$platform,images:$images}' \
  > "$report_directory/summary.json"
printf 'Release image security gate: %s (%s); reports: %s\n' "$status" "$platform" "$report_directory"
exit "$failed"
