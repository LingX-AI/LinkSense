#!/bin/sh
set -eu

HOST_OS=$(uname -s)
HOST_ARCHITECTURE=$(uname -m)
CURRENT_UID=$(id -u)

case "${LINKSENSE_CLI_LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en-US}}}}" in
  zh*|ZH*) CLI_LANGUAGE=zh-CN ;;
  *) CLI_LANGUAGE=en-US ;;
esac

text() {
  key=$1
  shift
  case "$CLI_LANGUAGE:$key" in
    zh-CN:unsupported_host) printf '不支持的主机系统：%s。' "$1" ;;
    zh-CN:run_without_sudo) printf '请使用当前 macOS 账号运行 linksense，不要使用 sudo。' ;;
    zh-CN:sudo_missing) printf '管理 LinkSense 需要 root 权限，但系统未安装 sudo。' ;;
    zh-CN:install_missing) printf '没有在 %s 找到可信的 LinkSense 安装。' "$1" ;;
    zh-CN:invalid_install) printf 'LinkSense 安装目录或状态文件不安全：%s' "$1" ;;
    zh-CN:docker_missing) printf '没有找到 Docker CLI。' ;;
    zh-CN:docker_stopped) printf 'Docker Engine 不可用；macOS 请启动 Docker Desktop，Linux 请启动 Docker 服务。' ;;
    zh-CN:compose_missing) printf '没有找到 Docker Compose V2。' ;;
    zh-CN:invalid_command) printf '不支持的命令：%s' "$1" ;;
    zh-CN:invalid_selection) printf '无效的菜单选项。' ;;
    zh-CN:label_version) printf '版本' ;;
    zh-CN:label_edition) printf '版本类型' ;;
    zh-CN:label_platform) printf '平台' ;;
    zh-CN:label_status) printf '状态' ;;
    zh-CN:label_address) printf '访问地址' ;;
    zh-CN:status_ready) printf '运行正常' ;;
    zh-CN:status_unavailable) printf '未就绪或已停止' ;;
    zh-CN:started) printf 'LinkSense 已启动：%s' "$1" ;;
    zh-CN:stopped) printf 'LinkSense 已停止；持久化数据卷未被删除。' ;;
    zh-CN:restarted) printf 'LinkSense 已重启：%s' "$1" ;;
    zh-CN:health_failed) printf 'LinkSense 未能在端口 %s 上通过健康检查。' "$1" ;;
    zh-CN:doctor_ok) printf 'LinkSense 健康诊断通过。' ;;
    zh-CN:volume_missing) printf '持久化数据卷 %s 不存在。' "$1" ;;
    zh-CN:volume_invalid) printf '持久化数据卷 %s 缺少可信的 LinkSense 数据标签。' "$1" ;;
    zh-CN:service_invalid) printf '未知的 LinkSense 服务：%s' "$1" ;;
    zh-CN:port_prompt) printf '请输入新的 TCP 端口：' ;;
    zh-CN:port_invalid) printf '端口必须是 1 到 65535 之间的整数。' ;;
    zh-CN:port_restricted) printf '端口 %s 会被主流浏览器限制，请选择其他端口。' "$1" ;;
    zh-CN:port_same) printf 'LinkSense 已经使用端口 %s。' "$1" ;;
    zh-CN:port_occupied) printf '端口 %s 已被占用。' "$1" ;;
    zh-CN:port_unsupported) printf '当前安装配置不支持安全修改端口，请先升级 LinkSense。' ;;
    zh-CN:port_changed) printf '端口已从 %s 修改为 %s；访问地址：%s' "$1" "$2" "$3" ;;
    zh-CN:port_rollback) printf '端口修改失败，已恢复端口 %s 和原配置。' "$1" ;;
    zh-CN:credential_unavailable) printf '无法读取系统初始化状态。' ;;
    zh-CN:credential_expired) printf '系统已经完成初始化，一次性初始化凭证已失效。' ;;
    zh-CN:credential_not_required) printf '当前部署不需要一次性初始化凭证。' ;;
    zh-CN:credential_warning) printf '警告：该凭证只能用于创建首个管理员，请立即安全保存且不要分享。' ;;
    zh-CN:credential_label) printf '一次性初始化凭证' ;;
    zh-CN:confirm_credential) printf '确认当前屏幕不会被他人看到？[y/N] ' ;;
    zh-CN:cancelled) printf '操作已取消。' ;;
    zh-CN:repair_missing) printf '本次安装没有可用的 %s 修复脚本。' "$1" ;;
    zh-CN:upgrade_missing) printf '本次安装没有可用的升级脚本。' ;;
    zh-CN:menu_title) printf 'LinkSense 管理工具' ;;
    zh-CN:menu_status) printf '查看服务状态' ;;
    zh-CN:menu_start) printf '启动 LinkSense' ;;
    zh-CN:menu_stop) printf '停止 LinkSense' ;;
    zh-CN:menu_restart) printf '重启 LinkSense' ;;
    zh-CN:menu_address) printf '查看访问地址' ;;
    zh-CN:menu_port) printf '修改访问端口' ;;
    zh-CN:menu_credential) printf '查看初始化凭证' ;;
    zh-CN:menu_logs) printf '查看服务日志' ;;
    zh-CN:menu_doctor) printf '运行健康诊断' ;;
    zh-CN:menu_repair) printf '修复当前版本' ;;
    zh-CN:menu_upgrade) printf '升级 LinkSense' ;;
    zh-CN:menu_exit) printf '退出' ;;
    zh-CN:menu_prompt) printf '请输入命令编号：' ;;
    zh-CN:usage) printf '%s\n' \
      '用法：linksense [命令]' \
      '命令：status、start、stop、restart、address、port <端口>、credential、logs [服务]、doctor、version、repair、upgrade [版本]' ;;
    en-US:unsupported_host) printf 'Unsupported host operating system: %s.' "$1" ;;
    en-US:run_without_sudo) printf 'Run linksense from the current macOS account without sudo.' ;;
    en-US:sudo_missing) printf 'Managing LinkSense requires root privileges, but sudo is not installed.' ;;
    en-US:install_missing) printf 'No trusted LinkSense installation was found at %s.' "$1" ;;
    en-US:invalid_install) printf 'The LinkSense installation directory or state is unsafe: %s' "$1" ;;
    en-US:docker_missing) printf 'Docker CLI was not found.' ;;
    en-US:docker_stopped) printf 'Docker Engine is unavailable; start Docker Desktop on macOS or the Docker service on Linux.' ;;
    en-US:compose_missing) printf 'Docker Compose V2 was not found.' ;;
    en-US:invalid_command) printf 'Unsupported command: %s' "$1" ;;
    en-US:invalid_selection) printf 'Invalid menu selection.' ;;
    en-US:label_version) printf 'Version' ;;
    en-US:label_edition) printf 'Edition' ;;
    en-US:label_platform) printf 'Platform' ;;
    en-US:label_status) printf 'Status' ;;
    en-US:label_address) printf 'Address' ;;
    en-US:status_ready) printf 'ready' ;;
    en-US:status_unavailable) printf 'not ready or stopped' ;;
    en-US:started) printf 'LinkSense started: %s' "$1" ;;
    en-US:stopped) printf 'LinkSense stopped; persistent data volumes were not deleted.' ;;
    en-US:restarted) printf 'LinkSense restarted: %s' "$1" ;;
    en-US:health_failed) printf 'LinkSense did not pass its readiness check on port %s.' "$1" ;;
    en-US:doctor_ok) printf 'LinkSense diagnostics passed.' ;;
    en-US:volume_missing) printf 'Persistent data volume %s does not exist.' "$1" ;;
    en-US:volume_invalid) printf 'Persistent data volume %s is missing trusted LinkSense data labels.' "$1" ;;
    en-US:service_invalid) printf 'Unknown LinkSense service: %s' "$1" ;;
    en-US:port_prompt) printf 'Enter the new TCP port: ' ;;
    en-US:port_invalid) printf 'The port must be an integer between 1 and 65535.' ;;
    en-US:port_restricted) printf 'Port %s is restricted by major browsers; choose another port.' "$1" ;;
    en-US:port_same) printf 'LinkSense already uses port %s.' "$1" ;;
    en-US:port_occupied) printf 'Port %s is already in use.' "$1" ;;
    en-US:port_unsupported) printf 'This installation cannot change ports safely; upgrade LinkSense first.' ;;
    en-US:port_changed) printf 'Port changed from %s to %s; open %s' "$1" "$2" "$3" ;;
    en-US:port_rollback) printf 'Port migration failed; port %s and the previous configuration were restored.' "$1" ;;
    en-US:credential_unavailable) printf 'The system initialization status could not be read.' ;;
    en-US:credential_expired) printf 'The system is initialized and the one-time initialization credential has expired.' ;;
    en-US:credential_not_required) printf 'This deployment does not require a one-time initialization credential.' ;;
    en-US:credential_warning) printf 'Warning: use this credential only to create the first administrator. Save it securely and do not share it.' ;;
    en-US:credential_label) printf 'One-time initialization credential' ;;
    en-US:confirm_credential) printf 'Confirm that nobody else can see this screen? [y/N] ' ;;
    en-US:cancelled) printf 'Operation cancelled.' ;;
    en-US:repair_missing) printf 'The %s repair script is unavailable in this installation.' "$1" ;;
    en-US:upgrade_missing) printf 'The upgrade script is unavailable in this installation.' ;;
    en-US:menu_title) printf 'LinkSense Control' ;;
    en-US:menu_status) printf 'Show service status' ;;
    en-US:menu_start) printf 'Start LinkSense' ;;
    en-US:menu_stop) printf 'Stop LinkSense' ;;
    en-US:menu_restart) printf 'Restart LinkSense' ;;
    en-US:menu_address) printf 'Show access address' ;;
    en-US:menu_port) printf 'Change access port' ;;
    en-US:menu_credential) printf 'Show initialization credential' ;;
    en-US:menu_logs) printf 'Show service logs' ;;
    en-US:menu_doctor) printf 'Run diagnostics' ;;
    en-US:menu_repair) printf 'Repair the installed release' ;;
    en-US:menu_upgrade) printf 'Upgrade LinkSense' ;;
    en-US:menu_exit) printf 'Exit' ;;
    en-US:menu_prompt) printf 'Select a command: ' ;;
    en-US:usage) printf '%s\n' \
      'Usage: linksense [command]' \
      'Commands: status, start, stop, restart, address, port <port>, credential, logs [service], doctor, version, repair, upgrade [version]' ;;
    *) printf 'Unknown message: %s' "$key" ;;
  esac
}

