#!/bin/sh
set -eu

output=${1:?usage: prepare-release-inputs.sh <output-directory>}
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${RELEASE_WORKFLOW_ID:?RELEASE_WORKFLOW_ID is required}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$output"
output=$(CDPATH= cd -- "$output" && pwd)
mkdir "$output/tokenizer" "$output/release-assets"

resolve() {
  key=$1
  tag=$2
  # Resolve separately: printf would hide a failed command substitution.
  immutable_reference=$("$root/scripts/resolve-release-image.sh" "$tag" linux/amd64 linux/arm64)
  printf 'IMAGE_%s=%s\n' "$key" "$immutable_reference" >> "$output/upstream-images.env"
}
resolve POSTGRES docker.io/library/postgres:16.10-alpine3.22
resolve REDIS docker.io/library/redis:7.4.5-alpine3.21
# Coolify's source-built image includes both the server and the signed mc client.
# Keep setup on the same distribution instead of the retired MinIO registries.
resolve MINIO ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z
resolve MINIO_CLIENT ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z
resolve BUSYBOX docker.io/library/busybox:1.37.0
resolve GATEWAY docker.io/library/nginx:1.28.0-alpine3.21
resolve ELASTICSEARCH docker.elastic.co/elasticsearch/elasticsearch:8.19.2
resolve DOCLING quay.io/docling-project/docling-serve:v1.27.0

lock="$root/deploy/release/tokenizer.lock.json"
jq -e '
  (.repository | type == "string" and test("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) and
  (.revision | type == "string" and test("^[0-9a-f]{40}$")) and
  (.files | type == "array" and length > 0 and all(.[];
    type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]*$")))
' "$lock" >/dev/null
repository=$(jq -r .repository "$lock")
revision=$(jq -r .revision "$lock")
jq -r '.files[]' "$lock" | while IFS= read -r file; do
  curl --proto '=https' --tlsv1.2 --retry 3 --retry-max-time 120 \
    --max-time 60 --connect-timeout 15 -fsSL \
    "https://huggingface.co/${repository}/resolve/${revision}/${file}?download=true" \
    -o "$output/tokenizer/$file"
  test -s "$output/tokenizer/$file"
done

install -m 0755 "$root/deploy/release/linksense-installer.sh" \
  "$root/deploy/release/linksense-cli.sh" "$output/release-assets/"
install -m 0644 "$root/LICENSE" \
  "$root/LICENSE-EXCEPTIONS.md" \
  "$root/ATTRIBUTION.md" \
  "$root/TRADEMARK.md" \
  "$root/NOTICE" \
  "$root/THIRD-PARTY-NOTICES.md" \
  "$root/deploy/release/compose.common.yml" \
  "$root/deploy/release/compose.core.yml" \
  "$root/deploy/release/compose.full.yml" \
  "$root/deploy/release/gateway.conf.template" \
  "$lock" "$output/release-assets/"
node "$root/scripts/bundle-release-installers.mjs" "$output/release-assets"
for script in "$output/release-assets/"*.sh; do sh -n "$script"; done

# Freeze time and inputs once per workflow; partial reruns must regenerate
# byte-identical release assets for the same draft and image digests.
printf 'RELEASE_VERSION=%s\nSOURCE_SHA=%s\nRELEASE_WORKFLOW_ID=%s\nRELEASE_BUILD_TIME=%s\n' \
  "$RELEASE_VERSION" "$SOURCE_SHA" "$RELEASE_WORKFLOW_ID" \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$output/identity.env"
(
  cd "$output"
  find . -type f ! -name SHA256SUMS | LC_ALL=C sort | xargs sha256sum > SHA256SUMS
)
