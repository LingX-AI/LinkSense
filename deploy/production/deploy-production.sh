#!/bin/sh

set -eu

umask 077

usage() {
  cat <<'EOF'
Usage: deploy-production.sh [--allow-migrations]
       deploy-production.sh --migrate-user-data-from ABSOLUTE_PATH \
         [--migrate-backups-from ABSOLUTE_PATH]

Fast-forward the production checkout from origin/main, build the fixed
production image tag, stop active execution, create a validated PostgreSQL backup,
and restart LinkSense with health verification.

Options:
  --allow-migrations  Confirm that new or unverified Prisma migrations were
                      reviewed and may be applied during this release.
  --migrate-user-data-from ABSOLUTE_PATH
                      Perform the one-time maintenance cutover from the legacy
                      bind-mounted user directory to the managed external
                      user-data volume. The source remains read-only and is
                      never removed.
  --migrate-backups-from ABSOLUTE_PATH
                      Optionally migrate the legacy backup directory during the
                      same one-time cutover.
  -h, --help          Show this help text.

Environment:
  LINKSENSE_REUSE_PREVIOUS_WORKER_IMAGE=1
                      Retag the previously deployed worker image as the fixed
                      production worker tag when worker runtime inputs did not
                      change. This is intended for one-time fixed-tag
                      transitions or build-host browser-download incidents.
EOF
}

allow_migrations=0
migrate_user_data_from=""
migrate_backups_from=""
while [ "$#" -gt 0 ]; do
  argument="$1"
  case "$argument" in
    --allow-migrations)
      allow_migrations=1
      shift
      ;;
    --migrate-user-data-from)
      [ "$#" -ge 2 ] || {
        echo "--migrate-user-data-from requires an absolute path" >&2
        exit 2
      }
      migrate_user_data_from="$2"
      shift 2
      ;;
    --migrate-backups-from)
      [ "$#" -ge 2 ] || {
        echo "--migrate-backups-from requires an absolute path" >&2
        exit 2
      }
      migrate_backups_from="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unsupported argument: $argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done
if [ -n "$migrate_backups_from" ] && [ -z "$migrate_user_data_from" ]; then
  echo "--migrate-backups-from requires --migrate-user-data-from" >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-production.sh must run as root" >&2
  exit 1
fi

deployment_root="${LINKSENSE_DEPLOYMENT_ROOT:-$(pwd)}"
environment_file="${LINKSENSE_ENVIRONMENT_FILE:-${deployment_root}/.env.production}"
compose_file="${LINKSENSE_COMPOSE_FILE:-${deployment_root}/docker-compose.production-stack.yml}"
metadata_file="${LINKSENSE_DEPLOYMENT_METADATA_FILE:-${deployment_root}/.data/deployment-metadata}"
gateway_template="${deployment_root}/deploy/nginx/production-gateway.conf.template"
remote_name="${LINKSENSE_DEPLOY_REMOTE:-origin}"
deploy_branch="main"
health_wait_seconds="${LINKSENSE_DEPLOY_HEALTH_WAIT_SECONDS:-600}"
force_rebuild="${LINKSENSE_FORCE_REBUILD:-0}"
reuse_previous_worker_image="${LINKSENSE_REUSE_PREVIOUS_WORKER_IMAGE:-0}"
lock_file="${LINKSENSE_DEPLOY_LOCK_FILE:-/run/lock/linksense-deploy.lock}"
lock_state_file="${LINKSENSE_DEPLOY_STATE_FILE:-${lock_file}.state}"
maintenance_message="The system is under maintenance. Please wait a moment."
production_image_tag="${LINKSENSE_PRODUCTION_IMAGE_TAG:-pro-latest}"

case "$health_wait_seconds" in
  *[!0-9]* | "")
    echo "LINKSENSE_DEPLOY_HEALTH_WAIT_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$health_wait_seconds" -lt 60 ]; then
  echo "deployment wait limits must be at least 60 seconds" >&2
  exit 1
fi
case "$force_rebuild" in
  0 | 1) ;;
  *)
    echo "LINKSENSE_FORCE_REBUILD must be 0 or 1" >&2
    exit 1
    ;;
esac
case "$reuse_previous_worker_image" in
  0 | 1) ;;
  *)
    echo "LINKSENSE_REUSE_PREVIOUS_WORKER_IMAGE must be 0 or 1" >&2
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

for command_name in awk curl cut date df docker du flock git grep head install mktemp readlink sed sha256sum tail timeout tr; do
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

if [ ! -d "${deployment_root}/.git" ]; then
  echo "deployment root is not a Git checkout: $deployment_root" >&2
  exit 1
fi
if [ ! -f "$environment_file" ]; then
  echo "missing production environment: $environment_file" >&2
  exit 1
fi
if [ ! -f "$compose_file" ]; then
  echo "missing production Compose entrypoint: $compose_file" >&2
  exit 1
fi
if [ ! -f "$gateway_template" ]; then
  echo "missing production Gateway template: $gateway_template" >&2
  exit 1
fi

cd "$deployment_root"

restore_git_checkout_modes() {
  git -c core.quotePath=false ls-files -s | while IFS="$(printf '\t')" read -r metadata path; do
    set -- $metadata
    file_mode="${1:-}"
    if [ -z "$path" ]; then
      continue
    fi
    case "$file_mode" in
      100755)
        chmod 0755 "$path"
        ;;
      100644)
        chmod 0644 "$path"
        ;;
    esac
  done
}

restore_git_checkout_modes

current_branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [ "$current_branch" != "$deploy_branch" ]; then
  echo "production checkout must stay on main (current: ${current_branch:-detached})" >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "production checkout has local changes; refusing to overwrite them" >&2
  exit 1
fi

remote_url="$(git remote get-url "$remote_name")"
case "$remote_url" in
  http://*:*@* | https://*:*@*)
    echo "Git credentials must not be embedded in the remote URL" >&2
    exit 1
    ;;
esac

install -d -m 0755 "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "another LinkSense deployment is already running" >&2
  echo "inspect it with: sudo ./deploy/production/control-production-deployment.sh status" >&2
  exit 1
fi

write_deployment_state() {
  state_temporary_file="$(mktemp "${lock_state_file}.tmp.XXXXXX")"
  {
    printf 'PID=%s\n' "$$"
    printf 'STARTED_AT=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } >"$state_temporary_file"
  chmod 0600 "$state_temporary_file"
  mv "$state_temporary_file" "$lock_state_file"
}

remove_deployment_state() {
  [ -f "$lock_state_file" ] || return 0
  recorded_pid="$(awk -F= '$1 == "PID" { print $2; exit }' "$lock_state_file")"
  if [ "$recorded_pid" = "$$" ]; then
    rm -f "$lock_state_file"
  fi
}

write_deployment_state
# The full rollback-aware exit handler is installed after its dependencies are
# defined. Until then, keep the state file accurate even on an early failure.
trap remove_deployment_state 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/linksense-production-deploy.XXXXXX")"
environment_backup="${temporary_root}/environment.previous"
cp -p "$environment_file" "$environment_backup"

environment_changed=0
environment_pending_file=""
maintenance_active=0
runtime_touched=0
execution_settled=0
shutdown_deadline=0
deployment_helper=""
deployment_succeeded=0
cleanup_started=0
volume_cutover=0
volume_migration_published=0
fresh_install=0
release_committed=0
migration_may_have_applied=0
user_migration_volume_ready=0
backup_migration_volume_ready=0
user_volume_hold=""
backup_volume_hold=""
previous_images_file="${temporary_root}/previous-image-ids"

compose() {
  docker compose -f "$compose_file" --env-file "$environment_file" "$@"
}

read_key() {
  source_file="$1"
  source_key="$2"
  [ -f "$source_file" ] || return 0
  awk -v key="$source_key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      exit
    }
  ' "$source_file"
}

set_key() {
  target_file="$1"
  target_key="$2"
  target_value="$3"
  next_file="${temporary_root}/$(basename "$target_file").next"
  awk -v key="$target_key" -v value="$target_value" '
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
  ' "$target_file" >"$next_file"
  install -m 0600 "$next_file" "$target_file"
}

begin_environment_update() {
  if [ -n "$environment_pending_file" ]; then
    echo "an environment update is already in progress" >&2
    return 1
  fi
  environment_pending_file="$(dirname "$environment_file")/.$(basename "$environment_file").next.$$"
  install -m 0600 "$environment_file" "$environment_pending_file"
}

set_environment_key() {
  [ -n "$environment_pending_file" ] || begin_environment_update
  set_key "$environment_pending_file" "$1" "$2"
}

commit_environment_file() {
  if [ -z "$environment_pending_file" ]; then
    echo "no environment update is in progress" >&2
    return 1
  fi
  chmod 0600 "$environment_pending_file"
  mv -f "$environment_pending_file" "$environment_file"
  environment_pending_file=""
}

