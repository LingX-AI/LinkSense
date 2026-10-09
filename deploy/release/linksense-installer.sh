#!/bin/sh
set -eu
. "$(dirname "$0")/linksense-host.sh"

EDITION=${LINKSENSE_INSTALL_EDITION:-}
ACTION=${LINKSENSE_INSTALL_ACTION:-}
REQUESTED_HTTP_PORT=${LINKSENSE_HTTP_PORT:-}
REQUESTED_CPU_QUOTA_MODE=${LINKSENSE_CPU_QUOTA_MODE:-}
HTTP_PORT=${REQUESTED_HTTP_PORT:-18081}
ELASTICSEARCH_ROOT_USERNAME=elastic
REQUIRED_DOCKER_API=1.45
REQUIRED_COMPOSE_VERSION=2.24.4
DEFAULT_RELEASE_ORIGIN=https://github.com/LingX-AI/linksense/releases
RELEASE_SELECTOR=${LINKSENSE_VERSION:-latest}
LAST_STAGE=bootstrap
DIAGNOSTICS_READY=false
UPGRADE_RUNTIME_STOPPED=false
UPGRADE_CONFIG_CHANGED=false
UPGRADE_MIGRATION_STARTED=false
UPGRADE_PENDING_EXISTED=false
UPGRADE_BACKUP_URI=
UPGRADE_PREVIOUS_DIR=
UPGRADE_PREVIOUS_TOKENIZER_REVISION=
RELEASE_RESOURCE_BASE=

HOST_OS=$(uname -s)
HOST_ARCHITECTURE=$(uname -m)
INSTALL_OWNER_UID=$(id -u)
case "$HOST_OS:$HOST_ARCHITECTURE" in
  Linux:x86_64|Linux:amd64)
    LINKSENSE_PLATFORM=linux-amd64
    DEFAULT_INSTALL_DIR=/opt/linksense
    ;;
  Linux:aarch64|Linux:arm64)
    LINKSENSE_PLATFORM=linux-arm64
    DEFAULT_INSTALL_DIR=/opt/linksense
    ;;
  Darwin:x86_64|Darwin:amd64)
    LINKSENSE_PLATFORM=linux-amd64
    DEFAULT_INSTALL_DIR=${HOME:?HOME is required on macOS}/.linksense
    ;;
  Darwin:arm64|Darwin:aarch64)
    LINKSENSE_PLATFORM=linux-arm64
    DEFAULT_INSTALL_DIR=${HOME:?HOME is required on macOS}/.linksense
    ;;
  Linux:*)
    printf 'Unsupported Linux CPU architecture: %s. LinkSense supports x86_64 and ARM64.\n' "$HOST_ARCHITECTURE" >&2
    exit 64
    ;;
  Darwin:*)
    printf 'Unsupported macOS CPU architecture: %s. LinkSense supports Intel and Apple silicon.\n' "$HOST_ARCHITECTURE" >&2
    exit 64
    ;;
  *)
    printf 'Unsupported host operating system: %s. LinkSense supports Linux and macOS with Docker Desktop.\n' "$HOST_OS" >&2
    exit 64
    ;;
esac
INSTALL_DIR=${LINKSENSE_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}

if [ "$ACTION" = upgrade ] && [ -z "$EDITION" ]; then
  upgrade_identity_file=$INSTALL_DIR/install-state.env
  [ -f "$upgrade_identity_file" ] && [ ! -L "$upgrade_identity_file" ] || {
    printf 'No trusted LinkSense installation exists at %s.\n' "$upgrade_identity_file" >&2
    exit 1
  }
  EDITION=$(awk -F= '$1 == "STATE_EDITION" { print $2; exit }' "$upgrade_identity_file")
fi

case "$EDITION:$ACTION" in
  core:install|full:install|core:repair|full:repair|core:upgrade|full:upgrade) ;;
  *) printf '%s\n' "Invalid installer entry point." >&2; exit 64 ;;
esac
PROGRAM="LinkSense $EDITION $ACTION"

if [ "$HOST_OS" = Linux ] && [ "$INSTALL_OWNER_UID" -ne 0 ]; then
  printf '%s\n' "Please run this script as root (for example: curl ... | sudo sh)." >&2
  exit 77
fi
if [ "$HOST_OS" = Darwin ] && [ "$INSTALL_OWNER_UID" -eq 0 ]; then
  printf '%s\n' "Run this script from your macOS account without sudo so Docker Desktop uses your active user context." >&2
  exit 77
fi

TMP_ROOT=""
cleanup() {
  host_unlock_installation
  if [ -n "${HOST_PROBE_ID:-}" ]; then docker rm -f "$HOST_PROBE_ID" >/dev/null 2>&1 || true; fi
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
    rm -r "$TMP_ROOT"
  fi
}

check_release_storage() {
  disk_gib=20
  inode_reserve=100000
  if [ "$EDITION" = full ]; then disk_gib=60; inode_reserve=200000; fi
  cached_images=true
  for disk_image in "$IMAGE_LINKSENSE_API" "$IMAGE_LINKSENSE_WEB" "$IMAGE_LINKSENSE_MIGRATE" "$IMAGE_LINKSENSE_RUNNER" "$IMAGE_LINKSENSE_WORKER" "$IMAGE_POSTGRES" "$IMAGE_REDIS" "$IMAGE_MINIO" "$IMAGE_MINIO_CLIENT" "$IMAGE_BUSYBOX" "$IMAGE_GATEWAY"; do
    docker image inspect "$disk_image" >/dev/null 2>&1 || cached_images=false
  done
  if [ "$EDITION" = full ]; then
    docker image inspect "$IMAGE_DOCLING" >/dev/null 2>&1 || cached_images=false
    docker image inspect "$IMAGE_ELASTICSEARCH" >/dev/null 2>&1 || cached_images=false
  fi
  if [ "$cached_images" = true ]; then disk_gib=2; inode_reserve=10000; fi
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  if [ "$HOST_OS" = Linux ] && [ -d "$docker_root" ]; then
    host_storage "$docker_root" "$((disk_gib * 1024 * 1024))" "$inode_reserve"
    if [ -d /var/lib/containerd ]; then host_storage /var/lib/containerd "$((disk_gib * 1024 * 1024))" "$inode_reserve"; fi
  else
    pull_image "$IMAGE_BUSYBOX"
    disk_stats=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --memory 64m --pids-limit 16 "$IMAGE_BUSYBOX" sh -ec 'df -Pk /; df -Pi /') || host_fail storage Docker_VM
    disk_free_kb=$(printf '%s\n' "$disk_stats" | awk 'NR == 2 {print $4}')
    disk_free_inodes=$(printf '%s\n' "$disk_stats" | awk 'NR == 4 {print $4}')
    printf '%s' "$disk_free_kb" | grep -Eq '^[0-9]+$' || host_fail storage Docker_VM_space_unknown
    [ "$disk_free_kb" -ge "$((disk_gib * 1024 * 1024))" ] || host_fail storage "Docker_VM available_kib=$disk_free_kb required_gib=$disk_gib"
    case "$disk_free_inodes" in ''|-|*[!0-9]*) ;; *) [ "$disk_free_inodes" -ge "$inode_reserve" ] || host_fail storage "Docker_VM available_inodes=$disk_free_inodes required_inodes=$inode_reserve" ;; esac
  fi
}

probe_host_runtime() {
  host_capabilities
  probe_cpu=1
  [ "${LINKSENSE_CPU_QUOTA_MODE:-strict}" != compatible ] || probe_cpu=0
  HOST_PROBE_ID=$(docker create --label com.linksense.host-probe=true --network none \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 128m --memory-swap 128m --pids-limit 32 --cpus "$probe_cpu" \
    -e "PROBE_CPU=$probe_cpu" \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m "$IMAGE_BUSYBOX" sh -ec '
      ! touch /linksense-readonly-probe 2>/dev/null
      echo test >/tmp/linksense-probe
      grep -Eq "^NoNewPrivs:[[:space:]]*1$" /proc/self/status
      for probe_cap in CapInh CapPrm CapEff CapBnd CapAmb; do grep -Eq "^$probe_cap:[[:space:]]*0+$" /proc/self/status; done
      test "$(ls /sys/class/net)" = lo
      if [ -f /sys/fs/cgroup/memory.max ]; then
        test "$(cat /sys/fs/cgroup/memory.max)" = 134217728
        test "$(cat /sys/fs/cgroup/pids.max)" = 32
        if [ -f /sys/fs/cgroup/memory.swap.max ]; then test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0
        else test "$(wc -l </proc/swaps)" -le 1; fi
        if [ "$PROBE_CPU" = 1 ]; then test "$(cat /sys/fs/cgroup/cpu.max)" = "100000 100000"; fi
      else
        test "$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)" = 134217728
        test "$(cat /sys/fs/cgroup/pids/pids.max)" = 32
        if [ -f /sys/fs/cgroup/memory/memory.memsw.limit_in_bytes ]; then test "$(cat /sys/fs/cgroup/memory/memory.memsw.limit_in_bytes)" = 134217728
        else test "$(wc -l </proc/swaps)" -le 1; fi
        if [ "$PROBE_CPU" = 1 ]; then
          test "$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)" = 100000
          test "$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)" = 100000
        fi
      fi
      cat /proc/sys/vm/max_map_count
    ' 2>"$TMP_ROOT/host-probe.log") || host_fail probe create
  if ! host_bounded 30 "$DOCKER_CLI" start --attach "$HOST_PROBE_ID" >"$TMP_ROOT/host-probe.out" 2>"$TMP_ROOT/host-probe.log"; then host_fail probe runtime; fi
  probe_map_count=$(cat "$TMP_ROOT/host-probe.out")
  docker rm "$HOST_PROBE_ID" >/dev/null
  HOST_PROBE_ID=
  if [ "$EDITION" = full ]; then
    printf '%s' "$probe_map_count" | grep -Eq '^[0-9]+$' || host_fail sysctl unknown
    if [ "$probe_map_count" -lt 262144 ]; then
      if [ "$HOST_OS" != Linux ] || [ "$(id -u)" != 0 ]; then host_fail sysctl "current=$probe_map_count"; fi
      sysctl_file=/etc/sysctl.d/90-linksense.conf
      [ ! -L "$sysctl_file" ] || host_fail sysctl symlink
      if [ -f "$sysctl_file" ]; then grep -Fx '# LinkSense managed vm.max_map_count' "$sysctl_file" >/dev/null || host_fail sysctl existing_unmanaged_file; fi
      sysctl -w vm.max_map_count=262144 >/dev/null 2>&1 || host_fail sysctl "current=$probe_map_count"
      install -d -m 0755 /etc/sysctl.d
      printf '%s\n' '# LinkSense managed vm.max_map_count' 'vm.max_map_count=262144' > "$TMP_ROOT/linksense-sysctl.conf"
      install -m 0644 "$TMP_ROOT/linksense-sysctl.conf" "$sysctl_file"
    fi
  fi
}

compose_bounded() {
  compose_seconds=$1
  shift
  if [ -n "$COMPOSE_CLI" ]; then
    host_bounded "$compose_seconds" "$COMPOSE_CLI" --project-directory "$INSTALL_DIR" --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.common.yml" -f "$INSTALL_DIR/compose.$EDITION.yml" "$@"
  else
    host_bounded "$compose_seconds" "$DOCKER_CLI" compose --project-directory "$INSTALL_DIR" --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.common.yml" -f "$INSTALL_DIR/compose.$EDITION.yml" "$@"
  fi
}

service_snapshot() {
  host_service_snapshot
}

verify_service_stability() {
  service_snapshot > "$TMP_ROOT/services.before"
  stability_deadline=$(($(date +%s) + 30))
  while [ "$(date +%s)" -lt "$stability_deadline" ]; do
    sleep 5
    service_snapshot > "$TMP_ROOT/services.after"
    cmp -s "$TMP_ROOT/services.before" "$TMP_ROOT/services.after" || host_fail stability container_state_changed
  done
}

restore_pre_migration_upgrade() {
  [ "$ACTION" = upgrade ] || return 0
  [ "$UPGRADE_RUNTIME_STOPPED" = true ] || return 0
  [ "$UPGRADE_MIGRATION_STARTED" = false ] || return 0
  [ "$UPGRADE_PENDING_EXISTED" = false ] || return 0
  if [ "$UPGRADE_CONFIG_CHANGED" = true ] && [ -n "$UPGRADE_PREVIOUS_DIR" ]; then
    for previous_file in .env LICENSE LICENSE-EXCEPTIONS.md ATTRIBUTION.md TRADEMARK.md NOTICE THIRD-PARTY-NOTICES.md compose.common.yml "compose.$EDITION.yml" gateway.conf.template release-manifest.env release-manifest.env.sha256; do
      if [ -f "$UPGRADE_PREVIOUS_DIR/$previous_file" ]; then
        cp -p "$UPGRADE_PREVIOUS_DIR/$previous_file" "$INSTALL_DIR/$previous_file"
      else
        case "$previous_file" in
          LICENSE-EXCEPTIONS.md|ATTRIBUTION.md|TRADEMARK.md|NOTICE|THIRD-PARTY-NOTICES.md)
            rm -f "$INSTALL_DIR/$previous_file"
            ;;
        esac
      fi
    done
    if [ "$EDITION" = full ] && [ -n "$UPGRADE_PREVIOUS_TOKENIZER_REVISION" ]; then
      docker run --rm --network none \
        -v linksense-tokenizer:/tokenizer \
        "$BUSYBOX_IMAGE" sh -ec '
          test -d "/tokenizer/releases/$1"
          ln -sfn "releases/$1" /tokenizer/.previous
          mv -Tf /tokenizer/.previous /tokenizer/current
        ' sh "$UPGRADE_PREVIOUS_TOKENIZER_REVISION" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$INSTALL_DIR/upgrade.pending"
  compose up -d --remove-orphans >/dev/null 2>&1 || true
  if [ -n "$UPGRADE_BACKUP_URI" ]; then
    printf 'The validated database backup remains at %s\n' "$UPGRADE_BACKUP_URI" >&2
  fi
  printf '%s\n' "The previous LinkSense configuration was restored because database migration had not started." >&2
}

