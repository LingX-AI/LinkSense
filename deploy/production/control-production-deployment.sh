#!/bin/sh

set -eu

umask 077

usage() {
  cat <<'EOF'
Usage: control-production-deployment.sh status
       control-production-deployment.sh stop
       control-production-deployment.sh kill

Inspect or terminate the single LinkSense production deployment that owns the
deployment lock.

Commands:
  status  Show whether a deployment owns the lock and identify its process.
  stop    Send TERM to the deployment process tree and allow rollback cleanup.
  kill    Try TERM briefly, then use KILL if the deployment cannot stop.

Environment:
  LINKSENSE_DEPLOY_LOCK_FILE
          Override the deployment lock path.
  LINKSENSE_DEPLOY_STATE_FILE
          Override the deployment state path.
  LINKSENSE_DEPLOY_STOP_WAIT_SECONDS
          Seconds to allow rollback cleanup for "stop" (default: 180).
  LINKSENSE_DEPLOY_KILL_GRACE_SECONDS
          Seconds to allow cleanup before "kill" escalates (default: 15).

Never delete the lock file while it is held. Doing so creates a second lock
inode and can allow two deployments to run concurrently.
EOF
}

case "${1:-status}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "control-production-deployment.sh must run as root" >&2
  exit 1
fi

script_directory="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
deployment_root="${LINKSENSE_DEPLOYMENT_ROOT:-$(CDPATH= cd -- "${script_directory}/../.." && pwd)}"
lock_file="${LINKSENSE_DEPLOY_LOCK_FILE:-/run/lock/linksense-deploy.lock}"
state_file="${LINKSENSE_DEPLOY_STATE_FILE:-${lock_file}.state}"
stop_wait_seconds="${LINKSENSE_DEPLOY_STOP_WAIT_SECONDS:-180}"
kill_grace_seconds="${LINKSENSE_DEPLOY_KILL_GRACE_SECONDS:-15}"

case "$stop_wait_seconds" in
  *[!0-9]* | "")
    echo "LINKSENSE_DEPLOY_STOP_WAIT_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac
case "$kill_grace_seconds" in
  *[!0-9]* | "")
    echo "LINKSENSE_DEPLOY_KILL_GRACE_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$stop_wait_seconds" -lt 1 ] || [ "$kill_grace_seconds" -lt 1 ]; then
  echo "deployment stop wait limits must be at least 1 second" >&2
  exit 1
fi

for command_name in awk flock fuser id kill ps sleep tr; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
done

command_name="${1:-status}"
case "$command_name" in
  status | stop | kill)
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "unsupported command: $command_name" >&2
    usage >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "unexpected extra arguments" >&2
  usage >&2
  exit 2
fi

install_lock_parent() {
  lock_parent="$(dirname "$lock_file")"
  [ -d "$lock_parent" ] || {
    echo "deployment lock directory does not exist: $lock_parent" >&2
    exit 1
  }
}

lock_is_held() {
  if flock -n "$lock_file" true 2>/dev/null; then
    return 1
  fi
  return 0
}

lock_holder_pids() {
  fuser "$lock_file" 2>/dev/null | tr ' ' '\n' | awk '/^[0-9]+$/ { print }'
}

pid_is_lock_holder() {
  expected_pid="$1"
  for holder_pid in $(lock_holder_pids); do
    if [ "$holder_pid" = "$expected_pid" ]; then
      return 0
    fi
  done
  return 1
}

process_is_deployment() {
  candidate_pid="$1"
  case "$candidate_pid" in
    *[!0-9]* | "") return 1 ;;
  esac
  kill -0 "$candidate_pid" 2>/dev/null || return 1
  candidate_command="$(ps -p "$candidate_pid" -o args= 2>/dev/null || true)"
  case "$candidate_command" in
    *deploy/production/deploy-production.sh*) return 0 ;;
    *) return 1 ;;
  esac
}

read_recorded_pid() {
  [ -f "$state_file" ] || return 1
  awk -F= '$1 == "PID" && $2 ~ /^[0-9]+$/ { print $2; exit }' "$state_file"
}

find_deployment_pid() {
  recorded_pid="$(read_recorded_pid || true)"
  if process_is_deployment "$recorded_pid" && pid_is_lock_holder "$recorded_pid"; then
    printf '%s\n' "$recorded_pid"
    return 0
  fi

  matched_pid=""
  for holder_pid in $(lock_holder_pids); do
    if process_is_deployment "$holder_pid"; then
      if [ -n "$matched_pid" ] && [ "$matched_pid" != "$holder_pid" ]; then
        echo "multiple deployment processes own the lock; refusing an ambiguous termination" >&2
        return 1
      fi
      matched_pid="$holder_pid"
    fi
  done
  [ -n "$matched_pid" ] || return 1
  printf '%s\n' "$matched_pid"
}