commit_deployment_metadata() {
  metadata_directory="$(dirname "$metadata_file")"
  install -d -m 0700 "$metadata_directory"
  committed_metadata="${metadata_directory}/.$(basename "$metadata_file").next.$$"
  if [ -f "$metadata_file" ]; then
    install -m 0600 "$metadata_file" "$committed_metadata"
  else
    : >"$committed_metadata"
    chmod 0600 "$committed_metadata"
  fi
  set_key "$committed_metadata" DEPLOYED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set_key "$committed_metadata" SOURCE_REVISION "$target_revision"
  set_key "$committed_metadata" IMAGE_TAG "$image_tag"
  set_key "$committed_metadata" WORKER_IMAGE_FINGERPRINT "$worker_fingerprint"
  set_key "$committed_metadata" PREVIOUS_SOURCE_REVISION "$previous_revision"
  set_key "$committed_metadata" USER_DATA_VOLUME "$(configured_user_volume)"
  set_key "$committed_metadata" BACKUP_VOLUME "$(configured_backup_volume)"
  if [ "$volume_migration_published" -eq 1 ]; then
    set_key "$committed_metadata" VOLUME_MIGRATED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    set_key "$committed_metadata" LEGACY_USER_DATA_ROOT "$migrate_user_data_from"
    if [ -n "$migrate_backups_from" ]; then
      set_key "$committed_metadata" LEGACY_BACKUP_ROOT "$migrate_backups_from"
    fi
  fi
  chmod 0600 "$committed_metadata"
  mv -f "$committed_metadata" "$metadata_file"
}

environment_value() {
  environment_key="$1"
  environment_default="$2"
  environment_current="$(read_key "$environment_file" "$environment_key")"
  printf '%s\n' "${environment_current:-$environment_default}"
}

validate_volume_name() {
  volume_name="$1"
  case "$volume_name" in
    [A-Za-z0-9]* ) ;;
    *)
      echo "production volume names must start with an alphanumeric character" >&2
      return 1
      ;;
  esac
  case "$volume_name" in
    *[!A-Za-z0-9_.-]* )
      echo "production volume name contains unsupported characters: $volume_name" >&2
      return 1
      ;;
  esac
}

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

configured_user_volume() {
  user_volume="$(read_key "$environment_file" LINKSENSE_USER_DATA_VOLUME)"
  printf '%s\n' "${user_volume:-linksense-user-data}"
}

configured_backup_volume() {
  backup_volume="$(read_key "$environment_file" LINKSENSE_BACKUP_VOLUME)"
  printf '%s\n' "${backup_volume:-linksense-backups}"
}

validate_production_volumes() {
  user_volume="$(configured_user_volume)"
  backup_volume="$(configured_backup_volume)"
  validate_volume_name "$user_volume"
  validate_volume_name "$backup_volume"
  if [ "$user_volume" = "$backup_volume" ]; then
    echo "user-data and backup volumes must be different" >&2
    return 1
  fi
  validate_managed_volume "$user_volume" user-data
  validate_managed_volume "$backup_volume" backups
  ensure_volume_guard "$user_volume" user-data
  ensure_volume_guard "$backup_volume" backups
  validate_volume_guard_running "$user_volume" user-data
  validate_volume_guard_running "$backup_volume" backups
}