on_exit() {
  status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ]; then
    restore_pre_migration_upgrade
    printf 'FAILED: %s stopped during stage: %s\n' "$PROGRAM" "$LAST_STAGE" >&2
    if [ "$ACTION" = upgrade ] && [ "$UPGRADE_MIGRATION_STARTED" = true ]; then
      printf '%s\n' \
        "Database migration may have started, so LinkSense did not automatically roll back images or the database." \
        "The validated backup and upgrade.pending state were preserved. Run upgrade.sh again after reviewing diagnostics." >&2
      [ -z "$UPGRADE_BACKUP_URI" ] || printf 'Backup: %s\n' "$UPGRADE_BACKUP_URI" >&2
    fi
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

file_owner_uid() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1" 2>/dev/null
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

verify_private_file() {
  file=$1
  label=$2
  [ -f "$file" ] && [ ! -L "$file" ] || fail "$label is missing or is not a regular file: $file"
  owner=$(file_owner_uid "$file" || true)
  mode=$(file_mode "$file" || true)
  [ "$owner" = "$INSTALL_OWNER_UID" ] || fail "$label must be owned by the LinkSense installation user: $file"
  [ "$mode" = 600 ] || fail "$label must have mode 0600: $file"
}

validate_http_port() {
  port=$1
  printf '%s' "$port" | grep -Eq '^[1-9][0-9]{0,4}$' || fail "LINKSENSE_HTTP_PORT must be an integer between 1 and 65535."
  [ "$port" -le 65535 ] || fail "LINKSENSE_HTTP_PORT must be an integer between 1 and 65535."
}

resolve_http_port() {
  installed_port=
  state_file=$INSTALL_DIR/install-state.env
  if [ -e "$state_file" ] || [ -L "$state_file" ]; then
    verify_private_file "$state_file" "The installation state"
    installed_port=$(awk -F= '$1 == "STATE_HTTP_PORT" { print $2; exit }' "$state_file")
  elif [ -f "$INSTALL_DIR/install.pending" ] && [ -e "$INSTALL_DIR/.env" ]; then
    verify_private_file "$INSTALL_DIR/install.pending" "The interrupted installation state"
    verify_private_file "$INSTALL_DIR/.env" "The protected environment file"
    installed_port=$(awk -F= '$1 == "LINKSENSE_HTTP_PORT" { print $2; exit }' "$INSTALL_DIR/.env")
  fi

  if [ -n "$installed_port" ]; then
    validate_http_port "$installed_port"
    if [ -n "$REQUESTED_HTTP_PORT" ] && [ "$REQUESTED_HTTP_PORT" != "$installed_port" ]; then
      fail "This installation already uses TCP $installed_port. Changing the port requires a dedicated port migration instead of an install, repair, or upgrade run."
    fi
    HTTP_PORT=$installed_port
  fi
  validate_http_port "$HTTP_PORT"
}

log() {
  printf '%s\n' "[$PROGRAM] $*"
}

log_stage() {
  LAST_STAGE=$1
  log "$LAST_STAGE"
}

print_initialization_credential() {
  highlight=
  credential_highlight=
  reset=
  if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ]; then
    highlight=$(printf '\033[1;33m')
    credential_highlight=$(printf '\033[1;36m')
    reset=$(printf '\033[0m')
  fi
  divider='========================================================================'
  printf '\n%s%s%s\n' "$highlight" "$divider" "$reset"
  printf '%s%s%s\n' "$highlight" '  ACTION REQUIRED: SAVE YOUR INITIALIZATION CREDENTIAL NOW' "$reset"
  printf '%s%s%s\n\n' "$highlight" "$divider" "$reset"
  printf 'LinkSense is ready at: %s\n\n' "$LINKSENSE_PUBLIC_BASE_URL"
  printf '%s\n' 'Copy and securely save the credential below before continuing:'
  printf '%s%s%s\n\n' "$credential_highlight" "$LINKSENSE_INITIALIZATION_TOKEN" "$reset"
  printf '%s\n' \
    'You need this credential to create the first administrator.' \
    'Do not share it. Future repair runs will not display it again.' \
    'It becomes unusable after the first administrator is initialized.'
  printf '%s%s%s\n' "$highlight" "$divider" "$reset"
}

