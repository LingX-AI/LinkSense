#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
for command in docker git python3 curl timeout flock; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
docker buildx version >/dev/null
docker compose version >/dev/null
test -z "$(git status --porcelain --untracked-files=normal)" || { echo "Refusing to deploy a checkout with uncommitted changes" >&2; exit 1; }
revision=$(git rev-parse HEAD)
project=${COMPOSE_PROJECT_NAME:-linksense-uat}
port=${LINKSENSE_HTTP_PORT:-19090}
public_url=${LINKSENSE_PUBLIC_BASE_URL:-http://127.0.0.1:$port}
if [ ! -f .data/uat/runtime.env ] && docker volume inspect "$project-postgres" >/dev/null 2>&1; then
  echo "Existing UAT data requires its original runtime.env; restore it before deploying" >&2
  exit 1
fi
mkdir -p .data/uat
exec 9>.data/uat/deploy.lock
flock -n 9 || { echo "Another UAT deployment is running" >&2; exit 1; }
docker_root=$(docker info --format '{{.DockerRootDir}}')
free_kb=$(df -Pk "$docker_root" | awk 'NR == 2 {print $4}')
test "$free_kb" -ge 20971520 || { echo "Core source deployment needs at least 20 GiB free in Docker storage" >&2; exit 1; }
node_image=$(python3 -c 'import json; print(json.load(open("deploy/baselines/images.lock.json"))["runtimes"]["node"])')
if [ "${LINKSENSE_UAT_CACHED_BASELINES:-0}" = 1 ]; then
  node_image=linksense-uat-cache/node:${node_image##*sha256:}
  docker image inspect "$node_image" >/dev/null
else
  timeout 600 docker pull "$node_image"
fi
timeout 60 docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$root:$root" -w "$root" \
  -e "LINKSENSE_SOURCE_REVISION=$revision" -e "COMPOSE_PROJECT_NAME=$project" \
  -e "LINKSENSE_PUBLIC_BASE_URL=$public_url" -e "LINKSENSE_HTTP_PORT=$port" \
  -e "LINKSENSE_UAT_CACHED_BASELINES=${LINKSENSE_UAT_CACHED_BASELINES:-0}" \
  "$node_image" node deploy/uat/prepare.mjs
compose() {
  timeout 3600 docker compose --project-directory "$root" --env-file "$root/.data/uat/runtime.env" -p "$project" \
    -f "$root/deploy/release/compose.common.yml" -f "$root/deploy/release/compose.core.yml" \
    -f "$root/deploy/uat/compose.yml" "$@"
}
compose config --quiet
for role in POSTGRES REDIS MINIO USER_DATA BACKUP; do
  volume=$(python3 -c 'import json,sys; key="LINKSENSE_"+sys.argv[1]+"_VOLUME"; print(next(json.loads(line.split("=",1)[1]) for line in open(".data/uat/runtime.env") if line.startswith(key+"=")))' "$role")
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    owner=$(docker volume inspect --format '{{index .Labels "com.linksense.uat-project"}}' "$volume")
    test "$owner" = "$project" || { echo "Refusing to reuse an unowned UAT volume: $volume" >&2; exit 1; }
    if [ "$role" = USER_DATA ]; then
      contract=$(docker volume inspect --format '{{.Driver}}|{{json .Options}}|{{index .Labels "com.linksense.managed-by"}}|{{index .Labels "com.linksense.persistence"}}|{{index .Labels "com.linksense.role"}}' "$volume")
      case "$contract" in
        'local|null|linksense-production|critical|user-data'|'local|{}|linksense-production|critical|user-data') ;;
        *) echo "UAT user-data volume does not satisfy the Runner security contract: $volume" >&2; exit 1 ;;
      esac
    fi
  else
    case "$role" in USER_DATA) volume_role=user-data ;; BACKUP) volume_role=backups ;; *) volume_role=$(printf '%s' "$role" | tr 'A-Z' 'a-z') ;; esac
    docker volume create --driver local --label "com.linksense.uat-project=$project" \
      --label com.linksense.managed-by=linksense-production --label com.linksense.persistence=critical \
      --label "com.linksense.role=$volume_role" "$volume" >/dev/null
  fi
done
echo "Building UAT source revision $revision"
if [ -n "${LINKSENSE_UAT_BUILD_PROXY:-}" ]; then
  export LINKSENSE_UAT_BUILD_PROXY
  python3 - <<'PY'
import json, os
proxy = os.environ['LINKSENSE_UAT_BUILD_PROXY']
args = {'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy, 'NO_PROXY': 'localhost,127.0.0.1,::1'}
services = {name: {'build': {'network': 'host', 'entitlements': ['network.host'], 'args': args}} for name in ['migrate', 'api', 'runner', 'worker-image', 'web']}
with open('.data/uat/proxy-build.json', 'w') as output:
    json.dump({'services': services}, output)
PY
  trap 'rm -f "$root/.data/uat/proxy-build.json"' EXIT HUP INT TERM
  HTTP_PROXY="$LINKSENSE_UAT_BUILD_PROXY" HTTPS_PROXY="$LINKSENSE_UAT_BUILD_PROXY" \
    COMPOSE_PARALLEL_LIMIT=1 compose -f "$root/.data/uat/proxy-build.json" --progress plain build migrate api runner worker-image web
else
  COMPOSE_PARALLEL_LIMIT=1 compose --progress plain build migrate api runner worker-image web
fi
# Build failure leaves the running environment intact. Never delete UAT volumes.
compose up -d --wait --wait-timeout 180 postgres redis minio
schema_present=$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT to_regclass('\''public.conversation_turns'\'') IS NOT NULL"')
if [ "$schema_present" = t ]; then
  active=$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM conversation_turns WHERE status = '\''running'\''"')
  test "$active" = 0 || { echo "UAT has running tasks; stop them before updating" >&2; exit 1; }
  backup=$root/.data/uat/database-$(date -u +%Y%m%dT%H%M%SZ).dump
  compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup.partial"
  compose exec -T postgres pg_restore --list < "$backup.partial" >/dev/null
  mv "$backup.partial" "$backup"
fi
compose up -d --wait --wait-timeout 600
curl --connect-timeout 5 --max-time 20 --fail --silent "http://127.0.0.1:$port/api/v1/system/health/ready" >/dev/null
compose ps
printf '\nCore UAT ready: %s\nSource revision: %s\nInitialization credential: %s/.data/uat/initialization.txt (private file)\n' "$public_url" "$revision" "$root"