assert_absolute_legacy_directory() {
  legacy_path="$1"
  legacy_label="$2"
  case "$legacy_path" in
    /*) ;;
    *)
      echo "$legacy_label migration source must be an absolute path" >&2
      return 1
      ;;
  esac
  if [ ! -d "$legacy_path" ] || [ -L "$legacy_path" ]; then
    echo "$legacy_label migration source must be a real directory: $legacy_path" >&2
    return 1
  fi
  if [ "$(readlink -m "$legacy_path")" = "/" ]; then
    echo "$legacy_label migration source must not be the filesystem root" >&2
    return 1
  fi
}

assert_disjoint_legacy_directories() {
  first_path="$(readlink -m "$1")"
  second_path="$(readlink -m "$2")"
  case "$first_path" in
    "$second_path" | "$second_path"/*)
      echo "legacy user-data and backup migration sources must not overlap" >&2
      return 1
      ;;
  esac
  case "$second_path" in
    "$first_path" | "$first_path"/*)
      echo "legacy user-data and backup migration sources must not overlap" >&2
      return 1
      ;;
  esac
}

migration_directory_bytes() {
  migration_path="$1"
  allocated_bytes="$(
    du -sx --block-size=1 -- "$migration_path" | awk 'NR == 1 { print $1 }'
  )"
  apparent_bytes="$(
    du -sx --apparent-size --block-size=1 -- "$migration_path" |
      awk 'NR == 1 { print $1 }'
  )"
  case "$allocated_bytes:$apparent_bytes" in
    *[!0-9:]* | :* | *:)
      echo "unable to measure migration source: $migration_path" >&2
      return 1
      ;;
  esac
  if [ "$apparent_bytes" -gt "$allocated_bytes" ]; then
    printf '%s\n' "$apparent_bytes"
  else
    printf '%s\n' "$allocated_bytes"
  fi
}

production_database_bytes() {
  database_bytes="$(
    compose exec -T postgres sh -ec '
      PGPASSWORD="$POSTGRES_PASSWORD" psql \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -Atc "SELECT pg_database_size(current_database())"
    ' | tr -d '[:space:]'
  )"
  case "$database_bytes" in
    *[!0-9]* | "")
      echo "unable to measure the production PostgreSQL database" >&2
      return 1
      ;;
  esac
  printf '%s\n' "$database_bytes"
}

rewrite_legacy_capability_storage_paths() {
  [ "$volume_cutover" -eq 1 ] || return 0
  legacy_capability_root="${migrate_user_data_from}/.capabilities"
  target_capability_root="/srv/linksense/users/.capabilities"
  case "$legacy_capability_root:$target_capability_root" in
    *"'"*)
      echo "legacy capability storage paths contain unsupported characters" >&2
      return 1
      ;;
  esac
  updated_count="$(
    compose exec -T postgres sh -ec "
      psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -At <<SQL
WITH updated AS (
  UPDATE capabilities
  SET storage_path = replace(
    storage_path,
    '${legacy_capability_root}',
    '${target_capability_root}'
  )
  WHERE storage_path = '${legacy_capability_root}'
     OR storage_path LIKE '${legacy_capability_root}/%'
  RETURNING 1
)
SELECT count(*) FROM updated;
SQL
    " | tr -d '[:space:]'
  )"
  case "$updated_count" in
    *[!0-9]* | "")
      echo "unable to rewrite legacy capability storage paths" >&2
      return 1
      ;;
  esac
  echo "Rewritten ${updated_count} legacy capability storage path(s)."
}

validate_migration_capacity() {
  [ "$volume_cutover" -eq 1 ] || return 0
  user_bytes="$(migration_directory_bytes "$migrate_user_data_from")"
  backup_bytes=0
  if [ -n "$migrate_backups_from" ]; then
    backup_bytes="$(migration_directory_bytes "$migrate_backups_from")"
  fi
  database_bytes="$(production_database_bytes)"
  payload_bytes=$((user_bytes + backup_bytes + database_bytes))
  safety_bytes=$((payload_bytes / 5))
  minimum_safety_bytes=2147483648
  if [ "$safety_bytes" -lt "$minimum_safety_bytes" ]; then
    safety_bytes="$minimum_safety_bytes"
  fi
  required_bytes=$((payload_bytes + safety_bytes))
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available_bytes="$(
    df -P -B1 -- "$docker_root" | awk 'NR == 2 { print $4 }'
  )"
  case "$available_bytes" in
    *[!0-9]* | "")
      echo "unable to measure free space for DockerRootDir: $docker_root" >&2
      return 1
      ;;
  esac
  if [ "$available_bytes" -lt "$required_bytes" ]; then
    echo "insufficient DockerRootDir space for volume migration" >&2
    echo "required bytes (sources + database backup + safety): $required_bytes" >&2
    echo "available bytes: $available_bytes" >&2
    return 1
  fi
  echo "Volume migration capacity verified: ${required_bytes} required, ${available_bytes} available."
}

assert_volume_unattached_and_empty() {
  volume_name="$1"
  attached_containers="$(docker ps -aq --filter "volume=${volume_name}")"
  if [ -n "$attached_containers" ]; then
    echo "migration target volume is already attached to a container: $volume_name" >&2
    return 1
  fi
  entry_count="$(
    docker run --rm --network none \
      --mount "type=volume,src=${volume_name},dst=/target" \
      --entrypoint /bin/sh busybox:1.37 \
      -ec 'find /target -mindepth 1 -maxdepth 1 | wc -l'
  )"
  if [ "$entry_count" != "0" ]; then
    echo "migration target volume is not empty: $volume_name" >&2
    return 1
  fi
}

create_volume_hold() {
  volume_name="$1"
  hold_name="linksense-volume-hold-$(printf '%s' "$volume_name" | tr -c 'A-Za-z0-9_.-' '-')-$$"
  docker create \
    --name "$hold_name" \
    --network none \
    --label com.linksense.migration-hold=true \
    --label com.linksense.managed-by=linksense-production \
    --label "com.linksense.volume=${volume_name}" \
    --mount "type=volume,src=${volume_name},dst=/hold" \
    busybox:1.37 sh -c 'exit 0' >/dev/null
  printf '%s\n' "$hold_name"
}

remove_volume_holds() {
  for hold_name in "$user_volume_hold" "$backup_volume_hold"; do
    [ -n "$hold_name" ] || continue
    docker rm -f "$hold_name" >/dev/null 2>&1 || true
  done
  user_volume_hold=""
  backup_volume_hold=""
}

remove_user_volume_hold() {
  [ -n "$user_volume_hold" ] || return 0
  docker rm -f "$user_volume_hold" >/dev/null 2>&1 || return 1
  user_volume_hold=""
}

remove_backup_volume_hold() {
  [ -n "$backup_volume_hold" ] || return 0
  docker rm -f "$backup_volume_hold" >/dev/null 2>&1 || return 1
  backup_volume_hold=""
}

protect_migration_target_volumes() {
  if [ "$user_migration_volume_ready" -eq 1 ]; then
    if ensure_volume_guard "$(configured_user_volume)" user-data; then
      remove_user_volume_hold || true
    else
      echo "User-data quarantine guard failed; retaining migration hold: $user_volume_hold" >&2
    fi
  fi
  if [ "$backup_migration_volume_ready" -eq 1 ]; then
    if ensure_volume_guard "$(configured_backup_volume)" backups; then
      remove_backup_volume_hold || true
    else
      echo "Backup quarantine guard failed; retaining migration hold: $backup_volume_hold" >&2
    fi
  fi
}

prepare_volume_migration_scripts() {
  cat >"${temporary_root}/volume-manifest.mjs" <<'EOF'
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const aggregate = createHash("sha256");
let entries = 0;
let files = 0;
let bytes = 0;
const update = (value) => {
  const encoded = Buffer.from(value);
  aggregate.update(String(encoded.length));
  aggregate.update(":");
  aggregate.update(encoded);
};
async function visit(relative) {
  const absolute = relative ? path.join(root, relative) : root;
  const info = await lstat(absolute);
  const type = info.isDirectory()
    ? "directory"
    : info.isFile()
      ? "file"
      : info.isSymbolicLink()
        ? "symlink"
        : "special";
  if (type === "special") {
    throw new Error(`unsupported special entry in migration source: ${relative || "."}`);
  }
  entries += 1;
  update(JSON.stringify([
    relative,
    type,
    info.uid,
    info.gid,
    info.mode & 0o7777,
    type === "file" ? info.size : null,
  ]));
  if (type === "file") {
    files += 1;
    bytes += info.size;
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(absolute)) digest.update(chunk);
    update(digest.digest("hex"));
  } else if (type === "symlink") {
    update(await readlink(absolute));
  } else if (type === "directory") {
    const children = (await readdir(absolute)).sort((left, right) =>
      Buffer.from(left).compare(Buffer.from(right)),
    );
    for (const child of children) {
      await visit(relative ? path.join(relative, child) : child);
    }
  }
}
await visit("");
process.stdout.write(JSON.stringify({ entries, files, bytes, sha256: aggregate.digest("hex") }));
EOF
  cat >"${temporary_root}/normalize-user-volume.mjs" <<'EOF'
import { chmod, chown, lchown, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const uuidSource = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ownerPattern = new RegExp(`^${uuidSource}$`, "iu");
const stagingPattern = new RegExp(`^\\.capabilities(?:-backup)?-${uuidSource}$`, "iu");
const readInfo = async (target) => {
  try { return await lstat(target); } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};
const assertRealDirectory = async (target, label) => {
  const info = await readInfo(target);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory`);
  }
  return info;
};
const ensureRealDirectory = async (target, uid, mode, label) => {
  const existing = await readInfo(target);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw new Error(`${label} is not a real directory`);
  }
  if (!existing) await mkdir(target, { mode });
  await chown(target, uid, 1000);
  await chmod(target, mode);
};
const normalizeTree = async (target, uid, directoryMode, fileMode) => {
  const info = await readInfo(target);
  if (!info) return;
  if (info.isSymbolicLink()) {
    await lchown(target, uid, 1000);
    return;
  }
  await chown(target, uid, 1000);
  if (info.isDirectory()) {
    await chmod(target, directoryMode);
    for (const child of await readdir(target)) {
      await normalizeTree(path.join(target, child), uid, directoryMode, fileMode);
    }
  } else if (info.isFile()) {
    await chmod(target, (info.mode & 0o111) !== 0 ? 0o750 : fileMode);
  } else {
    throw new Error(`unsupported special entry while normalizing: ${target}`);
  }
};
const removeRegeneratedDirectory = async (target, label) => {
  const info = await readInfo(target);
  if (!info) return;
  if (!info.isDirectory() && !info.isSymbolicLink()) {
    throw new Error(`${label} is neither a real directory nor a symlink mountpoint`);
  }
  await rm(target, { recursive: true, force: true });
};
const removeStagingDirectories = async (managed) => {
  for (const entry of await readdir(managed)) {
    if (!stagingPattern.test(entry)) continue;
    const target = path.join(managed, entry);
    await assertRealDirectory(target, `capability staging directory ${entry}`);
    await rm(target, { recursive: true, force: true });
  }
};
await assertRealDirectory(root, "user-data volume root");
await chown(root, 1000, 1000);
await chmod(root, 0o770);
const capabilityRoot = path.join(root, ".capabilities");
await ensureRealDirectory(
  capabilityRoot,
  1000,
  0o750,
  "global capability source root",
);
await normalizeTree(capabilityRoot, 1000, 0o750, 0o640);
await chmod(capabilityRoot, 0o750);
for (const ownerId of await readdir(root)) {
  if (ownerId === ".runner-health") {
    await rm(path.join(root, ownerId), { recursive: true, force: true });
    continue;
  }
  if (ownerId === ".capabilities") continue;
  if (!ownerPattern.test(ownerId)) {
    throw new Error(`unexpected entry at user-data volume root: ${ownerId}`);
  }
  const owner = path.join(root, ownerId);
  await assertRealDirectory(owner, `owner root ${ownerId}`);
  for (const entry of await readdir(owner)) {
    if (!new Set(["home", "managed", "control"]).has(entry)) {
      throw new Error(`unexpected entry under owner ${ownerId}: ${entry}`);
    }
  }
  const home = path.join(owner, "home");
  const agents = path.join(home, ".agents");
  const codex = path.join(home, ".codex");
  const plugins = path.join(codex, "plugins");
  const workspaces = path.join(home, "workspaces");
  const managed = path.join(owner, "managed");
  const managedAgents = path.join(managed, "agents");
  const control = path.join(owner, "control");
  await chown(owner, 1000, 1000);
  await chmod(owner, 0o770);
  await ensureRealDirectory(home, 1001, 0o770, `home for ${ownerId}`);
  await ensureRealDirectory(workspaces, 1001, 0o2770, `workspaces for ${ownerId}`);
  await ensureRealDirectory(codex, 1001, 0o770, `Codex home for ${ownerId}`);
  await ensureRealDirectory(managed, 1000, 0o750, `managed root for ${ownerId}`);
  await ensureRealDirectory(managedAgents, 1000, 0o750, `managed agents for ${ownerId}`);
  await ensureRealDirectory(control, 1000, 0o700, `control root for ${ownerId}`);
  await removeStagingDirectories(managed);
  await normalizeTree(home, 1001, 0o700, 0o600);
  await chmod(home, 0o770);
  await normalizeTree(workspaces, 1001, 0o2770, 0o640);
  await removeRegeneratedDirectory(agents, `legacy agents mountpoint for ${ownerId}`);
  await ensureRealDirectory(agents, 1001, 0o750, `agents mountpoint for ${ownerId}`);
  await chmod(codex, 0o770);
  await removeRegeneratedDirectory(plugins, `Codex plugin cache for ${ownerId}`);
  await ensureRealDirectory(plugins, 1001, 0o770, `Codex plugin cache for ${ownerId}`);
  for (const filename of ["config.toml", "auth.json", "AGENTS.md"]) {
    const target = path.join(codex, filename);
    const info = await readInfo(target);
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`managed Codex file is not regular: ${ownerId}/${filename}`);
    }
    await chown(target, 1001, 1000);
    await chmod(target, 0o660);
  }
  await normalizeTree(control, 1000, 0o700, 0o600);
  await rm(path.join(control, ".workspace-permissions-v1"), { force: true });
  await normalizeTree(managed, 1000, 0o750, 0o640);
  await chmod(managed, 0o750);
  await chmod(managedAgents, 0o750);
  for (const child of ["skills", "plugin-sources", "plugins"]) {
    await ensureRealDirectory(
      path.join(managedAgents, child),
      1000,
      0o750,
      `managed agents ${child} for ${ownerId}`,
    );
  }
}
EOF
}

volume_manifest() {
  mount_type="$1"
  mount_source="$2"
  mount_readonly="$3"
  mount_spec="type=${mount_type},src=${mount_source},dst=/data"
  if [ "$mount_readonly" = "1" ]; then
    mount_spec="${mount_spec},readonly"
  fi
  docker run --rm --network none \
    --mount "$mount_spec" \
    --mount "type=bind,src=${temporary_root}/volume-manifest.mjs,dst=/volume-manifest.mjs,readonly" \
    --entrypoint node "linksense-runner-controller:${image_tag}" \
    /volume-manifest.mjs /data
}

copy_and_verify_legacy_directory() {
  source_path="$1"
  target_volume="$2"
  migration_label="$3"
  source_manifest="$(volume_manifest bind "$source_path" 1)"
  docker run --rm --network none \
    --mount "type=bind,src=${source_path},dst=/source,readonly" \
    --mount "type=volume,src=${target_volume},dst=/target" \
    --entrypoint /bin/sh "linksense-runner-controller:${image_tag}" \
    -ec 'set -eu; cd /source; tar --numeric-owner -cpf - . | tar --numeric-owner -xpf - -C /target'
  target_manifest="$(volume_manifest volume "$target_volume" 0)"
  if [ "$source_manifest" != "$target_manifest" ]; then
    echo "$migration_label migration verification failed" >&2
    echo "source: $source_manifest" >&2
    echo "target: $target_manifest" >&2
    return 1
  fi
  echo "$migration_label raw-copy verified: $target_manifest"
}

normalize_user_volume() {
  volume_name="$1"
  docker run --rm --network none \
    --mount "type=volume,src=${volume_name},dst=/data" \
    --mount "type=bind,src=${temporary_root}/normalize-user-volume.mjs,dst=/normalize-user-volume.mjs,readonly" \
    --entrypoint node "linksense-runner-controller:${image_tag}" \
    /normalize-user-volume.mjs /data
  # A second pass proves the normalized layout is accepted idempotently.
  docker run --rm --network none \
    --mount "type=volume,src=${volume_name},dst=/data" \
    --mount "type=bind,src=${temporary_root}/normalize-user-volume.mjs,dst=/normalize-user-volume.mjs,readonly" \
    --entrypoint node "linksense-runner-controller:${image_tag}" \
    /normalize-user-volume.mjs /data
}

write_legacy_rollback_override() {
  legacy_user_root="$1"
  legacy_backup_root="$2"
  escaped_user_root="$(printf '%s' "$legacy_user_root" | sed "s/'/''/g")"
  escaped_backup_root="$(printf '%s' "$legacy_backup_root" | sed "s/'/''/g")"
  cat >"${temporary_root}/legacy-bind-rollback.yml" <<EOF
services:
  storage-init:
    environment:
      LINKSENSE_USER_DATA_ROOT: '${escaped_user_root}'
    volumes: !override
      - type: bind
        source: '${escaped_user_root}'
        target: '${escaped_user_root}'
  runner:
    environment:
      LINKSENSE_USER_DATA_ROOT: '${escaped_user_root}'
      LINKSENSE_USER_DATA_VOLUME: ""
    volumes: !override
      - type: bind
        source: '${escaped_user_root}'
        target: '${escaped_user_root}'
      - type: bind
        source: \${LINKSENSE_DOCKER_SOCKET_PATH:-/var/run/docker.sock}
        target: \${LINKSENSE_DOCKER_SOCKET_PATH:-/var/run/docker.sock}
  api:
    environment:
      LINKSENSE_USER_DATA_ROOT: '${escaped_user_root}'
    volumes: !override
      - type: bind
        source: '${escaped_user_root}'
        target: '${escaped_user_root}'
  backup-init:
    environment:
      LINKSENSE_BACKUP_ROOT: '${escaped_backup_root}'
    volumes: !override
      - type: bind
        source: '${escaped_backup_root}'
        target: '${escaped_backup_root}'
  postgres-backup:
    volumes: !override
      - type: bind
        source: ./deploy/production/postgres-backup.sh
        target: /usr/local/bin/linksense-postgres-backup
        read_only: true
      - type: bind
        source: '${escaped_backup_root}'
        target: /backups
volumes:
  # The production overlay declares these as external volumes. Reset them from
  # the rollback model so a failure before target-volume creation can still
  # restore the legacy bind runtime without requiring empty placeholder volumes.
  user-data: !reset null
  backup-data: !reset null
EOF
}

rollback_compose() {
  if [ "$volume_cutover" -eq 1 ]; then
    docker compose \
      -f "$compose_file" \
      -f "${temporary_root}/legacy-bind-rollback.yml" \
      --env-file "$environment_file" "$@"
  else
    compose "$@"
  fi
}

prepare_storage_contract() {
  configured_user_volume_value="$(read_key "$environment_file" LINKSENSE_USER_DATA_VOLUME)"
  configured_backup_volume_value="$(read_key "$environment_file" LINKSENSE_BACKUP_VOLUME)"
  legacy_user_root="$(read_key "$environment_file" LINKSENSE_USER_DATA_ROOT)"
  legacy_backup_root="$(read_key "$environment_file" LINKSENSE_BACKUP_ROOT)"
  legacy_backup_root="${legacy_backup_root:-${deployment_root}/.data/backups}"

  if [ -n "$configured_user_volume_value" ]; then
    if [ -n "$migrate_user_data_from" ]; then
      echo "production already declares a user-data volume; refusing a second migration" >&2
      return 1
    fi
    if [ -z "$configured_backup_volume_value" ]; then
      echo "LINKSENSE_BACKUP_VOLUME is required after volume cutover" >&2
      return 1
    fi
    if [ "$(read_key "$environment_file" LINKSENSE_USER_DATA_ROOT)" != "/srv/linksense/users" ]; then
      echo "LINKSENSE_USER_DATA_ROOT must be /srv/linksense/users after volume cutover" >&2
      return 1
    fi
    if [ "$(read_key "$environment_file" LINKSENSE_BACKUP_ROOT)" != "/backups" ]; then
      echo "LINKSENSE_BACKUP_ROOT must be /backups after volume cutover" >&2
      return 1
    fi
    validate_production_volumes
    return
  fi

  if [ -z "$migrate_user_data_from" ]; then
    echo "legacy bind storage requires explicit --migrate-user-data-from cutover" >&2
    return 1
  fi
  assert_absolute_legacy_directory "$migrate_user_data_from" user-data
  if [ -z "$legacy_user_root" ]; then
    echo "legacy environment does not declare LINKSENSE_USER_DATA_ROOT" >&2
    return 1
  fi
  if [ "$(readlink -m "$migrate_user_data_from")" != "$(readlink -m "$legacy_user_root")" ]; then
    echo "user-data migration source does not match the active legacy root" >&2
    return 1
  fi
  migrate_user_data_from="$(readlink -m "$migrate_user_data_from")"
  legacy_user_root="$migrate_user_data_from"
  legacy_backup_root="$(readlink -m "$legacy_backup_root")"
  if [ -n "$migrate_backups_from" ]; then
    assert_absolute_legacy_directory "$migrate_backups_from" backups
    migrate_backups_from="$(readlink -m "$migrate_backups_from")"
    if [ "$migrate_backups_from" != "$legacy_backup_root" ]; then
      echo "backup migration source does not match the active legacy root" >&2
      return 1
    fi
    assert_disjoint_legacy_directories "$legacy_user_root" "$migrate_backups_from"
  fi
  case "$legacy_user_root:$legacy_backup_root" in
    *"'"*)
      echo "legacy migration paths contain unsupported characters" >&2
      return 1
      ;;
  esac

  user_volume="$(configured_user_volume)"
  backup_volume="$(configured_backup_volume)"
  validate_volume_name "$user_volume"
  validate_volume_name "$backup_volume"
  if [ "$user_volume" = "$backup_volume" ]; then
    echo "user-data and backup volumes must be different" >&2
    return 1
  fi
  volume_cutover=1
  write_legacy_rollback_override "$legacy_user_root" "$legacy_backup_root"
}

initialize_migration_target_volumes() {
  [ "$volume_cutover" -eq 1 ] || return 0
  if ! docker image inspect busybox:1.37 >/dev/null 2>&1; then
    docker pull busybox:1.37 >/dev/null
  fi
  user_volume="$(configured_user_volume)"
  backup_volume="$(configured_backup_volume)"
  if docker volume inspect "$user_volume" >/dev/null 2>&1; then
    validate_managed_volume "$user_volume" user-data
    user_migration_volume_ready=1
  else
    docker volume create \
      --driver local \
      --label com.linksense.managed-by=linksense-production \
      --label com.linksense.persistence=critical \
      --label com.linksense.role=user-data \
      "$user_volume" >/dev/null
    # Mark a volume created by this run before any later check can fail, so the
    # exit trap always protects it from prune without deleting its contents.
    user_migration_volume_ready=1
    validate_managed_volume "$user_volume" user-data
  fi
  if docker volume inspect "$backup_volume" >/dev/null 2>&1; then
    validate_managed_volume "$backup_volume" backups
    backup_migration_volume_ready=1
  else
    docker volume create \
      --driver local \
      --label com.linksense.managed-by=linksense-production \
      --label com.linksense.persistence=critical \
      --label com.linksense.role=backups \
      "$backup_volume" >/dev/null
    backup_migration_volume_ready=1
    validate_managed_volume "$backup_volume" backups
  fi
  assert_volume_unattached_and_empty "$user_volume"
  assert_volume_unattached_and_empty "$backup_volume"
  user_volume_hold="$(create_volume_hold "$user_volume")"
  backup_volume_hold="$(create_volume_hold "$backup_volume")"
  prepare_volume_migration_scripts
}

worker_source_fingerprint() {
  {
    printf '%s\n' "linksense-worker-image-inputs-v1"
    printf 'CODEX_VERSION=%s\n' "$(environment_value CODEX_VERSION 0.150.1)"
    printf 'PNPM_VERSION=%s\n' "$(environment_value PNPM_VERSION 10.6.4)"
    printf 'LINKSENSE_NODE_PACKAGE_REGISTRY_URL=%s\n' \
      "$(environment_value LINKSENSE_NODE_PACKAGE_REGISTRY_URL https://registry.npmjs.org/)"
    printf 'PLAYWRIGHT_DOWNLOAD_HOST=%s\n' \
      "$(environment_value PLAYWRIGHT_DOWNLOAD_HOST "")"
    git ls-tree -r "$target_revision" -- \
      .dockerignore \
      Dockerfile.runner \
      package.json \
      pnpm-lock.yaml \
      pnpm-workspace.yaml \
      tsconfig.base.json \
      patches \
      apps/api/package.json \
      apps/docs/package.json \
      apps/runner \
      apps/web/package.json \
      packages/shared \
      deploy/codex-home-template/config.toml \
      deploy/codex-system/requirements.toml \
      deploy/docker/configure-debian-apt.sh \
      deploy/runtime/browser \
      deploy/runtime/fonts \
      deploy/runtime/node \
      deploy/runtime/python \
      deploy/runtime/shell
  } | sha256sum | cut -c1-32
}

worker_runtime_changed_paths() {
  worker_runtime_base="$1"
  git diff --name-only "$worker_runtime_base" "$target_revision" -- \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    tsconfig.base.json \
    patches \
    apps/api/package.json \
    apps/docs/package.json \
    apps/runner \
    apps/web/package.json \
    packages/shared \
    deploy/codex-home-template/config.toml \
    deploy/codex-system/requirements.toml \
    deploy/runtime/browser \
    deploy/runtime/fonts \
    deploy/runtime/node \
    deploy/runtime/python \
    deploy/runtime/shell
}

worker_rebuild_changed_paths() {
  worker_rebuild_base="$1"
  git diff --name-only "$worker_rebuild_base" "$target_revision" -- \
    .dockerignore \
    Dockerfile.runner \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    tsconfig.base.json \
    patches \
    apps/api/package.json \
    apps/docs/package.json \
    apps/runner \
    apps/web/package.json \
    packages/shared \
    deploy/codex-home-template/config.toml \
    deploy/codex-system/requirements.toml \
    deploy/docker/configure-debian-apt.sh \
    deploy/runtime/browser \
    deploy/runtime/fonts \
    deploy/runtime/node \
    deploy/runtime/python \
    deploy/runtime/shell
}

worker_browser_runtime_changed_paths() {
  worker_browser_runtime_base="$1"
  git diff --name-only "$worker_browser_runtime_base" "$target_revision" -- \
    deploy/runtime/browser
}

capture_previous_image_ids() {
  : >"$previous_images_file"
  for image_repository in \
    linksense-migrate \
    linksense-runner-controller \
    linksense-api \
    linksense-web \
    linksense-runner-worker
  do
    image_id="$(
      docker image inspect \
        --format '{{.Id}}' \
        "${image_repository}:${image_tag}" 2>/dev/null || true
    )"
    if [ -n "$image_id" ]; then
      printf '%s %s\n' "$image_repository" "$image_id" >>"$previous_images_file"
    fi
  done
}

restore_previous_image_ids() {
  [ -s "$previous_images_file" ] || return 0
  while read -r image_repository image_id; do
    [ -n "$image_repository" ] || continue
    [ -n "$image_id" ] || continue
    if docker image inspect "$image_id" >/dev/null 2>&1; then
      docker tag "$image_id" "${image_repository}:${image_tag}" >/dev/null
    fi
  done <"$previous_images_file"
}

gateway_port() {
  configured_port="$(read_key "$environment_file" LINKSENSE_HTTP_PORT)"
  configured_port="${configured_port:-8080}"
  case "$configured_port" in
    *[!0-9]* | "")
      echo "invalid LINKSENSE_HTTP_PORT" >&2
      return 1
      ;;
  esac
  printf '%s\n' "$configured_port"
}

wait_for_gateway_response() {
  expected_status="$1"
  expected_text="$2"
  response_path="${temporary_root}/gateway-response.html"
  port="$(gateway_port)"
  attempt=1
  while [ "$attempt" -le 20 ]; do
    : >"$response_path"
    actual_status="$(
      curl --silent --show-error \
        --connect-timeout 5 \
        --max-time 20 \
        --output "$response_path" \
        --write-out '%{http_code}' \
        "http://127.0.0.1:${port}/" || true
    )"
    if [ "$actual_status" = "$expected_status" ]; then
      if [ -z "$expected_text" ] || grep -F "$expected_text" "$response_path" >/dev/null; then
        return 0
      fi
    fi
    attempt="$((attempt + 1))"
    sleep 1
  done
  echo "gateway did not return the expected HTTP ${expected_status} response" >&2
  return 1
}

reload_gateway_configuration() {
  if ! compose exec -T gateway sh -ec '
    active_config="/etc/nginx/conf.d/default.conf"
    next_config="/etc/nginx/conf.d/.default.conf.linksense-next"
    previous_config="/etc/nginx/conf.d/.default.conf.linksense-previous"
    restore_active_config() {
      if [ -f "$previous_config" ]; then
        mv "$previous_config" "$active_config"
      fi
      rm -f "$next_config"
    }
    trap restore_active_config EXIT HUP INT TERM
    defined_environment_variables="\${NGINX_CLIENT_MAX_BODY_SIZE} \${NGINX_EXTERNAL_SCHEME} \${NGINX_MINIO_UPSTREAM}"
    envsubst "$defined_environment_variables" >"$next_config"
    test -s "$next_config"
    mv "$active_config" "$previous_config"
    mv "$next_config" "$active_config"
    nginx -t
    nginx -s reload
    rm -f "$previous_config"
    trap - EXIT HUP INT TERM
  ' <"$gateway_template"; then
    return 1
  fi
}

activate_maintenance() {
  echo "Enabling the production maintenance response..."
  maintenance_active=1
  reload_gateway_configuration || return 1
  compose exec -T gateway sh -ec ': > /tmp/linksense-maintenance' || return 1
  wait_for_gateway_response 503 "$maintenance_message" || return 1
}

deactivate_maintenance() {
  echo "Disabling the production maintenance response..."
  if ! compose exec -T gateway sh -ec 'rm -f /tmp/linksense-maintenance'; then
    return 1
  fi
  if ! wait_for_gateway_response 200 ""; then
    echo "Gateway did not become available after removing maintenance; restoring the maintenance response." >&2
    if compose exec -T gateway sh -ec ': > /tmp/linksense-maintenance'; then
      wait_for_gateway_response 503 "$maintenance_message" ||
        echo "Failed to verify the restored maintenance response; manual recovery is required." >&2
    else
      echo "Failed to restore the maintenance marker; manual recovery is required." >&2
    fi
    return 1
  fi
  maintenance_active=0
}

worker_instance_key() {
  worker_network="$(read_key "$environment_file" LINKSENSE_WORKER_CONTROL_NETWORK)"
  user_data_root="$(read_key "$environment_file" LINKSENSE_USER_DATA_ROOT)"
  user_data_volume="$(read_key "$environment_file" LINKSENSE_USER_DATA_VOLUME)"
  worker_network="${worker_network:-linksense-worker-control}"
  case "$worker_network" in
    *[!A-Za-z0-9_.-]* | "")
      echo "invalid LINKSENSE_WORKER_CONTROL_NETWORK" >&2
      return 1
      ;;
  esac
  if [ -n "$user_data_volume" ]; then
    validate_volume_name "$user_data_volume"
    storage_kind="volume"
    storage_identity="$user_data_volume"
  else
    case "$user_data_root" in
      /*) ;;
      *)
        echo "LINKSENSE_USER_DATA_ROOT must be an absolute path" >&2
        return 1
        ;;
    esac
    storage_kind="bind"
    storage_identity="$user_data_root"
  fi
  printf '["linksense-runner-storage-domain","%s","%s","%s"]' \
    "$worker_network" "$storage_kind" "$storage_identity" |
    sha256sum |
    cut -c1-32
}

remove_deployment_workers() {
  expected_instance="$(worker_instance_key)"
  worker_ids="$(
    bounded_docker ps -aq \
      --filter 'label=com.linksense.runner.managed=true' \
      --filter "label=com.linksense.runner.instance=${expected_instance}"
  )"
  [ -n "$worker_ids" ] || return 0
  for worker_id in $worker_ids; do
    actual_managed="$(
      bounded_docker inspect --format '{{ index .Config.Labels "com.linksense.runner.managed" }}' "$worker_id"
    )"
    actual_instance="$(
      bounded_docker inspect --format '{{ index .Config.Labels "com.linksense.runner.instance" }}' "$worker_id"
    )"
    if [ "$actual_managed" != "true" ] || [ "$actual_instance" != "$expected_instance" ]; then
      echo "refusing to remove worker outside this deployment: $worker_id" >&2
      return 1
    fi
  done
  # All workers share the remaining grace period, not one timeout per worker.
  worker_grace="$(shutdown_remaining)"
  stop_pids=""
  for worker_id in $worker_ids; do
    bounded_docker stop --timeout "$worker_grace" "$worker_id" &
    stop_pids="$stop_pids $!"
  done
  stop_failed=0
  for stop_pid in $stop_pids; do
    wait "$stop_pid" || stop_failed=1
  done
  [ "$stop_failed" -eq 0 ] || return 1
  # Without -f, Docker refuses removal if a worker somehow remains running.
  # No volumes are removed; the persistent history and files stay in place.
  bounded_docker rm $worker_ids
}

bounded_docker() {
  # Daemon/transport failure must fail closed, not hang deployment indefinitely.
  timeout --kill-after=2s 20s docker "$@"
}

shutdown_remaining() {
  remaining="$(( shutdown_deadline - $(date +%s) ))"
  [ "$remaining" -ge 0 ] || remaining=0
  printf '%s\n' "$remaining"
}

stop_deployment_service() {
  service_name="$1"
  service_grace="$(shutdown_remaining)"
  [ "$service_grace" -le 2 ] || service_grace=2
  bounded_docker compose -f "$compose_file" --env-file "$environment_file" \
    stop --timeout "$service_grace" "$service_name"
  service_ids="$(bounded_docker compose -f "$compose_file" --env-file "$environment_file" ps -aq "$service_name")"
  for service_id in $service_ids; do
    if [ "$(bounded_docker inspect --format '{{.State.Running}}' "$service_id")" != "false" ]; then
      echo "execution service did not stop: $service_name" >&2
      return 1
    fi
  done
}

run_deployment_task_command() {
  task_command="$1"
  task_timeout="$2"
  [ "$task_timeout" -gt 0 ] || return 1
  deployment_helper="linksense-deployment-tasks-${temporary_root##*/}"
  task_status=0
  set -- "$task_command"
  if [ "$task_command" = "settle" ]; then
    set -- "$@" --runtime-stopped
  fi
  # The new image contains the offline command; never start another API server
  # or any dependencies here. It uses the same validated production settings.
  # -T only disables the TTY; Compose still attaches stdin by default. Under
  # timeout's background process group, reading the SSH terminal causes SIGTTIN.
  # Disable that attachment and close stdin without weakening process timeouts.
  timeout --kill-after=2s "${task_timeout}s" \
    docker compose -f "$compose_file" --env-file "$environment_file" \
    run --rm --no-deps --interactive=false -T --pull never --name "$deployment_helper" \
    --label "com.linksense.deployment.helper=${deployment_helper}" \
    --entrypoint node api dist/commands/deployment-task-stop.js "$@" </dev/null || task_status=$?
  case "$task_status" in
    0) ;;
    124) echo "Deployment task '$task_command' timed out after ${task_timeout}s (exit 124)." >&2 ;;
    *) echo "Deployment task '$task_command' failed with exit code $task_status." >&2 ;;
  esac
  # A killed Compose client does not kill its one-off container.
  if ! cleanup_deployment_helper; then
    echo "Deployment task '$task_command' helper cleanup failed (command exit $task_status)." >&2
    return 1
  fi
  return "$task_status"
}

