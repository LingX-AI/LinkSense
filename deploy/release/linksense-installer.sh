#!/bin/sh
set -eu

EDITION=${LINKSENSE_INSTALL_EDITION:-}
ACTION=${LINKSENSE_INSTALL_ACTION:-}
PROGRAM="LinkSense $EDITION $ACTION"
INSTALL_DIR=${LINKSENSE_INSTALL_DIR:-/opt/linksense}
HTTP_PORT=10080
ELASTICSEARCH_ROOT_USERNAME=elastic
REQUIRED_DOCKER_API=1.45
REQUIRED_COMPOSE_VERSION=2.24.4
DEFAULT_RELEASE_ORIGIN=https://github.com/LingX-AI/linksense/releases
RELEASE_SELECTOR=${LINKSENSE_VERSION:-latest}
LAST_STAGE=bootstrap
DIAGNOSTICS_READY=false

case "$EDITION:$ACTION" in
  core:install|full:install|core:repair|full:repair) ;;
  *) printf '%s\n' "Invalid installer entry point." >&2; exit 64 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Please run this script as root (for example: curl ... | sudo sh)." >&2
  exit 77
fi

TMP_ROOT=""
cleanup() {
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
    rm -r "$TMP_ROOT"
  fi
}

on_exit() {
  status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ]; then
    printf 'FAILED: %s stopped during stage: %s\n' "$PROGRAM" "$LAST_STAGE" >&2
    if [ "$DIAGNOSTICS_READY" = true ]; then
      compose ps >&2
      printf 'Diagnostics: cd %s && docker compose --env-file .env -f compose.common.yml -f compose.%s.yml ps\n' "$INSTALL_DIR" "$EDITION" >&2
    fi
  fi
  cleanup
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' HUP INT TERM

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

