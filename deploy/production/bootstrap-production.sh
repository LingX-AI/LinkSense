#!/bin/sh

set -eu

umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-production.sh must run as root" >&2
  exit 1
fi

deployment_root="${LINKSENSE_DEPLOYMENT_ROOT:-$(pwd)}"
environment_file="${LINKSENSE_ENVIRONMENT_FILE:-${deployment_root}/.env.production}"
user_data_volume="${LINKSENSE_USER_DATA_VOLUME:-linksense-user-data}"
backup_volume="${LINKSENSE_BACKUP_VOLUME:-linksense-backups}"
public_base_url="${LINKSENSE_PUBLIC_BASE_URL:?LINKSENSE_PUBLIC_BASE_URL is required}"
source_revision="${LINKSENSE_SOURCE_REVISION:?LINKSENSE_SOURCE_REVISION is required}"
production_image_tag="${LINKSENSE_PRODUCTION_IMAGE_TAG:-pro-latest}"
minio_container="${LINKSENSE_MINIO_CONTAINER:-minio}"
minio_network="${LINKSENSE_MINIO_NETWORK:-minio_default}"
elasticsearch_admin_url="${LINKSENSE_ELASTICSEARCH_ADMIN_URL:-http://127.0.0.1:9200}"
elasticsearch_admin_username="${LINKSENSE_ELASTICSEARCH_ADMIN_USERNAME:-elastic}"
elasticsearch_admin_password="${LINKSENSE_ELASTICSEARCH_ADMIN_PASSWORD:?LINKSENSE_ELASTICSEARCH_ADMIN_PASSWORD is required}"
minio_client_image="${LINKSENSE_MINIO_CLIENT_IMAGE:-ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9}"

case "$public_base_url" in
  https://*) external_scheme="https" ;;
  http://*) external_scheme="http" ;;
  *)
    echo "LINKSENSE_PUBLIC_BASE_URL must use HTTP or HTTPS" >&2
    exit 1
    ;;
esac
case "$production_image_tag" in
  [A-Za-z0-9_]*)
    ;;
  *)
    echo "LINKSENSE_PRODUCTION_IMAGE_TAG must start with a Docker tag character" >&2
    exit 1
    ;;
esac
case "$production_image_tag" in
  *[!A-Za-z0-9_.-]*)
    echo "LINKSENSE_PRODUCTION_IMAGE_TAG contains characters outside Docker tag syntax" >&2
    exit 1
    ;;
esac

if [ -e "$environment_file" ]; then
  echo "refusing to replace existing production environment: $environment_file" >&2
  exit 1
fi

for command_name in awk base64 curl cut docker openssl sed sha256sum tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
done

version_at_least() {
  actual_version="$1"
  required_version="$2"
  awk -v actual="$actual_version" -v required="$required_version" '
    BEGIN {
      actual_count = split(actual, actual_parts, ".")
      required_count = split(required, required_parts, ".")
      count = actual_count > required_count ? actual_count : required_count
      for (part_index = 1; part_index <= count; part_index += 1) {
        actual_part = actual_parts[part_index] == "" ? 0 : actual_parts[part_index] + 0
        required_part = required_parts[part_index] == "" ? 0 : required_parts[part_index] + 0
        if (actual_part > required_part) exit 0
        if (actual_part < required_part) exit 1
      }
      exit 0
    }
  '
}

docker_api_version="$(docker version --format '{{.Server.APIVersion}}')"
compose_version="$(docker compose version --short | sed 's/^v//; s/[^0-9.].*$//')"
if ! version_at_least "$docker_api_version" 1.45; then
  echo "Docker Engine API 1.45 or newer is required for volume subpaths" >&2
  exit 1
fi
if ! version_at_least "$compose_version" 2.24.4; then
  echo "Docker Compose 2.24.4 or newer is required for production overrides" >&2
  exit 1
fi

for volume_name in "$user_data_volume" "$backup_volume"; do
  case "$volume_name" in
    [A-Za-z0-9]* ) ;;
    *)
      echo "production volume names must start with an alphanumeric character" >&2
      exit 1
      ;;
  esac
  case "$volume_name" in
    *[!A-Za-z0-9_.-]* )
      echo "production volume name contains unsupported characters: $volume_name" >&2
      exit 1
      ;;
  esac
done
if [ "$user_data_volume" = "$backup_volume" ]; then
  echo "user-data and backup volumes must be different" >&2
  exit 1