version_ge() {
  current=${1#v}
  required=${2#v}
  awk -v current="$current" -v required="$required" 'BEGIN {
    current_parts = split(current, current_values, ".")
    required_parts = split(required, required_values, ".")
    parts = current_parts > required_parts ? current_parts : required_parts
    for (position = 1; position <= parts; position += 1) {
      current_value = (current_values[position] == "" ? 0 : current_values[position]) + 0
      required_value = (required_values[position] == "" ? 0 : required_values[position]) + 0
      if (current_value > required_value) exit 0
      if (current_value < required_value) exit 1
    }
    exit 0
  }'
}

docker_help() {
  if [ "$HOST_OS" = Darwin ]; then
    printf '%s\n' \
      "Install or update Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/" \
      "Open Docker Desktop and wait until the Docker Engine is running."
    return
  fi
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
}

resolve_cpu_mode() {
  CPU_MODE_CHANGED=false
  HOST_CPU_QUOTA_MODE=${REQUESTED_CPU_QUOTA_MODE:-strict}
  if [ -f "$INSTALL_DIR/install-state.env" ] || [ -f "$INSTALL_DIR/install.pending" ]; then
    verify_private_file "$INSTALL_DIR/.env" "The protected environment file"
    installed_cpu_mode=$(awk -F= '$1 == "LINKSENSE_CPU_QUOTA_MODE" {print $2}' "$INSTALL_DIR/.env")
    installed_cpu_mode=${installed_cpu_mode:-strict}
    if [ -n "$REQUESTED_CPU_QUOTA_MODE" ] && [ "$REQUESTED_CPU_QUOTA_MODE" != "$installed_cpu_mode" ]; then CPU_MODE_CHANGED=true; fi
    if [ -n "$REQUESTED_CPU_QUOTA_MODE" ] && [ "$REQUESTED_CPU_QUOTA_MODE" != "$installed_cpu_mode" ] && [ "$ACTION" != upgrade ]; then
      host_fail invalid_config CPU_mode_change_requires_upgrade
    fi
    HOST_CPU_QUOTA_MODE=${REQUESTED_CPU_QUOTA_MODE:-$installed_cpu_mode}
  fi
  LINKSENSE_CPU_QUOTA_MODE=$HOST_CPU_QUOTA_MODE
  host_cpu_mode
}

select_available_port() {
  if [ "$ACTION" = install ] && [ -z "$REQUESTED_HTTP_PORT" ] && [ -z "${LINKSENSE_PUBLIC_BASE_URL:-}" ] && [ ! -d "$INSTALL_DIR" ]; then
    original_port=$HTTP_PORT
    while ! (trap - EXIT HUP INT TERM; check_port) >/dev/null 2>&1; do
      HTTP_PORT=$((HTTP_PORT + 1))
      [ "$HTTP_PORT" -lt "$((original_port + 20))" ] || { HTTP_PORT=$original_port; check_port; }
    done
    [ "$HTTP_PORT" = "$original_port" ] || host_text port "$HTTP_PORT"
  else
    check_port
  fi
}

check_port() {
  own_container=false
  occupied_container=$(docker ps --filter "publish=$HTTP_PORT" --format '{{.ID}} {{.Names}}' | head -n 1 || true)
  if [ -n "$occupied_container" ]; then
    container_id=$(printf '%s' "$occupied_container" | awk '{print $1}')
    project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null || true)
    if { [ "$ACTION" = repair ] || [ "$ACTION" = upgrade ] || [ -f "$INSTALL_DIR/install.pending" ] || [ -f "$INSTALL_DIR/install-state.env" ]; } && [ "$project" = linksense ]; then
      own_container=true
    else
      fail "TCP $HTTP_PORT is published by another container: $occupied_container. Stop or reconfigure it manually, then retry."
    fi
  fi

  if command -v ss >/dev/null 2>&1; then
    listener=$(ss -ltnp 2>/dev/null | awk -v port=":$HTTP_PORT" '$4 ~ port "$" { print; exit }')
  elif command -v lsof >/dev/null 2>&1; then
    listener=$(lsof -nP -iTCP:"$HTTP_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 { print; exit }')
  elif command -v netstat >/dev/null 2>&1; then
    listener=$(netstat -ltnp 2>/dev/null | awk -v port=":$HTTP_PORT" '$4 ~ port "$" { print; exit }')
  else
    port_hex=$(printf '%04X' "$HTTP_PORT")
    listener=$(awk -v port=":$port_hex" '$2 ~ port "$" && $4 == "0A" { print; exit }' /proc/net/tcp /proc/net/tcp6 2>/dev/null || true)
  fi
  if [ -n "${listener:-}" ] && [ "$own_container" != true ]; then
    fail "TCP $HTTP_PORT is already in use: $listener"
  fi
}

preflight() {
  if [ "$HOST_OS" = Linux ]; then
    read_os_release
  else
    OS_ID=macos
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is required. Install it with your operating system package manager."
  host_prepare_tools

  if ! docker info >/dev/null 2>&1; then
    if [ "$HOST_OS" = Darwin ]; then
      docker_help >&2
      fail "Docker Desktop is stopped or the current macOS account cannot access its Docker context."
    else
      printf '%s\n' \
        "Start Docker: sudo systemctl enable --now docker" \
        "If Docker is running but access is denied: sudo usermod -aG docker \"${SUDO_USER:-${USER:-root}}\"" \
        "Log out and back in after changing group membership." >&2
      fail "Docker daemon is stopped or the current identity cannot access it."
    fi
  fi

  docker_os=$(docker info --format '{{.OSType}}' 2>/dev/null || true)
  [ "$docker_os" = linux ] || fail "The active Docker context must run Linux containers."
  docker_architecture=$(docker info --format '{{.Architecture}}' 2>/dev/null || true)
  case "$docker_architecture" in
    x86_64|amd64) docker_platform=linux-amd64 ;;
    aarch64|arm64) docker_platform=linux-arm64 ;;
    *) fail "The active Docker Engine reports an unsupported CPU architecture: ${docker_architecture:-unknown}." ;;
  esac
  [ "$docker_platform" = "$LINKSENSE_PLATFORM" ] || fail "The active Docker Engine platform is $docker_platform, but this host requires $LINKSENSE_PLATFORM."

  api_version=$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null || true)
  [ -n "$api_version" ] || fail "Could not read the Docker Engine API version."
  version_ge "$api_version" "$REQUIRED_DOCKER_API" || {
    docker_help >&2
    fail "Docker Engine API $api_version is too old; API $REQUIRED_DOCKER_API or newer is required."
  }

  compose_version=$(host_compose version --short 2>/dev/null | sed 's/^v//' || true)
  [ -n "$compose_version" ] || {
    docker_help >&2
    fail "Docker Compose V2 is not installed."
  }
  version_ge "$compose_version" "$REQUIRED_COMPOSE_VERSION" || {
    docker_help >&2
    fail "Docker Compose $compose_version is too old; $REQUIRED_COMPOSE_VERSION or newer is required."
  }

  docker_endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}
  case "$docker_endpoint" in
    unix://*) docker_cli_socket=${docker_endpoint#unix://} ;;
    *) fail "The active Docker context must use a local Unix socket; remote Docker contexts are not supported by the one-line installer." ;;
  esac
  [ -S "$docker_cli_socket" ] || fail "The active Docker socket is unavailable: $docker_cli_socket"
  if [ "$HOST_OS" = Darwin ]; then
    # Docker Desktop evaluates bind sources inside its Linux VM, where the
    # Engine socket remains /var/run/docker.sock even when the macOS CLI uses
    # the per-user ~/.docker/run/docker.sock endpoint.
    LINKSENSE_DOCKER_SOCKET_SOURCE=/var/run/docker.sock
  else
    LINKSENSE_DOCKER_SOCKET_SOURCE=$docker_cli_socket
  fi
  LINKSENSE_DOCKER_SOCKET_PATH=/var/run/docker.sock

  memory_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)
  printf '%s' "$memory_bytes" | grep -Eq '^[1-9][0-9]*$' || fail "Could not determine memory available to the Docker Engine."
  memory_kb=$((memory_bytes / 1024))
  if [ "$EDITION" = full ]; then
    required_memory_kb=$((10 * 1024 * 1024))
    if [ ! -f "$INSTALL_DIR/install-state.env" ] && [ ! -f "$INSTALL_DIR/install.pending" ]; then required_memory_kb=$((24 * 1024 * 1024)); fi
  else
    required_memory_kb=$((8 * 1024 * 1024))
  fi
  if [ "$memory_kb" -lt "$required_memory_kb" ]; then
    memory_gib=$(awk -v bytes="$memory_bytes" 'BEGIN { printf "%.2f", bytes / 1024 / 1024 / 1024 }')
    required_memory_gib=$((required_memory_kb / 1024 / 1024))
    if [ "$HOST_OS" = Darwin ]; then
      memory_help="Open Docker Desktop > Settings > Resources > Advanced > Memory limit, increase the VM allocation above ${required_memory_gib} GiB to allow for VM overhead, then apply the changes and restart Docker Desktop."
    else
      memory_help="Increase the memory available to the Docker Engine host or its virtual machine above ${required_memory_gib} GiB, then restart Docker if its allocation changed."
    fi
    fail "Insufficient Docker Engine memory: ${memory_gib} GiB (${memory_kb} KiB) available; $EDITION requires at least ${required_memory_gib} GiB (${required_memory_kb} KiB).
This checks memory available to Docker Engine, not the host's physical memory when Docker runs in a virtual machine.
$memory_help
Verify the new allocation with: docker info --format '{{.MemTotal}}' (bytes), then retry the installer."
  fi
  host_capabilities
  select_available_port
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

download() {
  host_download "$@"
}

verify_file() {
  file=$1
  expected=$2
  actual=$(sha256_file "$file")
  [ "$actual" = "$expected" ] || fail "Checksum mismatch for $(basename "$file"): expected $expected, got $actual."
}

