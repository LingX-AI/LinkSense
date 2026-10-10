#!/bin/sh
set -eu

[ "$#" -eq 5 ] || {
  printf '%s\n' 'usage: scan-release-images.sh <image-references> <release-inputs> <reports> <linux/amd64|linux/arm64> <application|baseline>' >&2
  exit 64
}
image_directory=$1
input_directory=$2
report_directory=$3
platform=$4
scope=$5
case "$scope" in application|baseline) ;; *) printf 'Unsupported scan scope: %s\n' "$scope" >&2; exit 64 ;; esac
policy_script="$(dirname "$0")/release-image-policy.mjs"
policy_name=$(node "$policy_script" name)
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
jq -n --arg platform "$platform" --arg policy "$policy_name" \
  '{status:"incomplete", policy:$policy, scanner:"Trivy 0.75.0", platform:$platform, images:[]}' \
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
if [ "$scope" = application ]; then
  test -f "$input_directory/runtime-images.env" || fail 'Missing frozen runtime image inventory.'
  for runtime in node api web worker; do
    key=$(printf '%s' "$runtime" | tr '[:lower:]' '[:upper:]')
    baseline_reference=$(sed -n "s/^BASELINE_${key}_IMAGE=//p" "$input_directory/runtime-images.env")
    jq -en --arg reference "$baseline_reference" --arg runtime "$runtime" \
      '$reference | test("^ghcr[.]io/lingx-ai/linksense-runtime-" + $runtime + "@sha256:[0-9a-f]{64}$")' >/dev/null ||
      fail 'Runtime provenance requires an immutable LinkSense baseline reference.'
  done
  [ "$(wc -l < "$input_directory/runtime-images.env" | tr -d ' ')" -eq 4 ] ||
    fail 'Frozen runtime inventory must contain exactly four runtime roles.'
fi

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
resolved_runtimes=
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
  elif [ "$role" = LINKSENSE_WORKER ]; then
    vex_file="$(dirname "$0")/../deploy/security/worker-kernel-headers.vex.json"
    test -f "$vex_file" || fail 'Missing exact userspace-header inventory evidence.'
    cp "$vex_file" "$report_directory/worker-kernel-headers.vex.json"
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
  elif [ "$scan_status" -ne 0 ] && [ "$scan_status" -ne 1 ]; then
    record error "Scanner failed with exit status $scan_status; see the role log."
    failed=1
  else
    finding_count=$(jq '[((.Results // [])[] | (.Vulnerabilities // [])[]) | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' "$report_file")
    if [ "$scan_status" -eq 1 ] && [ "$finding_count" -eq 0 ]; then
      record error 'Scanner failed without a corresponding vulnerability finding.'
      failed=1
      continue
    fi
    baseline_config=-
    runtime=$(node "$policy_script" runtime "$role") || fail 'Invalid image policy role.'
    if [ "$scope" = application ] && [ "$finding_count" -gt 0 ] && [ -n "$runtime" ]; then
      key=$(printf '%s' "$runtime" | tr '[:lower:]' '[:upper:]')
      baseline_config="$report_directory/BASELINE_${key}.image-config.json"
      case " $resolved_runtimes " in
        *" $runtime "*) ;;
        *)
          baseline_reference=$(sed -n "s/^BASELINE_${key}_IMAGE=//p" "$input_directory/runtime-images.env")
          if ! timeout --kill-after=30s 120 docker buildx imagetools inspect "$baseline_reference" --format '{{json .Image}}' > "$baseline_config" 2>> "$log_file"; then
            record error 'Cannot verify frozen baseline layer provenance.'
            failed=1
            continue
          fi
          resolved_runtimes="$resolved_runtimes $runtime"
          ;;
      esac
    fi
    policy_file="$report_directory/$role.policy.json"
    if ! node "$policy_script" classify "$role" "$scope" "$report_file" "$baseline_config" "$architecture" > "$policy_file" 2>> "$log_file"; then
      record error 'Invalid or unverified image vulnerability provenance; see the role log.'
      failed=1
    else
      policy_status=$(jq -r .status "$policy_file")
      case "$policy_status" in
        vulnerabilities)
          record vulnerabilities 'Application-introduced HIGH or CRITICAL vulnerabilities block release.'
          failed=1
          ;;
        external_risks_recorded)
          record external_risks_recorded 'External image or verified inherited-baseline vulnerabilities are recorded and do not block release.'
          ;;
        passed) record passed 'No HIGH or CRITICAL vulnerabilities.' ;;
        *) fail 'Invalid image policy outcome.' ;;
      esac
    fi
  fi
done < "$inventory"

status=passed
if [ "$failed" -ne 0 ]; then status=failed
elif jq -se 'any(.[]; .status == "external_risks_recorded")' "$records" >/dev/null; then status=passed_with_external_risks
fi
jq -sn --arg status "$status" --arg platform "$platform" --arg policy "$policy_name" --slurpfile images "$records" \
  '{status:$status,policy:$policy,scanner:"Trivy 0.75.0",platform:$platform,images:$images}' \
  > "$report_directory/summary.json"
printf 'Release image security gate: %s (%s); reports: %s\n' "$status" "$platform" "$report_directory"
exit "$failed"
