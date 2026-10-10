# Published format-2 parser from 8560eee; retained to verify upgrade metadata compatibility.
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
      manifest:MANIFEST_FORMAT|manifest:RELEASE_VERSION|manifest:RELEASE_EDITION_SUPPORT|manifest:RELEASE_PLATFORMS|manifest:RELEASE_GIT_COMMIT|manifest:RELEASE_BUILD_TIME|manifest:RELEASE_WORKFLOW_ID|manifest:RELEASE_ASSET_BASE_URL|manifest:MIN_DOCKER_API|manifest:MIN_DOCKER_COMPOSE|manifest:CORE_MIN_MEMORY_GIB|manifest:CORE_MIN_DISK_GIB|manifest:CORE_MIN_FREE_INODES|manifest:FULL_MIN_MEMORY_GIB|manifest:FULL_MIN_DISK_GIB|manifest:FULL_MIN_FREE_INODES|manifest:IMAGE_*|manifest:RESOURCE_*|manifest:TOKENIZER_*) ;;
      state:STATE_*) ;;
      upgrade:UPGRADE_*) ;;
      runtime:COMPOSE_PROJECT_NAME|runtime:LINKSENSE_EDITION|runtime:LINKSENSE_VERSION|runtime:LINKSENSE_PLATFORM|runtime:LINKSENSE_DOCKER_SOCKET_SOURCE|runtime:LINKSENSE_DOCKER_SOCKET_PATH|runtime:LINKSENSE_PUBLIC_BASE_URL|runtime:LINKSENSE_PUBLIC_SCHEME|runtime:LINKSENSE_HTTP_PORT|runtime:POSTGRES_DB|runtime:POSTGRES_USER|runtime:POSTGRES_PASSWORD|runtime:DATABASE_URL|runtime:REDIS_PASSWORD|runtime:REDIS_URL|runtime:DOCLING_REDIS_URL|runtime:LINKSENSE_JWT_SECRET|runtime:LINKSENSE_INITIALIZATION_TOKEN|runtime:LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_CREDENTIAL_MASTER_KEY|runtime:LINKSENSE_CREDENTIAL_KEY_ID|runtime:LINKSENSE_RUNNER_SHARED_SECRET|runtime:MINIO_ROOT_USER|runtime:MINIO_ROOT_PASSWORD|runtime:MINIO_ACCESS_KEY|runtime:MINIO_SECRET_KEY|runtime:MINIO_BUCKET|runtime:MINIO_KNOWLEDGE_BUCKET|runtime:MINIO_ENDPOINT|runtime:MINIO_PORT|runtime:MINIO_USE_SSL|runtime:MINIO_PUBLIC_URL|runtime:MINIO_REGION|runtime:LINKSENSE_MAX_CONCURRENT_CONVERSATIONS|runtime:LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT|runtime:LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_READY_TIMEOUT_SECONDS|runtime:LINKSENSE_WORKER_MEMORY_MB|runtime:LINKSENSE_WORKER_CPUS|runtime:LINKSENSE_WORKER_PIDS_LIMIT|runtime:LINKSENSE_WORKER_TMPFS_MB|runtime:LINKSENSE_WORKER_SHM_MB|runtime:LINKSENSE_BROWSER_SESSION_LIMIT|runtime:LINKSENSE_API_IMAGE|runtime:LINKSENSE_WEB_IMAGE|runtime:LINKSENSE_MIGRATE_IMAGE|runtime:LINKSENSE_RUNNER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE_REVISION|runtime:POSTGRES_IMAGE|runtime:REDIS_IMAGE|runtime:MINIO_IMAGE|runtime:MINIO_CLIENT_IMAGE|runtime:BUSYBOX_IMAGE|runtime:GATEWAY_IMAGE|runtime:ELASTICSEARCH_IMAGE|runtime:DOCLING_IMAGE|runtime:LINKSENSE_POSTGRES_VOLUME|runtime:LINKSENSE_REDIS_VOLUME|runtime:LINKSENSE_MINIO_VOLUME|runtime:LINKSENSE_USER_DATA_VOLUME|runtime:LINKSENSE_BACKUP_VOLUME|runtime:LINKSENSE_ELASTICSEARCH_VOLUME|runtime:LINKSENSE_TOKENIZER_VOLUME|runtime:LINKSENSE_INTERNAL_NETWORK|runtime:LINKSENSE_WORKER_CONTROL_NETWORK|runtime:LINKSENSE_WORKER_EGRESS_NETWORK|runtime:LINKSENSE_KNOWLEDGE_NETWORK|runtime:ELASTICSEARCH_ROOT_PASSWORD|runtime:ELASTICSEARCH_USERNAME|runtime:ELASTICSEARCH_PASSWORD|runtime:DOCLING_SERVE_API_KEY|runtime:LINKSENSE_KB_HYBRID_TOKENIZER|runtime:LINKSENSE_TOKENIZER_MOUNT_PATH) ;;
      *) fail "Unexpected key $key in $(basename "$file")." ;;
    esac
    export "$key=$value"
    loaded_keys="$loaded_keys$key|"
  done < "$file"
}