cleanup_deployment_helper() {
  [ -n "$deployment_helper" ] || return 0
  helper_ids="$(bounded_docker ps -aq --filter "name=^/${deployment_helper}$")" || return 1
  if [ -n "$helper_ids" ]; then
    if [ "$(bounded_docker inspect --format '{{ index .Config.Labels "com.linksense.deployment.helper" }}' "$deployment_helper")" != "$deployment_helper" ]; then
      echo "refusing to remove an unrecognized deployment helper" >&2
      return 1
    fi
    bounded_docker rm -f "$deployment_helper" || return 1
  fi
  deployment_helper=""
}

stop_deployment_execution() {
  shutdown_deadline="$(( $(date +%s) + 10 ))"
  echo "Stopping active execution for deployment (shared 10-second grace period)..."
  # Stop every API replica first: they own ingress, schedulers and recovery.
  stop_deployment_service api
  if ! run_deployment_task_command interrupt "$(shutdown_remaining)"; then
    echo "Native interruption did not finish; proceeding with container shutdown." >&2
  fi
  # Stop the controller before the worker snapshot, preventing new workers.
  stop_deployment_service runner
  remove_deployment_workers
}

settle_deployment_execution() {
  run_deployment_task_command settle 95 || return 1
  execution_settled=1
}