download_verified() {
  verified_url=$1
  verified_target=$2
  verified_sha=$3
  verified_cache=$TMP_ROOT/cache
  if [ -f "$INSTALL_DIR/install.pending" ] || [ -f "$INSTALL_DIR/install-state.env" ]; then
    verified_cache=$INSTALL_DIR/cache
  fi
  [ ! -L "$verified_cache" ] || host_fail invalid_config cache_symlink
  mkdir -p "$verified_cache"
  chmod 0700 "$verified_cache"
  verified_entry=$verified_cache/$verified_sha
  [ ! -L "$verified_entry" ] && [ ! -L "$verified_entry.part" ] || host_fail invalid_config cache_entry_symlink
  if [ ! -f "$verified_entry" ] || [ "$(sha256_file "$verified_entry")" != "$verified_sha" ]; then
    host_download "$verified_url" "$verified_entry" resume
    verify_file "$verified_entry" "$verified_sha"
  fi
  cp "$verified_entry" "$verified_target"
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
      manifest:MANIFEST_FORMAT|manifest:RESOURCE_HOST_ADAPTATION_FORMAT|manifest:RELEASE_VERSION|manifest:RELEASE_EDITION_SUPPORT|manifest:RELEASE_PLATFORMS|manifest:RELEASE_GIT_COMMIT|manifest:RELEASE_BUILD_TIME|manifest:RELEASE_WORKFLOW_ID|manifest:RELEASE_ASSET_BASE_URL|manifest:MIN_DOCKER_API|manifest:MIN_DOCKER_COMPOSE|manifest:CORE_MIN_MEMORY_GIB|manifest:CORE_MIN_DISK_GIB|manifest:CORE_MIN_FREE_INODES|manifest:FULL_MIN_MEMORY_GIB|manifest:FULL_MIN_DISK_GIB|manifest:FULL_MIN_FREE_INODES|manifest:IMAGE_*|manifest:RESOURCE_*|manifest:TOKENIZER_*) ;;
      runtime:LINKSENSE_ELASTICSEARCH_MEMORY_MB) ;;
      runtime:LINKSENSE_CPU_QUOTA_MODE|runtime:LINKSENSE_API_MEMORY_MB|runtime:LINKSENSE_API_NODE_OPTIONS|runtime:LINKSENSE_RUNNER_MEMORY_MB|runtime:LINKSENSE_RUNNER_NODE_OPTIONS|runtime:LINKSENSE_POSTGRES_MEMORY_MB|runtime:LINKSENSE_REDIS_MEMORY_MB|runtime:LINKSENSE_MINIO_MEMORY_MB|runtime:LINKSENSE_KB_PARSING_CONCURRENCY|runtime:LINKSENSE_KB_CHUNKING_CONCURRENCY|runtime:LINKSENSE_KB_PARENTING_CONCURRENCY|runtime:LINKSENSE_KB_EMBEDDING_CONCURRENCY|runtime:LINKSENSE_KB_INDEXING_CONCURRENCY|runtime:LINKSENSE_KB_ACTIVATION_CONCURRENCY|runtime:LINKSENSE_DOCLING_API_CPUS|runtime:LINKSENSE_DOCLING_WORKER_CPUS) ;;
      state:STATE_*) ;;
      upgrade:UPGRADE_*) ;;
      runtime:COMPOSE_PROJECT_NAME|runtime:LINKSENSE_EDITION|runtime:LINKSENSE_VERSION|runtime:LINKSENSE_PLATFORM|runtime:LINKSENSE_DOCKER_SOCKET_SOURCE|runtime:LINKSENSE_DOCKER_SOCKET_PATH|runtime:LINKSENSE_PUBLIC_BASE_URL|runtime:LINKSENSE_PUBLIC_SCHEME|runtime:LINKSENSE_HTTP_PORT|runtime:POSTGRES_DB|runtime:POSTGRES_USER|runtime:POSTGRES_PASSWORD|runtime:DATABASE_URL|runtime:REDIS_PASSWORD|runtime:REDIS_URL|runtime:DOCLING_REDIS_URL|runtime:LINKSENSE_JWT_SECRET|runtime:LINKSENSE_INITIALIZATION_TOKEN|runtime:LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET|runtime:LINKSENSE_CREDENTIAL_MASTER_KEY|runtime:LINKSENSE_CREDENTIAL_KEY_ID|runtime:LINKSENSE_RUNNER_SHARED_SECRET|runtime:MINIO_ROOT_USER|runtime:MINIO_ROOT_PASSWORD|runtime:MINIO_ACCESS_KEY|runtime:MINIO_SECRET_KEY|runtime:MINIO_BUCKET|runtime:MINIO_KNOWLEDGE_BUCKET|runtime:MINIO_ENDPOINT|runtime:MINIO_PORT|runtime:MINIO_USE_SSL|runtime:MINIO_PUBLIC_URL|runtime:MINIO_REGION|runtime:LINKSENSE_MAX_CONCURRENT_CONVERSATIONS|runtime:LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT|runtime:LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_IDLE_TTL_SECONDS|runtime:LINKSENSE_WORKER_READY_TIMEOUT_SECONDS|runtime:LINKSENSE_WORKER_MEMORY_MB|runtime:LINKSENSE_WORKER_CPUS|runtime:LINKSENSE_WORKER_PIDS_LIMIT|runtime:LINKSENSE_WORKER_TMPFS_MB|runtime:LINKSENSE_WORKER_SHM_MB|runtime:LINKSENSE_BROWSER_SESSION_LIMIT|runtime:LINKSENSE_API_IMAGE|runtime:LINKSENSE_WEB_IMAGE|runtime:LINKSENSE_MIGRATE_IMAGE|runtime:LINKSENSE_RUNNER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE|runtime:LINKSENSE_WORKER_IMAGE_REVISION|runtime:POSTGRES_IMAGE|runtime:REDIS_IMAGE|runtime:MINIO_IMAGE|runtime:MINIO_CLIENT_IMAGE|runtime:BUSYBOX_IMAGE|runtime:GATEWAY_IMAGE|runtime:ELASTICSEARCH_IMAGE|runtime:DOCLING_IMAGE|runtime:LINKSENSE_POSTGRES_VOLUME|runtime:LINKSENSE_REDIS_VOLUME|runtime:LINKSENSE_MINIO_VOLUME|runtime:LINKSENSE_USER_DATA_VOLUME|runtime:LINKSENSE_BACKUP_VOLUME|runtime:LINKSENSE_ELASTICSEARCH_VOLUME|runtime:LINKSENSE_TOKENIZER_VOLUME|runtime:LINKSENSE_INTERNAL_NETWORK|runtime:LINKSENSE_WORKER_CONTROL_NETWORK|runtime:LINKSENSE_WORKER_EGRESS_NETWORK|runtime:LINKSENSE_KNOWLEDGE_NETWORK|runtime:ELASTICSEARCH_ROOT_PASSWORD|runtime:ELASTICSEARCH_USERNAME|runtime:ELASTICSEARCH_PASSWORD|runtime:DOCLING_SERVE_API_KEY|runtime:LINKSENSE_KB_HYBRID_TOKENIZER|runtime:LINKSENSE_TOKENIZER_MOUNT_PATH) ;;
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
  unset RESOURCE_HOST_ADAPTATION_FORMAT RESOURCE_FULL_FRESH_MIN_MEMORY_GIB
  load_strict_env "$manifest" manifest
  require_loaded_keys MANIFEST_FORMAT RELEASE_VERSION RELEASE_EDITION_SUPPORT RELEASE_PLATFORMS RELEASE_ASSET_BASE_URL
  [ "${MANIFEST_FORMAT:-}" = 2 ] || fail "Unsupported release manifest format."
  case "${RESOURCE_HOST_ADAPTATION_FORMAT:-0}" in 0|1) ;; *) host_fail invalid_config RESOURCE_HOST_ADAPTATION_FORMAT ;; esac
  printf '%s' "${RELEASE_VERSION:-}" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "The release manifest version is invalid."
  [ "${RELEASE_EDITION_SUPPORT:-}" = core-full ] || fail "This manifest does not support Core and Full."
  [ "${RELEASE_PLATFORMS:-}" = linux-amd64,linux-arm64 ] || fail "This manifest does not contain the required amd64 and ARM64 platforms."
  case ",${RELEASE_PLATFORMS:-}," in
    *",$LINKSENSE_PLATFORM,"*) ;;
    *) fail "This release does not support $LINKSENSE_PLATFORM." ;;
  esac
  [ "${MIN_DOCKER_API:-}" = "$REQUIRED_DOCKER_API" ] || fail "The release manifest has an inconsistent Docker API requirement."
  [ "${MIN_DOCKER_COMPOSE:-}" = "$REQUIRED_COMPOSE_VERSION" ] || fail "The release manifest has an inconsistent Docker Compose requirement."
  [ "${CORE_MIN_MEMORY_GIB:-}" = 8 ] || fail "The release manifest has inconsistent Core host requirements."
  printf '%s' "${FULL_MIN_MEMORY_GIB:-}" | grep -Eq '^[1-9][0-9]{0,3}$' && [ "$FULL_MIN_MEMORY_GIB" -ge 10 ] || fail "The release manifest has invalid Full host requirements."
  if [ -n "${RESOURCE_FULL_FRESH_MIN_MEMORY_GIB:-}" ]; then
    printf '%s' "$RESOURCE_FULL_FRESH_MIN_MEMORY_GIB" | grep -Eq '^[1-9][0-9]{0,3}$' && [ "$RESOURCE_FULL_FRESH_MIN_MEMORY_GIB" -ge 24 ] || host_fail invalid_config RESOURCE_FULL_FRESH_MIN_MEMORY_GIB
  fi
  if [ "${LINKSENSE_CPU_QUOTA_MODE:-strict}" = compatible ] && [ "${RESOURCE_HOST_ADAPTATION_FORMAT:-}" != 1 ]; then
    host_fail invalid_config release_has_no_CPU_compatibility_support
  fi
  if [ "$EDITION" = full ] && [ ! -f "$INSTALL_DIR/install-state.env" ] && [ ! -f "$INSTALL_DIR/install.pending" ]; then
    manifest_memory_bytes=$(docker info --format '{{.MemTotal}}')
    manifest_fresh_memory_gib=${RESOURCE_FULL_FRESH_MIN_MEMORY_GIB:-$FULL_MIN_MEMORY_GIB}
    [ "$manifest_memory_bytes" -ge "$((manifest_fresh_memory_gib * 1024 * 1024 * 1024))" ] || fail "This release requires at least $manifest_fresh_memory_gib GiB of Docker Engine memory."
  fi
  for required_hash in RESOURCE_LICENSE_SHA256 RESOURCE_LICENSE_EXCEPTIONS_SHA256 RESOURCE_ATTRIBUTION_SHA256 RESOURCE_TRADEMARK_SHA256 RESOURCE_NOTICE_SHA256 RESOURCE_THIRD_PARTY_NOTICES_SHA256 RESOURCE_COMPOSE_COMMON_SHA256 RESOURCE_COMPOSE_CORE_SHA256 RESOURCE_COMPOSE_FULL_SHA256 RESOURCE_GATEWAY_SHA256 RESOURCE_CLI_SHA256 RESOURCE_INSTALLER_ENGINE_SHA256 RESOURCE_INSTALL_CORE_SHA256 RESOURCE_INSTALL_FULL_SHA256 RESOURCE_REPAIR_CORE_SHA256 RESOURCE_REPAIR_FULL_SHA256 RESOURCE_UPGRADE_SHA256; do
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
  RELEASE_RESOURCE_BASE=$base
  stage=$TMP_ROOT/resources
  mkdir "$stage"
  for resource in LICENSE LICENSE-EXCEPTIONS.md ATTRIBUTION.md TRADEMARK.md NOTICE THIRD-PARTY-NOTICES.md compose.common.yml "compose.$EDITION.yml" gateway.conf.template linksense-cli.sh "repair-$EDITION.sh" upgrade.sh; do
    case "$resource" in
      LICENSE) expected=$RESOURCE_LICENSE_SHA256 ;;
      LICENSE-EXCEPTIONS.md) expected=$RESOURCE_LICENSE_EXCEPTIONS_SHA256 ;;
      ATTRIBUTION.md) expected=$RESOURCE_ATTRIBUTION_SHA256 ;;
      TRADEMARK.md) expected=$RESOURCE_TRADEMARK_SHA256 ;;
      NOTICE) expected=$RESOURCE_NOTICE_SHA256 ;;
      THIRD-PARTY-NOTICES.md) expected=$RESOURCE_THIRD_PARTY_NOTICES_SHA256 ;;
      compose.common.yml) expected=$RESOURCE_COMPOSE_COMMON_SHA256 ;;
      compose.core.yml) expected=$RESOURCE_COMPOSE_CORE_SHA256 ;;
      compose.full.yml) expected=$RESOURCE_COMPOSE_FULL_SHA256 ;;
      gateway.conf.template) expected=$RESOURCE_GATEWAY_SHA256 ;;
      linksense-cli.sh) expected=$RESOURCE_CLI_SHA256 ;;
      repair-core.sh) expected=$RESOURCE_REPAIR_CORE_SHA256 ;;
      repair-full.sh) expected=$RESOURCE_REPAIR_FULL_SHA256 ;;
      upgrade.sh) expected=$RESOURCE_UPGRADE_SHA256 ;;
    esac
    download_verified "$base/$resource" "$stage/$resource" "$expected"
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
  if [ "$HOST_OS" = Darwin ]; then
    printf 'http://127.0.0.1:%s' "$HTTP_PORT"
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
      "LINKSENSE_PLATFORM=$LINKSENSE_PLATFORM" \
      "LINKSENSE_DOCKER_SOCKET_SOURCE=$LINKSENSE_DOCKER_SOCKET_SOURCE" \
      "LINKSENSE_DOCKER_SOCKET_PATH=$LINKSENSE_DOCKER_SOCKET_PATH" \
      "LINKSENSE_PUBLIC_BASE_URL=$LINKSENSE_PUBLIC_BASE_URL" \
      "LINKSENSE_PUBLIC_SCHEME=$LINKSENSE_PUBLIC_SCHEME" \
      "LINKSENSE_HTTP_PORT=$HTTP_PORT" \
      "LINKSENSE_CPU_QUOTA_MODE=${LINKSENSE_CPU_QUOTA_MODE:-strict}" \
      "LINKSENSE_API_MEMORY_MB=${LINKSENSE_API_MEMORY_MB:-0}" \
      "LINKSENSE_API_NODE_OPTIONS=${LINKSENSE_API_NODE_OPTIONS:-}" \
      "LINKSENSE_RUNNER_MEMORY_MB=${LINKSENSE_RUNNER_MEMORY_MB:-0}" \
      "LINKSENSE_RUNNER_NODE_OPTIONS=${LINKSENSE_RUNNER_NODE_OPTIONS:-}" \
      "LINKSENSE_POSTGRES_MEMORY_MB=${LINKSENSE_POSTGRES_MEMORY_MB:-0}" \
      "LINKSENSE_REDIS_MEMORY_MB=${LINKSENSE_REDIS_MEMORY_MB:-0}" \
      "LINKSENSE_MINIO_MEMORY_MB=${LINKSENSE_MINIO_MEMORY_MB:-0}" \
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
      "LINKSENSE_MAX_CONCURRENT_CONVERSATIONS=${LINKSENSE_MAX_CONCURRENT_CONVERSATIONS:-500}" \
      "LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT=${LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT:-20}" \
      "LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS=${LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS:-900}" \
      "LINKSENSE_WORKER_IDLE_TTL_SECONDS=${LINKSENSE_WORKER_IDLE_TTL_SECONDS:-900}" \
      "LINKSENSE_WORKER_READY_TIMEOUT_SECONDS=${LINKSENSE_WORKER_READY_TIMEOUT_SECONDS:-90}" \
      "LINKSENSE_WORKER_MEMORY_MB=${LINKSENSE_WORKER_MEMORY_MB:-4096}" \
      "LINKSENSE_WORKER_CPUS=${LINKSENSE_WORKER_CPUS:-2}" \
      "LINKSENSE_WORKER_PIDS_LIMIT=${LINKSENSE_WORKER_PIDS_LIMIT:-4096}" \
      "LINKSENSE_WORKER_TMPFS_MB=${LINKSENSE_WORKER_TMPFS_MB:-4096}" \
      "LINKSENSE_WORKER_SHM_MB=${LINKSENSE_WORKER_SHM_MB:-2048}" \
      "LINKSENSE_BROWSER_SESSION_LIMIT=${LINKSENSE_BROWSER_SESSION_LIMIT:-2}" \
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
      if [ "${LINKSENSE_CPU_QUOTA_MODE:-strict}" = compatible ]; then
        LINKSENSE_DOCLING_API_CPUS=0
        LINKSENSE_DOCLING_WORKER_CPUS=0
      else
        [ "${LINKSENSE_DOCLING_API_CPUS:-1}" != 0 ] || LINKSENSE_DOCLING_API_CPUS=1
        [ "${LINKSENSE_DOCLING_WORKER_CPUS:-4}" != 0 ] || LINKSENSE_DOCLING_WORKER_CPUS=4
      fi
      printf '%s\n' \
        "LINKSENSE_ELASTICSEARCH_MEMORY_MB=${LINKSENSE_ELASTICSEARCH_MEMORY_MB:-0}" \
        "LINKSENSE_DOCLING_API_CPUS=${LINKSENSE_DOCLING_API_CPUS:-1}" \
        "LINKSENSE_DOCLING_WORKER_CPUS=${LINKSENSE_DOCLING_WORKER_CPUS:-4}" \
        "LINKSENSE_KB_PARSING_CONCURRENCY=${LINKSENSE_KB_PARSING_CONCURRENCY:-4}" \
        "LINKSENSE_KB_CHUNKING_CONCURRENCY=${LINKSENSE_KB_CHUNKING_CONCURRENCY:-8}" \
        "LINKSENSE_KB_PARENTING_CONCURRENCY=${LINKSENSE_KB_PARENTING_CONCURRENCY:-8}" \
        "LINKSENSE_KB_EMBEDDING_CONCURRENCY=${LINKSENSE_KB_EMBEDDING_CONCURRENCY:-8}" \
        "LINKSENSE_KB_INDEXING_CONCURRENCY=${LINKSENSE_KB_INDEXING_CONCURRENCY:-8}" \
        "LINKSENSE_KB_ACTIVATION_CONCURRENCY=${LINKSENSE_KB_ACTIVATION_CONCURRENCY:-16}" \
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
  if [ -f "$INSTALL_DIR/.env" ]; then
    # Preserve every validated installed setting except release-owned image/identity fields.
    awk -F= '
      NR == FNR { if ($0 !~ /^#/ && index($0, "=")) old[$1]=substr($0,index($0,"=")+1); next }
      {
        key=$1; seen[key]=1
        if (key in old && key !~ /_IMAGE$/ && key != "LINKSENSE_WORKER_IMAGE_REVISION" && key !~ /^LINKSENSE_(VERSION|EDITION|PLATFORM|DOCKER_SOCKET_SOURCE|DOCKER_SOCKET_PATH|CPU_QUOTA_MODE|DOCLING_API_CPUS|DOCLING_WORKER_CPUS)$/) print key "=" old[key]
        else print
      }
      END {for (key in old) if (!(key in seen)) print key "=" old[key]}
    ' "$INSTALL_DIR/.env" "$env_tmp" > "$env_tmp.merged"
    mv "$env_tmp.merged" "$env_tmp"
  fi
  chmod 0600 "$env_tmp"
  mv "$env_tmp" "$INSTALL_DIR/.env"
}

write_and_activate_runtime_env() {
  write_runtime_env
  load_runtime_env
}

write_env() {
  api_default_memory=1536
  api_default_heap=1024
  runner_default_memory=512
  minio_default_memory=512
  redis_default_memory=256
  postgres_default_memory=512
  if [ "$EDITION" = full ]; then
    api_default_memory=2048; api_default_heap=1536; redis_default_memory=512; postgres_default_memory=768
    LINKSENSE_ELASTICSEARCH_MEMORY_MB=${LINKSENSE_ELASTICSEARCH_MEMORY_MB:-2048}
  elif [ "$(host_available_memory_mib)" -lt 8192 ]; then
    api_default_memory=1280; api_default_heap=896; runner_default_memory=384
    postgres_default_memory=384; redis_default_memory=192; minio_default_memory=384
  fi
  LINKSENSE_API_MEMORY_MB=${LINKSENSE_API_MEMORY_MB:-$api_default_memory}
  LINKSENSE_API_NODE_OPTIONS=${LINKSENSE_API_NODE_OPTIONS:---max-old-space-size=$api_default_heap}
  LINKSENSE_RUNNER_MEMORY_MB=${LINKSENSE_RUNNER_MEMORY_MB:-$runner_default_memory}
  LINKSENSE_RUNNER_NODE_OPTIONS=${LINKSENSE_RUNNER_NODE_OPTIONS:---max-old-space-size=256}
  LINKSENSE_POSTGRES_MEMORY_MB=${LINKSENSE_POSTGRES_MEMORY_MB:-$postgres_default_memory}
  LINKSENSE_REDIS_MEMORY_MB=${LINKSENSE_REDIS_MEMORY_MB:-$redis_default_memory}
  LINKSENSE_MINIO_MEMORY_MB=${LINKSENSE_MINIO_MEMORY_MB:-$minio_default_memory}
  LINKSENSE_MAX_CONCURRENT_CONVERSATIONS=${LINKSENSE_MAX_CONCURRENT_CONVERSATIONS:-1}
  LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT=${LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT:-2}
  LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS=${LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS:-60}
  LINKSENSE_WORKER_IDLE_TTL_SECONDS=${LINKSENSE_WORKER_IDLE_TTL_SECONDS:-60}
  cpu_count=$(docker info --format '{{.NCPU}}')
  case "$cpu_count" in ''|*[!0-9]*|0) host_fail invalid_config Docker_NCPU ;; esac
  worker_cpus=2
  [ "$cpu_count" -ge 2 ] || worker_cpus=1
  LINKSENSE_WORKER_CPUS=${LINKSENSE_WORKER_CPUS:-$worker_cpus}
  docling_cpus=4
  [ "$cpu_count" -ge 4 ] || docling_cpus=$cpu_count
  LINKSENSE_DOCLING_WORKER_CPUS=${LINKSENSE_DOCLING_WORKER_CPUS:-$docling_cpus}
  for concurrency_key in PARSING CHUNKING PARENTING EMBEDDING INDEXING ACTIVATION; do
    eval "LINKSENSE_KB_${concurrency_key}_CONCURRENCY=\${LINKSENSE_KB_${concurrency_key}_CONCURRENCY:-1}"
  done
  validate_resource_budget fresh
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
  write_and_activate_runtime_env
}