remove_stale_state() {
  [ -f "$state_file" ] || return 0
  recorded_pid="$(read_recorded_pid || true)"
  if ! process_is_deployment "$recorded_pid" || ! pid_is_lock_holder "$recorded_pid"; then
    rm -f "$state_file"
  fi
}

deployment_descendants() {
  root_pid="$1"
  ps -eo pid=,ppid= | awk -v root="$root_pid" '
    {
      process_count += 1
      process_id[process_count] = $1
      parent_id[process_count] = $2
    }
    END {
      selected[root] = 1
      for (pass = 1; pass <= process_count; pass += 1) {
        for (index = 1; index <= process_count; index += 1) {
          if (selected[parent_id[index]]) selected[process_id[index]] = 1
        }
      }
      for (index = process_count; index >= 1; index -= 1) {
        if (process_id[index] != root && selected[process_id[index]]) {
          print process_id[index]
        }
      }
    }
  '
}

signal_pid_list() {
  signal_name="$1"
  process_ids="$2"
  for process_id in $process_ids; do
    kill "-${signal_name}" "$process_id" 2>/dev/null || true
  done
}

wait_until_unlocked() {
  remaining_seconds="$1"
  while [ "$remaining_seconds" -gt 0 ]; do
    if ! lock_is_held; then
      return 0
    fi
    sleep 1
    remaining_seconds=$((remaining_seconds - 1))
  done
  ! lock_is_held
}

print_status() {
  if ! lock_is_held; then
    remove_stale_state
    echo "No LinkSense production deployment is running."
    return 0
  fi

  deployment_pid="$(find_deployment_pid || true)"
  if [ -z "$deployment_pid" ]; then
    echo "The deployment lock is held, but its owner cannot be verified safely." >&2
    echo "Do not delete the lock file. Inspect it with: sudo fuser -v '$lock_file'" >&2
    return 2
  fi

  started_at=""
  if [ -f "$state_file" ]; then
    started_at="$(awk -F= '$1 == "STARTED_AT" { print $2; exit }' "$state_file")"
  fi
  elapsed_time="$(ps -p "$deployment_pid" -o etime= 2>/dev/null | awk '{$1=$1; print}')"
  echo "LinkSense production deployment is running."
  echo "PID: $deployment_pid"
  [ -z "$started_at" ] || echo "Started at (UTC): $started_at"
  [ -z "$elapsed_time" ] || echo "Elapsed: $elapsed_time"
  echo "Deployment root: $deployment_root"
}

stop_deployment() {
  escalation="$1"
  if ! lock_is_held; then
    remove_stale_state
    echo "No LinkSense production deployment is running."
    return 0
  fi

  deployment_pid="$(find_deployment_pid || true)"
  if [ -z "$deployment_pid" ]; then
    echo "Refusing to terminate an unverified lock owner." >&2
    echo "Inspect it with: sudo fuser -v '$lock_file'" >&2
    return 2
  fi

  echo "Requesting deployment PID ${deployment_pid} to stop and run its cleanup..."
  verified_process_ids="$(deployment_descendants "$deployment_pid") $deployment_pid"
  signal_pid_list TERM "$verified_process_ids"

  wait_seconds="$stop_wait_seconds"
  if [ "$escalation" = "kill" ]; then
    wait_seconds="$kill_grace_seconds"
  fi
  if wait_until_unlocked "$wait_seconds"; then
    remove_stale_state
    echo "The production deployment stopped and released its lock."
    return 0
  fi

  if [ "$escalation" != "kill" ]; then
    echo "The deployment is still cleaning up after ${wait_seconds} seconds." >&2
    echo "Check status again, or explicitly run this script with 'kill' to force termination." >&2
    return 3
  fi

  echo "Cleanup did not finish after ${wait_seconds} seconds; forcing the verified deployment process tree to stop." >&2
  # Keep the original verified PID set: if the root shell exited while one of
  # its children retained fd 9, that child may already have been re-parented.
  current_process_ids="$(deployment_descendants "$deployment_pid") $deployment_pid"
  signal_pid_list KILL "$verified_process_ids $current_process_ids"
  if wait_until_unlocked 15; then
    remove_stale_state
    echo "The production deployment was forcefully terminated and released its lock."
    echo "Because forced termination bypasses deployment cleanup, verify maintenance mode and service health before redeploying." >&2
    return 0
  fi

  echo "The verified deployment process was killed, but another process still owns the lock." >&2
  echo "Do not delete the lock file. Inspect it with: sudo fuser -v '$lock_file'" >&2
  return 4
}

install_lock_parent
case "$command_name" in
  status) print_status ;;
  stop) stop_deployment stop ;;
  kill) stop_deployment kill ;;
esac