create_postgres_backup() {
  backup_volume="$(configured_backup_volume)"
  validate_managed_volume "$backup_volume" backups
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  compose exec -T postgres sh -ec '
    temporary_dump="/tmp/linksense-predeploy-$$.dump"
    trap '\''rm -f "$temporary_dump"'\'' EXIT HUP INT TERM
    pg_dump \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --format=custom \
      --compress=6 \
      --no-owner \
      --no-privileges \
      --file="$temporary_dump"
    pg_restore --list "$temporary_dump" >/dev/null
    cat "$temporary_dump"
  ' | docker run --rm -i --network none \
    --mount "type=volume,src=${backup_volume},dst=/backups" \
    -e "BACKUP_TIMESTAMP=${timestamp}" \
    --entrypoint /bin/sh postgres:16-alpine \
    -ec '
      set -eu
      mkdir -p /backups/postgres
      chown 70:70 /backups /backups/postgres
      chmod 0700 /backups /backups/postgres
      final_path="/backups/postgres/linksense-predeploy-${BACKUP_TIMESTAMP}.dump"
      partial_path="${final_path}.partial"
      trap '\''rm -f "$partial_path"'\'' EXIT HUP INT TERM
      cat >"$partial_path"
      test -s "$partial_path"
      pg_restore --list "$partial_path" >/dev/null
      chown 70:70 "$partial_path"
      chmod 0600 "$partial_path"
      mv "$partial_path" "$final_path"
      trap - EXIT HUP INT TERM
    '
  echo "Validated PostgreSQL backup: volume://${backup_volume}/postgres/linksense-predeploy-${timestamp}.dump"
}