say() {
  text "$@"
  printf '\n'
}

die() {
  say "$@" >&2
  exit 1
}

case "$HOST_OS" in
  Linux)
    case "$HOST_ARCHITECTURE" in
      x86_64|amd64) HOST_PLATFORM=linux-amd64 ;;
      aarch64|arm64) HOST_PLATFORM=linux-arm64 ;;
      *) die unsupported_host "$HOST_OS/$HOST_ARCHITECTURE" ;;
    esac
    DEFAULT_INSTALL_DIR=/opt/linksense
    if [ "$CURRENT_UID" -ne 0 ]; then
      command -v sudo >/dev/null 2>&1 || die sudo_missing
      if [ -n "${LINKSENSE_RELEASE_BASE_URL:-}" ]; then
        exec sudo env \
          "LINKSENSE_INSTALL_DIR=${LINKSENSE_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}" \
          "LINKSENSE_CLI_LANGUAGE=$CLI_LANGUAGE" \
          "LINKSENSE_RELEASE_BASE_URL=$LINKSENSE_RELEASE_BASE_URL" \
          "$0" "$@"
      fi
      exec sudo env \
        "LINKSENSE_INSTALL_DIR=${LINKSENSE_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}" \
        "LINKSENSE_CLI_LANGUAGE=$CLI_LANGUAGE" \
        "$0" "$@"
    fi
    ;;
  Darwin)
    case "$HOST_ARCHITECTURE" in
      x86_64|amd64) HOST_PLATFORM=linux-amd64 ;;
      arm64|aarch64) HOST_PLATFORM=linux-arm64 ;;
      *) die unsupported_host "$HOST_OS/$HOST_ARCHITECTURE" ;;
    esac
    [ "$CURRENT_UID" -ne 0 ] || die run_without_sudo
    DEFAULT_INSTALL_DIR=${HOME:?HOME is required on macOS}/.linksense
    ;;
  *) die unsupported_host "$HOST_OS" ;;