host_available_memory_mib() {
  available_engine_bytes=$(docker info --format '{{.MemTotal}}')
  printf '%s' "$available_engine_bytes" | grep -Eq '^[1-9][0-9]*$' || host_fail memory Docker_memory_unknown
  available_mib=$((available_engine_bytes / 1024 / 1024))
  if [ "$HOST_OS" = Linux ]; then
    available_host_mib=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
    if [ -n "$available_host_mib" ] && [ "$available_host_mib" -lt "$available_mib" ]; then available_mib=$available_host_mib; fi
  fi
  printf '%s\n' "$available_mib"
}

validate_resource_budget() {
  budget_kind=${1:-existing}
  budget_mib=768
  budget_keys='LINKSENSE_API_MEMORY_MB LINKSENSE_RUNNER_MEMORY_MB LINKSENSE_POSTGRES_MEMORY_MB LINKSENSE_REDIS_MEMORY_MB LINKSENSE_MINIO_MEMORY_MB'
  if [ "$EDITION" = full ]; then budget_keys="$budget_keys LINKSENSE_ELASTICSEARCH_MEMORY_MB"; fi
  for budget_key in $budget_keys; do
    eval "budget_value=\${$budget_key:-0}"
    printf '%s' "$budget_value" | grep -Eq '^(0|[1-9][0-9]{0,6})$' || host_fail invalid_config "$budget_key"
    if [ "$budget_kind" = fresh ]; then [ "$budget_value" -gt 0 ] || host_fail invalid_config "$budget_key/zero"; fi
    budget_mib=$((budget_mib + budget_value))
  done
  printf '%s' "${LINKSENSE_WORKER_MEMORY_MB:-4096}" | grep -Eq '^[1-9][0-9]{0,6}$' || host_fail invalid_config LINKSENSE_WORKER_MEMORY_MB
  # shortcut: budget one Worker; guaranteed multi-user capacity needs runtime admission control.
  budget_mib=$((budget_mib + ${LINKSENSE_WORKER_MEMORY_MB:-4096}))
  if [ "$EDITION" = full ]; then
    budget_mib=$((budget_mib + 10240))
    budget_es_limit=${LINKSENSE_ELASTICSEARCH_MEMORY_MB:-0}
    if [ "$budget_es_limit" -ne 0 ]; then
      [ 1024 -le "$((budget_es_limit * 3 / 4))" ] || host_fail memory "Elasticsearch heap_mib=1024 limit_mib=$budget_es_limit"
    fi
  fi
  for budget_service in API RUNNER; do
    eval "budget_limit=\${LINKSENSE_${budget_service}_MEMORY_MB:-0}"
    eval "budget_options=\${LINKSENSE_${budget_service}_NODE_OPTIONS:-}"
    if [ -n "$budget_options" ]; then
      printf '%s' "$budget_options" | grep -Eq '^--max-old-space-size=[1-9][0-9]{0,6}$' || host_fail invalid_config "LINKSENSE_${budget_service}_NODE_OPTIONS"
      budget_heap=${budget_options#*=}
      if [ "$budget_limit" -ne 0 ]; then [ "$budget_heap" -le "$((budget_limit * 3 / 4))" ] || host_fail memory "$budget_service heap_mib=$budget_heap limit_mib=$budget_limit"; fi
    fi
  done
  budget_available_mib=$(($(docker info --format '{{.MemTotal}}') / 1024 / 1024))
  if [ "$budget_kind" = fresh ]; then budget_available_mib=$(host_available_memory_mib); fi
  [ "$budget_available_mib" -ge "$budget_mib" ] || host_fail memory "available_mib=$budget_available_mib required_mib=$budget_mib"
}

install_resources() {
  for resource in LICENSE LICENSE-EXCEPTIONS.md ATTRIBUTION.md TRADEMARK.md NOTICE THIRD-PARTY-NOTICES.md compose.common.yml "compose.$EDITION.yml" gateway.conf.template; do
    install -m 0644 "$TMP_ROOT/resources/$resource" "$INSTALL_DIR/$resource"
  done
  install -m 0644 "$TMP_ROOT/release-manifest.env" "$INSTALL_DIR/release-manifest.env"
  printf '%s  %s\n' "$MANIFEST_SHA256" release-manifest.env > "$INSTALL_DIR/release-manifest.env.sha256"
  chmod 0644 "$INSTALL_DIR/release-manifest.env.sha256"
  install -d -m 0700 "$INSTALL_DIR/bin"
  install -m 0755 "$TMP_ROOT/resources/linksense-cli.sh" "$INSTALL_DIR/bin/linksense-cli.sh"
  install -m 0755 "$TMP_ROOT/resources/repair-$EDITION.sh" "$INSTALL_DIR/bin/repair-$EDITION.sh"
  install -m 0755 "$TMP_ROOT/resources/upgrade.sh" "$INSTALL_DIR/bin/upgrade.sh"
}

activate_management_cli() {
  launcher_tmp=$TMP_ROOT/linksense-launcher
  {
    printf '%s\n' '#!/bin/sh' '# LinkSense managed launcher; updated by install, repair, and upgrade.'
    if [ "$HOST_OS" = Linux ]; then
      printf '%s\n' \
        'cli_language=${LINKSENSE_CLI_LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en-US}}}}' \
        'if [ "$(id -u)" -eq 0 ]; then' \
        "  exec env LINKSENSE_INSTALL_DIR=$INSTALL_DIR \"LINKSENSE_CLI_LANGUAGE=\$cli_language\" $INSTALL_DIR/bin/linksense-cli.sh \"\$@\"" \
        'fi' \
        'command -v sudo >/dev/null 2>&1 || {' \
        '  printf "%s\\n" "Managing LinkSense requires root privileges, but sudo is not installed." >&2' \
        '  exit 1' \
        '}' \
        'if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then' \
        "  exec sudo env LINKSENSE_INSTALL_DIR=$INSTALL_DIR \"LINKSENSE_CLI_LANGUAGE=\$cli_language\" \"LINKSENSE_RELEASE_BASE_URL=\$LINKSENSE_RELEASE_BASE_URL\" $INSTALL_DIR/bin/linksense-cli.sh \"\$@\"" \
        'fi' \
        "exec sudo env LINKSENSE_INSTALL_DIR=$INSTALL_DIR \"LINKSENSE_CLI_LANGUAGE=\$cli_language\" $INSTALL_DIR/bin/linksense-cli.sh \"\$@\""
      launcher_path=/usr/local/bin/linksense
      install -d -m 0755 /usr/local/bin
    else
      printf '%s\n' \
        "LINKSENSE_INSTALL_DIR=$INSTALL_DIR" \
        'export LINKSENSE_INSTALL_DIR' \
        "exec $INSTALL_DIR/bin/linksense-cli.sh \"\$@\""
      install -d -m 0755 "$HOME/.local/bin"
      launcher_path=$HOME/.local/bin/linksense
    fi
  } > "$launcher_tmp"
  chmod 0755 "$launcher_tmp"
  if [ -e "$launcher_path" ] && [ ! -f "$launcher_path" ]; then
    fail "Refusing to replace a non-file LinkSense command at $launcher_path."
  fi
  if [ -f "$launcher_path" ] && ! grep -F 'LinkSense managed launcher' "$launcher_path" >/dev/null 2>&1; then
    fail "Refusing to replace an unmanaged command at $launcher_path."
  fi
  install -m 0755 "$launcher_tmp" "$launcher_path"
  log "Management command installed: linksense"
  if [ "$HOST_OS" = Darwin ]; then
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) ;;
      *) log "Add $HOME/.local/bin to PATH to run the linksense command from any directory." ;;
    esac
  fi
}

