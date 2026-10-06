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

baseline="$root/deploy/baselines/images.lock.json"
baseline_tool="$root/deploy/baselines/tools/baseline-images.mjs"
node "$root/scripts/baseline-adoption.mjs" --check
node "$baseline_tool" verify-proof "$baseline"
node "$baseline_tool" service-env "$baseline" > "$output/upstream-images.env"
node "$baseline_tool" runtime-env "$baseline" > "$output/runtime-images.env"
install -m 0644 "$baseline" "$output/images.lock.json"
# Validate every already-frozen index without resolving mutable vendor tags.
jq -r '.runtimes[], .services[]' "$baseline" | while IFS= read -r reference; do
  resolved=$("$root/scripts/resolve-release-image.sh" "$reference" linux/amd64 linux/arm64)
  test "$resolved" = "$reference" || { echo "Baseline index digest changed." >&2; exit 1; }
done

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