esac

INSTALL_DIR=${LINKSENSE_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}
STATE_FILE=$INSTALL_DIR/install-state.env
ENV_FILE=$INSTALL_DIR/.env

file_owner_uid() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1" 2>/dev/null
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

validate_installation_file() {
  file=$1
  [ -f "$file" ] && [ ! -L "$file" ] || die install_missing "$INSTALL_DIR"
  [ "$(file_owner_uid "$file" 2>/dev/null || true)" = "$CURRENT_UID" ] || die invalid_install "$file"
  [ "$(file_mode "$file" 2>/dev/null || true)" = 600 ] || die invalid_install "$file"
}

read_key() {
  file=$1
  expected=$2
  awk -F= -v expected="$expected" '
    $1 == expected {
      count += 1
      value = substr($0, length($1) + 2)
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$file"
}

validate_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

validate_version() {
  printf '%s' "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
}

validate_install_dir() {
  printf '%s' "$INSTALL_DIR" | grep -Eq '^/[A-Za-z0-9._/-]+$' || die invalid_install "$INSTALL_DIR"
  case "/${INSTALL_DIR#/}/" in */../*|*/./*) die invalid_install "$INSTALL_DIR" ;; esac
  [ -d "$INSTALL_DIR" ] && [ ! -L "$INSTALL_DIR" ] || die install_missing "$INSTALL_DIR"
}

load_installation() {
  validate_install_dir
  validate_installation_file "$STATE_FILE"
  validate_installation_file "$ENV_FILE"
  EDITION=$(read_key "$STATE_FILE" STATE_EDITION 2>/dev/null || true)
  VERSION=$(read_key "$STATE_FILE" STATE_RELEASE_VERSION 2>/dev/null || true)
  PLATFORM=$(read_key "$STATE_FILE" STATE_PLATFORM 2>/dev/null || true)
  STATE_INSTALL_DIR=$(read_key "$STATE_FILE" STATE_INSTALL_DIR 2>/dev/null || true)
  HTTP_PORT=$(read_key "$STATE_FILE" STATE_HTTP_PORT 2>/dev/null || true)
  PUBLIC_BASE_URL=$(read_key "$ENV_FILE" LINKSENSE_PUBLIC_BASE_URL 2>/dev/null || true)
  RUNTIME_PORT=$(read_key "$ENV_FILE" LINKSENSE_HTTP_PORT 2>/dev/null || true)
  case "$EDITION" in core|full) ;; *) die invalid_install "$STATE_FILE" ;; esac
  validate_version "$VERSION" || die invalid_install "$STATE_FILE"
  case "$PLATFORM" in linux-amd64|linux-arm64) ;; *) die invalid_install "$STATE_FILE" ;; esac
  [ "$PLATFORM" = "$HOST_PLATFORM" ] || die invalid_install "$STATE_FILE"
  [ "$STATE_INSTALL_DIR" = "$INSTALL_DIR" ] || die invalid_install "$STATE_FILE"
  validate_port "$HTTP_PORT" || die invalid_install "$STATE_FILE"
  [ "$HTTP_PORT" = "$RUNTIME_PORT" ] || die invalid_install "$ENV_FILE"
  printf '%s' "$PUBLIC_BASE_URL" | grep -Eq '^https?://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$' || die invalid_install "$ENV_FILE"
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || die docker_missing
  docker info >/dev/null 2>&1 || die docker_stopped
  docker compose version >/dev/null 2>&1 || die compose_missing
}

compose() {
  docker compose --project-directory "$INSTALL_DIR" \
    --env-file "$ENV_FILE" \
    -f "$INSTALL_DIR/compose.common.yml" \
    -f "$INSTALL_DIR/compose.$EDITION.yml" "$@"
}

local_url() {
  printf 'http://127.0.0.1:%s' "$1"
}

ready() {
  curl -fsS "$(local_url "$1")/api/v1/system/health/ready" >/dev/null 2>&1
}

wait_until_ready() {
  port=$1
  attempts=0
  maximum=${LINKSENSE_CLI_WAIT_ATTEMPTS:-60}
  interval=${LINKSENSE_CLI_WAIT_INTERVAL_SECONDS:-2}
  while [ "$attempts" -lt "$maximum" ]; do
    ready "$port" && return 0
    attempts=$((attempts + 1))
    [ "$attempts" -ge "$maximum" ] || sleep "$interval"
  done
  return 1
}

wait_until_service_ready() {
  service=$1
  attempts=0
  maximum=${LINKSENSE_CLI_WAIT_ATTEMPTS:-60}
  interval=${LINKSENSE_CLI_WAIT_INTERVAL_SECONDS:-2}
  while [ "$attempts" -lt "$maximum" ]; do
    container_id=$(compose ps -q "$service" 2>/dev/null || true)
    if [ -n "$container_id" ]; then
      service_state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "$container_id" 2>/dev/null || true)
      case "$service_state" in healthy|running) return 0 ;; esac
    fi
    attempts=$((attempts + 1))
    [ "$attempts" -ge "$maximum" ] || sleep "$interval"
  done
  return 1
}

recreate_public_services() {
  port=$1
  compose up -d --no-deps --force-recreate api
  wait_until_service_ready api || return 1
  compose up -d --no-deps --force-recreate gateway
  wait_until_ready "$port"
}

command_status() {
  ensure_docker
  printf '%s: %s\n' "$(text label_version)" "$VERSION"
  printf '%s: %s\n' "$(text label_edition)" "$EDITION"
  printf '%s: %s\n' "$(text label_platform)" "$PLATFORM"
  printf '%s: %s\n' "$(text label_address)" "$PUBLIC_BASE_URL"
  if ready "$HTTP_PORT"; then
    printf '%s: %s\n' "$(text label_status)" "$(text status_ready)"
  else
    printf '%s: %s\n' "$(text label_status)" "$(text status_unavailable)"
  fi
  compose ps --all
}

command_start() {
  ensure_docker
  compose config --quiet
  compose up -d --remove-orphans
  wait_until_ready "$HTTP_PORT" || die health_failed "$HTTP_PORT"
  say started "$PUBLIC_BASE_URL"
}

sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

remove_task_workers() {
  control_network=$(read_key "$ENV_FILE" LINKSENSE_WORKER_CONTROL_NETWORK 2>/dev/null || true)
  user_volume=$(read_key "$ENV_FILE" LINKSENSE_USER_DATA_VOLUME 2>/dev/null || true)
  [ -n "$control_network" ] && [ -n "$user_volume" ] || return 0
  worker_identity=$(printf '["linksense-runner-storage-domain","%s","volume","%s"]' "$control_network" "$user_volume")
  instance=$(sha256_text "$worker_identity" | cut -c1-32)
  worker_ids=$(docker ps -aq \
    --filter 'label=com.linksense.runner.managed=true' \
    --filter "label=com.linksense.runner.instance=$instance")
  [ -n "$worker_ids" ] || return 0
  for worker_id in $worker_ids; do
    managed=$(docker inspect --format '{{ index .Config.Labels "com.linksense.runner.managed" }}' "$worker_id")
    actual_instance=$(docker inspect --format '{{ index .Config.Labels "com.linksense.runner.instance" }}' "$worker_id")
    [ "$managed" = true ] && [ "$actual_instance" = "$instance" ] || die invalid_install "$worker_id"
    docker stop --time 60 "$worker_id" >/dev/null 2>&1 || true
    docker rm "$worker_id" >/dev/null
  done
}

command_stop() {
  ensure_docker
  compose stop -t 60 api runner >/dev/null 2>&1 || true
  remove_task_workers
  compose stop -t 60
  say stopped
}

command_restart() {
  ensure_docker
  compose config --quiet
  compose stop -t 60 api runner >/dev/null 2>&1 || true
  remove_task_workers
  compose restart -t 60
  wait_until_ready "$HTTP_PORT" || die health_failed "$HTTP_PORT"
  say restarted "$PUBLIC_BASE_URL"
}

is_browser_restricted_port() {
  case "$1" in
    1|7|9|11|13|15|17|19|20|21|22|23|25|37|42|43|53|69|77|79|87|95|101|102|103|104|109|110|111|113|115|117|119|123|135|137|138|139|143|161|179|389|427|465|512|513|514|515|526|530|531|532|540|548|554|556|563|587|601|636|989|990|993|995|1719|1720|1723|2049|3659|4045|5060|5061|6000|6566|6665|6666|6667|6668|6669|6697|10080) return 0 ;;
    *) return 1 ;;
  esac
}

port_in_use() {
  port=$1
  [ -z "$(docker ps --filter "publish=$port" --format '{{.ID}}' | head -n 1)" ] || return 0
  if command -v ss >/dev/null 2>&1; then
    [ -z "$(ss -H -ltn "sport = :$port" 2>/dev/null | head -n 1)" ] || return 0
  elif command -v lsof >/dev/null 2>&1; then
    [ -z "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 {print; exit}')" ] || return 0
  elif command -v netstat >/dev/null 2>&1; then
    [ -z "$(netstat -ltn 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" {print; exit}')" ] || return 0
  elif [ -r /proc/net/tcp ]; then
    port_hex=$(printf '%04X' "$port")
    [ -z "$(awk -v port=":$port_hex" '$2 ~ port "$" && $4 == "0A" {print; exit}' /proc/net/tcp /proc/net/tcp6 2>/dev/null)" ] || return 0
  fi
  return 1
}

replace_public_port() {
  url=$1
  old_port=$2
  new_port=$3
  scheme=${url%%://*}
  authority=${url#*://}
  case "$authority" in
    \[*\]:*) host=${authority%:*}; explicit_port=${authority##*:} ;;
    \[*\]) host=$authority; explicit_port= ;;
    *:*) host=${authority%:*}; explicit_port=${authority##*:} ;;
    *) host=$authority; explicit_port= ;;
  esac
  if [ -n "$explicit_port" ] && [ "$explicit_port" != "$old_port" ]; then
    printf '%s' "$url"
  elif [ -z "$explicit_port" ] && [ "$scheme" = https ]; then
    printf '%s' "$url"
  else
    printf '%s://%s:%s' "$scheme" "$host" "$new_port"
  fi
}

write_runtime_port() {
  target=$1
  new_port=$2
  new_public=$3
  new_minio=$4
  temporary=$target.cli-next.$$
  if ! awk -F= -v port="$new_port" -v public="$new_public" -v minio="$new_minio" '
    /^LINKSENSE_HTTP_PORT=/ { print "LINKSENSE_HTTP_PORT=" port; seen_port=1; next }
    /^LINKSENSE_PUBLIC_BASE_URL=/ { print "LINKSENSE_PUBLIC_BASE_URL=" public; seen_public=1; next }
    /^MINIO_PUBLIC_URL=/ { print "MINIO_PUBLIC_URL=" minio; seen_minio=1; next }
    { print }
    END { if (!seen_port || !seen_public || !seen_minio) exit 1 }
  ' "$target" >"$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod 0600 "$temporary"
  mv "$temporary" "$target"
}

write_state_port() {
  target=$1
  new_port=$2
  changed_at=$3
  temporary=$target.cli-next.$$
  if ! awk -F= -v port="$new_port" -v changed_at="$changed_at" '
    /^STATE_HTTP_PORT=/ { print "STATE_HTTP_PORT=" port; seen_port=1; next }
    /^STATE_LAST_PORT_CHANGE_AT=/ { print "STATE_LAST_PORT_CHANGE_AT=" changed_at; seen_changed=1; next }
    { print }
    END {
      if (!seen_port) exit 1
      if (!seen_changed) print "STATE_LAST_PORT_CHANGE_AT=" changed_at
    }
  ' "$target" >"$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod 0600 "$temporary"
  mv "$temporary" "$target"
}

gateway_running() {
  gateway_id=$(compose ps -q gateway 2>/dev/null || true)
  [ -n "$gateway_id" ] || return 1
  [ "$(docker inspect --format '{{.State.Running}}' "$gateway_id" 2>/dev/null || true)" = true ]
}

rollback_port() {
  backup_dir=$1
  old_port=$2
  cp -p "$backup_dir/.env" "$ENV_FILE"
  cp -p "$backup_dir/install-state.env" "$STATE_FILE"
  if [ "$3" = true ]; then
    recreate_public_services "$old_port" >/dev/null 2>&1 || true
  fi
  load_installation
  say port_rollback "$old_port" >&2
}

command_port() {
  new_port=${1:-}
  validate_port "$new_port" || die port_invalid
  is_browser_restricted_port "$new_port" && die port_restricted "$new_port"
  [ "$new_port" != "$HTTP_PORT" ] || { say port_same "$HTTP_PORT"; return; }
  ensure_docker
  port_in_use "$new_port" && die port_occupied "$new_port"
  grep -F '${LINKSENSE_HTTP_PORT' "$INSTALL_DIR/compose.common.yml" >/dev/null 2>&1 || die port_unsupported

  old_port=$HTTP_PORT
  old_public=$PUBLIC_BASE_URL
  old_minio=$(read_key "$ENV_FILE" MINIO_PUBLIC_URL 2>/dev/null || true)
  [ -n "$old_minio" ] || die invalid_install "$ENV_FILE"
  new_public=$(replace_public_port "$old_public" "$old_port" "$new_port")
  if [ "$old_minio" = "$old_public" ]; then new_minio=$new_public; else new_minio=$old_minio; fi
  was_running=false
  gateway_running && was_running=true
  backup_dir=$INSTALL_DIR/backups/cli-port-$(date -u '+%Y%m%dT%H%M%SZ')-$$
  install -d -m 0700 "$INSTALL_DIR/backups" "$backup_dir"
  cp -p "$ENV_FILE" "$backup_dir/.env"
  cp -p "$STATE_FILE" "$backup_dir/install-state.env"
  changed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  if ! write_runtime_port "$ENV_FILE" "$new_port" "$new_public" "$new_minio" || \
     ! write_state_port "$STATE_FILE" "$new_port" "$changed_at"; then
    rollback_port "$backup_dir" "$old_port" "$was_running"
    return 1
  fi
  HTTP_PORT=$new_port
  PUBLIC_BASE_URL=$new_public
  if ! compose config --quiet; then
    rollback_port "$backup_dir" "$old_port" "$was_running"
    return 1
  fi
  if [ "$was_running" = true ]; then
    if ! recreate_public_services "$new_port"; then
      rollback_port "$backup_dir" "$old_port" "$was_running"
      return 1
    fi
  fi
  say port_changed "$old_port" "$new_port" "$new_public"
}

command_credential() {
  require_confirmation=${1:-false}
  if [ "$require_confirmation" = true ]; then
    text confirm_credential
    IFS= read -r confirmation || confirmation=
    case "$confirmation" in y|Y|yes|YES|Yes|是) ;; *) say cancelled; return ;; esac
  fi
  response=$(curl -fsS "$(local_url "$HTTP_PORT")/api/v1/system/bootstrap" 2>/dev/null || true)
  [ -n "$response" ] || die credential_unavailable
  if printf '%s' "$response" | grep -Eq '"initialized"[[:space:]]*:[[:space:]]*true'; then
    say credential_expired
    return
  fi
  if ! printf '%s' "$response" | grep -Eq '"initialization_credential_required"[[:space:]]*:[[:space:]]*true'; then
    say credential_not_required
    return
  fi
  credential=$(read_key "$ENV_FILE" LINKSENSE_INITIALIZATION_TOKEN 2>/dev/null || true)
  [ -n "$credential" ] || die invalid_install "$ENV_FILE"
  say credential_warning
  printf '\n%s:\n%s\n' "$(text credential_label)" "$credential"
}

command_logs() {
  ensure_docker
  service=${1:-}
  if [ -n "$service" ]; then
    printf '%s' "$service" | grep -Eq '^[a-z0-9-]+$' || die service_invalid "$service"
    compose config --services | grep -Fx "$service" >/dev/null 2>&1 || die service_invalid "$service"
    compose logs --tail 200 "$service"
  else
    compose logs --tail 200
  fi
}

command_doctor() {
  ensure_docker
  compose config --quiet
  volumes=$(read_key "$STATE_FILE" STATE_DATA_VOLUMES 2>/dev/null || true)
  [ -n "$volumes" ] || die invalid_install "$STATE_FILE"
  old_ifs=$IFS
  IFS=,
  for volume in $volumes; do
    [ -z "$volume" ] && continue
    docker volume inspect "$volume" >/dev/null 2>&1 || die volume_missing "$volume"
    managed=$(docker volume inspect --format '{{ index .Labels "com.linksense.managed-by" }}' "$volume" 2>/dev/null || true)
    persistence=$(docker volume inspect --format '{{ index .Labels "com.linksense.persistence" }}' "$volume" 2>/dev/null || true)
    [ "$managed" = linksense-production ] && [ "$persistence" = critical ] || die volume_invalid "$volume"
  done
  IFS=$old_ifs
  ready "$HTTP_PORT" || die health_failed "$HTTP_PORT"
  compose ps --all
  say doctor_ok
}

command_repair() {
  ensure_docker
  repair_script=$INSTALL_DIR/bin/repair-$EDITION.sh
  [ -x "$repair_script" ] || die repair_missing "$EDITION"
  release_base=$(read_key "$STATE_FILE" STATE_RELEASE_BASE_URL 2>/dev/null || true)
  if [ -n "$release_base" ]; then
    LINKSENSE_INSTALL_DIR=$INSTALL_DIR LINKSENSE_RELEASE_BASE_URL=$release_base "$repair_script"
  else
    LINKSENSE_INSTALL_DIR=$INSTALL_DIR "$repair_script"
  fi
}

command_upgrade() {
  ensure_docker
  upgrade_script=$INSTALL_DIR/bin/upgrade.sh
  [ -x "$upgrade_script" ] || die upgrade_missing
  target=${1:-}
  [ -z "$target" ] || validate_version "$target" || die invalid_command "$target"
  if [ -n "$target" ]; then
    LINKSENSE_INSTALL_DIR=$INSTALL_DIR LINKSENSE_VERSION=$target "$upgrade_script"
  else
    LINKSENSE_INSTALL_DIR=$INSTALL_DIR "$upgrade_script"
  fi
}

show_menu() {
  while :; do
    printf '\n================ %s ================\n' "$(text menu_title)"
    printf '%s: %s  %s: %s  %s: %s\n' \
      "$(text label_version)" "$VERSION" \
      "$(text label_edition)" "$EDITION" \
      "$(text label_address)" "$PUBLIC_BASE_URL"
    printf '\n(1) %-24s (6) %s\n' "$(text menu_status)" "$(text menu_port)"
    printf '(2) %-24s (7) %s\n' "$(text menu_start)" "$(text menu_credential)"
    printf '(3) %-24s (8) %s\n' "$(text menu_stop)" "$(text menu_logs)"
    printf '(4) %-24s (9) %s\n' "$(text menu_restart)" "$(text menu_doctor)"
    printf '(5) %-24s (10) %s\n' "$(text menu_address)" "$(text menu_repair)"
    printf '(11) %s\n' "$(text menu_upgrade)"
    printf '(0) %s\n\n' "$(text menu_exit)"
    text menu_prompt
    IFS= read -r selection || return 0
    case "$selection" in
      1) command_status ;;
      2) command_start ;;
      3) command_stop ;;
      4) command_restart ;;
      5) printf '%s\n' "$PUBLIC_BASE_URL" ;;
      6) text port_prompt; IFS= read -r requested_port || requested_port=; command_port "$requested_port" ;;
      7) command_credential true ;;
      8) command_logs ;;
      9) command_doctor ;;
      10) command_repair ;;
      11) command_upgrade ;;
      0) return 0 ;;
      *) say invalid_selection >&2 ;;
    esac
  done
}

command=${1:-menu}
case "$command" in
  help|-h|--help) text usage; printf '\n'; exit 0 ;;
esac

load_installation

case "$command" in
  menu) show_menu ;;
  status) command_status ;;
  start) command_start ;;
  stop) command_stop ;;
  restart) command_restart ;;
  address) printf '%s\n' "$PUBLIC_BASE_URL" ;;
  port) shift; command_port "${1:-}" ;;
  credential) command_credential false ;;
  logs) shift; command_logs "${1:-}" ;;
  doctor) command_doctor ;;
  version) printf '%s (%s, %s)\n' "$VERSION" "$EDITION" "$PLATFORM" ;;
  repair) command_repair ;;
  upgrade) shift; command_upgrade "${1:-}" ;;
  *) die invalid_command "$command" ;;
esac