validate_managed_volume() {
  volume=$1
  role=$2
  driver=$(docker volume inspect --format '{{.Driver}}' "$volume")
  options=$(docker volume inspect --format '{{json .Options}}' "$volume" | tr '[:upper:]' '[:lower:]')
  managed_label=$(docker volume inspect --format '{{ index .Labels "com.linksense.managed-by" }}' "$volume")
  persistence_label=$(docker volume inspect --format '{{ index .Labels "com.linksense.persistence" }}' "$volume")
  role_label=$(docker volume inspect --format '{{ index .Labels "com.linksense.role" }}' "$volume")
  [ "$driver" = local ] || fail "Persistent volume $volume must use Docker's local driver."
  { [ "$options" = null ] || [ "$options" = '{}' ]; } || fail "Persistent volume $volume must not define local-driver options."
  if [ "$managed_label" != linksense-production ] || \
    [ "$persistence_label" != critical ] || \
    [ "$role_label" != "$role" ]; then
    fail "Persistent volume $volume does not have the required LinkSense production labels. Preserve its data and migrate it to a correctly labeled volume before retrying."
  fi
}

ensure_managed_volume() {
  volume=$1
  role=$2
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create \
      --driver local \
      --label com.linksense.managed-by=linksense-production \
      --label com.linksense.persistence=critical \
      --label "com.linksense.role=$role" \
      "$volume" >/dev/null
  fi
  validate_managed_volume "$volume" "$role"
}

create_install_volumes() {
  for volume in linksense-postgres linksense-redis linksense-minio; do
    docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
  done
  ensure_managed_volume linksense-user-data user-data
  ensure_managed_volume linksense-backups backups
  if [ "$EDITION" = full ]; then
    for volume in linksense-elasticsearch linksense-tokenizer; do
      docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
    done
  fi
}

compose() {
  host_compose --project-directory "$INSTALL_DIR" \
    --env-file "$INSTALL_DIR/.env" \
    -f "$INSTALL_DIR/compose.common.yml" \
    -f "$INSTALL_DIR/compose.$EDITION.yml" "$@"
}

pull_images() {
  compose config --quiet
  pull_release_images
}

pull_image() {
  pull_reference=$1
  if docker image inspect "$pull_reference" >/dev/null 2>&1; then return 0; fi
  pull_attempt=0
  pull_log=$TMP_ROOT/image-pull.log
  while [ "$pull_attempt" -lt 3 ]; do
    pull_attempt=$((pull_attempt + 1))
    pull_remaining=$((pull_deadline - $(date +%s)))
    [ "$pull_remaining" -gt 0 ] || host_fail pull deadline
    [ "$pull_remaining" -le 1200 ] || pull_remaining=1200
    if host_bounded "$pull_remaining" "$DOCKER_CLI" pull "$pull_reference" >"$pull_log" 2>&1; then return 0; fi
    grep -Eiq 'timeout|timed out|connection reset|connection refused|TLS handshake|unexpected EOF|no such host|429|502|503|504|http2' "$pull_log" || break
    [ "$pull_attempt" -ge 3 ] || sleep "$pull_attempt"
  done
  host_fail pull "image=$pull_reference attempts=$pull_attempt"
}

pull_release_images() {
  pull_deadline=$(($(date +%s) + 2700))
  check_release_storage
  for release_image in \
    "$IMAGE_LINKSENSE_API" "$IMAGE_LINKSENSE_WEB" "$IMAGE_LINKSENSE_MIGRATE" \
    "$IMAGE_LINKSENSE_RUNNER" "$IMAGE_LINKSENSE_WORKER" "$IMAGE_POSTGRES" \
    "$IMAGE_REDIS" "$IMAGE_MINIO" "$IMAGE_MINIO_CLIENT" "$IMAGE_BUSYBOX" "$IMAGE_GATEWAY"; do
    pull_image "$release_image"
  done
  if [ "$EDITION" = full ]; then
    pull_image "$IMAGE_ELASTICSEARCH"
    pull_image "$IMAGE_DOCLING"
  fi
}

tokenizer_value() {
  index=$1
  field=$2
  name="TOKENIZER_FILE_${index}_${field}"
  eval "printf '%s' \"\${$name:-}\""
}

download_tokenizer() {
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
    download_verified "$url" "$token_stage/$path" "$expected"
    verify_file "$token_stage/$path" "$expected"
    printf '%s' "$expected_size" | grep -Eq '^[0-9]+$' || fail "Invalid tokenizer file size in release manifest."
    actual_size=$(wc -c < "$token_stage/$path" | tr -d ' ')
    [ "$actual_size" = "$expected_size" ] || fail "Size mismatch for tokenizer file $path."
    index=$((index + 1))
  done
}

publish_tokenizer() {
  [ "$EDITION" = full ] || return 0
  token_stage=$TMP_ROOT/tokenizer
  docker volume inspect linksense-tokenizer >/dev/null 2>&1 || docker volume create linksense-tokenizer >/dev/null
  if [ "$ACTION" = repair ] || [ "$ACTION" = upgrade ]; then
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
      if [ -d "/tokenizer/releases/$revision" ]; then
        mv "/tokenizer/releases/$revision" /tokenizer/releases/.previous
      fi
      mv /tokenizer/releases/.staging "/tokenizer/releases/$revision"
      chmod -R a=rX "/tokenizer/releases/$revision"
      ln -sfn "releases/$revision" /tokenizer/.current
      mv -Tf /tokenizer/.current /tokenizer/current
      rm -rf /tokenizer/releases/.previous
    ' sh "$TOKENIZER_REVISION"
}

prepare_tokenizer() {
  download_tokenizer
  publish_tokenizer
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
  validate_managed_volume linksense-user-data user-data
  validate_managed_volume linksense-backups backups
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

active_operation_count() {
  compose exec -T postgres sh -ec \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT (SELECT count(*) FROM conversation_turns WHERE status = '\''running'\'') + (SELECT count(*) FROM conversation_turn_start_intents);"'
}

wait_for_active_operations() {
  deadline=$(( $(date +%s) + 600 ))
  while :; do
    active_count=$(active_operation_count)
    case "$active_count" in
      ''|*[!0-9]*) fail "Could not read the active conversation operation count." ;;
    esac
    [ "$active_count" -ne 0 ] || return 0
    [ "$(date +%s)" -lt "$deadline" ] || fail "Timed out waiting for $active_count active conversation operation(s)."
    log "Waiting for $active_count active conversation operation(s) to finish."
    sleep 5
  done
}

worker_instance_key() {
  worker_identity=$(printf '["linksense-runner-storage-domain","%s","volume","%s"]' \
    "$LINKSENSE_WORKER_CONTROL_NETWORK" "$LINKSENSE_USER_DATA_VOLUME")
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$worker_identity" | sha256sum | cut -c1-32
  else
    printf '%s' "$worker_identity" | shasum -a 256 | cut -c1-32
  fi
}

remove_installation_workers() {
  expected_instance=$(worker_instance_key)
  worker_ids=$(docker ps -aq \
    --filter 'label=com.linksense.runner.managed=true' \
    --filter "label=com.linksense.runner.instance=$expected_instance")
  [ -n "$worker_ids" ] || return 0
  for worker_id in $worker_ids; do
    actual_managed=$(docker inspect --format '{{ index .Config.Labels "com.linksense.runner.managed" }}' "$worker_id")
    actual_instance=$(docker inspect --format '{{ index .Config.Labels "com.linksense.runner.instance" }}' "$worker_id")
    [ "$actual_managed" = true ] && [ "$actual_instance" = "$expected_instance" ] || \
      fail "Refusing to remove a task worker outside this LinkSense installation: $worker_id"
    docker stop --time 60 "$worker_id" >/dev/null 2>&1 || true
    docker rm "$worker_id" >/dev/null
  done
}

stop_upgrade_runtime() {
  wait_for_active_operations
  UPGRADE_RUNTIME_STOPPED=true
  compose stop api runner
  remove_installation_workers
  active_count=$(active_operation_count)
  [ "$active_count" = 0 ] || fail "$active_count active conversation operation(s) remained after stopping API and Runner."
}

check_upgrade_backup_storage() {
  backup_database_bytes=$(compose_bounded 30 exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database())"')
  printf '%s' "$backup_database_bytes" | grep -Eq '^[0-9]{1,15}$' || host_fail storage PostgreSQL_size_unknown
  # Both the temporary dump and final backup may share Docker's data filesystem.
  backup_required_kb=$((backup_database_bytes / 1024 * 2 + 262144))
  backup_temporary_kb=$(compose_bounded 30 exec -T postgres sh -ec "df -Pk /tmp | awk 'END {print \$4}'")
  backup_volume_kb=$(docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 64m --pids-limit 16 \
    --mount "type=volume,src=$LINKSENSE_BACKUP_VOLUME,dst=/backups,readonly" \
    "$IMAGE_BUSYBOX" sh -ec "df -Pk /backups | awk 'END {print \$4}'")
  for backup_free_kb in "$backup_temporary_kb" "$backup_volume_kb"; do
    printf '%s' "$backup_free_kb" | grep -Eq '^[0-9]+$' || host_fail storage backup_space_unknown
    [ "$backup_free_kb" -ge "$backup_required_kb" ] || host_fail storage "backup_available_kib=$backup_free_kb required_kib=$backup_required_kb"
  done
}