verify_release() {
  migrate_id="$(compose ps -aq migrate | tail -n 1)"
  if [ -z "$migrate_id" ]; then
    echo "migration container was not created" >&2
    return 1
  fi
  migrate_result="$(
    docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$migrate_id"
  )"
  if [ "$migrate_result" != "exited 0" ]; then
    echo "migration did not complete successfully: $migrate_result" >&2
    return 1
  fi

  gateway_port="$(gateway_port)"
  curl --silent --show-error --fail \
    --connect-timeout 5 \
    --max-time 20 \
    "http://127.0.0.1:${gateway_port}/health/live" >/dev/null

  worker_image="$(read_key "$environment_file" LINKSENSE_WORKER_IMAGE)"
  expected_worker_fingerprint="$(
    read_key "$environment_file" LINKSENSE_WORKER_IMAGE_FINGERPRINT
  )"
  worker_fingerprint="$(
    docker image inspect \
      --format '{{ index .Config.Labels "com.linksense.worker.fingerprint" }}' \
      "$worker_image"
  )"
  if [ "$worker_fingerprint" != "$expected_worker_fingerprint" ]; then
    echo "worker image fingerprint does not match the deployed worker inputs" >&2
    return 1
  fi
}

existing_release_is_healthy() {
  for service_name in postgres redis runner api web gateway postgres-backup; do
    service_ids="$(compose ps -q "$service_name")"
    if [ -z "$service_ids" ]; then
      echo "deployed service is not running: $service_name" >&2
      return 1
    fi
    for service_id in $service_ids; do
      if [ "$(docker inspect --format '{{.State.Running}}' "$service_id")" != "true" ]; then
        echo "deployed service container is stopped: $service_name" >&2
        return 1
      fi
      service_health="$(
        docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
          "$service_id"
      )"
      if [ -n "$service_health" ] && [ "$service_health" != "healthy" ]; then
        echo "deployed service container is not healthy: $service_name" >&2
        return 1
      fi
    done
  done
  gateway_id="$(compose ps -q gateway | head -n 1)"
  if ! docker exec "$gateway_id" test ! -e /tmp/linksense-maintenance; then
    echo "production gateway is still in maintenance mode" >&2
    return 1
  fi
  verify_release
}