fi

validate_managed_volume() {
  volume_name="$1"
  volume_role="$2"
  volume_driver="$(docker volume inspect --format '{{.Driver}}' "$volume_name")"
  volume_options="$(
    docker volume inspect --format '{{json .Options}}' "$volume_name" |
      tr '[:upper:]' '[:lower:]'
  )"
  managed_label="$(
    docker volume inspect --format '{{ index .Labels "com.linksense.managed-by" }}' "$volume_name"
  )"
  persistence_label="$(
    docker volume inspect --format '{{ index .Labels "com.linksense.persistence" }}' "$volume_name"
  )"
  role_label="$(
    docker volume inspect --format '{{ index .Labels "com.linksense.role" }}' "$volume_name"
  )"
  if [ "$volume_driver" != "local" ]; then
    echo "production volume must use Docker's local managed driver: $volume_name" >&2
    return 1
  fi
  if [ "$volume_options" != "null" ] && [ "$volume_options" != "{}" ]; then
    echo "production volume must not define local-driver options: $volume_name" >&2
    return 1
  fi
  if [ "$managed_label" != "linksense-production" ] ||
    [ "$persistence_label" != "critical" ] ||
    [ "$role_label" != "$volume_role" ]; then
    echo "production volume labels do not match the LinkSense contract: $volume_name" >&2
    return 1
  fi
}

ensure_managed_volume() {
  volume_name="$1"
  volume_role="$2"
  if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
    docker volume create \
      --driver local \
      --label com.linksense.managed-by=linksense-production \
      --label com.linksense.persistence=critical \
      --label "com.linksense.role=${volume_role}" \
      "$volume_name" >/dev/null
  fi
  validate_managed_volume "$volume_name" "$volume_role"
}

volume_guard_name() {
  volume_name="$1"
  volume_role="$2"
  guard_hash="$(printf '%s' "$volume_name" | sha256sum | cut -c1-16)"
  printf 'linksense-volume-guard-%s-%s\n' "$volume_role" "$guard_hash"
}

volume_guard_contract() {
  volume_name="$1"
  volume_role="$2"
  guard_name="$(volume_guard_name "$volume_name" "$volume_role")"
  docker container inspect --format '
{{.Config.Image}}|
{{json .Config.Cmd}}|
{{.Config.User}}|
{{ index .Config.Labels "com.linksense.volume-guard" }}|
{{ index .Config.Labels "com.linksense.volume" }}|
{{ index .Config.Labels "com.linksense.role" }}|
{{ index .Config.Labels "com.linksense.managed-by" }}|
{{ .HostConfig.NetworkMode }}|
{{ .HostConfig.RestartPolicy.Name }}|
{{ .HostConfig.ReadonlyRootfs }}|
{{ .HostConfig.PidsLimit }}|
{{ .HostConfig.Memory }}|
{{json .HostConfig.CapDrop}}|
{{json .HostConfig.SecurityOpt}}|
{{range .Mounts}}{{if eq .Destination "/hold"}}{{.Type}}|{{.Name}}|{{.RW}}{{end}}{{end}}' \
    "$guard_name" | tr -d '\n'
}

validate_volume_guard_config() {
  volume_name="$1"
  volume_role="$2"
  guard_name="$(volume_guard_name "$volume_name" "$volume_role")"
  guard_contract="$(volume_guard_contract "$volume_name" "$volume_role")"
  expected_contract="busybox:1.37|[\"sh\",\"-ec\",\"trap : TERM INT; while :; do sleep 3600; done\"]||true|${volume_name}|${volume_role}|linksense-production|none|unless-stopped|true|16|16777216|[\"ALL\"]|[\"no-new-privileges=true\"]|volume|${volume_name}|false"
  if [ "$guard_contract" != "$expected_contract" ]; then
    echo "volume guard does not match the production contract: $guard_name" >&2
    return 1
  fi
}

validate_volume_guard_running() {
  volume_name="$1"
  volume_role="$2"
  guard_name="$(volume_guard_name "$volume_name" "$volume_role")"
  validate_volume_guard_config "$volume_name" "$volume_role"
  if [ "$(docker container inspect --format '{{.State.Running}}' "$guard_name")" != "true" ]; then
    echo "volume guard is not running: $guard_name" >&2
    return 1
  fi
}