create_upgrade_backup() {
  validate_managed_volume "$LINKSENSE_BACKUP_VOLUME" backups
  backup_timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
  backup_name="linksense-preupgrade-${UPGRADE_FROM_VERSION}-to-${RELEASE_VERSION}-${backup_timestamp}.dump"
  compose exec -T postgres sh -ec '
    temporary_dump="/tmp/linksense-preupgrade-$$.dump"
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
    --mount "type=volume,src=$LINKSENSE_BACKUP_VOLUME,dst=/backups" \
    -e "BACKUP_NAME=$backup_name" \
    --entrypoint /bin/sh "$POSTGRES_IMAGE" \
    -ec '
      set -eu
      mkdir -p /backups/postgres
      chmod 0700 /backups /backups/postgres
      final_path="/backups/postgres/$BACKUP_NAME"
      partial_path="${final_path}.partial"
      trap '\''rm -f "$partial_path"'\'' EXIT HUP INT TERM
      cat >"$partial_path"
      test -s "$partial_path"
      pg_restore --list "$partial_path" >/dev/null
      chmod 0600 "$partial_path"
      mv "$partial_path" "$final_path"
      trap - EXIT HUP INT TERM
    '
  UPGRADE_BACKUP_URI="volume://$LINKSENSE_BACKUP_VOLUME/postgres/$backup_name"
  log "Validated PostgreSQL backup: $UPGRADE_BACKUP_URI"
}