validate_install_dir() {
  printf '%s' "$INSTALL_DIR" | grep -Eq '^/[A-Za-z0-9._/-]+$' || fail "LINKSENSE_INSTALL_DIR must be an absolute path without spaces or shell metacharacters."
  case "/${INSTALL_DIR#/}/" in
    */../*|*/./*) fail "LINKSENSE_INSTALL_DIR must not contain . or .. path segments." ;;
  esac
  [ ! -L "$INSTALL_DIR" ] || fail "LINKSENSE_INSTALL_DIR must not be a symbolic link."
}

verify_root_private_file() {
  file=$1
  label=$2
  [ -f "$file" ] && [ ! -L "$file" ] || fail "$label is missing or is not a regular file: $file"
  owner=$(stat -c '%u' "$file" 2>/dev/null || true)
  mode=$(stat -c '%a' "$file" 2>/dev/null || true)
  [ "$owner" = 0 ] || fail "$label must be owned by root: $file"
  [ "$mode" = 600 ] || fail "$label must have mode 0600: $file"
}

log() {
  printf '%s\n' "[$PROGRAM] $*"
}

log_stage() {
  LAST_STAGE=$1
  log "$LAST_STAGE"
}

version_ge() {
  current=$1
  required=$2
  first=$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n 1)
  [ "$first" = "$required" ]
}

docker_help() {
  os_id=${OS_ID:-linux}
  case "$os_id" in
    ubuntu|debian)
      printf '%s\n' \
        "Install Docker: curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh" \
        "Upgrade Docker: sudo apt-get update && sudo apt-get install --only-upgrade docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
      ;;
    fedora|rhel|rocky|almalinux|centos)
      printf '%s\n' \
        "Install Docker: curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh" \
        "Upgrade Docker: sudo dnf upgrade docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
      ;;
    *)
      printf '%s\n' "Use Docker's official installation guide: https://docs.docker.com/engine/install/"
      ;;
  esac
}

read_os_release() {
  OS_ID=linux
  if [ -r /etc/os-release ]; then
    OS_ID=$(sed -n 's/^ID=//p' /etc/os-release | head -n 1 | tr -d '"')
  fi
  case "$OS_ID" in
    ubuntu|debian|fedora|rhel|rocky|almalinux|centos) ;;
    *) fail "Unsupported Linux distribution: $OS_ID." ;;
  esac
}

check_port() {
  own_container=false
  occupied_container=$(docker ps --filter "publish=$HTTP_PORT" --format '{{.ID}} {{.Names}}' | head -n 1 || true)
  if [ -n "$occupied_container" ]; then
    container_id=$(printf '%s' "$occupied_container" | awk '{print $1}')
    project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null || true)
    if { [ "$ACTION" = repair ] || [ -f "$INSTALL_DIR/install.pending" ]; } && [ "$project" = linksense ]; then
      own_container=true
    else
      fail "TCP $HTTP_PORT is published by another container: $occupied_container. Stop or reconfigure it manually, then retry."
    fi
  fi

  if command -v ss >/dev/null 2>&1; then
    listener=$(ss -ltnp 2>/dev/null | awk -v port=":$HTTP_PORT" '$4 ~ port "$" { print; exit }')
  elif command -v netstat >/dev/null 2>&1; then
    listener=$(netstat -ltnp 2>/dev/null | awk -v port=":$HTTP_PORT" '$4 ~ port "$" { print; exit }')
  else
    listener=$(awk '$2 ~ /:2760$/ && $4 == "0A" { print; exit }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true)
  fi
  if [ -n "${listener:-}" ] && [ "$own_container" != true ]; then
    fail "TCP $HTTP_PORT is already in use: $listener"
  fi
}

preflight() {
  [ "$(uname -s)" = Linux ] || fail "Only Linux hosts are supported by this release."
  read_os_release
  architecture=$(uname -m)
  case "$architecture" in
    x86_64|amd64) ;;
    *) fail "Unsupported CPU architecture: $architecture. This release provides linux/amd64 images only." ;;
  esac

  command -v curl >/dev/null 2>&1 || fail "curl is required. Install it with your operating system package manager."
  command -v docker >/dev/null 2>&1 || {
    docker_help >&2
    fail "Docker CLI is not installed. Run the command above, then retry."
  }

  if ! docker info >/dev/null 2>&1; then
    printf '%s\n' \
      "Start Docker: sudo systemctl enable --now docker" \
      "If Docker is running but access is denied: sudo usermod -aG docker \"${SUDO_USER:-${USER:-root}}\"" \
      "Log out and back in after changing group membership." >&2
    fail "Docker daemon is stopped or the current identity cannot access it."
  fi

  api_version=$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null || true)
  [ -n "$api_version" ] || fail "Could not read the Docker Engine API version."
  version_ge "$api_version" "$REQUIRED_DOCKER_API" || {
    docker_help >&2
    fail "Docker Engine API $api_version is too old; API $REQUIRED_DOCKER_API or newer is required."
  }

  compose_version=$(docker compose version --short 2>/dev/null | sed 's/^v//' || true)
  [ -n "$compose_version" ] || {
    docker_help >&2
    fail "Docker Compose V2 is not installed."
  }
  version_ge "$compose_version" "$REQUIRED_COMPOSE_VERSION" || {
    docker_help >&2
    fail "Docker Compose $compose_version is too old; $REQUIRED_COMPOSE_VERSION or newer is required."
  }

  docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
  [ -n "$docker_root" ] || fail "Could not determine Docker's storage directory."
  available_kb=$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')
  available_inodes=$(df -Pi "$docker_root" | awk 'NR == 2 { print $4 }')
  memory_kb=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  if [ "$EDITION" = full ]; then
    required_disk_kb=$((80 * 1024 * 1024))
    required_memory_kb=$((16 * 1024 * 1024))
    required_inodes=200000
  else
    required_disk_kb=$((40 * 1024 * 1024))
    required_memory_kb=$((8 * 1024 * 1024))
    required_inodes=100000
  fi
  [ "$available_kb" -ge "$required_disk_kb" ] || fail "Insufficient free space in $docker_root: ${available_kb} KiB available, ${required_disk_kb} KiB required."
  [ "$available_inodes" -ge "$required_inodes" ] || fail "Insufficient free inodes in $docker_root: $available_inodes available, $required_inodes required."
  [ "$memory_kb" -ge "$required_memory_kb" ] || fail "Insufficient memory: ${memory_kb} KiB detected, ${required_memory_kb} KiB required for $EDITION."
  check_port
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

download() {
  url=$1
  target=$2
  curl --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 15 -fsSL "$url" -o "$target"
}

verify_file() {
  file=$1
  expected=$2
  actual=$(sha256_file "$file")
  [ "$actual" = "$expected" ] || fail "Checksum mismatch for $(basename "$file"): expected $expected, got $actual."
}

load_strict_env() {
  file=$1
  scope=$2
  loaded_keys='|'
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}
    value=${line#*=}
    printf '%s' "$key" | grep -Eq '^[A-Z][A-Z0-9_]*$' || fail "Invalid key in $(basename "$file")."
    [ "$line" != "$key" ] || fail "Invalid line in $(basename "$file")."
    printf '%s' "$value" | tr -d '[]' | grep -Eq '^[A-Za-z0-9_./:@?&=+,-]*$' || fail "Unsafe value for $key in $(basename "$file")."
    case "$loaded_keys" in *"|$key|"*) fail "Duplicate key $key in $(basename "$file")." ;; esac
    case "$scope:$key" in
      manifest:MANIFEST_FORMAT|manifest:RELEASE_VERSION|manifest:RELEASE_EDITION_SUPPORT|manifest:RELEASE_ARCHITECTURE|manifest:RELEASE_GIT_COMMIT|manifest:RELEASE_BUILD_TIME|manifest:RELEASE_WORKFLOW_ID|manifest:RELEASE_ASSET_BASE_URL|manifest:MIN_DOCKER_API|manifest:MIN_DOCKER_COMPOSE|manifest:CORE_MIN_MEMORY_GIB|manifest:CORE_MIN_DISK_GIB|manifest:CORE_MIN_FREE_INODES|manifest:FULL_MIN_MEMORY_GIB|manifest:FULL_MIN_DISK_GIB|manifest:FULL_MIN_FREE_INODES|manifest:IMAGE_*|manifest:RESOURCE_*|manifest:TOKENIZER_*) ;;
      state:STATE_*) ;;
      runtime:COMPOSE_PROJECT_NAME|runtime:LINKSENSE_EDITION|runtime:LINKSENSE_VERSION|runtime:LINKSENSE_PUBLIC_BASE_URL|runtime:LINKSENSE_PUBLIC_SCHEME|runtime:LINKSENSE_HTTP_PORT|runtime:POSTGRES_DB|runtime:POSTGRES_USER|runtime:POSTGRES_PASSWORD|runtime:DATABASE_URL|runtime:REDIS_PASSWORD|runtime:REDIS_URL|runtime:DOCLING_REDIS_URL|runtime:LINKSENSE_JWT_SECRET|runtime:LINKSENSE_INITIALIZATION_TOKEN|runtime:LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_CREDENTIAL_MASTER_KEY|runtime:LINKSENSE_CREDENTIAL_KEY_ID|runtime:LINKSENSE_RUNNER_SHARED_SECRET|runtime:MINIO_ROOT_USER|runtime:MINIO_ROOT_PASSWORD|runtime:MINIO_ACCESS_KEY|runtime:MINIO_SECRET_KEY|runtime:MINIO_BUCKET|runtime:MINIO_KNOWLEDGE_BUCKET|runtime:MINIO_ENDPOINT|runtime:MINIO_PORT|runtime:MINIO_USE_SSL|runtime:MINIO_PUBLIC_URL|runtime:MINIO_REGION|runtime:LINKSENSE_MAX_CONCURRENT_CONVERSATIONS|runtime:LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT|runtime:LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_READY_TIMEOUT_SECONDS|runtime:LINKSENSE_WORKER_MEMORY_MB|runtime:LINKSENSE_WORKER_CPUS|runtime:LINKSENSE_WORKER_PIDS_LIMIT|runtime:LINKSENSE_WORKER_TMPFS_MB|runtime:LINKSENSE_WORKER_SHM_MB|runtime:LINKSENSE_BROWSER_SESSION_LIMIT|runtime:LINKSENSE_API_IMAGE|runtime:LINKSENSE_WEB_IMAGE|runtime:LINKSENSE_MIGRATE_IMAGE|runtime:LINKSENSE_RUNNER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE_REVISION|runtime:POSTGRES_IMAGE|runtime:REDIS_IMAGE|runtime:MINIO_IMAGE|runtime:MINIO_CLIENT_IMAGE|runtime:BUSYBOX_IMAGE|runtime:GATEWAY_IMAGE|runtime:ELASTICSEARCH_IMAGE|runtime:DOCLING_IMAGE|runtime:LINKSENSE_POSTGRES_VOLUME|runtime:LINKSENSE_REDIS_VOLUME|runtime:LINKSENSE_MINIO_VOLUME|runtime:LINKSENSE_USER_DATA_VOLUME|runtime:LINKSENSE_BACKUP_VOLUME|runtime:LINKSENSE_ELASTICSEARCH_VOLUME|runtime:LINKSENSE_TOKENIZER_VOLUME|runtime:LINKSENSE_INTERNAL_NETWORK|runtime:LINKSENSE_WORKER_CONTROL_NETWORK|runtime:LINKSENSE_WORKER_EGRESS_NETWORK|runtime:LINKSENSE_KNOWLEDGE_NETWORK|runtime:ELASTICSEARCH_ROOT_PASSWORD|runtime:ELASTICSEARCH_USERNAME|runtime:ELASTICSEARCH_PASSWORD|runtime:DOCLING_SERVE_API_KEY|runtime:LINKSENSE_KB_HYBRID_TOKENIZER|runtime:LINKSENSE_TOKENIZER_MOUNT_PATH) ;;
      *) fail "Unexpected key $key in $(basename "$file")." ;;
    esac
    export "$key=$value"
    loaded_keys="$loaded_keys$key|"
  done < "$file"
}

require_loaded_keys() {
  for required_key in "$@"; do
    case "$loaded_keys" in
      *"|$required_key|"*) ;;
      *) fail "Required key $required_key is missing from the protected configuration." ;;
    esac
  done
}

release_base() {
  if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then
    printf '%s' "${LINKSENSE_RELEASE_BASE_URL%/}"
  elif [ "$RELEASE_SELECTOR" = latest ]; then
    printf '%s/latest/download' "$DEFAULT_RELEASE_ORIGIN"
  else
    printf '%s/download/%s' "$DEFAULT_RELEASE_ORIGIN" "$RELEASE_SELECTOR"
  fi
}

fetch_manifest() {
  base=$1
  manifest=$TMP_ROOT/release-manifest.env
  checksum=$TMP_ROOT/release-manifest.env.sha256
  download "$base/release-manifest.env.sha256" "$checksum"
  expected=$(awk 'NF { print $1; exit }' "$checksum")
  printf '%s' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail "The release-manifest checksum file is invalid."
  download "$base/release-manifest.env" "$manifest"
  verify_file "$manifest" "$expected"
  MANIFEST_SHA256=$expected
  export MANIFEST_SHA256
  load_strict_env "$manifest" manifest
  require_loaded_keys MANIFEST_FORMAT RELEASE_VERSION RELEASE_EDITION_SUPPORT RELEASE_ARCHITECTURE RELEASE_ASSET_BASE_URL
  [ "${MANIFEST_FORMAT:-}" = 1 ] || fail "Unsupported release manifest format."
  printf '%s' "${RELEASE_VERSION:-}" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "The release manifest version is invalid."
  [ "${RELEASE_EDITION_SUPPORT:-}" = core-full ] || fail "This manifest does not support Core and Full."
  [ "${RELEASE_ARCHITECTURE:-}" = linux-amd64 ] || fail "This manifest does not support linux/amd64."
  [ "${MIN_DOCKER_API:-}" = "$REQUIRED_DOCKER_API" ] || fail "The release manifest has an inconsistent Docker API requirement."
  [ "${MIN_DOCKER_COMPOSE:-}" = "$REQUIRED_COMPOSE_VERSION" ] || fail "The release manifest has an inconsistent Docker Compose requirement."
  [ "${CORE_MIN_MEMORY_GIB:-}" = 8 ] && [ "${CORE_MIN_DISK_GIB:-}" = 40 ] && [ "${CORE_MIN_FREE_INODES:-}" = 100000 ] || fail "The release manifest has inconsistent Core host requirements."
  [ "${FULL_MIN_MEMORY_GIB:-}" = 16 ] && [ "${FULL_MIN_DISK_GIB:-}" = 80 ] && [ "${FULL_MIN_FREE_INODES:-}" = 200000 ] || fail "The release manifest has inconsistent Full host requirements."
  for required_hash in RESOURCE_LICENSE_SHA256 RESOURCE_COMPOSE_COMMON_SHA256 RESOURCE_COMPOSE_CORE_SHA256 RESOURCE_COMPOSE_FULL_SHA256 RESOURCE_GATEWAY_SHA256 RESOURCE_INSTALLER_ENGINE_SHA256 RESOURCE_INSTALL_CORE_SHA256 RESOURCE_INSTALL_FULL_SHA256 RESOURCE_REPAIR_CORE_SHA256 RESOURCE_REPAIR_FULL_SHA256; do
    eval "hash_value=\${$required_hash:-}"
    printf '%s' "$hash_value" | grep -Eq '^[0-9a-f]{64}$' || fail "The release manifest is missing a valid $required_hash."
  done
  for required_image in IMAGE_LINKSENSE_API IMAGE_LINKSENSE_WEB IMAGE_LINKSENSE_MIGRATE IMAGE_LINKSENSE_RUNNER IMAGE_LINKSENSE_WORKER IMAGE_POSTGRES IMAGE_REDIS IMAGE_MINIO IMAGE_MINIO_CLIENT IMAGE_BUSYBOX IMAGE_GATEWAY IMAGE_ELASTICSEARCH IMAGE_DOCLING; do
    eval "image_value=\${$required_image:-}"
    printf '%s' "$image_value" | grep -Eq '^[a-z0-9./-]+@sha256:[0-9a-f]{64}$' || fail "The release manifest is missing a valid $required_image."
    digest_key="${required_image}_DIGEST"
    eval "digest_value=\${$digest_key:-}"
    printf '%s' "$digest_value" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail "The release manifest is missing a valid $digest_key."
    [ "$digest_value" = "${image_value#*@}" ] || fail "$digest_key does not match $required_image."
  done
  if [ "$RELEASE_SELECTOR" != latest ]; then
    [ "${RELEASE_VERSION:-}" = "$RELEASE_SELECTOR" ] || fail "Requested $RELEASE_SELECTOR but the manifest describes ${RELEASE_VERSION:-unknown}."
  fi
  if [ "$EDITION" = full ]; then
    printf '%s' "${TOKENIZER_FILE_COUNT:-}" | grep -Eq '^[1-9][0-9]*$' || fail "The tokenizer file count is invalid."
    printf '%s' "${TOKENIZER_REVISION:-}" | grep -Eq '^[0-9a-f]{40,64}$' || fail "The tokenizer revision is invalid."
    printf '%s' "${TOKENIZER_TOTAL_BYTES:-}" | grep -Eq '^[1-9][0-9]*$' || fail "The tokenizer total size is invalid."
    tokenizer_size_sum=0
    tokenizer_index=1
    while [ "$tokenizer_index" -le "$TOKENIZER_FILE_COUNT" ]; do
      tokenizer_path=$(tokenizer_value "$tokenizer_index" PATH)
      tokenizer_url=$(tokenizer_value "$tokenizer_index" URL)
      tokenizer_sha=$(tokenizer_value "$tokenizer_index" SHA256)
      tokenizer_size=$(tokenizer_value "$tokenizer_index" SIZE)
      printf '%s' "$tokenizer_path" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "The tokenizer manifest contains an unsafe filename."
      printf '%s' "$tokenizer_url" | grep -Eq '^https://[^[:space:]]+$' || fail "The tokenizer manifest contains a non-HTTPS URL."
      printf '%s' "$tokenizer_sha" | grep -Eq '^[0-9a-f]{64}$' || fail "The tokenizer manifest contains an invalid SHA-256."
      printf '%s' "$tokenizer_size" | grep -Eq '^[1-9][0-9]*$' || fail "The tokenizer manifest contains an invalid file size."
      tokenizer_size_sum=$((tokenizer_size_sum + tokenizer_size))
      tokenizer_index=$((tokenizer_index + 1))
    done
    [ "$tokenizer_size_sum" = "$TOKENIZER_TOTAL_BYTES" ] || fail "The tokenizer manifest total size does not match its file entries."
  fi
}

fetch_release_resources() {
  if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then
    base=${LINKSENSE_RELEASE_BASE_URL%/}
  else
    base=$RELEASE_ASSET_BASE_URL
  fi
  stage=$TMP_ROOT/resources
  mkdir "$stage"
  for resource in LICENSE compose.common.yml "compose.$EDITION.yml" gateway.conf.template; do
    case "$resource" in
      LICENSE) expected=$RESOURCE_LICENSE_SHA256 ;;
      compose.common.yml) expected=$RESOURCE_COMPOSE_COMMON_SHA256 ;;
      compose.core.yml) expected=$RESOURCE_COMPOSE_CORE_SHA256 ;;
      compose.full.yml) expected=$RESOURCE_COMPOSE_FULL_SHA256 ;;
      gateway.conf.template) expected=$RESOURCE_GATEWAY_SHA256 ;;
    esac
    download "$base/$resource" "$stage/$resource"
    verify_file "$stage/$resource" "$expected"
  done
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

validate_http_origin() {
  origin_value=$1
  printf '%s' "$origin_value" | grep -Eq '^https?://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$' || fail "The public URL must be an HTTP(S) origin without credentials, path, query, or fragment."
  origin_authority=${origin_value#*://}
  case "$origin_authority" in
    \[*\]:*) origin_port=${origin_authority##*:} ;;
    \[*\]) origin_port= ;;
    *:*) origin_port=${origin_authority##*:} ;;
    *) origin_port= ;;
  esac
  if [ -n "$origin_port" ]; then
    [ "$origin_port" -ge 1 ] && [ "$origin_port" -le 65535 ] || fail "The public URL port must be between 1 and 65535."
  fi
}

detect_public_url() {
  if [ -n "${LINKSENSE_PUBLIC_BASE_URL:-}" ]; then
    public_url=${LINKSENSE_PUBLIC_BASE_URL%/}
    validate_http_origin "$public_url"
    printf '%s' "$public_url"
    return
  fi
  if command -v ip >/dev/null 2>&1; then
    host_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{ for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit } }' || true)
  else
    host_ip=$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)
  fi
  [ -n "$host_ip" ] || host_ip=127.0.0.1
  case "$host_ip" in
    *:*) printf 'http://[%s]:%s' "$host_ip" "$HTTP_PORT" ;;
    *) printf 'http://%s:%s' "$host_ip" "$HTTP_PORT" ;;
  esac
}

write_runtime_env() {
  env_tmp=$INSTALL_DIR/.env.tmp.$$
  umask 077
  {
    printf '%s\n' \
      "COMPOSE_PROJECT_NAME=linksense" \
      "LINKSENSE_EDITION=$EDITION" \
      "LINKSENSE_VERSION=$RELEASE_VERSION" \
      "LINKSENSE_PUBLIC_BASE_URL=$LINKSENSE_PUBLIC_BASE_URL" \
      "LINKSENSE_PUBLIC_SCHEME=$LINKSENSE_PUBLIC_SCHEME" \
      "LINKSENSE_HTTP_PORT=$HTTP_PORT" \
      "POSTGRES_DB=linksense" \
      "POSTGRES_USER=linksense" \
      "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
      "DATABASE_URL=postgresql://linksense:$POSTGRES_PASSWORD@postgres:5432/linksense" \
      "REDIS_PASSWORD=$REDIS_PASSWORD" \
      "REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/0" \
      "LINKSENSE_JWT_SECRET=$LINKSENSE_JWT_SECRET" \
      "LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET=$LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET" \
      "LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET=$LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET" \
      "LINKSENSE_CREDENTIAL_MASTER_KEY=$LINKSENSE_CREDENTIAL_MASTER_KEY" \
      "LINKSENSE_CREDENTIAL_KEY_ID=v1" \
      "LINKSENSE_RUNNER_SHARED_SECRET=$LINKSENSE_RUNNER_SHARED_SECRET" \
      "LINKSENSE_INITIALIZATION_TOKEN=$LINKSENSE_INITIALIZATION_TOKEN" \
      "MINIO_ROOT_USER=linksense-root" \
      "MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD" \
      "MINIO_ACCESS_KEY=linksense-app" \
      "MINIO_SECRET_KEY=$MINIO_SECRET_KEY" \
      "MINIO_BUCKET=linksense-files" \
      "MINIO_KNOWLEDGE_BUCKET=linksense-knowledge" \
      "MINIO_ENDPOINT=minio" \
      "MINIO_PORT=9000" \
      "MINIO_USE_SSL=false" \
      "MINIO_PUBLIC_URL=$LINKSENSE_PUBLIC_BASE_URL" \
      "MINIO_REGION=us-east-1" \
      "LINKSENSE_MAX_CONCURRENT_CONVERSATIONS=20" \
      "LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT=20" \
      "LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS=900" \
      "LINKSENSE_WORKER_IDLE_TTL_SECONDS=900" \
      "LINKSENSE_WORKER_READY_TIMEOUT_SECONDS=90" \
      "LINKSENSE_WORKER_MEMORY_MB=4096" \
      "LINKSENSE_WORKER_CPUS=2" \
      "LINKSENSE_WORKER_PIDS_LIMIT=4096" \
      "LINKSENSE_WORKER_TMPFS_MB=4096" \
      "LINKSENSE_WORKER_SHM_MB=2048" \
      "LINKSENSE_BROWSER_SESSION_LIMIT=2" \
      "LINKSENSE_API_IMAGE=$IMAGE_LINKSENSE_API" \
      "LINKSENSE_WEB_IMAGE=$IMAGE_LINKSENSE_WEB" \
      "LINKSENSE_MIGRATE_IMAGE=$IMAGE_LINKSENSE_MIGRATE" \
      "LINKSENSE_RUNNER_IMAGE=$IMAGE_LINKSENSE_RUNNER" \
      "LINKSENSE_WORKER_IMAGE=$IMAGE_LINKSENSE_WORKER" \
      "LINKSENSE_WORKER_IMAGE_REVISION=$IMAGE_LINKSENSE_WORKER_DIGEST" \
      "POSTGRES_IMAGE=$IMAGE_POSTGRES" \
      "REDIS_IMAGE=$IMAGE_REDIS" \
      "MINIO_IMAGE=$IMAGE_MINIO" \
      "MINIO_CLIENT_IMAGE=$IMAGE_MINIO_CLIENT" \
      "BUSYBOX_IMAGE=$IMAGE_BUSYBOX" \
      "GATEWAY_IMAGE=$IMAGE_GATEWAY" \
      "LINKSENSE_POSTGRES_VOLUME=linksense-postgres" \
      "LINKSENSE_REDIS_VOLUME=linksense-redis" \
      "LINKSENSE_MINIO_VOLUME=linksense-minio" \
      "LINKSENSE_USER_DATA_VOLUME=linksense-user-data" \
      "LINKSENSE_BACKUP_VOLUME=linksense-backups" \
      "LINKSENSE_INTERNAL_NETWORK=linksense-internal" \
      "LINKSENSE_WORKER_CONTROL_NETWORK=linksense-worker-control" \
      "LINKSENSE_WORKER_EGRESS_NETWORK=linksense-worker-egress"
    if [ "$EDITION" = full ]; then
      printf '%s\n' \
        "DOCLING_REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/2" \
        "ELASTICSEARCH_ROOT_PASSWORD=$ELASTICSEARCH_ROOT_PASSWORD" \
        "ELASTICSEARCH_USERNAME=linksense" \
        "ELASTICSEARCH_PASSWORD=$ELASTICSEARCH_PASSWORD" \
        "DOCLING_SERVE_API_KEY=$DOCLING_SERVE_API_KEY" \
        "LINKSENSE_KB_HYBRID_TOKENIZER=/models/tokenizers/Qwen3-Embedding-4B/current" \
        "LINKSENSE_TOKENIZER_MOUNT_PATH=/models/tokenizers/Qwen3-Embedding-4B" \
        "ELASTICSEARCH_IMAGE=$IMAGE_ELASTICSEARCH" \
        "DOCLING_IMAGE=$IMAGE_DOCLING" \
        "LINKSENSE_ELASTICSEARCH_VOLUME=linksense-elasticsearch" \
        "LINKSENSE_TOKENIZER_VOLUME=linksense-tokenizer" \
        "LINKSENSE_KNOWLEDGE_NETWORK=linksense-knowledge-internal"
    fi
  } > "$env_tmp"
  chmod 0600 "$env_tmp"
  mv "$env_tmp" "$INSTALL_DIR/.env"
}

write_env() {
  LINKSENSE_PUBLIC_BASE_URL=$(detect_public_url)
  case "$LINKSENSE_PUBLIC_BASE_URL" in
    https://*) LINKSENSE_PUBLIC_SCHEME=https ;;
    *) LINKSENSE_PUBLIC_SCHEME=http ;;
  esac
  POSTGRES_PASSWORD=$(random_hex)
  REDIS_PASSWORD=$(random_hex)
  MINIO_ROOT_PASSWORD=$(random_hex)
  MINIO_SECRET_KEY=$(random_hex)
  LINKSENSE_JWT_SECRET=$(random_hex)
  LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET=$(random_hex)
  LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET=$(random_hex)
  LINKSENSE_CREDENTIAL_MASTER_KEY=$(random_hex)
  LINKSENSE_RUNNER_SHARED_SECRET=$(random_hex)
  LINKSENSE_INITIALIZATION_TOKEN=$(random_hex)
  if [ "$EDITION" = full ]; then
    DOCLING_SERVE_API_KEY=$(random_hex)
    ELASTICSEARCH_ROOT_PASSWORD=$(random_hex)
    ELASTICSEARCH_PASSWORD=$(random_hex)
  fi
  write_runtime_env
}

install_resources() {
  for resource in LICENSE compose.common.yml "compose.$EDITION.yml" gateway.conf.template; do
    install -m 0644 "$TMP_ROOT/resources/$resource" "$INSTALL_DIR/$resource"
  done
  install -m 0644 "$TMP_ROOT/release-manifest.env" "$INSTALL_DIR/release-manifest.env"
  printf '%s  %s\n' "$MANIFEST_SHA256" release-manifest.env > "$INSTALL_DIR/release-manifest.env.sha256"
  chmod 0644 "$INSTALL_DIR/release-manifest.env.sha256"
}

create_install_volumes() {
  for volume in $(required_volumes); do
    docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
  done
}

compose() {
  docker compose --project-directory "$INSTALL_DIR" \
    --env-file "$INSTALL_DIR/.env" \
    -f "$INSTALL_DIR/compose.common.yml" \
    -f "$INSTALL_DIR/compose.$EDITION.yml" "$@"
}

pull_images() {
  compose config --quiet
  compose pull --policy always
}

tokenizer_value() {
  index=$1
  field=$2
  name="TOKENIZER_FILE_${index}_${field}"
  eval "printf '%s' \"\${$name:-}\""
}

prepare_tokenizer() {
  [ "$EDITION" = full ] || return 0
  token_stage=$TMP_ROOT/tokenizer
  mkdir "$token_stage"
  index=1
  while [ "$index" -le "$TOKENIZER_FILE_COUNT" ]; do
    path=$(tokenizer_value "$index" PATH)
    url=$(tokenizer_value "$index" URL)
    expected=$(tokenizer_value "$index" SHA256)
    expected_size=$(tokenizer_value "$index" SIZE)
    printf '%s' "$path" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "Unsafe tokenizer filename in release manifest."
    download "$url" "$token_stage/$path"
    verify_file "$token_stage/$path" "$expected"
    printf '%s' "$expected_size" | grep -Eq '^[0-9]+$' || fail "Invalid tokenizer file size in release manifest."
    actual_size=$(wc -c < "$token_stage/$path" | tr -d ' ')
    [ "$actual_size" = "$expected_size" ] || fail "Size mismatch for tokenizer file $path."
    index=$((index + 1))
  done

  docker volume inspect linksense-tokenizer >/dev/null 2>&1 || docker volume create linksense-tokenizer >/dev/null
  if [ "$ACTION" = repair ]; then
    compose stop docling-api docling-worker >/dev/null 2>&1 || true
  fi
  docker run --rm --network none \
    -v linksense-tokenizer:/tokenizer \
    -v "$token_stage:/source:ro" \
    "$IMAGE_BUSYBOX" sh -ec '
      revision=$1
      mkdir -p /tokenizer/releases
      rm -rf /tokenizer/releases/.staging /tokenizer/releases/.previous
      mkdir /tokenizer/releases/.staging
      cp -R /source/. /tokenizer/releases/.staging/
      chmod -R a-w /tokenizer/releases/.staging
      if [ -d "/tokenizer/releases/$revision" ]; then
        mv "/tokenizer/releases/$revision" /tokenizer/releases/.previous
      fi
      mv /tokenizer/releases/.staging "/tokenizer/releases/$revision"
      ln -sfn "releases/$revision" /tokenizer/.current
      mv -Tf /tokenizer/.current /tokenizer/current
      rm -rf /tokenizer/releases/.previous
    ' sh "$TOKENIZER_REVISION"
}

required_volumes() {
  printf '%s\n' linksense-postgres linksense-redis linksense-minio linksense-user-data linksense-backups
  if [ "$EDITION" = full ]; then
    printf '%s\n' linksense-elasticsearch linksense-tokenizer
  fi
}

required_networks() {
  printf '%s\n' linksense-internal linksense-worker-control linksense-worker-egress
  if [ "$EDITION" = full ]; then
    printf '%s\n' linksense-knowledge-internal
  fi
}

verify_existing_volumes() {
  missing=false
  for volume in $(required_volumes); do
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
      printf 'Missing required data volume: %s\n' "$volume" >&2
      missing=true
    fi
  done
  [ "$missing" = false ] || fail "Repair stopped to avoid creating empty replacements. Restore the missing volume from backup."
}

verify_fresh_targets() {
  for volume in $(required_volumes); do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      fail "Docker volume $volume already exists without a trusted LinkSense install state. Move or recover the existing instance before installing."
    fi
  done
  existing_container=$(docker ps -a --filter label=com.docker.compose.project=linksense --format '{{.ID}} {{.Names}}' | head -n 1 || true)
  [ -z "$existing_container" ] || fail "A LinkSense-labeled container already exists without a trusted install state: $existing_container"
  for network in $(required_networks); do
    if docker network inspect "$network" >/dev/null 2>&1; then
      fail "Docker network $network already exists without a trusted LinkSense install state."
    fi
  done
}

start_stack() {
  compose up -d postgres redis minio
  compose run --rm minio-init
  compose run --rm migrate
  compose up -d --remove-orphans
}

wait_for_health() {
  attempts=0
  local_health_url="http://127.0.0.1:$HTTP_PORT/api/v1/system/health/ready"
  while [ "$attempts" -lt 60 ]; do
    health_response=$TMP_ROOT/health.json
    if curl -fsS "$local_health_url" -o "$health_response" 2>/dev/null; then
      if [ "$EDITION" = full ]; then
        if ! grep -Eq '"document_parsing":\{"status":"available"' "$health_response" || \
          ! grep -Eq '"knowledge_search_and_indexing":\{"status":"available"' "$health_response"; then
          attempts=$((attempts + 1))
          sleep 5
          continue
        fi
        if ! compose exec -T elasticsearch curl -fsS -u "$ELASTICSEARCH_ROOT_USERNAME:$ELASTICSEARCH_ROOT_PASSWORD" http://127.0.0.1:9200/_cluster/health >/dev/null 2>&1 || \
          ! compose exec -T docling-api python -c 'import os,urllib.request; r=urllib.request.Request("http://127.0.0.1:5001/ready",headers={"X-Api-Key":os.environ["DOCLING_SERVE_API_KEY"]}); urllib.request.urlopen(r,timeout=5).read()' >/dev/null 2>&1; then
          attempts=$((attempts + 1))
          sleep 5
          continue
        fi
      fi
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  compose ps >&2 || true
  fail "The stack did not become ready. Run the matching repair script after reviewing the service logs."
}

run_full_release_probe() {
  [ "$EDITION" = full ] || return 0
  compose exec -T api node dist/release/full-installation-probe.js
}

write_pending_state() {
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  STATE_STARTED_AT=$timestamp
  pending_tmp=$INSTALL_DIR/install.pending.tmp.$$
  {
    printf '%s\n' \
      "STATE_FORMAT=1" \
      "STATE_EDITION=$EDITION" \
      "STATE_RELEASE_VERSION=$RELEASE_VERSION" \
      "STATE_MANIFEST_SHA256=$MANIFEST_SHA256" \
      "STATE_STARTED_AT=$timestamp"
  } > "$pending_tmp"
  chmod 0600 "$pending_tmp"
  mv "$pending_tmp" "$INSTALL_DIR/install.pending"
}

write_success_state() {
  installed_at=$1
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  state_tmp=$INSTALL_DIR/install-state.env.tmp.$$
  case "$EDITION" in
    core) edition_compose_sha=$RESOURCE_COMPOSE_CORE_SHA256 ;;
    full) edition_compose_sha=$RESOURCE_COMPOSE_FULL_SHA256 ;;
  esac
  volumes_csv=
  for volume in $(required_volumes); do
    if [ -n "$volumes_csv" ]; then volumes_csv="$volumes_csv,$volume"; else volumes_csv=$volume; fi
  done
  networks_csv=
  for network in $(required_networks); do
    if [ -n "$networks_csv" ]; then networks_csv="$networks_csv,$network"; else networks_csv=$network; fi
  done
  {
    printf '%s\n' \
      "STATE_FORMAT=1" \
      "STATE_EDITION=$EDITION" \
      "STATE_RELEASE_VERSION=$RELEASE_VERSION" \
      "STATE_RELEASE_MANIFEST_FORMAT=$MANIFEST_FORMAT" \
      "STATE_MANIFEST_SHA256=$MANIFEST_SHA256" \
      "STATE_INSTALL_DIR=$INSTALL_DIR" \
      "STATE_ENV_FILE=$INSTALL_DIR/.env" \
      "STATE_HTTP_PORT=$HTTP_PORT" \
      "STATE_COMPOSE_COMMON_SHA256=$RESOURCE_COMPOSE_COMMON_SHA256" \
      "STATE_COMPOSE_EDITION_SHA256=$edition_compose_sha" \
      "STATE_GATEWAY_CONFIG_SHA256=$RESOURCE_GATEWAY_SHA256" \
      "STATE_INSTALLED_AT=$installed_at" \
      "STATE_LAST_SUCCESS_AT=$timestamp" \
      "STATE_LINKSENSE_API_IMAGE=$IMAGE_LINKSENSE_API" \
      "STATE_LINKSENSE_WEB_IMAGE=$IMAGE_LINKSENSE_WEB" \
      "STATE_LINKSENSE_MIGRATE_IMAGE=$IMAGE_LINKSENSE_MIGRATE" \
      "STATE_LINKSENSE_RUNNER_IMAGE=$IMAGE_LINKSENSE_RUNNER" \
      "STATE_LINKSENSE_WORKER_IMAGE=$IMAGE_LINKSENSE_WORKER" \
      "STATE_POSTGRES_IMAGE=$IMAGE_POSTGRES" \
      "STATE_REDIS_IMAGE=$IMAGE_REDIS" \
      "STATE_MINIO_IMAGE=$IMAGE_MINIO" \
      "STATE_MINIO_CLIENT_IMAGE=$IMAGE_MINIO_CLIENT" \
      "STATE_BUSYBOX_IMAGE=$IMAGE_BUSYBOX" \
      "STATE_GATEWAY_IMAGE=$IMAGE_GATEWAY" \
      "STATE_DATA_VOLUMES=$volumes_csv" \
      "STATE_NETWORKS=$networks_csv"
    if [ "$EDITION" = full ]; then
      printf '%s\n' \
        "STATE_ELASTICSEARCH_IMAGE=$IMAGE_ELASTICSEARCH" \
        "STATE_DOCLING_IMAGE=$IMAGE_DOCLING" \
        "STATE_TOKENIZER_REVISION=$TOKENIZER_REVISION"
    fi
  } > "$state_tmp"
  chmod 0600 "$state_tmp"
  mv "$state_tmp" "$INSTALL_DIR/install-state.env"
  rm -f "$INSTALL_DIR/install.pending"
}

load_runtime_env() {
  verify_root_private_file "$INSTALL_DIR/.env" "The protected environment file"
  load_strict_env "$INSTALL_DIR/.env" runtime
  require_loaded_keys LINKSENSE_EDITION LINKSENSE_VERSION LINKSENSE_PUBLIC_BASE_URL LINKSENSE_PUBLIC_SCHEME POSTGRES_PASSWORD REDIS_PASSWORD LINKSENSE_JWT_SECRET LINKSENSE_INITIALIZATION_TOKEN LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET LINKSENSE_CREDENTIAL_MASTER_KEY LINKSENSE_RUNNER_SHARED_SECRET MINIO_ROOT_PASSWORD MINIO_SECRET_KEY
  for required_secret in POSTGRES_PASSWORD REDIS_PASSWORD LINKSENSE_JWT_SECRET LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET LINKSENSE_CREDENTIAL_MASTER_KEY LINKSENSE_RUNNER_SHARED_SECRET LINKSENSE_INITIALIZATION_TOKEN MINIO_ROOT_PASSWORD MINIO_SECRET_KEY; do
    eval "secret_value=\${$required_secret:-}"
    [ -n "$secret_value" ] || fail "Required secret $required_secret is missing. Restore the environment file from backup."
  done
  if [ "$EDITION" = full ]; then
    require_loaded_keys ELASTICSEARCH_ROOT_PASSWORD ELASTICSEARCH_PASSWORD DOCLING_SERVE_API_KEY
    for required_secret in ELASTICSEARCH_ROOT_PASSWORD ELASTICSEARCH_PASSWORD DOCLING_SERVE_API_KEY; do
      eval "secret_value=\${$required_secret:-}"
      [ -n "$secret_value" ] || fail "Required Full secret $required_secret is missing. Restore the environment file from backup."
    done
  fi
  validate_http_origin "${LINKSENSE_PUBLIC_BASE_URL:-}"
  case "$LINKSENSE_PUBLIC_BASE_URL:$LINKSENSE_PUBLIC_SCHEME" in
    https://*:https|http://*:http) ;;
    *) fail "The installed public URL and scheme do not match." ;;
  esac
  DIAGNOSTICS_READY=true
}

install_action() {
  log_stage "Stage 3/7: validate installation identity and configuration."
  state_file=$INSTALL_DIR/install-state.env
  if [ -f "$state_file" ]; then
    verify_root_private_file "$state_file" "The installation state"
    load_strict_env "$state_file" state
    require_loaded_keys STATE_FORMAT STATE_EDITION STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_INSTALL_DIR STATE_INSTALLED_AT
    [ "$STATE_FORMAT" = 1 ] || fail "Unsupported installation state format."
    [ "$STATE_EDITION" = "$EDITION" ] || fail "This host contains a $STATE_EDITION installation; edition conversion is not supported by install scripts."
    [ "$STATE_RELEASE_VERSION" = "$RELEASE_VERSION" ] || fail "Version $STATE_RELEASE_VERSION is already installed; install scripts do not upgrade or downgrade."
    [ "$STATE_MANIFEST_SHA256" = "$MANIFEST_SHA256" ] || fail "The installed manifest does not match the requested immutable release."
    load_runtime_env
    if curl -fsS "http://127.0.0.1:$HTTP_PORT/api/v1/system/health/ready" >/dev/null 2>&1; then
      log "$EDITION $RELEASE_VERSION is already installed and healthy at $LINKSENSE_PUBLIC_BASE_URL."
      return
    fi
    fail "The same version is installed but unhealthy. Run repair-$EDITION.sh."
  fi

  if [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/install.pending" ]; then
    fail "$INSTALL_DIR already exists without a trusted LinkSense install state. Move it aside or choose a different LINKSENSE_INSTALL_DIR."
  fi
  if [ ! -f "$INSTALL_DIR/install.pending" ]; then
    verify_fresh_targets
  fi
  install -d -m 0700 "$INSTALL_DIR"
  if [ -f "$INSTALL_DIR/install.pending" ]; then
    verify_root_private_file "$INSTALL_DIR/install.pending" "The interrupted installation state"
    load_strict_env "$INSTALL_DIR/install.pending" state
    require_loaded_keys STATE_FORMAT STATE_EDITION STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_STARTED_AT
    [ "$STATE_FORMAT" = 1 ] || fail "Unsupported interrupted installation state format."
    [ "$STATE_EDITION" = "$EDITION" ] || fail "An interrupted $STATE_EDITION installation exists."
    [ "$STATE_RELEASE_VERSION" = "$RELEASE_VERSION" ] || fail "An interrupted $STATE_RELEASE_VERSION installation exists."
    [ "$STATE_MANIFEST_SHA256" = "$MANIFEST_SHA256" ] || fail "The interrupted installation belongs to a different release manifest."
    load_runtime_env
    installed_at=$STATE_STARTED_AT
  else
    write_env
    write_pending_state
    installed_at=$STATE_STARTED_AT
    load_runtime_env
  fi
  install_resources
  log_stage "Stage 4/7: pull immutable container images."
  pull_images
  log_stage "Stage 5/7: prepare persistent volumes and edition assets."
  create_install_volumes
  prepare_tokenizer
  log_stage "Stage 6/7: start services and run readiness checks."
  start_stack
  wait_for_health
  run_full_release_probe
  log_stage "Stage 7/7: record the verified installation state."
  write_success_state "$installed_at"
  log "Installed LinkSense $EDITION $RELEASE_VERSION successfully."
  log "Open: $LINKSENSE_PUBLIC_BASE_URL"
  printf '%s\n' "One-time initialization credential: $LINKSENSE_INITIALIZATION_TOKEN"
  printf '%s\n' "Enter it only on the first-administrator page. It becomes unusable after initialization."
  log "Install directory: $INSTALL_DIR"
  log "Diagnostics: cd $INSTALL_DIR && docker compose --env-file .env -f compose.common.yml -f compose.$EDITION.yml ps"
}

repair_action() {
  log_stage "Stage 2/7: load the trusted installation identity."
  state_file=$INSTALL_DIR/install-state.env
  [ -f "$state_file" ] || fail "No trusted installation state exists at $state_file; repair will not guess an instance identity."
  verify_root_private_file "$state_file" "The installation state"
  load_strict_env "$state_file" state
  require_loaded_keys STATE_FORMAT STATE_EDITION STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_INSTALL_DIR STATE_INSTALLED_AT
  [ "$STATE_FORMAT" = 1 ] || fail "Unsupported installation state format."
  [ "$STATE_EDITION" = "$EDITION" ] || fail "This is a $STATE_EDITION installation; use repair-$STATE_EDITION.sh."
  state_release=$STATE_RELEASE_VERSION
  state_manifest=$STATE_MANIFEST_SHA256
  [ "$STATE_INSTALL_DIR" = "$INSTALL_DIR" ] || fail "The installation state belongs to $STATE_INSTALL_DIR, not $INSTALL_DIR."
  load_runtime_env
  [ "$LINKSENSE_EDITION" = "$EDITION" ] || fail "The environment edition does not match the trusted installation state."
  [ "$LINKSENSE_VERSION" = "$state_release" ] || fail "The environment version does not match the trusted installation state."
  log_stage "Stage 3/7: verify persistent data and immutable release metadata."
  verify_existing_volumes

  RELEASE_SELECTOR=$state_release
  fetch_manifest "$(release_base)"
  [ "$MANIFEST_SHA256" = "$state_manifest" ] || fail "The published manifest no longer matches the installed immutable version."
  fetch_release_resources
  write_runtime_env
  load_runtime_env
  install_resources
  log_stage "Stage 4/7: pull immutable container images."
  pull_images
  log_stage "Stage 5/7: repair edition assets without replacing data volumes."
  prepare_tokenizer
  log_stage "Stage 6/7: recreate services and run readiness checks."
  start_stack
  wait_for_health
  run_full_release_probe
  log_stage "Stage 7/7: record the verified repair state."
  write_success_state "$STATE_INSTALLED_AT"
  log "Repaired LinkSense $EDITION $state_release successfully without changing secrets or data volumes."
  log "Open: $LINKSENSE_PUBLIC_BASE_URL"
}

log_stage "Stage 1/7: run the read-only host preflight."
validate_install_dir
preflight
TMP_ROOT=$(mktemp -d)

if [ "$ACTION" = install ]; then
  log_stage "Stage 2/7: verify immutable release inputs and download configuration."
  fetch_manifest "$(release_base)"
  fetch_release_resources
  install_action
else
  repair_action
fi