ensure_volume_guard() {
  volume_name="$1"
  volume_role="$2"
  guard_name="$(volume_guard_name "$volume_name" "$volume_role")"
  if ! docker container inspect "$guard_name" >/dev/null 2>&1; then
    if ! docker image inspect busybox:1.37 >/dev/null 2>&1; then
      docker pull busybox:1.37 >/dev/null
    fi
    docker create \
      --name "$guard_name" \
      --network none \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges=true \
      --pids-limit 16 \
      --memory 16m \
      --restart unless-stopped \
      --label com.linksense.volume-guard=true \
      --label "com.linksense.volume=${volume_name}" \
      --label "com.linksense.role=${volume_role}" \
      --label com.linksense.managed-by=linksense-production \
      --mount "type=volume,src=${volume_name},dst=/hold,readonly" \
      busybox:1.37 sh -ec 'trap : TERM INT; while :; do sleep 3600; done' >/dev/null
  else
    validate_volume_guard_config "$volume_name" "$volume_role"
  fi
  if [ "$(docker container inspect --format '{{.State.Running}}' "$guard_name")" != "true" ]; then
    docker start "$guard_name" >/dev/null
  fi
  validate_volume_guard_running "$volume_name" "$volume_role"
}

if [ ! -f "${deployment_root}/.env.example" ]; then
  echo "missing environment template under deployment root" >&2
  exit 1
fi
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/linksense-production-bootstrap.XXXXXX")"
environment_staging_file=""
metadata_staging_file=""
cleanup() {
  if [ -n "$environment_staging_file" ]; then
    rm -f "$environment_staging_file"
  fi
  if [ -n "$metadata_staging_file" ]; then
    rm -f "$metadata_staging_file"
  fi
  rm -rf "$temporary_root"
}
trap cleanup EXIT HUP INT TERM

random_secret() {
  openssl rand -hex 32
}

suffix="$(openssl rand -hex 4)"
image_tag="$production_image_tag"

postgres_password="$(random_secret)"
redis_password="$(random_secret)"
jwt_secret="$(random_secret)"
login_hmac_secret="$(random_secret)"
password_reset_hmac_secret="$(random_secret)"
credential_master_key="$(random_secret)"
runner_shared_secret="$(random_secret)"
docling_api_key="$(random_secret)"

minio_access_key="linksense-prod-${suffix}"
minio_secret_key="$(random_secret)"
minio_policy="linksense-prod-${suffix}"
minio_bucket="linksense-files"
minio_knowledge_bucket="linksense-knowledge"

elasticsearch_username="linksense_prod_${suffix}"
elasticsearch_password="$(random_secret)"
elasticsearch_role="linksense_prod_${suffix}"
elasticsearch_index="linksense-knowledge-prod"

minio_root_user="$(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$minio_container" |
    sed -n 's/^MINIO_ROOT_USER=//p' |
    head -n 1
)"
minio_root_password="$(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$minio_container" |
    sed -n 's/^MINIO_ROOT_PASSWORD=//p' |
    head -n 1
)"
if [ -z "$minio_root_user" ] || [ -z "$minio_root_password" ]; then
  echo "unable to resolve MinIO administrative credentials" >&2
  exit 1
fi

cat >"${temporary_root}/minio-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": [
        "arn:aws:s3:::${minio_bucket}",
        "arn:aws:s3:::${minio_knowledge_bucket}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::${minio_bucket}/*",
        "arn:aws:s3:::${minio_knowledge_bucket}/*"
      ]
    }
  ]
}
EOF

if ! docker image inspect "$minio_client_image" >/dev/null 2>&1; then
  docker pull "$minio_client_image"
fi
export minio_root_user minio_root_password minio_access_key minio_secret_key minio_policy
docker run --rm \
  --network "$minio_network" \
  --entrypoint /bin/sh \
  -e minio_root_user \
  -e minio_root_password \
  -e minio_access_key \
  -e minio_secret_key \
  -e minio_policy \
  -v "${temporary_root}/minio-policy.json:/tmp/linksense-policy.json:ro" \
  "$minio_client_image" \
  -ec '
    mc alias set linksense-admin http://minio:9000 "$minio_root_user" "$minio_root_password" >/dev/null
    mc mb --ignore-existing linksense-admin/linksense-files >/dev/null
    mc mb --ignore-existing linksense-admin/linksense-knowledge >/dev/null
    mc admin user add linksense-admin "$minio_access_key" "$minio_secret_key" >/dev/null
    mc admin policy create linksense-admin "$minio_policy" /tmp/linksense-policy.json >/dev/null
    mc admin policy attach linksense-admin "$minio_policy" --user "$minio_access_key" >/dev/null
    mc admin user info linksense-admin "$minio_access_key" >/dev/null
  '