verify_upgrade_backup() {
  backup_name=${UPGRADE_BACKUP_URI##*/}
  printf '%s' "$backup_name" | grep -Eq '^linksense-preupgrade-v[0-9]+\.[0-9]+\.[0-9]+-to-v[0-9]+\.[0-9]+\.[0-9]+-[0-9]{8}T[0-9]{6}Z\.dump$' || \
    fail "The interrupted upgrade contains an invalid backup reference."
  [ "$UPGRADE_BACKUP_URI" = "volume://$LINKSENSE_BACKUP_VOLUME/postgres/$backup_name" ] || \
    fail "The interrupted upgrade backup belongs to a different Docker volume."
  docker run --rm --network none \
    --mount "type=volume,src=$LINKSENSE_BACKUP_VOLUME,dst=/backups,readonly" \
    "$POSTGRES_IMAGE" pg_restore --list "/backups/postgres/$backup_name" >/dev/null
}

write_upgrade_pending() {
  migration_started=$1
  pending_tmp=$INSTALL_DIR/upgrade.pending.tmp.$$
  {
    printf '%s\n' \
      "UPGRADE_FORMAT=1" \
      "UPGRADE_EDITION=$EDITION" \
      "UPGRADE_PLATFORM=$LINKSENSE_PLATFORM" \
      "UPGRADE_FROM_VERSION=$UPGRADE_FROM_VERSION" \
      "UPGRADE_TARGET_VERSION=$RELEASE_VERSION" \
      "UPGRADE_TARGET_MANIFEST_SHA256=$MANIFEST_SHA256" \
      "UPGRADE_BACKUP_URI=$UPGRADE_BACKUP_URI" \
      "UPGRADE_MIGRATION_STARTED=$migration_started" \
      "UPGRADE_STARTED_AT=$UPGRADE_STARTED_AT"
  } > "$pending_tmp"
  chmod 0600 "$pending_tmp"
  mv "$pending_tmp" "$INSTALL_DIR/upgrade.pending"
}

snapshot_upgrade_configuration() {
  UPGRADE_PREVIOUS_DIR=$TMP_ROOT/previous
  mkdir "$UPGRADE_PREVIOUS_DIR"
  for current_file in .env LICENSE LICENSE-EXCEPTIONS.md ATTRIBUTION.md TRADEMARK.md NOTICE THIRD-PARTY-NOTICES.md compose.common.yml "compose.$EDITION.yml" gateway.conf.template release-manifest.env release-manifest.env.sha256; do
    [ ! -f "$INSTALL_DIR/$current_file" ] || cp -p "$INSTALL_DIR/$current_file" "$UPGRADE_PREVIOUS_DIR/$current_file"
  done
}

wait_for_health() {
  attempts=0
  health_deadline=$(($(date +%s) + 400))
  local_health_url="http://127.0.0.1:$HTTP_PORT/api/v1/system/health/ready"
  while [ "$attempts" -lt 60 ] && [ "$(date +%s)" -lt "$health_deadline" ]; do
    if curl --noproxy '*' --connect-timeout 3 --max-time 5 -fsS "$local_health_url" >/dev/null 2>&1; then
      if [ "$EDITION" = full ]; then
        if ! compose_bounded 10 exec -T elasticsearch curl --max-time 5 -fsS -u "$ELASTICSEARCH_ROOT_USERNAME:$ELASTICSEARCH_ROOT_PASSWORD" http://127.0.0.1:9200/_cluster/health >/dev/null 2>&1 || \
          ! compose_bounded 10 exec -T docling-api python -c 'import os,urllib.request; r=urllib.request.Request("http://127.0.0.1:5001/ready",headers={"X-Api-Key":os.environ["DOCLING_SERVE_API_KEY"]}); urllib.request.urlopen(r,timeout=5).read()' >/dev/null 2>&1; then
          attempts=$((attempts + 1))
          sleep 5
          continue
        fi
      fi
      verify_service_stability
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  compose ps >&2 || true
  host_fail stability readiness_deadline
}

run_full_release_probe() {
  [ "$EDITION" = full ] || return 0
  probe_output=$TMP_ROOT/full-release-probe.log
  if ! compose_bounded 600 exec -T api node dist/release/full-installation-probe.js >"$probe_output" 2>&1; then
    fail "Full release probe failed. Inspect the Docling and API service logs."
  fi
  grep -Fx 'Full release probe passed.' "$probe_output" >/dev/null || fail "Full release probe exited without completing its checks."
  log "Full release probe passed."
}

write_pending_state() {
  timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  STATE_STARTED_AT=$timestamp
  pending_tmp=$INSTALL_DIR/install.pending.tmp.$$
  {
    printf '%s\n' \
      "STATE_FORMAT=2" \
      "STATE_EDITION=$EDITION" \
      "STATE_PLATFORM=$LINKSENSE_PLATFORM" \
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
      "STATE_FORMAT=2" \
      "STATE_EDITION=$EDITION" \
      "STATE_PLATFORM=$LINKSENSE_PLATFORM" \
      "STATE_RELEASE_VERSION=$RELEASE_VERSION" \
      "STATE_RELEASE_MANIFEST_FORMAT=$MANIFEST_FORMAT" \
      "STATE_MANIFEST_SHA256=$MANIFEST_SHA256" \
      "STATE_INSTALL_DIR=$INSTALL_DIR" \
      "STATE_ENV_FILE=$INSTALL_DIR/.env" \
      "STATE_HTTP_PORT=$HTTP_PORT" \
      "STATE_RELEASE_BASE_URL=$RELEASE_RESOURCE_BASE" \
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
    if [ "$ACTION" = upgrade ]; then
      printf '%s\n' \
        "STATE_PREVIOUS_RELEASE_VERSION=$UPGRADE_FROM_VERSION" \
        "STATE_LAST_UPGRADE_BACKUP_URI=$UPGRADE_BACKUP_URI" \
        "STATE_LAST_UPGRADE_AT=$timestamp"
    fi
  } > "$state_tmp"
  chmod 0600 "$state_tmp"
  mv "$state_tmp" "$INSTALL_DIR/install-state.env"
  rm -f "$INSTALL_DIR/install.pending"
  rm -f "$INSTALL_DIR/upgrade.pending"
}

load_runtime_env() {
  runtime_state_format=${1:-2}
  verify_private_file "$INSTALL_DIR/.env" "The protected environment file"
  load_strict_env "$INSTALL_DIR/.env" runtime
  runtime_cpu_mode=${LINKSENSE_CPU_QUOTA_MODE:-strict}
  LINKSENSE_CPU_QUOTA_MODE=${HOST_CPU_QUOTA_MODE:-${LINKSENSE_CPU_QUOTA_MODE:-strict}}
  if [ "$runtime_cpu_mode" != "$LINKSENSE_CPU_QUOTA_MODE" ]; then unset LINKSENSE_DOCLING_API_CPUS LINKSENSE_DOCLING_WORKER_CPUS; fi
  host_cpu_mode
  require_loaded_keys LINKSENSE_EDITION LINKSENSE_VERSION LINKSENSE_PUBLIC_BASE_URL LINKSENSE_PUBLIC_SCHEME POSTGRES_PASSWORD REDIS_PASSWORD LINKSENSE_JWT_SECRET LINKSENSE_INITIALIZATION_TOKEN LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET LINKSENSE_CREDENTIAL_MASTER_KEY LINKSENSE_RUNNER_SHARED_SECRET MINIO_ROOT_PASSWORD MINIO_SECRET_KEY
  if [ "$runtime_state_format" = 1 ]; then
    [ "$HOST_OS:$docker_platform" = Linux:linux-amd64 ] || fail "Legacy v0.1.0 installations can only be upgraded on their original Linux amd64 platform."
    LINKSENSE_PLATFORM=$docker_platform
    LINKSENSE_DOCKER_SOCKET_SOURCE=${docker_endpoint#unix://}
    LINKSENSE_DOCKER_SOCKET_PATH=/var/run/docker.sock
  else
    require_loaded_keys LINKSENSE_PLATFORM LINKSENSE_DOCKER_SOCKET_SOURCE LINKSENSE_DOCKER_SOCKET_PATH
    [ "$LINKSENSE_PLATFORM" = "$docker_platform" ] || fail "The installed runtime targets $LINKSENSE_PLATFORM, but the active Docker Engine is $docker_platform."
    if [ "$HOST_OS" = Darwin ]; then
      expected_docker_socket_source=/var/run/docker.sock
    else
      expected_docker_socket_source=${docker_endpoint#unix://}
    fi
    [ "$LINKSENSE_DOCKER_SOCKET_SOURCE" = "$expected_docker_socket_source" ] || fail "The installed runtime belongs to a different Docker socket."
    [ "$LINKSENSE_DOCKER_SOCKET_PATH" = /var/run/docker.sock ] || fail "The installed runtime contains an unsupported Docker socket target."
  fi
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
    verify_private_file "$state_file" "The installation state"
    load_strict_env "$state_file" state
    require_loaded_keys STATE_FORMAT STATE_EDITION STATE_PLATFORM STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_INSTALL_DIR STATE_INSTALLED_AT
    [ "$STATE_FORMAT" = 2 ] || fail "Unsupported installation state format."
    [ "$STATE_EDITION" = "$EDITION" ] || fail "This host contains a $STATE_EDITION installation; edition conversion is not supported by install scripts."
    [ "$STATE_PLATFORM" = "$LINKSENSE_PLATFORM" ] || fail "This installation targets $STATE_PLATFORM, not $LINKSENSE_PLATFORM."
    [ "$STATE_RELEASE_VERSION" = "$RELEASE_VERSION" ] || fail "Version $STATE_RELEASE_VERSION is already installed; install scripts do not upgrade or downgrade."
    [ "$STATE_MANIFEST_SHA256" = "$MANIFEST_SHA256" ] || fail "The installed manifest does not match the requested immutable release."
    load_runtime_env
    if curl --noproxy '*' --connect-timeout 3 --max-time 5 -fsS "http://127.0.0.1:$HTTP_PORT/api/v1/system/health/ready" >/dev/null 2>&1; then
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
    verify_private_file "$INSTALL_DIR/install.pending" "The interrupted installation state"
    load_strict_env "$INSTALL_DIR/install.pending" state
    require_loaded_keys STATE_FORMAT STATE_EDITION STATE_PLATFORM STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_STARTED_AT
    [ "$STATE_FORMAT" = 2 ] || fail "Unsupported interrupted installation state format."
    [ "$STATE_EDITION" = "$EDITION" ] || fail "An interrupted $STATE_EDITION installation exists."
    [ "$STATE_PLATFORM" = "$LINKSENSE_PLATFORM" ] || fail "The interrupted installation targets $STATE_PLATFORM, not $LINKSENSE_PLATFORM."
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
  fetch_release_resources
  install_resources
  log_stage "Stage 4/7: pull immutable container images."
  pull_images
  log_stage "Stage 5/7: prepare persistent volumes and edition assets."
  probe_host_runtime
  create_install_volumes
  prepare_tokenizer
  log_stage "Stage 6/7: start services and run readiness checks."
  start_stack
  wait_for_health
  run_full_release_probe
  log_stage "Stage 7/7: record the verified installation state."
  activate_management_cli
  host_save_tools
  write_success_state "$installed_at"
  log "Installed LinkSense $EDITION $RELEASE_VERSION successfully."
  host_text baseline
  log "Install directory: $INSTALL_DIR"
  log "Diagnostics: cd $INSTALL_DIR && docker compose --env-file .env -f compose.common.yml -f compose.$EDITION.yml ps"
  print_initialization_credential
}

repair_action() {
  log_stage "Stage 2/7: load the trusted installation identity."
  state_file=$INSTALL_DIR/install-state.env
  [ -f "$state_file" ] || fail "No trusted installation state exists at $state_file; repair will not guess an instance identity."
  verify_private_file "$state_file" "The installation state"
  load_strict_env "$state_file" state
  require_loaded_keys STATE_FORMAT STATE_EDITION STATE_PLATFORM STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_INSTALL_DIR STATE_INSTALLED_AT
  [ "$STATE_FORMAT" = 2 ] || fail "Unsupported installation state format."
  [ "$STATE_EDITION" = "$EDITION" ] || fail "This is a $STATE_EDITION installation; use repair-$STATE_EDITION.sh."
  [ "$STATE_PLATFORM" = "$LINKSENSE_PLATFORM" ] || fail "This installation targets $STATE_PLATFORM, not $LINKSENSE_PLATFORM."
  state_release=$STATE_RELEASE_VERSION
  state_manifest=$STATE_MANIFEST_SHA256
  [ "$STATE_INSTALL_DIR" = "$INSTALL_DIR" ] || fail "The installation state belongs to $STATE_INSTALL_DIR, not $INSTALL_DIR."
  load_runtime_env
  [ "$LINKSENSE_EDITION" = "$EDITION" ] || fail "The environment edition does not match the trusted installation state."
  validate_resource_budget
  [ "$LINKSENSE_VERSION" = "$state_release" ] || fail "The environment version does not match the trusted installation state."
  log_stage "Stage 3/7: verify persistent data and immutable release metadata."
  verify_existing_volumes

  RELEASE_SELECTOR=$state_release
  fetch_manifest "$(release_base)"
  [ "$MANIFEST_SHA256" = "$state_manifest" ] || fail "The published manifest no longer matches the installed immutable version."
  fetch_release_resources
  write_and_activate_runtime_env
  install_resources
  log_stage "Stage 4/7: pull immutable container images."
  pull_images
  log_stage "Stage 5/7: repair edition assets without replacing data volumes."
  prepare_tokenizer
  probe_host_runtime
  log_stage "Stage 6/7: recreate services and run readiness checks."
  start_stack
  wait_for_health
  run_full_release_probe
  log_stage "Stage 7/7: record the verified repair state."
  activate_management_cli
  host_save_tools
  write_success_state "$STATE_INSTALLED_AT"
  log "Repaired LinkSense $EDITION $state_release successfully without changing secrets or data volumes."
  host_text baseline
  log "Open: $LINKSENSE_PUBLIC_BASE_URL"
}

upgrade_action() {
  log_stage "Stage 2/9: load the trusted installation identity."
  state_file=$INSTALL_DIR/install-state.env
  [ -f "$state_file" ] || fail "No trusted installation state exists at $state_file; upgrade will not guess an instance identity."
  verify_private_file "$state_file" "The installation state"
  load_strict_env "$state_file" state
  require_loaded_keys STATE_FORMAT STATE_EDITION STATE_RELEASE_VERSION STATE_MANIFEST_SHA256 STATE_INSTALL_DIR STATE_INSTALLED_AT
  case "$STATE_FORMAT" in
    1)
      [ "$STATE_RELEASE_VERSION" = v0.1.0 ] || fail "Only the published v0.1.0 installation state can be upgraded from format 1."
      [ "$LINKSENSE_PLATFORM" = linux-amd64 ] || fail "The v0.1.0 installation state belongs to Linux amd64."
      ;;
    2)
      require_loaded_keys STATE_PLATFORM
      [ "$STATE_PLATFORM" = "$LINKSENSE_PLATFORM" ] || fail "This installation targets $STATE_PLATFORM, not $LINKSENSE_PLATFORM."
      ;;
    *) fail "Unsupported installation state format." ;;
  esac
  [ "$STATE_EDITION" = "$EDITION" ] || fail "The trusted installation edition changed while upgrade was starting."
  [ "$STATE_INSTALL_DIR" = "$INSTALL_DIR" ] || fail "The installation state belongs to $STATE_INSTALL_DIR, not $INSTALL_DIR."
  UPGRADE_FROM_VERSION=$STATE_RELEASE_VERSION
  UPGRADE_INSTALLED_AT=$STATE_INSTALLED_AT
  UPGRADE_PREVIOUS_TOKENIZER_REVISION=${STATE_TOKENIZER_REVISION:-}
  current_manifest_sha=$STATE_MANIFEST_SHA256

  if [ -f "$INSTALL_DIR/upgrade.pending" ]; then
    UPGRADE_PENDING_EXISTED=true
    verify_private_file "$INSTALL_DIR/upgrade.pending" "The interrupted upgrade state"
    load_strict_env "$INSTALL_DIR/upgrade.pending" upgrade
    require_loaded_keys UPGRADE_FORMAT UPGRADE_EDITION UPGRADE_PLATFORM UPGRADE_FROM_VERSION UPGRADE_TARGET_VERSION UPGRADE_TARGET_MANIFEST_SHA256 UPGRADE_BACKUP_URI UPGRADE_MIGRATION_STARTED UPGRADE_STARTED_AT
    [ "$UPGRADE_FORMAT" = 1 ] || fail "Unsupported interrupted upgrade state format."
    [ "$UPGRADE_EDITION" = "$EDITION" ] || fail "The interrupted upgrade belongs to a different edition."
    [ "$UPGRADE_PLATFORM" = "$LINKSENSE_PLATFORM" ] || fail "The interrupted upgrade targets a different platform."
    [ "$UPGRADE_FROM_VERSION" = "$STATE_RELEASE_VERSION" ] || fail "The interrupted upgrade does not match the installed release state."
    RELEASE_SELECTOR=$UPGRADE_TARGET_VERSION
    pending_manifest_sha=$UPGRADE_TARGET_MANIFEST_SHA256
  else
    pending_manifest_sha=
  fi

  load_runtime_env "$STATE_FORMAT"
  runtime_version=$LINKSENSE_VERSION
  if [ "$UPGRADE_PENDING_EXISTED" = true ]; then
    case "$runtime_version" in
      "$UPGRADE_FROM_VERSION"|"$UPGRADE_TARGET_VERSION") ;;
      *) fail "The protected environment does not match the interrupted upgrade." ;;
    esac
  else
    [ "$runtime_version" = "$UPGRADE_FROM_VERSION" ] || fail "The environment version does not match the trusted installation state."
  fi

  log_stage "Stage 3/9: verify persistent data and the target release."
  verify_existing_volumes
  fetch_manifest "$(release_base)"
  [ "$MANIFEST_SHA256" != "$current_manifest_sha" ] || [ "$RELEASE_VERSION" = "$UPGRADE_FROM_VERSION" ] || \
    fail "The target release reuses the installed manifest unexpectedly."
  if [ "$UPGRADE_PENDING_EXISTED" = true ]; then
    [ "$RELEASE_VERSION" = "$UPGRADE_TARGET_VERSION" ] || fail "The interrupted upgrade target is no longer available."
    [ "$MANIFEST_SHA256" = "$pending_manifest_sha" ] || fail "The interrupted upgrade manifest changed unexpectedly."
    verify_upgrade_backup
  else
    version_ge "$RELEASE_VERSION" "$UPGRADE_FROM_VERSION" || fail "Refusing to downgrade from $UPGRADE_FROM_VERSION to $RELEASE_VERSION."
    if [ "$RELEASE_VERSION" = "$UPGRADE_FROM_VERSION" ]; then
      [ "$MANIFEST_SHA256" = "$current_manifest_sha" ] || fail "The published manifest for installed release $RELEASE_VERSION changed unexpectedly."
    fi
    if [ "$RELEASE_VERSION" = "$UPGRADE_FROM_VERSION" ] && [ "${CPU_MODE_CHANGED:-false}" = false ]; then
      if curl --noproxy '*' --connect-timeout 3 --max-time 5 -fsS "http://127.0.0.1:$HTTP_PORT/api/v1/system/health/ready" >/dev/null 2>&1; then
        log "LinkSense $EDITION is already running the latest release $RELEASE_VERSION. No backup or restart was needed."
        return
      fi
      fail "The latest release is installed but unhealthy. Run repair-$EDITION.sh."
    fi
  fi
  validate_resource_budget
  fetch_release_resources

  log_stage "Stage 4/9: pull and verify target images and edition assets."
  pull_release_images
  probe_host_runtime
  download_tokenizer

  if [ "$UPGRADE_PENDING_EXISTED" = false ]; then
    check_upgrade_backup_storage
    snapshot_upgrade_configuration
    log_stage "Stage 5/9: drain active work and stop write-producing services."
    stop_upgrade_runtime
    log_stage "Stage 6/9: create and validate the pre-upgrade PostgreSQL backup."
    UPGRADE_STARTED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    create_upgrade_backup
    write_upgrade_pending false
  else
    log_stage "Stage 5/9: resume the interrupted upgrade safely."
    stop_upgrade_runtime
    log "Reusing validated backup: $UPGRADE_BACKUP_URI"
  fi

  log_stage "Stage 7/9: install target configuration and run database migration."
  UPGRADE_CONFIG_CHANGED=true
  write_and_activate_runtime_env
  install_resources
  publish_tokenizer
  compose config --quiet
  compose up -d postgres redis minio
  compose run --rm minio-init
  UPGRADE_MIGRATION_STARTED=true
  write_upgrade_pending true
  compose run --rm migrate
  compose up -d --remove-orphans

  log_stage "Stage 8/9: verify service readiness and edition capabilities."
  wait_for_health
  run_full_release_probe
  log_stage "Stage 9/9: record the verified upgrade state."
  activate_management_cli
  host_save_tools
  write_success_state "$UPGRADE_INSTALLED_AT"
  log "Upgraded LinkSense $EDITION from $UPGRADE_FROM_VERSION to $RELEASE_VERSION successfully."
  host_text baseline
  log "Pre-upgrade database backup: $UPGRADE_BACKUP_URI"
  log "Open: $LINKSENSE_PUBLIC_BASE_URL"
}

log_stage "Stage 1: run the read-only host preflight."
validate_install_dir
TMP_ROOT=$(mktemp -d)
host_lock_installation
resolve_http_port
resolve_cpu_mode
preflight

if [ "$ACTION" = install ]; then
  log_stage "Stage 2/7: verify immutable release inputs and download configuration."
  fetch_manifest "$(release_base)"
  install_action
elif [ "$ACTION" = repair ]; then
  repair_action
else
  upgrade_action
fi