rollback_runtime() {
  if [ "$runtime_touched" -eq 1 ] && [ "$execution_settled" -ne 1 ]; then
    echo "Execution shutdown or state settlement failed; automatic restart is disabled to prevent task replay." >&2
    echo "Maintenance remains enabled. Resolve the reported error and rerun deployment." >&2
    return 1
  fi
  if [ "$release_committed" -eq 1 ] || [ "$migration_may_have_applied" -eq 1 ]; then
    echo "The new runtime may have committed database changes; automatic image rollback is disabled." >&2
    echo "Maintenance remains enabled for manual recovery and backup review." >&2
    return 1
  fi
  echo "Deployment failed; restoring the previous image configuration..." >&2
  restore_previous_image_ids || true
  if [ "$runtime_touched" -eq 1 ] &&
    [ "$volume_cutover" -eq 1 ] &&
    [ "$volume_migration_published" -eq 1 ]; then
    compose stop --timeout 120 runner >/dev/null 2>&1 || true
    remove_deployment_workers || true
  fi
  cp -p "$environment_backup" "$environment_file"
  chmod 0600 "$environment_file"
  environment_changed=0
  rollback_ready=1
  if [ "$runtime_touched" -eq 1 ]; then
    rollback_ready=0
    rollback_compose stop --timeout 120 runner >/dev/null 2>&1 || true
    if [ "$volume_migration_published" -eq 1 ]; then
      remove_deployment_workers || true
    fi
    if rollback_compose up -d --wait --wait-timeout "$health_wait_seconds" --remove-orphans; then
      rollback_ready=1
      echo "Previous image configuration restored. The Git checkout remains at the fetched commit." >&2
    else
      echo "Automatic runtime rollback failed; manual recovery is required." >&2
    fi
  fi
  if [ "$maintenance_active" -eq 1 ]; then
    if [ "$rollback_ready" -eq 1 ]; then
      deactivate_maintenance ||
        echo "Failed to disable maintenance mode after rollback; manual recovery is required." >&2
    else
      echo "Maintenance mode remains enabled because runtime rollback did not become healthy." >&2
    fi
  fi
}

on_exit() {
  exit_status="$?"
  if [ "$cleanup_started" -eq 1 ]; then
    return
  fi
  cleanup_started=1
  trap - 0 HUP INT TERM
  cleanup_deployment_helper || echo "Deployment helper cleanup failed; inspect Docker before restarting." >&2
  if [ "$exit_status" -ne 0 ] && [ "$deployment_succeeded" -ne 1 ]; then
    set +e
    if [ "$fresh_install" -eq 1 ]; then
      echo "Initial deployment did not verify; no previous production runtime exists to restore." >&2
    elif [ "$release_committed" -eq 1 ]; then
      echo "Release metadata and runtime are committed; failure while disabling maintenance requires manual recovery." >&2
    elif [ "$migration_may_have_applied" -eq 1 ]; then
      echo "Database migration may have applied; preserving the new runtime and maintenance state for manual recovery." >&2
    elif [ "$environment_changed" -eq 1 ] || [ "$runtime_touched" -eq 1 ] || [ "$maintenance_active" -eq 1 ]; then
      rollback_runtime
    fi
    if [ "$user_migration_volume_ready" -eq 1 ] ||
      [ "$backup_migration_volume_ready" -eq 1 ] ||
      [ -n "$user_volume_hold" ] ||
      [ -n "$backup_volume_hold" ]; then
      echo "Migration target volumes are retained as quarantine evidence; they were not cleared." >&2
      protect_migration_target_volumes
      if [ -n "$user_volume_hold" ] || [ -n "$backup_volume_hold" ]; then
        echo "At least one migration hold remains because a permanent guard could not be verified." >&2
      fi
    fi
    set -e
  fi
  if [ "$exit_status" -eq 0 ]; then
    remove_volume_holds
  fi
  if [ -n "$environment_pending_file" ]; then
    rm -f "$environment_pending_file"
  fi
  rm -rf "$temporary_root"
  remove_deployment_state
  exit "$exit_status"
}
trap on_exit 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

previous_revision="$(git rev-parse HEAD)"
deployed_revision="$(read_key "$metadata_file" SOURCE_REVISION)"
running_script_hash="$(sha256sum "$0" | awk '{ print $1 }')"
echo "Fetching ${remote_name}/${deploy_branch}..."
(
  umask 022
  git fetch --prune "$remote_name" "$deploy_branch"
)
target_revision="$(git rev-parse FETCH_HEAD)"
if [ "$previous_revision" != "$target_revision" ]; then
  if ! git merge-base --is-ancestor "$previous_revision" "$target_revision"; then
    echo "origin/main is not a fast-forward of the production checkout" >&2
    exit 1
  fi
  (
    umask 022
    git -c pull.rebase=false pull --ff-only "$remote_name" "$deploy_branch"
  )
  restore_git_checkout_modes
  if [ "$(git rev-parse HEAD)" != "$target_revision" ]; then
    echo "production checkout did not reach the fetched main revision" >&2
    exit 1
  fi
fi

current_script_hash="$(sha256sum "$0" | awk '{ print $1 }')"
if [ "$running_script_hash" != "$current_script_hash" ]; then
  if [ "${LINKSENSE_DEPLOY_SCRIPT_REEXEC_REVISION:-}" = "$target_revision" ]; then
    echo "deployment script changed again after re-exec; refusing an update loop" >&2
    exit 1
  fi
  set --
  if [ "$allow_migrations" -eq 1 ]; then
    set -- "$@" --allow-migrations
  fi
  if [ -n "$migrate_user_data_from" ]; then
    set -- "$@" --migrate-user-data-from "$migrate_user_data_from"
  fi
  if [ -n "$migrate_backups_from" ]; then
    set -- "$@" --migrate-backups-from "$migrate_backups_from"
  fi
  echo "Deployment script changed in ${target_revision}; re-executing the fetched version."
  trap - 0 HUP INT TERM
  rm -rf "$temporary_root"
  LINKSENSE_DEPLOY_SCRIPT_REEXEC_REVISION="$target_revision" \
    exec "${deployment_root}/deploy/production/deploy-production.sh" "$@"
fi

prepare_storage_contract

if [ -z "$deployed_revision" ]; then
  existing_production_ids="$(compose ps -aq | awk 'NF' | sort -u)"
  compose_project_name="$(read_key "$environment_file" COMPOSE_PROJECT_NAME)"
  compose_project_name="${compose_project_name:-linksense}"
  case "$compose_project_name" in
    *[!A-Za-z0-9_.-]* | "")
      echo "invalid COMPOSE_PROJECT_NAME while checking fresh-install state" >&2
      exit 1
      ;;
  esac
  existing_project_data_volumes="$(
    {
      docker volume ls -q \
        --filter "label=com.docker.compose.project=${compose_project_name}" \
        --filter 'label=com.docker.compose.volume=postgres-data'
      docker volume ls -q \
        --filter "label=com.docker.compose.project=${compose_project_name}" \
        --filter 'label=com.docker.compose.volume=redis-data'
    } | awk 'NF' | sort -u
  )"
  if [ -n "$existing_production_ids" ] || [ -n "$existing_project_data_volumes" ]; then
    echo "deployment metadata has no successful SOURCE_REVISION, but production containers or data volumes already exist" >&2
    echo "refusing to treat an existing installation as fresh; restore or review deployment metadata" >&2
    exit 1
  fi
  if [ "$volume_cutover" -eq 1 ]; then
    echo "legacy bind storage and missing successful deployment metadata cannot be treated as a fresh install" >&2
    echo "restore or review deployment metadata before running the explicit volume cutover" >&2
    exit 1
  fi
  fresh_install=1
elif [ "$deployed_revision" = "$target_revision" ] &&
  [ "$force_rebuild" -ne 1 ] &&
  [ "$volume_cutover" -ne 1 ]; then
  if existing_release_is_healthy; then
    echo "Production is already healthy at ${target_revision}; set LINKSENSE_FORCE_REBUILD=1 to rebuild it."
    deployment_succeeded=1
    exit 0
  fi
  echo "Production metadata points to ${target_revision}, but the runtime is incomplete or unhealthy; continuing deployment."
fi