unset minio_root_user minio_root_password minio_policy

elasticsearch_basic_token="$(
  printf '%s:%s' "$elasticsearch_admin_username" "$elasticsearch_admin_password" |
    base64 |
    tr -d '\n'
)"
printf 'header = "Authorization: Basic %s"\n' "$elasticsearch_basic_token" >"${temporary_root}/elasticsearch.curl"
cat >"${temporary_root}/elasticsearch-role.json" <<EOF
{
  "cluster": ["monitor"],
  "indices": [
    {
      "names": ["${elasticsearch_index}"],
      "privileges": ["all"],
      "allow_restricted_indices": false
    }
  ]
}
EOF
cat >"${temporary_root}/elasticsearch-user.json" <<EOF
{
  "password": "${elasticsearch_password}",
  "roles": ["${elasticsearch_role}"],
  "full_name": "LinkSense production service account"
}
EOF
curl --silent --show-error --fail-with-body \
  --connect-timeout 5 \
  --max-time 20 \
  --config "${temporary_root}/elasticsearch.curl" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data-binary "@${temporary_root}/elasticsearch-role.json" \
  "${elasticsearch_admin_url}/_security/role/${elasticsearch_role}" >/dev/null
curl --silent --show-error --fail-with-body \
  --connect-timeout 5 \
  --max-time 20 \
  --config "${temporary_root}/elasticsearch.curl" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data-binary "@${temporary_root}/elasticsearch-user.json" \
  "${elasticsearch_admin_url}/_security/user/${elasticsearch_username}" >/dev/null
elasticsearch_app_basic_token="$(
  printf '%s:%s' "$elasticsearch_username" "$elasticsearch_password" | base64 | tr -d '\n'
)"
printf 'header = "Authorization: Basic %s"\n' "$elasticsearch_app_basic_token" >"${temporary_root}/elasticsearch-app.curl"
curl --silent --show-error --fail-with-body \
  --connect-timeout 5 \
  --max-time 20 \
  --config "${temporary_root}/elasticsearch-app.curl" \
  --head \
  "$elasticsearch_admin_url" >/dev/null
unset elasticsearch_admin_password elasticsearch_basic_token elasticsearch_app_basic_token

environment_working_file="${temporary_root}/environment"
cp "${deployment_root}/.env.example" "$environment_working_file"

set_environment_value() {
  key="$1"
  value="$2"
  next_file="${temporary_root}/environment.next"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$environment_working_file" >"$next_file"
  mv "$next_file" "$environment_working_file"
}