migration_state="unchanged"
migration_base="$previous_revision"
if [ -n "$deployed_revision" ] && [ "$deployed_revision" != "$target_revision" ]; then
  if git cat-file -e "${deployed_revision}^{commit}" 2>/dev/null; then
    migration_base="$deployed_revision"
  else
    migration_state="unverified"
  fi
fi
if [ "$migration_state" = "unchanged" ] && [ "$migration_base" != "$target_revision" ]; then
  if [ -n "$(git diff --name-only "$migration_base" "$target_revision" -- prisma/migrations)" ]; then
    migration_state="changed"
  fi
fi
if [ "$migration_state" != "unchanged" ] && [ "$allow_migrations" -ne 1 ]; then
  echo "Prisma migrations are ${migration_state}; review them and rerun with --allow-migrations" >&2
  exit 1
fi

image_tag="$production_image_tag"
worker_fingerprint="$(worker_source_fingerprint)"
worker_image="linksense-runner-worker:${image_tag}"
existing_worker_image_id="$(
  docker image inspect --format '{{ .Id }}' "$worker_image" 2>/dev/null || true
)"
existing_worker_fingerprint="$(
  docker image inspect \
    --format '{{ index .Config.Labels "com.linksense.worker.fingerprint" }}' \
    "$worker_image" 2>/dev/null || true
)"
build_worker_image=0
worker_build_target="worker"
browser_runtime_cache_image="$worker_image"
if [ "$reuse_previous_worker_image" -eq 1 ]; then
  if [ -z "$deployed_revision" ] ||
    ! git cat-file -e "${deployed_revision}^{commit}" 2>/dev/null; then
    echo "cannot safely reuse the previous worker image without a deployed revision" >&2
    exit 1
  fi
  changed_worker_runtime_paths="$(
    worker_runtime_changed_paths "$deployed_revision"
  )"
  if [ -n "$changed_worker_runtime_paths" ]; then
    echo "cannot reuse the previous worker image because worker runtime inputs changed:" >&2
    printf '%s\n' "$changed_worker_runtime_paths" >&2
    exit 1
  fi
  previous_worker_image="$(read_key "$environment_backup" LINKSENSE_WORKER_IMAGE)"
  previous_worker_fingerprint="$(
    docker image inspect \
      --format '{{ index .Config.Labels "com.linksense.worker.fingerprint" }}' \
      "$previous_worker_image" 2>/dev/null || true
  )"
  if [ -z "$previous_worker_fingerprint" ]; then
    echo "cannot inspect the previous worker image fingerprint: $previous_worker_image" >&2
    exit 1
  fi
  docker tag "$previous_worker_image" "$worker_image"
  worker_fingerprint="$previous_worker_fingerprint"
  echo "Reusing previous worker image ${previous_worker_image} as ${worker_image} (${worker_fingerprint})"
else
  if [ "$force_rebuild" -eq 1 ] || [ -z "$existing_worker_image_id" ]; then
    build_worker_image=1
  elif [ -n "$deployed_revision" ] &&
    git cat-file -e "${deployed_revision}^{commit}" 2>/dev/null; then
    changed_worker_rebuild_paths="$(
      worker_rebuild_changed_paths "$deployed_revision"
    )"
    if [ -n "$changed_worker_rebuild_paths" ]; then
      echo "Worker image inputs changed since the last successful deployment; rebuilding:"
      printf '%s\n' "$changed_worker_rebuild_paths"
      build_worker_image=1
    elif [ -z "$existing_worker_fingerprint" ]; then
      echo "Existing worker image is missing its fingerprint label; rebuilding."
      build_worker_image=1
    else
      worker_fingerprint="$existing_worker_fingerprint"
      echo "Worker image inputs did not change since ${deployed_revision}; keeping ${worker_image}."
    fi
  elif [ "$existing_worker_fingerprint" != "$worker_fingerprint" ]; then
    build_worker_image=1
  fi
fi

if [ "$build_worker_image" -eq 1 ] &&
  [ -n "$existing_worker_image_id" ] &&
  [ -n "$deployed_revision" ] &&
  git cat-file -e "${deployed_revision}^{commit}" 2>/dev/null; then
  changed_browser_runtime_paths="$(
    worker_browser_runtime_changed_paths "$deployed_revision"
  )"
  if [ -z "$changed_browser_runtime_paths" ]; then
    worker_build_target="worker-cached-browser"
    echo "Reusing browser runtime from ${browser_runtime_cache_image}; browser runtime inputs did not change."
  fi
fi

capture_previous_image_ids
begin_environment_update
set_environment_key LINKSENSE_IMAGE_TAG "$image_tag"
set_environment_key LINKSENSE_WORKER_IMAGE "$worker_image"
set_environment_key LINKSENSE_WORKER_IMAGE_REVISION "$worker_fingerprint"
set_environment_key LINKSENSE_WORKER_IMAGE_FINGERPRINT "$worker_fingerprint"
set_environment_key LINKSENSE_MIGRATION_IMAGE_FINGERPRINT "$target_revision"
set_environment_key LINKSENSE_WORKER_BUILD_TARGET "$worker_build_target"
set_environment_key LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE "$browser_runtime_cache_image"
commit_environment_file
environment_changed=1

compose config --quiet
echo "Building production images for ${target_revision}..."
build_services="migrate api runner web"
if [ "$build_worker_image" -eq 1 ]; then
  build_services="${build_services} runner-worker-image"
else
  echo "Reusing worker image ${worker_image} (${worker_fingerprint})"
fi
compose build $build_services

# Capacity is checked after image export (when DockerRootDir usage is final) but
# before maintenance or target-volume creation. The reservation includes both
# legacy sources, a full uncompressed database-sized backup allowance, 20%
# overhead, and a minimum 2 GiB safety margin.
validate_migration_capacity

if [ "$fresh_install" -eq 1 ]; then
  echo "No successful production release metadata exists; performing the initial startup without drain or pre-deploy backup."
  runtime_touched=1
else
  # Images are already built. Block ingress only during the runtime switch.
  activate_maintenance
  # A partial shutdown is not safe to restart until durable settlement succeeds.
  runtime_touched=1
  stop_deployment_execution
  settle_deployment_execution
  if [ "$volume_cutover" -eq 1 ]; then
    compose stop --timeout 120 postgres-backup >/dev/null 2>&1 || true
    initialize_migration_target_volumes
    echo "Migrating legacy user data from the read-only source..."
    copy_and_verify_legacy_directory \
      "$migrate_user_data_from" "$(configured_user_volume)" user-data
    normalize_user_volume "$(configured_user_volume)"
    if [ -n "$migrate_backups_from" ]; then
      echo "Migrating legacy backups from the read-only source..."
      copy_and_verify_legacy_directory \
        "$migrate_backups_from" "$(configured_backup_volume)" backups
    fi
    begin_environment_update
    set_environment_key LINKSENSE_USER_DATA_VOLUME "$(configured_user_volume)"
    set_environment_key LINKSENSE_BACKUP_VOLUME "$(configured_backup_volume)"
    set_environment_key LINKSENSE_USER_DATA_ROOT /srv/linksense/users
    set_environment_key LINKSENSE_BACKUP_ROOT /backups
    commit_environment_file
    volume_migration_published=1
    environment_changed=1
    ensure_volume_guard "$(configured_user_volume)" user-data
    ensure_volume_guard "$(configured_backup_volume)" backups
    remove_volume_holds
    validate_production_volumes
    compose config --quiet
  fi
  create_postgres_backup
  if [ "$volume_cutover" -eq 1 ]; then
    migration_may_have_applied=1
    rewrite_legacy_capability_storage_paths
  fi
fi

echo "Starting production services..."
# The migrate service always runs both deploy and seed. Once it may start, the
# script can no longer prove that older images remain compatible with the
# database, even when the Git migration directory itself is unchanged.
migration_may_have_applied=1
if [ "$fresh_install" -eq 1 ]; then
  compose up -d --wait --wait-timeout "$health_wait_seconds" --remove-orphans \
    --force-recreate migrate runner-worker-image runner api web gateway postgres-backup
else
  # Keep the existing Gateway container and its /tmp maintenance marker alive
  # throughout the replacement. Once Web/API are healthy, reload the current
  # template so Nginx refreshes the upstream endpoints without closing port 80.
  compose up -d --wait --wait-timeout "$health_wait_seconds" --remove-orphans \
    --force-recreate migrate runner-worker-image runner api web postgres-backup
  reload_gateway_configuration
fi
verify_release

commit_deployment_metadata

release_committed=1
if [ "$maintenance_active" -eq 1 ]; then
  deactivate_maintenance
fi
deployment_succeeded=1
runtime_touched=0
echo "LinkSense production deployment completed"
echo "Revision: $target_revision"
echo "Image tag: $image_tag"
if [ "$volume_migration_published" -eq 1 ]; then
  echo "User data was cut over to volume $(configured_user_volume)."
  echo "Legacy source was retained unchanged at $migrate_user_data_from."
fi