set_environment_value COMPOSE_PROJECT_NAME linksense
set_environment_value LINKSENSE_IMAGE_TAG "$image_tag"
set_environment_value LINKSENSE_WORKER_IMAGE "linksense-runner-worker:${image_tag}"
set_environment_value LINKSENSE_WORKER_IMAGE_REVISION "$source_revision"
set_environment_value LINKSENSE_WORKER_IMAGE_FINGERPRINT "$source_revision"
set_environment_value LINKSENSE_MIGRATION_IMAGE_FINGERPRINT "$source_revision"
set_environment_value LINKSENSE_HTTP_PORT 8080
set_environment_value LINKSENSE_GATEWAY_BIND_ADDRESS 127.0.0.1
set_environment_value LINKSENSE_EXTERNAL_SCHEME "$external_scheme"
set_environment_value LINKSENSE_API_REPLICAS 2
set_environment_value NODE_ENV production
set_environment_value LOG_LEVEL info
set_environment_value POSTGRES_DB linksense
set_environment_value POSTGRES_USER linksense
set_environment_value POSTGRES_PASSWORD "$postgres_password"
set_environment_value DATABASE_URL "postgresql://linksense:${postgres_password}@postgres:5432/linksense"
set_environment_value REDIS_PASSWORD "$redis_password"
set_environment_value REDIS_URL "redis://:${redis_password}@redis:6379/0"
set_environment_value LINKSENSE_PUBLIC_BASE_URL "$public_base_url"
set_environment_value LINKSENSE_JWT_SECRET "$jwt_secret"
set_environment_value LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET "$login_hmac_secret"
set_environment_value LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET "$password_reset_hmac_secret"
set_environment_value LINKSENSE_CREDENTIAL_MASTER_KEY "$credential_master_key"
set_environment_value LINKSENSE_RUNNER_SHARED_SECRET "$runner_shared_secret"
set_environment_value LINKSENSE_MAX_CONCURRENT_CONVERSATIONS 20
set_environment_value LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT 20
set_environment_value LINKSENSE_WORKER_MEMORY_MB 4096
set_environment_value LINKSENSE_WORKER_CPUS 2
set_environment_value LINKSENSE_USER_DATA_VOLUME "$user_data_volume"
set_environment_value LINKSENSE_BACKUP_VOLUME "$backup_volume"
set_environment_value LINKSENSE_USER_DATA_ROOT /srv/linksense/users
set_environment_value LINKSENSE_BACKUP_ROOT /backups
set_environment_value LINKSENSE_POSTGRES_BACKUP_INTERVAL_SECONDS 86400
set_environment_value LINKSENSE_POSTGRES_BACKUP_RETENTION_DAYS 14
set_environment_value LINKSENSE_REDIS_VOLUME linksense-prod-redis
set_environment_value LINKSENSE_MINIO_NETWORK "$minio_network"
set_environment_value LINKSENSE_ELASTICSEARCH_NETWORK elasticsearch_net
set_environment_value MINIO_ACCESS_KEY "$minio_access_key"
set_environment_value MINIO_SECRET_KEY "$minio_secret_key"
set_environment_value MINIO_BUCKET "$minio_bucket"
set_environment_value MINIO_KNOWLEDGE_BUCKET "$minio_knowledge_bucket"
set_environment_value MINIO_ENDPOINT minio
set_environment_value MINIO_PORT 9000
set_environment_value MINIO_USE_SSL false
set_environment_value MINIO_PUBLIC_URL "$public_base_url"
set_environment_value LINKSENSE_KB_ELASTICSEARCH_URL http://elasticsearch:9200
set_environment_value LINKSENSE_KB_ELASTICSEARCH_USERNAME "$elasticsearch_username"
set_environment_value LINKSENSE_KB_ELASTICSEARCH_PASSWORD "$elasticsearch_password"
set_environment_value LINKSENSE_KB_ELASTICSEARCH_INDEX "$elasticsearch_index"
set_environment_value DOCLING_SERVE_URL http://host.docker.internal:8110
set_environment_value DOCLING_SERVE_API_KEY "$docling_api_key"
set_environment_value DOCLING_SERVE_TENANT_ID linksense
set_environment_value LINKSENSE_TRUST_PROXY true

chmod 0600 "$environment_working_file"
ensure_managed_volume "$user_data_volume" user-data
ensure_managed_volume "$backup_volume" backups
ensure_volume_guard "$user_data_volume" user-data
ensure_volume_guard "$backup_volume" backups

install -d -m 0700 "${deployment_root}/.data"
environment_directory="$(dirname "$environment_file")"
metadata_file="${deployment_root}/.data/deployment-metadata"
environment_staging_file="${environment_directory}/.$(basename "$environment_file").bootstrap-next.$$"
metadata_staging_file="$(dirname "$metadata_file")/.$(basename "$metadata_file").bootstrap-next.$$"
install -m 0600 "$environment_working_file" "$environment_staging_file"
cat >"$metadata_staging_file" <<EOF
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PUBLIC_BASE_URL=${public_base_url}
BOOTSTRAPPED_SOURCE_REVISION=${source_revision}
IMAGE_TAG=${image_tag}
MINIO_ACCESS_KEY=${minio_access_key}
ELASTICSEARCH_USERNAME=${elasticsearch_username}
ELASTICSEARCH_INDEX=${elasticsearch_index}
EOF
chmod 0600 "$metadata_staging_file"

# Publish complete files by same-filesystem renames. The environment is moved
# last because its existence is the bootstrap completion marker used above.
mv -f "$metadata_staging_file" "$metadata_file"
metadata_staging_file=""
mv -f "$environment_staging_file" "$environment_file"
environment_staging_file=""

echo "Production environment initialized"
echo "Environment file: ${environment_file}"
echo "User-data volume: ${user_data_volume}"
echo "Backup volume: ${backup_volume}"
echo "Image tag: ${image_tag}"
echo "MinIO access key: ${minio_access_key}"
echo "Elasticsearch username: ${elasticsearch_username}"
echo "Elasticsearch index: ${elasticsearch_index}"
