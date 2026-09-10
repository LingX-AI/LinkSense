import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const nginxConfigPath = resolve("deploy/nginx/default.conf.template");
const assistantHtmlPreviewShellPath = resolve(
  "apps/web/public/assistant-html-preview-shell.html",
);
const apiDockerfilePath = resolve("Dockerfile.api");
const developmentDockerfilePath = resolve("Dockerfile.dev");
const runnerDockerfilePath = resolve("Dockerfile.runner");
const runnerRuntimeSmokePath = resolve(
  "deploy/docker/runner-runtime-smoke.mjs",
);
const webDockerfilePath = resolve("Dockerfile.web");
const composePath = resolve("docker-compose.yml");
const developmentComposePath = resolve("docker-compose.dev.yml");
const productionComposePath = resolve("docker-compose.production.yml");
const productionStackComposePath = resolve(
  "docker-compose.production-stack.yml",
);
const productionGatewayPath = resolve(
  "deploy/nginx/production-gateway.conf.template",
);
const productionHostNginxExamplePath = resolve(
  "deploy/production/host-nginx.example.conf",
);
const productionPostgresBackupPath = resolve(
  "deploy/production/postgres-backup.sh",
);
const productionBootstrapPath = resolve(
  "deploy/production/bootstrap-production.sh",
);
const productionDeployPath = resolve(
  "deploy/production/deploy-production.sh",
);
const apiPackagePath = resolve("apps/api/package.json");
const docsPackagePath = resolve("apps/docs/package.json");
const webViteConfigPath = resolve("apps/web/vite.config.ts");
const developmentScriptPath = resolve("scripts/dev.mjs");
const environmentExamplePath = resolve(".env.example");
const debianAptConfigurationPath = resolve(
  "deploy/docker/configure-debian-apt.sh",
);
const redisAdapterPath = resolve("apps/api/src/adapters/redis.ts");
const maintenanceJobsPath = resolve("apps/api/src/adapters/jobs.ts");
const codexConfigPath = resolve("deploy/codex-home-template/config.toml");
const codexAuthPath = resolve("deploy/codex-home-template/auth.json");
const codexSystemRequirementsPath = resolve(
  "deploy/codex-system/requirements.toml",
);
const planStopHookPath = resolve("deploy/runtime/node/plan-stop-hook.mjs");
const runnerCodexProtocolPath = resolve("apps/runner/src/codex/protocol.ts");
const runnerIndexPath = resolve("apps/runner/src/index.ts");
const runnerBrowserCliWrapperPath = resolve(
  "apps/runner/src/browser/cli-wrapper.ts",
);
const runnerEnvironmentExamplePath = resolve("deploy/runner.env.example");
const runtimeOwnerMigrationPath = resolve(
  "prisma/migrations/20260715120000_add_runtime_cleanup_owner/migration.sql",
);
const publishedStartIntentMigrationPath = resolve(
  "prisma/migrations/20260715170000_add_conversation_turn_start_intents/migration.sql",
);
const turnIdempotencyMetadataMigrationPath = resolve(
  "prisma/migrations/20260715180000_add_turn_idempotency_metadata/migration.sql",
);
const pluginCredentialMappingMigrationPath = resolve(
  "prisma/migrations/20260817153000_map_plugin_credential_fields/migration.sql",
);
const formResponseSnapshotsMigrationPath = resolve(
  "prisma/migrations/20260817215500_add_form_response_snapshots/migration.sql",
);
const publishedMigrationChecksums = new Map([
  [
    "prisma/migrations/20260710120000_init/migration.sql",
    "7b3992746e283497aaaed8f5701e7f82879b0994ae13ade767ac810879b15528",
  ],
  [
    "prisma/migrations/20260711130000_add_runtime_cleanup_outbox/migration.sql",
    "5f901b2b911463842c7292fc2c72289d3aa9c443402bbf8c7f4c43bd1388ed1c",
  ],
  [
    "prisma/migrations/20260715120000_add_runtime_cleanup_owner/migration.sql",
    "78972fc38b35411f80c6629ee35831c661b5a95eec213c844e1fa3c653a12330",
  ],
  [
    "prisma/migrations/20260715170000_add_conversation_turn_start_intents/migration.sql",
    "425c13e057c3d0a02868ab9a24a6ba7f4a006c1563d695a84a42b64767b2d895",
  ],
  [
    "prisma/migrations/20260715180000_add_turn_idempotency_metadata/migration.sql",
    "4a2e7ba11520f7f4b768896c126292daaa3d6204d834c9a6ba56440d02a1344c",
  ],
]);
const pythonRuntimeProjectPath = resolve(
  "deploy/runtime/python/pyproject.toml",
);
const pythonRuntimeLockPath = resolve("deploy/runtime/python/uv.lock");
const pythonRuntimeWrapperPath = resolve("deploy/runtime/python/linksense-uv");
const nodeRuntimeProjectPath = resolve("deploy/runtime/node/package.json");
const nodeRuntimeLockPath = resolve("deploy/runtime/node/pnpm-lock.yaml");
const nodeRuntimeHookPath = resolve("deploy/runtime/node/register-hooks.mjs");
const nodePnpmLauncherPath = resolve("deploy/runtime/node/pnpm");
const nodeRuntimeWrapperPath = resolve("deploy/runtime/node/linksense-pnpm");
const pluginStdioWrapperPath = resolve(
  "deploy/runtime/node/linksense-plugin-stdio",
);
const browserRuntimeProjectPath = resolve(
  "deploy/runtime/browser/package.json",
);
const browserRuntimeLockPath = resolve("deploy/runtime/browser/pnpm-lock.yaml");
const browserRuntimeWrapperPath = resolve(
  "deploy/runtime/browser/linksense-browser",
);
const browserRuntimeInitPagePath = resolve(
  "deploy/runtime/browser/init-page.ts",
);
const bashEnvironmentBootstrapPath = resolve(
  "deploy/runtime/shell/linksense-bash-env.sh",
);
const execFileAsync = promisify(execFile);

function extractProductionHeredoc(script, filename) {
  const marker = `cat >"\${temporary_root}/${filename}" <<'EOF'\n`;
  const startIndex = script.indexOf(marker);
  assert.notEqual(startIndex, -1, `missing production heredoc: ${filename}`);
  const contentStart = startIndex + marker.length;
  const endIndex = script.indexOf("\nEOF\n", contentStart);
  assert.notEqual(endIndex, -1, `unterminated production heredoc: ${filename}`);
  return script.slice(contentStart, endIndex);
}

test("workspace tests bound parallel services before running the complete web suite", async () => {
  const [rootPackage, apiPackage, webPackage, runnerPackage] = await Promise.all(
    [
      resolve("package.json"),
      resolve("apps/api/package.json"),
      resolve("apps/web/package.json"),
      resolve("apps/runner/package.json"),
    ].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );

  assert.equal(
    rootPackage.scripts.test,
    "pnpm --filter @linksense/shared build && pnpm run '/^test:(deployment|packages)$/' && pnpm --filter @linksense/web test",
  );
  assert.equal(
    rootPackage.scripts["test:packages"],
    "pnpm -r --parallel --filter './apps/**' --filter './packages/**' --filter '!@linksense/web' --if-present test",
  );
  assert.equal(
    apiPackage.scripts.test,
    "vitest run --pool=threads --maxWorkers=4 --maxConcurrency=2",
  );
  assert.equal(
    webPackage.scripts.test,
    "pnpm run '/^test:(unit|e2e)$/'",
  );
  assert.equal(
    webPackage.scripts["test:unit"],
    "vitest run --project application --maxWorkers=4 && vitest run --project components --project shared-components --project node --maxWorkers=4",
  );
  assert.equal(webPackage.scripts["test:e2e"], "playwright test");
  assert.equal(runnerPackage.scripts.test, "vitest run --pool=forks --maxWorkers=4");
});

function instrumentNormalizerForUnprivilegedFixture(source) {
  const privilegedImport =
    'import { chmod, chown, lchown, lstat, mkdir, readdir, rm } from "node:fs/promises";';
  assert.ok(source.includes(privilegedImport));
  return source.replace(
    privilegedImport,
    `import { chmod, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const ownershipCalls = [];
const recordOwnership = async (target, uid, gid) => {
  ownershipCalls.push({ target, uid, gid });
};
const chown = recordOwnership;
const lchown = recordOwnership;
process.on("exit", () => {
  const logPath = process.env.LINKSENSE_NORMALIZER_OWNERSHIP_LOG;
  if (logPath) writeFileSync(logPath, JSON.stringify(ownershipCalls));
});`,
  );
}

async function snapshotTree(root) {
  const snapshot = [];
  const visit = async (relative) => {
    const absolute = relative ? resolve(root, relative) : root;
    const info = await lstat(absolute);
    const mode = info.mode & 0o7777;
    if (info.isSymbolicLink()) {
      snapshot.push([relative, "symlink", mode, await readlink(absolute)]);
      return;
    }
    if (info.isDirectory()) {
      snapshot.push([relative, "directory", mode]);
      const children = await readdir(absolute);
      children.sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      );
      for (const child of children) {
        await visit(relative ? `${relative}/${child}` : child);
      }
      return;
    }
    if (info.isFile()) {
      snapshot.push([
        relative,
        "file",
        mode,
        createHash("sha256").update(await readFile(absolute)).digest("hex"),
      ]);
      return;
    }
    snapshot.push([relative, "special", mode]);
  };
  await visit("");
  return snapshot;
}

async function modeOf(target) {
  return (await lstat(target)).mode & 0o7777;
}

async function runUnprivilegedNormalizer(normalizer, root, temporaryRoot) {
  const executable = resolve(temporaryRoot, "normalize-user-volume.fixture.mjs");
  const ownershipLog = resolve(temporaryRoot, "ownership.json");
  await writeFile(
    executable,
    instrumentNormalizerForUnprivilegedFixture(normalizer),
    "utf8",
  );
  const result = await execFileAsync(process.execPath, [executable, root], {
    env: {
      ...process.env,
      LINKSENSE_NORMALIZER_OWNERSHIP_LOG: ownershipLog,
    },
  });
  return {
    ...result,
    ownershipCalls: JSON.parse(await readFile(ownershipLog, "utf8")),
  };
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

function extractShellFunction(source, name) {
  const marker = `${name}() {`;
  const startIndex = source.indexOf(marker);
  assert.notEqual(startIndex, -1, `missing shell function: ${name}`);
  const endIndex = source.indexOf("\n}\n", startIndex + marker.length);
  assert.notEqual(endIndex, -1, `unterminated shell function: ${name}`);
  return source.slice(startIndex, endIndex + 2);
}

test("Nginx access logs never record query strings or request bodies", async () => {
  const config = await readFile(nginxConfigPath, "utf8");

  assert.match(
    config,
    /log_format\s+linksense_safe\s+'\$request_method \$uri \$server_protocol';/u,
  );
  assert.match(
    config,
    /access_log\s+\/var\/log\/nginx\/access\.log\s+linksense_safe;/u,
  );
  assert.doesNotMatch(config, /\$(?:request_uri|args|query_string)\b/u);
  assert.doesNotMatch(config, /\$request(?:\s|['"])/u);
});

test("Nginx revalidates stable embed assets and only caches fingerprinted assets immutably", async () => {
  const config = await readFile(nginxConfigPath, "utf8");

  assert.match(config, /\/assets\/embed-app\.js "no-cache";/u);
  assert.match(config, /\/assets\/embed-app\.css "no-cache";/u);
  assert.match(
    config,
    /~\^\/assets\/ "public, max-age=31536000, immutable";/u,
  );
  assert.doesNotMatch(config, /\/assets\/app\.css "public,[^"]*immutable";/u);
});

test("Nginx never caches the application entry document or SPA fallbacks", async () => {
  const config = await readFile(nginxConfigPath, "utf8");
  const indexLocation = section(
    config,
    "location = /index.html",
    "location = /health/live",
  );
  const spaLocation = section(config, "location / {", undefined);

  assert.match(
    config,
    /\/index\.html "no-store, no-cache, must-revalidate, max-age=0";/u,
  );
  assert.match(config, /map \$uri \$linksense_pragma \{[^}]*\/index\.html "no-cache";/su);
  assert.match(config, /map \$uri \$linksense_expires \{[^}]*\/index\.html "0";/su);
  assert.match(config, /add_header Pragma \$linksense_pragma always;/u);
  assert.match(config, /add_header Expires \$linksense_expires always;/u);
  assert.match(indexLocation, /try_files \$uri =404;/u);
  assert.match(spaLocation, /try_files \$uri \$uri\/ \/index\.html;/u);
});

test("Nginx serves JavaScript modules with an executable MIME type", async () => {
  const config = await readFile(nginxConfigPath, "utf8");
  const moduleLocation = section(
    config,
    "location ~ \\.mjs$",
    "location /assets/",
  );

  assert.match(moduleLocation, /default_type application\/javascript;/u);
  assert.match(moduleLocation, /try_files \$uri =404;/u);
  assert.doesNotMatch(moduleLocation, /\/index\.html/u);
});

test("Nginx permits the same-origin XLSX Worker and WebAssembly runtime", async () => {
  const config = await readFile(nginxConfigPath, "utf8");
  const serverHeaders = section(
    config,
    "server {",
    "location = /health/live",
  );

  assert.match(
    serverHeaders,
    /script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';/u,
  );
  assert.doesNotMatch(serverHeaders, /script-src[^;]*'unsafe-eval'/u);
  assert.doesNotMatch(serverHeaders, /script-src[^;]*'unsafe-inline'/u);
});

test("production Compose keeps data services private and bounds runtime resources", async () => {
  const compose = await readFile(productionComposePath, "utf8");

  for (const service of ["postgres", "redis", "web"]) {
    const serviceSection = section(
      compose,
      `  ${service}:`,
      service === "web" ? "  gateway:" : `\n  ${service === "postgres" ? "redis" : "storage-init"}:`,
    );
    assert.match(serviceSection, /ports: !reset \[\]/u);
  }
  assert.match(
    compose,
    /LINKSENSE_GATEWAY_BIND_ADDRESS:-127\.0\.0\.1.*LINKSENSE_HTTP_PORT:-8080/u,
  );
  assert.match(compose, /replicas: \$\{LINKSENSE_API_REPLICAS:-2\}/u);
  assert.match(
    section(compose, "  runner:", "  api:"),
    /replicas: 1/u,
  );
  assert.match(compose, /LINKSENSE_MINIO_NETWORK:-minio_default/u);
  assert.match(
    compose,
    /LINKSENSE_ELASTICSEARCH_NETWORK:-elasticsearch_net/u,
  );
  assert.match(compose, /max-size: "20m"/u);
  assert.match(compose, /max-file: "5"/u);
  assert.match(compose, /limits:\s+cpus: "[0-9.]+"\s+memory:/u);
  assert.match(section(compose, "  api:", "  web:"), /read_only: true/u);
  assert.match(compose, /LINKSENSE_BACKUP_ROOT/u);
  assert.match(compose, /LINKSENSE_POSTGRES_BACKUP_RETENTION_DAYS/u);
});

test("Compose forwards bounded ClawHub synchronization settings to the API", async () => {
  const [compose, environmentExample] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(environmentExamplePath, "utf8"),
  ]);
  const api = section(compose, "  api:", "  web:");

  assert.match(
    api,
    /LINKSENSE_CLAWHUB_SYNC_TIME_ZONE: \$\{LINKSENSE_CLAWHUB_SYNC_TIME_ZONE:-Asia\/Shanghai\}/u,
  );
  assert.match(
    api,
    /LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS: \$\{LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS:-300000\}/u,
  );
  assert.match(
    environmentExample,
    /^LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS=300000$/mu,
  );
});

test("production stack Compose exposes the merged deployment through one platform-independent entrypoint", async () => {
  const compose = await readFile(productionStackComposePath, "utf8");

  assert.match(compose, /^name: linksense$/mu);
  assert.match(compose, /^include:$/mu);
  assert.match(compose, /^\s+- \.\/docker-compose\.yml$/mu);
  assert.match(compose, /^\s+- \.\/docker-compose\.production\.yml$/mu);
  assert.match(compose, /^\s+project_directory: \.$/mu);
  assert.match(
    compose,
    /^\s+env_file: \$\{LINKSENSE_COMPOSE_ENV_FILE:-\.env\.production\}$/mu,
  );
  assert.doesNotMatch(compose, /(?:PASSWORD|SECRET|API_KEY)=/u);
});

test("production gateway preserves HTTPS proxy semantics, SSE, and signed MinIO paths", async () => {
  const [gateway, hostExample] = await Promise.all([
    readFile(productionGatewayPath, "utf8"),
    readFile(productionHostNginxExamplePath, "utf8"),
  ]);

  assert.match(
    gateway,
    /log_format\s+linksense_gateway_safe\s+'\$request_method \$uri \$server_protocol';/u,
  );
  assert.doesNotMatch(gateway, /\$(?:request_uri|args|query_string)\b/u);
  const apiLocation = section(
    gateway,
    "  location /api/",
    "  location ~ ^/linksense-",
  );
  assert.match(gateway, /resolver 127\.0\.0\.11 valid=10s ipv6=off;/u);
  assert.match(gateway, /resolver_timeout 5s;/u);
  assert.match(
    gateway,
    /upstream linksense_api \{[\s\S]*zone linksense_api 64k;[\s\S]*server api:4000 resolve;[\s\S]*keepalive 64;[\s\S]*\}/u,
  );
  assert.match(
    gateway,
    /map \$http_x_forwarded_proto \$linksense_forwarded_proto \{[\s\S]*default \$\{NGINX_EXTERNAL_SCHEME\};[\s\S]*~\*\^http\$ http;[\s\S]*~\*\^https\$ https;[\s\S]*\}/u,
  );
  assert.match(apiLocation, /proxy_pass http:\/\/linksense_api;/u);
  assert.match(apiLocation, /proxy_intercept_errors off;/u);
  assert.match(
    apiLocation,
    /proxy_set_header X-Forwarded-Proto \$linksense_forwarded_proto;/u,
  );
  assert.match(apiLocation, /proxy_request_buffering off;/u);
  assert.match(apiLocation, /proxy_buffering off;/u);
  assert.match(apiLocation, /proxy_read_timeout 1h;/u);

  assert.match(
    gateway,
    /error_page 502 503 504 =503 @linksense_maintenance;/u,
  );
  const maintenanceChecks =
    gateway.match(
      /if \(-f \/tmp\/linksense-maintenance\) \{\s*return 503;\s*\}/gu,
    ) ?? [];
  assert.equal(maintenanceChecks.length, 4);
  const maintenanceLocation = section(
    gateway,
    "  location @linksense_maintenance",
    "  location /api/",
  );
  assert.match(maintenanceLocation, /default_type text\/html;/u);
  assert.match(maintenanceLocation, /Retry-After "30" always;/u);
  assert.match(maintenanceLocation, /Cache-Control "no-store" always;/u);
  assert.match(
    maintenanceLocation,
    /The system is under maintenance\. Please wait a moment\./u,
  );

  const minioLocation = section(
    gateway,
    "  location ~ ^/linksense-",
    "  location = /assistant-html-preview-shell.html",
  );
  const previewLocation = section(
    gateway,
    "  location = /assistant-html-preview-shell.html",
    "  location / {",
  );
  assert.match(minioLocation, /files\|knowledge/u);
  assert.match(minioLocation, /proxy_pass \$\{NGINX_MINIO_UPSTREAM\};/u);
  assert.match(minioLocation, /proxy_set_header Host \$http_host;/u);
  assert.match(minioLocation, /proxy_request_buffering off;/u);
  assert.match(previewLocation, /proxy_pass http:\/\/web:80;/u);
  assert.match(
    previewLocation,
    /proxy_hide_header Content-Security-Policy;/u,
  );
  assert.match(previewLocation, /proxy_hide_header Permissions-Policy;/u);
  assert.match(previewLocation, /proxy_hide_header Referrer-Policy;/u);
  assert.match(previewLocation, /proxy_hide_header X-Content-Type-Options;/u);
  assert.match(
    previewLocation,
    /proxy_hide_header Cross-Origin-Resource-Policy;/u,
  );
  assert.match(previewLocation, /proxy_hide_header Cache-Control;/u);
  assert.match(previewLocation, /add_header Cache-Control "no-store" always;/u);

  assert.match(hostExample, /proxy_pass http:\/\/127\.0\.0\.1:8080;/u);
  assert.match(hostExample, /proxy_set_header X-Forwarded-Proto https;/u);
  assert.match(hostExample, /client_max_body_size 210m;/u);
  assert.match(hostExample, /proxy_read_timeout 1h;/u);
  assert.match(hostExample, /proxy_intercept_errors on;/u);
  const hostApiLocation = section(
    hostExample,
    "location /api/",
    "location ~ ^/linksense-",
  );
  assert.match(hostApiLocation, /proxy_intercept_errors off;/u);
  assert.match(
    hostExample,
    /error_page 502 503 504 =503 @linksense_maintenance;/u,
  );
  assert.match(
    hostExample,
    /The system is under maintenance\. Please wait a moment\./u,
  );
});

test("production PostgreSQL backups are validated and published atomically", async () => {
  const script = await readFile(productionPostgresBackupPath, "utf8");

  assert.match(script, /^set -eu$/mu);
  assert.match(script, /^umask 077$/mu);
  assert.match(script, /partial_path="\$\{final_path\}\.partial"/u);
  assert.match(script, /pg_dump[\s\S]*--format=custom/u);
  assert.match(script, /pg_restore --list "\$partial_path"/u);
  assert.ok(
    script.indexOf('pg_restore --list "$partial_path"') <
      script.indexOf('mv "$partial_path" "$final_path"'),
  );
  assert.match(
    script,
    /backup_directory="\/backups\/postgres"[\s\S]*find "\$backup_directory" .* -mtime "\+\$\{retention_days\}" -delete/u,
  );
  assert.doesNotMatch(script, /echo[^\n]*PGPASSWORD/u);
});

test("production bootstrap generates isolated credentials without replacing an existing environment", async () => {
  const script = await readFile(productionBootstrapPath, "utf8");

  assert.match(script, /^umask 077$/mu);
  assert.match(script, /refusing to replace existing production environment/u);
  assert.match(script, /openssl rand -hex 32/u);
  assert.match(script, /minio\/mc:RELEASE\.2025-04-08T15-39-49Z/u);
  assert.match(script, /mc admin user add/u);
  assert.match(script, /mc admin policy attach/u);
  assert.match(script, /"cluster": \["monitor"\]/u);
  assert.match(script, /"privileges": \["all"\]/u);
  assert.match(script, /linksense-knowledge-prod/u);
  assert.match(script, /chmod 0600 "\$environment_working_file"/u);
  assert.match(script, /LINKSENSE_GATEWAY_BIND_ADDRESS 127\.0\.0\.1/u);
  assert.match(script, /https:\/\/\*\) external_scheme="https"/u);
  assert.match(script, /http:\/\/\*\) external_scheme="http"/u);
  assert.match(
    script,
    /set_environment_value LINKSENSE_EXTERNAL_SCHEME "\$external_scheme"/u,
  );
  assert.match(script, /LINKSENSE_API_REPLICAS 2/u);
  assert.match(script, /LINKSENSE_USER_DATA_VOLUME:-linksense-user-data/u);
  assert.match(script, /LINKSENSE_BACKUP_VOLUME:-linksense-backups/u);
  assert.match(script, /LINKSENSE_USER_DATA_ROOT \/srv\/linksense\/users/u);
  assert.match(script, /LINKSENSE_BACKUP_ROOT \/backups/u);
  assert.match(
    script,
    /LINKSENSE_ELASTICSEARCH_ADMIN_PASSWORD:\?LINKSENSE_ELASTICSEARCH_ADMIN_PASSWORD is required/u,
  );
  assert.match(script, /LINKSENSE_ELASTICSEARCH_ADMIN_USERNAME:-elastic/u);
  assert.doesNotMatch(script, /ELASTICSEARCH_COMPOSE_FILE|\/www\/server\/panel/u);
  assert.match(script, /volume_options" != "null"[\s\S]*volume_options" != "\{\}"/u);
  assert.match(script, /--label com\.linksense\.persistence=critical/u);
  assert.match(script, /ensure_volume_guard "\$user_data_volume" user-data/u);
  assert.match(script, /ensure_volume_guard "\$backup_volume" backups/u);
  assert.match(script, /--network none/u);
  assert.match(script, /--read-only/u);
  assert.match(script, /--cap-drop ALL/u);
  assert.match(script, /--security-opt no-new-privileges=true/u);
  assert.match(script, /--pids-limit 16/u);
  assert.match(script, /--memory 16m/u);
  assert.match(script, /--restart unless-stopped/u);
  assert.match(script, /dst=\/hold,readonly/u);
  assert.match(script, /Docker Engine API 1\.45 or newer is required/u);
  assert.match(script, /Docker Compose 2\.24\.4 or newer is required/u);
  assert.match(script, /BOOTSTRAPPED_SOURCE_REVISION=\$\{source_revision\}/u);
  assert.doesNotMatch(script, /^SOURCE_REVISION=/mu);
  assert.match(
    script,
    /environment_staging_file="\$\{environment_directory\}\/\.\$\(basename "\$environment_file"\)\.bootstrap-next\.\$\$"/u,
  );
  assert.match(
    script,
    /metadata_staging_file="\$\(dirname "\$metadata_file"\)\/\.\$\(basename "\$metadata_file"\)\.bootstrap-next\.\$\$"/u,
  );
  assert.ok(
    script.indexOf('mv -f "$metadata_staging_file" "$metadata_file"') <
      script.indexOf('mv -f "$environment_staging_file" "$environment_file"'),
  );
  assert.doesNotMatch(
    script,
    /mv "\$environment_working_file" "\$environment_file"/u,
  );
  assert.doesNotMatch(script, /LINKSENSE_(?:STATE_ROOT|USER_DATA_ROOT|BACKUP_ROOT) "/u);
  assert.match(script, /--connect-timeout 5/u);
  assert.match(script, /--max-time 20/u);
  assert.match(script, /--head/u);
  assert.doesNotMatch(script, /echo[^\n]*(?:password|secret).*\$/iu);
});

test("production scripts compare required versions with the installed awk", async () => {
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "linksense-production-version-check-"),
  );

  try {
    for (const scriptPath of [productionBootstrapPath, productionDeployPath]) {
      const source = await readFile(scriptPath, "utf8");
      const fixturePath = resolve(
        temporaryRoot,
        `${scriptPath === productionBootstrapPath ? "bootstrap" : "deploy"}.sh`,
      );
      await writeFile(
        fixturePath,
        `set -eu
${extractShellFunction(source, "version_at_least")}
version_at_least 1.45 1.45
version_at_least 1.46 1.45
version_at_least 2.24.10 2.24.4
if version_at_least 1.44 1.45; then
  exit 21
fi
if version_at_least 2.24.3 2.24.4; then
  exit 22
fi
printf '%s\\n' portable-version-comparison-ok
`,
        "utf8",
      );

      const { stdout } = await execFileAsync("sh", [fixturePath]);
      assert.equal(stdout, "portable-version-comparison-ok\n");
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("production deployment restores Git checkout modes without chmodding an empty path", async () => {
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "linksense-production-mode-restore-"),
  );
  const source = await readFile(productionDeployPath, "utf8");
  const fixturePath = resolve(temporaryRoot, "restore-modes.sh");
  const logPath = resolve(temporaryRoot, "chmod.log");

  try {
    await writeFile(
      fixturePath,
      `set -eu
git() {
  if [ "$1" != "-c" ] || [ "$2" != "core.quotePath=false" ] || [ "$3" != "ls-files" ] || [ "$4" != "-s" ]; then
    exit 31
  fi
  printf '100755 abcdef 0\\tdeploy/production/deploy-production.sh\\n'
  printf '100644 fedcba 0\\tapps/runner/src/process-pool.ts\\n'
  printf '100644 123456 0\\tdocs/file with spaces.md\\n'
  printf '100644 987654 0\\toutput/中文文件.html\\n'
}
chmod() {
  if [ -z "$2" ]; then
    exit 32
  fi
  printf '%s|%s\\n' "$1" "$2" >> "$LOG_FILE"
}
${extractShellFunction(source, "restore_git_checkout_modes")}
restore_git_checkout_modes
`,
      "utf8",
    );

    await execFileAsync("sh", [fixturePath], {
      env: { ...process.env, LOG_FILE: logPath },
    });

    assert.equal(
      await readFile(logPath, "utf8"),
      [
        "0755|deploy/production/deploy-production.sh",
        "0644|apps/runner/src/process-pool.ts",
        "0644|docs/file with spaces.md",
        "0644|output/中文文件.html",
        "",
      ].join("\n"),
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("production Git deployment is serialized, migration-gated, force-stopped, and rollbackable", async () => {
  const script = await readFile(productionDeployPath, "utf8");

  assert.match(script, /^set -eu$/mu);
  assert.match(script, /^umask 077$/mu);
  assert.match(script, /deploy-production\.sh must run as root/u);
  assert.match(script, /deploy_branch="main"/u);
  assert.match(script, /docker-compose\.production-stack\.yml/u);
  assert.match(
    script,
    /production_image_tag="\$\{LINKSENSE_PRODUCTION_IMAGE_TAG:-pro-latest\}"/u,
  );
  assert.match(
    script,
    /reuse_previous_worker_image="\$\{LINKSENSE_REUSE_PREVIOUS_WORKER_IMAGE:-0\}"/u,
  );
  assert.match(script, /image_tag="\$production_image_tag"/u);
  assert.match(script, /git status --porcelain --untracked-files=normal/u);
  assert.match(script, /flock -n 9/u);
  assert.match(script, /restore_git_checkout_modes\(\)/u);
  assert.match(script, /git -c core\.quotePath=false ls-files -s/u);
  assert.match(script, /IFS="\$\(printf '\\t'\)" read -r metadata path/u);
  assert.match(script, /\[ -z "\$path" \]/u);
  assert.match(script, /chmod 0755 "\$path"/u);
  assert.match(script, /chmod 0644 "\$path"/u);
  assert.match(script, /umask 022[\s\S]*git fetch --prune "\$remote_name" "\$deploy_branch"/u);
  assert.match(script, /git fetch --prune "\$remote_name" "\$deploy_branch"/u);
  assert.match(
    script,
    /umask 022[\s\S]*git -c pull\.rebase=false pull --ff-only "\$remote_name" "\$deploy_branch"/u,
  );
  assert.match(
    script,
    /git -c pull\.rebase=false pull --ff-only "\$remote_name" "\$deploy_branch"/u,
  );
  assert.match(
    script,
    /git -c pull\.rebase=false pull --ff-only "\$remote_name" "\$deploy_branch"[\s\S]*restore_git_checkout_modes/u,
  );
  assert.match(script, /running_script_hash="\$\(sha256sum "\$0"/u);
  assert.match(script, /current_script_hash="\$\(sha256sum "\$0"/u);
  assert.match(script, /LINKSENSE_DEPLOY_SCRIPT_REEXEC_REVISION/u);
  assert.match(script, /re-executing the fetched version/u);
  assert.match(
    script,
    /exec "\$\{deployment_root\}\/deploy\/production\/deploy-production\.sh" "\$@"/u,
  );
  assert.match(script, /\[ "\$deployed_revision" = "\$target_revision" \]/u);
  assert.match(script, /\[ "\$force_rebuild" -ne 1 \]/u);
  assert.match(script, /\[ "\$volume_cutover" -ne 1 \]/u);
  assert.match(script, /existing_release_is_healthy\(\)/u);
  assert.match(
    script,
    /for service_name in postgres redis runner api web gateway postgres-backup/u,
  );
  assert.match(script, /production gateway is still in maintenance mode/u);
  assert.match(
    script,
    /if existing_release_is_healthy; then[\s\S]*Production is already healthy at/u,
  );
  assert.match(script, /runtime is incomplete or unhealthy; continuing deployment/u);
  assert.match(script, /--allow-migrations/u);
  assert.match(script, /git diff --name-only[^\n]*prisma\/migrations/u);
  assert.doesNotMatch(script, /git (?:reset|checkout -f)|docker compose down/u);
  assert.doesNotMatch(script, /docker (?:system|image|builder) prune/u);
  assert.doesNotMatch(script, /prod-\$\{release_timestamp\}/u);
  assert.match(script, /worker_source_fingerprint\(\)/u);
  assert.match(script, /worker_runtime_changed_paths\(\)/u);
  assert.match(script, /worker_rebuild_changed_paths\(\)/u);
  assert.match(script, /worker_browser_runtime_changed_paths\(\)/u);
  assert.match(script, /git ls-tree -r "\$target_revision"/u);
  assert.match(script, /git diff --name-only "\$worker_runtime_base" "\$target_revision"/u);
  assert.match(script, /git diff --name-only "\$worker_rebuild_base" "\$target_revision"/u);
  assert.match(script, /git diff --name-only "\$worker_browser_runtime_base" "\$target_revision"/u);
  assert.match(script, /cannot reuse the previous worker image because worker runtime inputs changed/u);
  assert.match(script, /docker tag "\$previous_worker_image" "\$worker_image"/u);
  assert.match(script, /Worker image inputs changed since the last successful deployment; rebuilding/u);
  assert.match(script, /Worker image inputs did not change since \$\{deployed_revision\}; keeping \$\{worker_image\}/u);
  assert.match(script, /Existing worker image is missing its fingerprint label; rebuilding/u);
  assert.match(script, /worker_build_target="worker-cached-browser"/u);
  assert.match(script, /Reusing browser runtime from \$\{browser_runtime_cache_image\}/u);
  assert.match(script, /LINKSENSE_WORKER_BUILD_TARGET/u);
  assert.match(script, /LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE/u);
  assert.match(script, /build_services="migrate api runner web"/u);
  assert.match(script, /Reusing worker image \$\{worker_image\}/u);
  assert.match(script, /capture_previous_image_ids/u);
  assert.match(script, /restore_previous_image_ids/u);
  assert.match(script, /validate_production_volumes\(\)/u);
  assert.match(
    script,
    /validate_managed_volume "\$user_volume" user-data[\s\S]*ensure_volume_guard "\$user_volume" user-data[\s\S]*validate_volume_guard_running "\$user_volume" user-data/u,
  );
  assert.match(script, /production volume must not define local-driver options/u);
  assert.ok(
    script.lastIndexOf("\nprepare_storage_contract\n") <
      script.lastIndexOf('migration_state="unchanged"'),
  );
  assert.ok(
    script.lastIndexOf("\nprepare_storage_contract\n") >
      script.lastIndexOf('git -c pull.rebase=false pull --ff-only'),
  );

  const buildIndex = script.indexOf("compose build $build_services");
  const capacityIndex = script.lastIndexOf("\nvalidate_migration_capacity\n");
  const maintenanceIndex = script.lastIndexOf("\n  activate_maintenance\n");
  const stopIndex = script.lastIndexOf("\n  stop_deployment_execution\n");
  const runtimeTouchedIndex = script.lastIndexOf("\n  runtime_touched=1\n");
  const settleIndex = script.lastIndexOf("\n  settle_deployment_execution\n");
  const backupIndex = script.lastIndexOf("create_postgres_backup");
  const capabilityPathRewriteIndex = script.lastIndexOf(
    "rewrite_legacy_capability_storage_paths",
  );
  const upIndex = script.lastIndexOf(
    "--force-recreate migrate runner-worker-image runner api web postgres-backup",
  );
  const verifyIndex = script.lastIndexOf("verify_release");
  const maintenanceEndIndex = script.lastIndexOf("\n  deactivate_maintenance\n");
  for (const index of [
    buildIndex,
    capacityIndex,
    maintenanceIndex,
    stopIndex,
    runtimeTouchedIndex,
    settleIndex,
    backupIndex,
    capabilityPathRewriteIndex,
    upIndex,
    verifyIndex,
    maintenanceEndIndex,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(buildIndex < maintenanceIndex);
  assert.ok(buildIndex < capacityIndex);
  assert.ok(capacityIndex < maintenanceIndex);
  assert.ok(maintenanceIndex < runtimeTouchedIndex);
  assert.ok(runtimeTouchedIndex < stopIndex);
  assert.ok(stopIndex < settleIndex);
  assert.ok(settleIndex < backupIndex);
  assert.doesNotMatch(script, /wait_for_active_operations|active_operation_count|LINKSENSE_DEPLOY_WAIT_SECONDS/u);
  assert.match(script, /execution_settled.*-ne 1[\s\S]*Maintenance remains enabled/u);
  assert.ok(backupIndex < capabilityPathRewriteIndex);
  assert.ok(capabilityPathRewriteIndex < upIndex);
  assert.ok(backupIndex < upIndex);
  assert.ok(upIndex < verifyIndex);
  assert.ok(verifyIndex < maintenanceEndIndex);
  assert.match(script, /if \[ "\$fresh_install" -eq 1 \]; then/u);
  assert.match(script, /existing_production_ids="\$\(compose ps -aq \| awk 'NF' \| sort -u\)"/u);
  assert.match(script, /label=com\.docker\.compose\.volume=postgres-data/u);
  assert.match(script, /label=com\.docker\.compose\.volume=redis-data/u);
  assert.match(script, /production containers or data volumes already exist/u);
  assert.match(script, /refusing to treat an existing installation as fresh/u);
  assert.match(
    script,
    /legacy bind storage and missing successful deployment metadata cannot be treated as a fresh install/u,
  );
  assert.match(script, /initial startup without drain or pre-deploy backup/u);
  assert.match(script, /no previous production runtime exists to restore/u);
  assert.match(script, /else[\s\S]*activate_maintenance[\s\S]*create_postgres_backup[\s\S]*fi/u);
  assert.match(
    script,
    /migrate service always runs both deploy and seed[\s\S]*migration_may_have_applied=1[\s\S]*compose up -d/u,
  );
  assert.match(script, /release_committed=1[\s\S]*deactivate_maintenance/u);
  assert.match(
    script,
    /compose up -d --wait --wait-timeout "\$health_wait_seconds" --remove-orphans \\\s+--force-recreate migrate runner-worker-image runner api web gateway postgres-backup/u,
  );
  assert.match(
    script,
    /else[\s\S]*--force-recreate migrate runner-worker-image runner api web postgres-backup[\s\S]*reload_gateway_configuration[\s\S]*fi/u,
  );
  assert.equal(
    script.match(
      /--force-recreate migrate runner-worker-image runner api web gateway postgres-backup/gu,
    )?.length,
    1,
  );
  assert.match(script, /Keep the existing Gateway container and its \/tmp maintenance marker alive/u);
  assert.match(
    script,
    /Gateway did not become available after removing maintenance; restoring the maintenance response/u,
  );
  assert.match(
    script,
    /wait_for_gateway_response 200 ""[\s\S]*: > \/tmp\/linksense-maintenance[\s\S]*wait_for_gateway_response 503 "\$maintenance_message"/u,
  );

  assert.doesNotMatch(script, /compose stop --timeout 30 gateway/u);
  assert.doesNotMatch(script, /20-envsubst-on-templates\.sh/u);
  assert.match(
    script,
    /gateway_template="\$\{deployment_root\}\/deploy\/nginx\/production-gateway\.conf\.template"/u,
  );
  assert.match(script, /envsubst "\$defined_environment_variables"/u);
  assert.match(script, /<"\$gateway_template"/u);
  assert.match(
    script,
    /next_config="\/etc\/nginx\/conf\.d\/\.default\.conf\.linksense-next"/u,
  );
  assert.match(
    script,
    /previous_config="\/etc\/nginx\/conf\.d\/\.default\.conf\.linksense-previous"/u,
  );
  assert.match(script, /nginx -t/u);
  assert.match(script, /nginx -s reload/u);
  assert.match(script, /\/tmp\/linksense-maintenance/u);
  assert.match(
    script,
    /The system is under maintenance\. Please wait a moment\./u,
  );

  assert.match(script, /dist\/commands\/deployment-task-stop.js/u);
  assert.match(script, /--runtime-stopped/u);
  assert.match(script, /pg_dump[\s\S]*--format=custom/u);
  assert.match(script, /pg_restore --list "\$temporary_dump"/u);
  assert.match(script, /linksense-predeploy-\$\{timestamp\}\.dump/u);
  assert.match(script, /volume:\/\/\$\{backup_volume\}\/postgres\/linksense-predeploy-/u);
  assert.match(script, /--mount "type=volume,src=\$\{backup_volume\},dst=\/backups"/u);
  assert.match(script, /com\.linksense\.runner\.managed=true/u);
  assert.match(script, /com\.linksense\.runner\.instance=\$\{expected_instance\}/u);
  assert.match(
    script,
    /worker image fingerprint does not match the deployed worker inputs/u,
  );
  assert.match(script, /rollback_runtime/u);
  assert.match(script, /automatic image rollback is disabled/u);
  assert.match(script, /Database migration may have applied; preserving the new runtime/u);
  assert.match(script, /Release metadata and runtime are committed/u);
  assert.match(script, /cp -p "\$environment_backup" "\$environment_file"/u);
  assert.match(script, /commit_environment_file\(\)/u);
  assert.match(script, /begin_environment_update\(\)/u);
  assert.match(script, /set_environment_key\(\)/u);
  assert.match(script, /commit_deployment_metadata\(\)/u);
  assert.match(script, /mv -f "\$environment_pending_file" "\$environment_file"/u);
  assert.match(script, /mv -f "\$committed_metadata" "\$metadata_file"/u);
  assert.match(script, /http:\/\/127\.0\.0\.1:\$\{gateway_port\}\/health\/live/u);
  assert.match(script, /--migrate-user-data-from/u);
  assert.match(script, /legacy bind storage requires explicit --migrate-user-data-from cutover/u);
  assert.match(script, /migration source must not be the filesystem root/u);
  assert.match(script, /legacy user-data and backup migration sources must not overlap/u);
  assert.match(script, /initialize_migration_target_volumes/u);
  assert.match(
    script,
    /docker volume create[\s\S]*user_migration_volume_ready=1[\s\S]*validate_managed_volume "\$user_volume" user-data/u,
  );
  assert.match(
    script,
    /docker volume create[\s\S]*backup_migration_volume_ready=1[\s\S]*validate_managed_volume "\$backup_volume" backups/u,
  );
  assert.match(script, /migration target volume is already attached to a container/u);
  assert.match(script, /migration target volume is not empty/u);
  assert.match(script, /du -sx --block-size=1/u);
  assert.match(script, /du -sx --apparent-size --block-size=1/u);
  assert.match(script, /SELECT pg_database_size\(current_database\(\)\)/u);
  assert.match(script, /minimum_safety_bytes=2147483648/u);
  assert.match(script, /insufficient DockerRootDir space for volume migration/u);
  assert.match(script, /src=\$\{source_path\},dst=\/source,readonly/u);
  assert.match(script, /src=\$\{target_volume\},dst=\/target/u);
  assert.match(script, /entries, files, bytes, sha256/u);
  assert.match(script, /type === "file" \? info\.size : null/u);
  assert.match(script, /unsupported special entry in migration source/u);
  assert.match(script, /\[1-8\]\[0-9a-f\]\{3\}/u);
  assert.match(script, /unexpected entry at user-data volume root/u);
  assert.match(script, /await chown\(root, 1000, 1000\)/u);
  assert.match(script, /const capabilityRoot = path\.join\(root, "\.capabilities"\)/u);
  assert.match(script, /"global capability source root"/u);
  assert.match(script, /normalizeTree\(capabilityRoot, 1000, 0o750, 0o640\)/u);
  assert.match(script, /ownerId === "\.capabilities"/u);
  assert.match(script, /ensureRealDirectory\(home/u);
  assert.match(script, /ensureRealDirectory\(codex/u);
  assert.match(script, /ensureRealDirectory\(managed/u);
  assert.match(script, /ensureRealDirectory\(control/u);
  assert.match(script, /await removeRegeneratedDirectory\(agents/u);
  assert.match(script, /await removeRegeneratedDirectory\(plugins/u);
  assert.match(script, /\.capabilities\(\?:-backup\)\?/u);
  assert.match(script, /\.workspace-permissions-v1/u);
  assert.match(script, /copy_and_verify_legacy_directory[\s\S]*normalize_user_volume/u);
  assert.match(script, /rewrite_legacy_capability_storage_paths\(\)/u);
  assert.match(script, /legacy_capability_root="\$\{migrate_user_data_from\}\/\.capabilities"/u);
  assert.match(script, /target_capability_root="\/srv\/linksense\/users\/\.capabilities"/u);
  assert.match(script, /UPDATE capabilities[\s\S]*SET storage_path = replace/u);
  assert.match(script, /ensure_volume_guard "\$\(configured_user_volume\)" user-data/u);
  assert.match(script, /ensure_volume_guard "\$\(configured_backup_volume\)" backups/u);
  assert.match(script, /Migration target volumes are retained as quarantine evidence/u);
  assert.match(script, /legacy-bind-rollback\.yml/u);
  assert.match(
    script,
    /LINKSENSE_USER_DATA_ROOT: '\$\{escaped_user_root\}'[\s\S]*source: '\$\{escaped_user_root\}'[\s\S]*target: '\$\{escaped_user_root\}'/u,
  );
  assert.match(script, /LINKSENSE_USER_DATA_VOLUME: ""/u);
  assert.match(
    script,
    /volumes:\s+[\s\S]*user-data: !reset null\s+backup-data: !reset null/u,
  );
  const rollbackSocketPlaceholder =
    "\\${LINKSENSE_DOCKER_SOCKET_PATH:-/var/run/docker.sock}";
  assert.ok(
    script.includes(`source: ${rollbackSocketPlaceholder}`) &&
      script.includes(`target: ${rollbackSocketPlaceholder}`),
  );
  assert.match(script, /volume_options" != "null"[\s\S]*volume_options" != "\{\}"/u);
  assert.match(script, /Docker Engine API 1\.45 or newer is required/u);
  assert.match(script, /Docker Compose 2\.24\.4 or newer is required/u);
  assert.doesNotMatch(script, /clear_migration_target_volumes/u);
  assert.doesNotMatch(script, /docker volume (?:rm|prune)/u);
  assert.doesNotMatch(script, /(?:PASSWORD|TOKEN|SECRET)=['"][^$]/u);
});

test("interactive HTML previews use a policy-free isolated shell", async () => {
  const [config, shell] = await Promise.all([
    readFile(nginxConfigPath, "utf8"),
    readFile(assistantHtmlPreviewShellPath, "utf8"),
  ]);
  const previewLocation = section(
    config,
    "location = /assistant-html-preview-shell.html",
    "location /api/",
  );

  assert.doesNotMatch(previewLocation, /Content-Security-Policy/u);
  assert.doesNotMatch(previewLocation, /Permissions-Policy/u);
  assert.doesNotMatch(previewLocation, /Referrer-Policy/u);
  assert.doesNotMatch(previewLocation, /X-Content-Type-Options/u);
  assert.match(previewLocation, /Cache-Control "no-store"/u);
  assert.match(shell, /linksense:assistant-html-preview:shell-ready/u);
  assert.match(shell, /linksense:assistant-html-preview:initialize/u);
  assert.match(shell, /maximumDocumentLength = 20 \* 1024 \* 1024/u);
  assert.match(shell, /document\.write\(message\.html\)/u);
});

test("Web image builds the shared workspace package before the application", async () => {
  const dockerfile = await readFile(webDockerfilePath, "utf8");

  const copySharedIndex = dockerfile.indexOf(
    "COPY packages/shared packages/shared",
  );
  const buildSharedIndex = dockerfile.indexOf(
    "pnpm --filter @linksense/shared build",
  );
  const buildWebIndex = dockerfile.indexOf(
    "pnpm --filter @linksense/web build",
  );

  assert.notEqual(copySharedIndex, -1);
  assert.notEqual(buildSharedIndex, -1);
  assert.notEqual(buildWebIndex, -1);
  assert.ok(copySharedIndex < buildSharedIndex);
  assert.ok(buildSharedIndex < buildWebIndex);
});

test("Web image builds and serves the bilingual Help Center with the application", async () => {
  const dockerfile = await readFile(webDockerfilePath, "utf8");

  const copyDocsManifestIndex = dockerfile.indexOf(
    "COPY apps/docs/package.json apps/docs/package.json",
  );
  const installIndex = dockerfile.indexOf(
    "RUN pnpm install --frozen-lockfile",
  );
  const copyDocsSourceIndex = dockerfile.indexOf("COPY apps/docs apps/docs");
  const buildDocsIndex = dockerfile.indexOf(
    "pnpm --filter @linksense/docs build",
  );
  const copyDocsBuildIndex = dockerfile.indexOf(
    "COPY --from=docs-build /workspace/apps/docs/build /usr/share/nginx/html/help",
  );

  for (const index of [
    copyDocsManifestIndex,
    installIndex,
    copyDocsSourceIndex,
    buildDocsIndex,
    copyDocsBuildIndex,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(copyDocsManifestIndex < installIndex);
  assert.ok(installIndex < copyDocsSourceIndex);
  assert.ok(copyDocsSourceIndex < buildDocsIndex);
  assert.ok(buildDocsIndex < copyDocsBuildIndex);
});

test("Web image normalizes static asset permissions for the unprivileged Nginx worker", async () => {
  const dockerfile = await readFile(webDockerfilePath, "utf8");
  const webCopyIndex = dockerfile.indexOf(
    "COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html",
  );
  const docsCopyIndex = dockerfile.lastIndexOf(
    "COPY --from=docs-build /workspace/apps/docs/build /usr/share/nginx/html/help",
  );
  const permissionIndex = dockerfile.lastIndexOf(
    "RUN chmod -R u=rwX,go=rX /usr/share/nginx/html",
  );

  assert.notEqual(webCopyIndex, -1);
  assert.notEqual(docsCopyIndex, -1);
  assert.notEqual(permissionIndex, -1);
  assert.ok(webCopyIndex < permissionIndex);
  assert.ok(docsCopyIndex < permissionIndex);
});

test("API image bundles the bilingual Help Center into the built-in documentation Skill", async () => {
  const [dockerfile, apiPackage] = await Promise.all([
    readFile(apiDockerfilePath, "utf8"),
    readFile(apiPackagePath, "utf8"),
  ]);
  const copyChineseDocsIndex = dockerfile.indexOf(
    "COPY apps/docs/docs apps/docs/docs",
  );
  const copyEnglishDocsIndex = dockerfile.indexOf(
    "COPY apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current",
  );
  const buildApiIndex = dockerfile.indexOf(
    "pnpm --filter @linksense/api build",
  );

  for (const index of [
    copyChineseDocsIndex,
    copyEnglishDocsIndex,
    buildApiIndex,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(copyChineseDocsIndex < buildApiIndex);
  assert.ok(copyEnglishDocsIndex < buildApiIndex);
  assert.match(
    apiPackage,
    /tsc -p tsconfig\.build\.json && node dist\/commands\/bundle-linksense-docs\.js/u,
  );
});

test("Nginx serves Help Center files without falling back to the application SPA", async () => {
  const config = await readFile(nginxConfigPath, "utf8");
  const serverHeaders = section(
    config,
    "server {",
    "location = /health/live",
  );
  const helpLocation = await readFile(resolve("deploy/nginx/help-location.conf"), "utf8");

  assert.match(config, /include \/etc\/nginx\/linksense\/help-location\.conf;/u);
  assert.match(helpLocation, /location = \/help\s*\{\s*return 308 \/help\/;/u);
  assert.match(helpLocation, /try_files \$uri \$uri\/ =404;/u);
  assert.doesNotMatch(helpLocation, /\/index\.html/u);
  assert.match(
    config,
    /~\^\/help\/\(\?:en-US\/\)\?assets\/ "public, max-age=31536000, immutable";/u,
  );
  assert.match(config, /~\^\/help\/\(\?:\.\*\\\/\)\?index\\\.html\$ "no-store";/u);
  assert.doesNotMatch(serverHeaders, /script-src[^;]*'unsafe-inline'/u);
  assert.match(
    helpLocation,
    /script-src 'self' 'unsafe-inline'; worker-src 'self';/u,
  );
  assert.match(
    helpLocation,
    /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/u,
  );
});

test("workspace image installs receive every manifest and pnpm patch before dependency resolution", async () => {
  const dockerfiles = await Promise.all(
    [apiDockerfilePath, runnerDockerfilePath, webDockerfilePath].map(
      async (path) => ({
        path,
        source: await readFile(path, "utf8"),
      }),
    ),
  );
  const workspaceManifestPaths = (
    await Promise.all(
      ["apps", "packages"].map(async (workspaceRoot) =>
        (await readdir(resolve(workspaceRoot), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${workspaceRoot}/${entry.name}/package.json`),
      ),
    )
  )
    .flat()
    .sort();

  for (const { path, source } of dockerfiles) {
    const installIndex = source.indexOf("RUN pnpm install --frozen-lockfile");
    assert.notEqual(installIndex, -1);

    for (const manifestPath of workspaceManifestPaths) {
      const copyManifestIndex = source.indexOf(
        `COPY ${manifestPath} ${manifestPath}`,
      );
      assert.notEqual(
        copyManifestIndex,
        -1,
        `${path} must copy ${manifestPath} before installing dependencies`,
      );
      assert.ok(copyManifestIndex < installIndex);
    }

    const copyPatchesIndex = source.indexOf("COPY patches patches");

    assert.notEqual(copyPatchesIndex, -1);
    assert.ok(copyPatchesIndex < installIndex);
  }
});

test("Docker builds configure a fast Debian mirror with bounded network retries", async () => {
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "linksense-debian-apt-"),
  );
  const sourcesPath = resolve(temporaryRoot, "debian.sources");
  const aptConfigDirectory = resolve(temporaryRoot, "apt.conf.d");
  try {
    await mkdir(aptConfigDirectory);
    await writeFile(
      sourcesPath,
      [
        "Types: deb",
        "URIs: http://deb.debian.org/debian",
        "Suites: bookworm bookworm-updates",
        "Components: main",
        "",
        "Types: deb",
        "URIs: http://deb.debian.org/debian-security",
        "Suites: bookworm-security",
        "Components: main",
        "",
      ].join("\n"),
    );

    await execFileAsync("sh", [debianAptConfigurationPath], {
      env: {
        ...process.env,
        DEBIAN_MIRROR_URL: "http://mirror.example/debian/",
        DEBIAN_SECURITY_MIRROR_URL: "http://mirror.example/debian-security/",
        DEBIAN_SOURCES_FILE: sourcesPath,
        APT_CONFIG_DIRECTORY: aptConfigDirectory,
      },
    });

    const [sources, networkConfiguration] = await Promise.all([
      readFile(sourcesPath, "utf8"),
      readFile(resolve(aptConfigDirectory, "80linksense-network"), "utf8"),
    ]);
    assert.match(sources, /URIs: http:\/\/mirror\.example\/debian$/mu);
    assert.match(sources, /URIs: http:\/\/mirror\.example\/debian-security$/mu);
    assert.doesNotMatch(sources, /deb\.debian\.org/u);
    assert.match(networkConfiguration, /Acquire::Retries "3";/u);
    assert.match(networkConfiguration, /Acquire::http::Timeout "30";/u);
    assert.match(networkConfiguration, /Acquire::https::Timeout "30";/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const [developmentDockerfile, apiDockerfile, runnerDockerfile] =
    await Promise.all(
      [developmentDockerfilePath, apiDockerfilePath, runnerDockerfilePath].map(
        (path) => readFile(path, "utf8"),
      ),
    );
  for (const dockerfile of [
    developmentDockerfile,
    apiDockerfile,
    runnerDockerfile,
  ]) {
    const configureIndex = dockerfile.indexOf(
      "deploy/docker/configure-debian-apt.sh",
    );
    const aptUpdateIndex = dockerfile.indexOf("apt-get update");
    assert.notEqual(configureIndex, -1);
    assert.notEqual(aptUpdateIndex, -1);
    assert.ok(configureIndex < aptUpdateIndex);
    assert.match(dockerfile, /ARG DEBIAN_MIRROR_URL=/u);
    assert.match(dockerfile, /ARG DEBIAN_SECURITY_MIRROR_URL=/u);
  }

  const installIndex = developmentDockerfile.indexOf(
    "RUN pnpm install --frozen-lockfile",
  );
  const fingerprintLabelIndex = developmentDockerfile.indexOf(
    "LABEL com.linksense.development.fingerprint",
  );
  assert.notEqual(installIndex, -1);
  assert.notEqual(fingerprintLabelIndex, -1);
  assert.ok(installIndex < fingerprintLabelIndex);
  assert.match(
    runnerDockerfile,
    /ARG WORKER_IMAGE_FINGERPRINT=unversioned.*LABEL com\.linksense\.worker\.fingerprint=\$\{WORKER_IMAGE_FINGERPRINT\}/su,
  );
  assert.match(
    runnerDockerfile,
    /ARG LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE=linksense-runner-worker:pro-latest[\s\S]*FROM \$\{LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE\} AS browser-runtime-cache/u,
  );
  assert.match(
    runnerDockerfile,
    /FROM worker-browser-build-input AS worker/u,
  );
  assert.match(
    runnerDockerfile,
    /FROM worker-browser-cache-input AS worker-cached-browser/u,
  );
  assert.match(
    runnerDockerfile,
    /FROM worker-base AS worker-browser-build-input[\s\S]*COPY --from=browser-runtime-build \/opt\/linksense\/runtime\/browser/u,
  );
  assert.match(
    runnerDockerfile,
    /FROM worker-base AS worker-browser-cache-input[\s\S]*COPY --from=browser-runtime-cache \/opt\/linksense\/runtime\/browser/u,
  );
});

test("Compose exposes overridable Debian build mirrors", async () => {
  const [compose, developmentCompose, example] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(developmentComposePath, "utf8"),
    readFile(environmentExamplePath, "utf8"),
  ]);
  const mirrors = {
    DEBIAN_MIRROR_URL: "http://deb.debian.org/debian",
    DEBIAN_SECURITY_MIRROR_URL:
      "http://security.debian.org/debian-security",
  };

  for (const [name, value] of Object.entries(mirrors)) {
    assert.match(example, new RegExp(`^${name}=${value}$`, "mu"));
    assert.ok(compose.includes(`\${${name}:-${value}}`));
    assert.ok(developmentCompose.includes(`\${${name}:-${value}}`));
  }
});

test("development Web proxies browser OIDC callbacks to the API service", async () => {
  const [developmentCompose, viteConfig] = await Promise.all([
    readFile(developmentComposePath, "utf8"),
    readFile(webViteConfigPath, "utf8"),
  ]);

  assert.match(
    developmentCompose,
    /LINKSENSE_DEV_API_PROXY_TARGET: http:\/\/api:4000/u,
  );
  assert.match(
    developmentCompose,
    /path: \.\/apps\/web\/vite\.config\.ts\s+target: \/workspace\/apps\/web\/vite\.config\.ts/u,
  );
  assert.match(viteConfig, /["']\/api["']:\s*\{/u);
  assert.match(viteConfig, /process\.env\.LINKSENSE_DEV_API_PROXY_TARGET/u);
});

test("development applications start without serial Docker healthcheck delays", async () => {
  const { stdout } = await execFileAsync("docker", [
    "compose", "--env-file", environmentExamplePath,
    "-f", composePath, "-f", developmentComposePath, "config", "--format", "json",
  ], { maxBuffer: 4 * 1024 * 1024 });
  const { services } = JSON.parse(stdout);
  assert.equal(services.api.depends_on.runner.condition, "service_started");
  assert.equal(services.web.depends_on.api.condition, "service_started");
  assert.equal(services.api.depends_on.redis.condition, "service_healthy");
  assert.equal(services.api.depends_on.migrate.condition, "service_completed_successfully");
});

test("development serves the production bilingual Help Center from an independent image", async () => {
  const [compose, dockerfile, script, viteConfig, docsConfig] = await Promise.all([
    readFile(developmentComposePath, "utf8"),
    readFile(webDockerfilePath, "utf8"),
    readFile(developmentScriptPath, "utf8"),
    readFile(webViteConfigPath, "utf8"),
    readFile(resolve("deploy/nginx/development-docs.conf"), "utf8"),
  ]);
  const web = section(compose, "  web:", "  docs:");
  const docs = compose.slice(compose.indexOf("  docs:"));
  assert.match(web, /command: \["pnpm", "--filter", "@linksense\/web", "dev"\]/u);
  assert.doesNotMatch(web, /@linksense\/docs/u);
  assert.match(web, /LINKSENSE_DEV_DOCS_PROXY_TARGET: http:\/\/docs:80/u);
  assert.match(docs, /target: docs-runtime/u);
  assert.match(docs, /action: rebuild\s+path: \.\/apps\/docs/u);
  assert.match(docs, /\/help\/en-US\//u);
  assert.match(dockerfile, /FROM dependencies AS docs-build/u);
  assert.match(dockerfile, /RUN pnpm --filter @linksense\/docs build/u);
  assert.equal(dockerfile.split("COPY --from=docs-build /workspace/apps/docs/build /usr/share/nginx/html/help").length - 1, 2);
  assert.match(docsConfig, /include \/etc\/nginx\/linksense\/help-location\.conf;/u);
  assert.match(script, /name: "Help Center \(zh-CN\)"/u);
  assert.match(script, /name: "Help Center \(en-US\)"/u);
  assert.match(viteConfig, /["']\/help["']:\s*\{/u);
  assert.match(viteConfig, /process\.env\.LINKSENSE_DEV_DOCS_PROXY_TARGET/u);
});

test("Docker dependency installs consistently use the official Node package registry by default", async () => {
  const [
    developmentDockerfile,
    apiDockerfile,
    runnerDockerfile,
    webDockerfile,
    compose,
    developmentCompose,
    environmentExample,
    rootPackage,
    lockfile,
  ] = await Promise.all([
    readFile(developmentDockerfilePath, "utf8"),
    readFile(apiDockerfilePath, "utf8"),
    readFile(runnerDockerfilePath, "utf8"),
    readFile(webDockerfilePath, "utf8"),
    readFile(composePath, "utf8"),
    readFile(developmentComposePath, "utf8"),
    readFile(environmentExamplePath, "utf8"),
    readFile(resolve("package.json"), "utf8"),
    readFile(resolve("pnpm-lock.yaml"), "utf8"),
  ]);

  for (const dockerfile of [
    developmentDockerfile,
    apiDockerfile,
    runnerDockerfile,
    webDockerfile,
  ]) {
    assert.match(
      dockerfile,
      /ARG LINKSENSE_NODE_PACKAGE_REGISTRY_URL=https:\/\/registry\.npmjs\.org\//u,
    );
    assert.match(
      dockerfile,
      /corepack_registry="\$\{LINKSENSE_NODE_PACKAGE_REGISTRY_URL%\/\}"/u,
    );
    assert.match(
      dockerfile,
      /ENV NPM_CONFIG_REGISTRY=\$\{LINKSENSE_NODE_PACKAGE_REGISTRY_URL\}/u,
    );
    assert.match(dockerfile, /ENV COREPACK_HOME=\/pnpm\/corepack/u);
    assert.match(
      dockerfile,
      /COREPACK_NPM_REGISTRY="\$\{corepack_registry\}" corepack prepare/u,
    );
  }

  assert.match(
    runnerDockerfile,
    /cp -a "\$\{COREPACK_HOME\}\/v1\/pnpm\/\$\{PNPM_VERSION\}\/\." \/opt\/linksense\/tooling\/pnpm\//u,
  );
  assert.doesNotMatch(runnerDockerfile, /\/root\/\.cache\/node\/corepack/u);

  const registryUrl = "https://registry.npmjs.org/";
  assert.match(
    environmentExample,
    new RegExp(`^LINKSENSE_NODE_PACKAGE_REGISTRY_URL=${registryUrl}$`, "mu"),
  );
  assert.ok(
    compose.includes(
      `LINKSENSE_NODE_PACKAGE_REGISTRY_URL: \${LINKSENSE_NODE_PACKAGE_REGISTRY_URL:-${registryUrl}}`,
    ),
  );
  assert.ok(
    developmentCompose.includes(
      `LINKSENSE_NODE_PACKAGE_REGISTRY_URL: \${LINKSENSE_NODE_PACKAGE_REGISTRY_URL:-${registryUrl}}`,
    ),
  );
  assert.doesNotMatch(rootPackage, /registry\.npmmirror\.com/u);
  assert.doesNotMatch(lockfile, /registry\.npmmirror\.com/u);

  assert.match(
    runnerDockerfile,
    /^ARG PLAYWRIGHT_DOWNLOAD_HOST=$/mu,
  );
  assert.match(
    runnerDockerfile,
    /^ENV PLAYWRIGHT_DOWNLOAD_HOST=\$\{PLAYWRIGHT_DOWNLOAD_HOST\}$/mu,
  );
  assert.match(
    environmentExample,
    /^PLAYWRIGHT_DOWNLOAD_HOST=$/mu,
  );
  assert.ok(
    compose.includes(
      "PLAYWRIGHT_DOWNLOAD_HOST: ${PLAYWRIGHT_DOWNLOAD_HOST:-}",
    ),
  );
  const pythonPackageIndexUrl = "https://pypi.org/simple/";
  assert.match(runnerDockerfile, /^ARG UV_VERSION=0\.9\.13$/mu);
  assert.match(
    runnerDockerfile,
    new RegExp(
      `^ARG LINKSENSE_PYTHON_PACKAGE_INDEX_URL=${pythonPackageIndexUrl}$`,
      "mu",
    ),
  );
  assert.match(
    runnerDockerfile,
    /ENV PIP_INDEX_URL=\$\{LINKSENSE_PYTHON_PACKAGE_INDEX_URL\}/u,
  );
  assert.match(
    runnerDockerfile,
    /python -m pip install --no-cache-dir "uv==\$\{UV_VERSION\}"/u,
  );
  assert.doesNotMatch(runnerDockerfile, /ghcr\.io\/astral-sh\/uv/u);
  assert.doesNotMatch(runnerDockerfile, /AS uv-bin/u);
  assert.match(
    environmentExample,
    new RegExp(`^LINKSENSE_PYTHON_PACKAGE_INDEX_URL=${pythonPackageIndexUrl}$`, "mu"),
  );
  assert.ok(
    compose.includes(
      `LINKSENSE_PYTHON_PACKAGE_INDEX_URL: \${LINKSENSE_PYTHON_PACKAGE_INDEX_URL:-${pythonPackageIndexUrl}}`,
    ),
  );
  assert.match(environmentExample, /^LINKSENSE_WORKER_BUILD_TARGET=worker$/mu);
  assert.match(
    environmentExample,
    /^LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE=linksense-runner-worker:pro-latest$/mu,
  );
  assert.ok(
    compose.includes(
      "target: ${LINKSENSE_WORKER_BUILD_TARGET:-worker}",
    ),
  );
  assert.ok(
    compose.includes(
      "LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE: ${LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE:-linksense-runner-worker:pro-latest}",
    ),
  );
});

test("Prisma generation uses the configured engine mirror during Docker builds", async () => {
  const [
    developmentDockerfile,
    apiDockerfile,
    compose,
    developmentCompose,
    environmentExample,
  ] = await Promise.all([
    readFile(developmentDockerfilePath, "utf8"),
    readFile(apiDockerfilePath, "utf8"),
    readFile(composePath, "utf8"),
    readFile(developmentComposePath, "utf8"),
    readFile(environmentExamplePath, "utf8"),
  ]);
  const mirror = "https://binaries.prisma.sh";

  for (const dockerfile of [developmentDockerfile, apiDockerfile]) {
    assert.match(
      dockerfile,
      /ARG PRISMA_ENGINES_MIRROR=https:\/\/binaries\.prisma\.sh/u,
    );
    assert.match(
      dockerfile,
      /ENV PRISMA_ENGINES_MIRROR=\$\{PRISMA_ENGINES_MIRROR\}/u,
    );
  }
  assert.match(
    environmentExample,
    new RegExp(`^PRISMA_ENGINES_MIRROR=${mirror}$`, "mu"),
  );
  assert.ok(
    compose.includes(
      `PRISMA_ENGINES_MIRROR: \${PRISMA_ENGINES_MIRROR:-${mirror}}`,
    ),
  );
  assert.ok(
    developmentCompose.includes(
      `PRISMA_ENGINES_MIRROR: \${PRISMA_ENGINES_MIRROR:-${mirror}}`,
    ),
  );
});

test("API image provides OpenSSL before Prisma client generation", async () => {
  const dockerfile = await readFile(apiDockerfilePath, "utf8");

  const opensslIndex = dockerfile.indexOf(
    "apt-get install --yes --no-install-recommends ca-certificates openssl",
  );
  const prismaGenerateIndex = dockerfile.indexOf("pnpm db:generate");

  assert.notEqual(opensslIndex, -1);
  assert.notEqual(prismaGenerateIndex, -1);
  assert.ok(opensslIndex < prismaGenerateIndex);
});

test("Codex template requires the isolated Responses provider and disables native MCP elicitation", async () => {
  const config = await readFile(codexConfigPath, "utf8");

  assert.match(config, /^forced_login_method = "api"$/mu);
  assert.doesNotMatch(config, /^model\s*=/mu);
  assert.match(config, /^model_provider = "link-sense"$/mu);
  assert.match(config, /^web_search = "disabled"$/mu);
  assert.match(config, /^allow_login_shell = false$/mu);
  assert.match(config, /^\[model_providers\.link-sense\]$/mu);
  assert.match(config, /^wire_api = "responses"$/mu);
  assert.match(config, /^env_key = "LINKSENSE_MODEL_GATEWAY_TOKEN"$/mu);
  assert.doesNotMatch(config, /^env_http_headers\s*=/mu);
  assert.doesNotMatch(config, /x-opencodex-api-key"\s*=\s*"ocx_/u);
  assert.doesNotMatch(config, /^base_url = ".*\/responses\/?"$/mu);
  assert.match(config, /^supports_websockets = true$/mu);
  assert.match(config, /^stream_max_retries = 2$/mu);
  assert.match(config, /^websocket_connect_timeout_ms = 12000$/mu);
  assert.match(config, /^requires_openai_auth = false$/mu);
  assert.match(config, /^plugins = true$/mu);
  assert.match(config, /^include_instructions = true$/mu);
  assert.match(config, /^multi_agent = true$/mu);
  assert.match(config, /^tool_call_mcp_elicitation = false$/mu);
  assert.match(
    config,
    /^\[skills\.bundled\]\r?\n(?:#[^\r\n]*\r?\n)*enabled = false$/mu,
  );
  for (const feature of [
    "apps",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "hooks",
    "image_generation",
    "in_app_browser",
    "plugin_sharing",
    "remote_plugin",
    "shell_snapshot",
    "skill_mcp_dependency_install",
    "tool_suggest",
    "workspace_dependencies",
  ]) {
    assert.match(config, new RegExp(`^${feature} = false$`, "mu"));
  }
  assert.doesNotMatch(config, /^plugin_hooks\s*=/mu);
  assert.doesNotMatch(config, /^\[\[skills\.config\]\]/mu);
  assert.doesNotMatch(config, /^tool_search\s*=/mu);
  assert.doesNotMatch(config, /^\[plugins\./mu);
  assert.doesNotMatch(config, /^\[projects\./mu);
  assert.doesNotMatch(config, /infocare-ai-crm-client/u);
});

test("Codex authentication is managed at runtime rather than in deployment env", async () => {
  const example = await readFile(runnerEnvironmentExamplePath, "utf8");

  assert.doesNotMatch(example, /^LINK_SENSE_API_KEY=/mu);
  assert.doesNotMatch(example, /^LINKSENSE_CODEX_MODEL=/mu);
  await assert.rejects(
    access(codexAuthPath),
    (error) => error.code === "ENOENT",
  );
});

test("the runner image, Compose default, environment example, and adapter pin Codex 0.150.1", async () => {
  const [dockerfile, compose, environmentExample, protocol] = await Promise.all(
    [
      readFile(runnerDockerfilePath, "utf8"),
      readFile(composePath, "utf8"),
      readFile(environmentExamplePath, "utf8"),
      readFile(runnerCodexProtocolPath, "utf8"),
    ],
  );

  assert.match(dockerfile, /^ARG CODEX_VERSION=0\.150\.1$/mu);
  assert.match(compose, /CODEX_VERSION: \$\{CODEX_VERSION:-0\.150\.1\}/u);
  assert.match(environmentExample, /^CODEX_VERSION=0\.150\.1$/mu);
  assert.match(protocol, /export const CODEX_SCHEMA_VERSION = "0\.150\.1"/u);
});

test("native plugin refresh smoke projects the current managed capability layout", async () => {
  const smoke = await readFile(
    resolve("scripts/codex-native-plugin-refresh-smoke.mts"),
    "utf8",
  );

  assert.match(smoke, /new WorkspaceManager\(/u);
  assert.match(smoke, /workspaceManager\.ensureConversation\(/u);
  assert.match(smoke, /homeRoot: conversationPaths\.home/u);
  assert.match(smoke, /await projectManagedAgents\(paths\)/u);
  assert.match(smoke, /activation\.skills\[0\]/u);
  assert.doesNotMatch(smoke, /activation\.skill(?:Names|Paths)/u);
});

test("Codex thread smoke projects capabilities into the isolated owner HOME", async () => {
  const smoke = await readFile(resolve("scripts/codex-thread-smoke.mts"), "utf8");

  assert.match(smoke, /materialized\.managedAgentsRoot/u);
  assert.match(smoke, /path\.join\(paths\.home, "\.agents"\)/u);
  assert.match(smoke, /path\.join\(materialized\.ownerRoot, "home"\)/u);
  assert.doesNotMatch(smoke, /materialized\.homeRoot/u);
  assert.match(smoke, /maxRetries: 5/u);
  assert.match(smoke, /new ModelGateway\(/u);
  assert.match(smoke, /manager\.configureModelProvider\(/u);
  assert.match(smoke, /\[modelGatewayEnvironmentKey\]: gatewayToken/u);
  assert.doesNotMatch(smoke, /LINK_SENSE_API_KEY: providerKey/u);
});

test("full Codex Skill smoke uses the managed model gateway contract", async () => {
  const smoke = await readFile(
    resolve("scripts/codex-skill-discovery-smoke.mts"),
    "utf8",
  );

  assert.match(smoke, /new ModelGateway\(/u);
  assert.match(smoke, /manager\.configureModelProvider\(/u);
  assert.match(smoke, /\[modelGatewayEnvironmentKey\]: gatewayToken/u);
  assert.doesNotMatch(smoke, /LINK_SENSE_API_KEY: providerKey/u);
});

test("runner image separates the trusted controller from unprivileged task workers", async () => {
  const dockerfile = await readFile(runnerDockerfilePath, "utf8");
  const build = section(
    dockerfile,
    "FROM dependencies AS build",
    "FROM ${PYTHON_IMAGE} AS python-runtime-build",
  );
  const controller = section(
    dockerfile,
    "FROM ${NODE_IMAGE} AS controller",
    "FROM ${NODE_IMAGE} AS worker",
  );
  const worker = section(dockerfile, "FROM ${NODE_IMAGE} AS worker");

  assert.match(controller, /^USER root$/mu);
  assert.doesNotMatch(controller, /pnpm add --global|uv sync|runtime\/python/u);
  assert.match(worker, /^USER 0:1000$/mu);
  assert.match(worker, /^ENV LANG=C\.UTF-8$/mu);
  assert.match(worker, /^ENV LC_ALL=C\.UTF-8$/mu);
  assert.match(
    worker,
    /^ENV PATH=\/opt\/linksense\/bin:\/home\/linksense\/\.local\/share\/linksense\/python\/\.venv\/bin:/mu,
  );
  assert.match(worker, /build-essential/u);
  assert.match(worker, /pkg-config/u);
  assert.match(worker, /useradd --uid 1001 --gid node .* linksense-task/u);
  assert.match(worker, /libreoffice-writer/u);
  assert.match(worker, /poppler-utils/u);
  assert.match(worker, /pnpm add --global @openai\/codex@\$\{CODEX_VERSION\}/u);
  assert.match(worker, /pnpm add --global[\s\S]*pnpm store prune/u);
  assert.match(
    worker,
    /COPY --chown=root:root --chmod=0444 deploy\/codex-home-template\/config\.toml \/opt\/linksense\/codex-home-template\/config\.toml/u,
  );
  assert.match(
    worker,
    /COPY --from=build --chown=root:root \/opt\/linksense-runner \/app\//u,
  );
  assert.match(
    build,
    /pnpm --filter @linksense\/runner deploy --prod --legacy \/opt\/linksense-runner[\s\S]*chmod -R u=rwX,go=rX \/opt\/linksense-runner[\s\S]*setpriv --reuid=1001 --regid=1000 --clear-groups[\s\S]*runner-runtime-smoke\.mjs \/opt\/linksense-runner/u,
  );
  assert.doesNotMatch(worker, /chmod -R a-w/u);
  assert.match(
    worker,
    /cp -a "\$\{COREPACK_HOME\}\/v1\/pnpm\/\$\{PNPM_VERSION\}\/\." \/opt\/linksense\/tooling\/pnpm\//u,
  );
  assert.match(
    worker,
    /COPY --chmod=0755 deploy\/runtime\/node\/pnpm \/opt\/linksense\/bin\/pnpm/u,
  );
});

test("API images embed the pinned localhost-only LibreOffice conversion runtime", async () => {
  const [apiDockerfile, developmentDockerfile] = await Promise.all([
    readFile(apiDockerfilePath, "utf8"),
    readFile(developmentDockerfilePath, "utf8"),
  ]);

  for (const dockerfile of [apiDockerfile, developmentDockerfile]) {
    assert.match(dockerfile, /libreoffice-writer/u);
    assert.match(dockerfile, /libreoffice-calc/u);
    assert.match(dockerfile, /libreoffice-impress/u);
    assert.match(dockerfile, /libreoffice-draw/u);
    assert.match(dockerfile, /python3-uno/u);
    assert.match(dockerfile, /uv venv .*--system-site-packages/u);
    assert.match(dockerfile, /unoserver==3\.7/u);
    assert.match(dockerfile, /import uno, unoserver/u);
    assert.match(dockerfile, /\/opt\/linksense\/unoserver\/bin/u);
    assert.doesNotMatch(dockerfile, /EXPOSE (?:2002|2003)/u);
  }
});

test("runner runtime smoke validates the registry-driven Core MCP in Default and Plan modes", async () => {
  const smoke = await readFile(runnerRuntimeSmokePath, "utf8");

  assert.match(smoke, /dist\/mcp\/core-service-server\.js/u);
  assert.match(smoke, /LINKSENSE_COLLABORATION_MODE: "default"/u);
  assert.match(smoke, /LINKSENSE_COLLABORATION_MODE: "plan"/u);
  assert.match(smoke, /"register_artifact"/u);
  assert.match(smoke, /"convert_document_to_markdown"/u);
  assert.match(smoke, /"generate_image"/u);
  assert.match(smoke, /"search_knowledge_base"/u);
  assert.equal(
    [...smoke.matchAll(/"get_current_user_info"/gu)].length,
    2,
    "current user tool must be smoke-tested in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/LINKSENSE_CURRENT_USER_ENDPOINT:/gu)].length,
    2,
    "current user endpoint must be configured in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/LINKSENSE_CURRENT_USER_TOKEN:/gu)].length,
    2,
    "current user token must be configured in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/"request_user_form"/gu)].length,
    2,
    "interactive form tool must be smoke-tested in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/"emit_application_event"/gu)].length,
    2,
    "interactive application event tool must be smoke-tested in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/LINKSENSE_FORM_SERVICE_ENDPOINT:/gu)].length,
    2,
    "interactive form endpoint must be configured in both Default and Plan modes",
  );
  assert.equal(
    [...smoke.matchAll(/LINKSENSE_FORM_SERVICE_TOKEN:/gu)].length,
    2,
    "interactive form token must be configured in both Default and Plan modes",
  );
  assert.match(smoke, /"preview_skill_zip"/u);
  assert.doesNotMatch(
    smoke,
    /(?:file|image-generation|knowledge|skill-creator)-service-server\.js/u,
  );
});

test("the worker image owns the static Codex template without a template volume", async () => {
  const [compose, dockerfile] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(runnerDockerfilePath, "utf8"),
  ]);
  const templateEntries = await readdir(resolve("deploy/codex-home-template"));

  assert.ok(templateEntries.includes("config.toml"));
  assert.match(
    dockerfile,
    /COPY --chown=root:root --chmod=0444 deploy\/codex-home-template\/config\.toml \/opt\/linksense\/codex-home-template\/config\.toml/u,
  );
  assert.doesNotMatch(compose, /template-source|codex-home-template:/u);
});

test("shared Python and Node runtimes are lockfile-driven and smoke tested", async () => {
  const [dockerfile, pythonProject, pythonLock, nodeProjectText, nodeLock] =
    await Promise.all([
      readFile(runnerDockerfilePath, "utf8"),
      readFile(pythonRuntimeProjectPath, "utf8"),
      readFile(pythonRuntimeLockPath, "utf8"),
      readFile(nodeRuntimeProjectPath, "utf8"),
      readFile(nodeRuntimeLockPath, "utf8"),
    ]);
  const nodeProject = JSON.parse(nodeProjectText);
  const pythonPackages = [
    "beautifulsoup4",
    "httpx",
    "jinja2",
    "lxml",
    "matplotlib",
    "numpy",
    "openpyxl",
    "pandas",
    "pdfplumber",
    "pillow",
    "pypdf",
    "python-docx",
    "python-pptx",
    "pyyaml",
    "reportlab",
    "requests",
    "xlsxwriter",
  ];
  const nodePackages = [
    "archiver",
    "axios",
    "cheerio",
    "csv-parse",
    "csv-stringify",
    "dayjs",
    "docx",
    "exceljs",
    "fast-xml-parser",
    "glob",
    "pdf-lib",
    "pptxgenjs",
    "sharp",
    "yaml",
    "zod",
  ];

  for (const packageName of pythonPackages) {
    assert.match(pythonProject, new RegExp(`"${packageName}[<>=]`, "u"));
    assert.match(pythonLock, new RegExp(`name = "${packageName}"`, "u"));
  }
  assert.deepEqual(Object.keys(nodeProject.dependencies).sort(), nodePackages);
  assert.equal(nodeProject.packageManager, "pnpm@10.6.4");
  for (const packageName of nodePackages) {
    assert.match(nodeLock, new RegExp(`      ${packageName}:`, "u"));
  }
  assert.match(dockerfile, /uv sync --frozen --no-dev/u);
  assert.match(dockerfile, /ENV UV_CONCURRENT_INSTALLS=8/u);
  assert.match(dockerfile, /pnpm install --prod --frozen-lockfile/u);
  assert.match(dockerfile, /python \/runtime-python\/smoke\.py/u);
  assert.match(dockerfile, /node \/opt\/linksense\/runtime\/node\/smoke\.mjs/u);
});

test("worker enables only the managed Plan output Stop hook", async () => {
  const [dockerfile, codexConfig, requirements, hook] = await Promise.all([
    readFile(runnerDockerfilePath, "utf8"),
    readFile(codexConfigPath, "utf8"),
    readFile(codexSystemRequirementsPath, "utf8"),
    readFile(planStopHookPath, "utf8"),
  ]);

  assert.match(codexConfig, /^hooks = false$/mu);
  assert.match(requirements, /^allow_managed_hooks_only = true$/mu);
  assert.doesNotMatch(requirements, /^hooks = true$/mu);
  assert.match(requirements, /^\[\[hooks\.Stop\]\]$/mu);
  assert.match(
    requirements,
    /command = "\/usr\/local\/bin\/node \/opt\/linksense\/runtime\/node\/plan-stop-hook\.mjs"/u,
  );
  assert.equal(
    dockerfile.match(
      /deploy\/codex-system\/requirements\.toml \/etc\/codex\/requirements\.toml/gu,
    )?.length,
    2,
  );
  assert.match(
    dockerfile,
    /COPY --chmod=0644 deploy\/runtime\/node\/register-hooks\.mjs deploy\/runtime\/node\/plan-stop-hook\.mjs deploy\/runtime\/node\/smoke\.mjs \.\//u,
  );
  assert.match(
    dockerfile,
    /COPY --chmod=0644 deploy\/runtime\/node\/user-package\.json \.\/user-package\.json/u,
  );
  assert.match(hook, /LINKSENSE_COLLABORATION_MODE === PLAN_MODE/u);
  assert.match(hook, /input\.stop_hook_active === false/u);
  assert.match(hook, /MAX_TRANSCRIPT_TAIL_BYTES/u);
});

test("worker full Chromium capability is pinned, broad by default, Plan-read-only, and smoke tested", async () => {
  const [
    dockerfile,
    browserProjectText,
    browserLock,
    browserWrapper,
    browserCliWrapper,
    browserInitPage,
    codexConfig,
    runnerIndex,
  ] = await Promise.all([
    readFile(runnerDockerfilePath, "utf8"),
    readFile(browserRuntimeProjectPath, "utf8"),
    readFile(browserRuntimeLockPath, "utf8"),
    readFile(browserRuntimeWrapperPath, "utf8"),
    readFile(runnerBrowserCliWrapperPath, "utf8"),
    readFile(browserRuntimeInitPagePath, "utf8"),
    readFile(codexConfigPath, "utf8"),
    readFile(runnerIndexPath, "utf8"),
  ]);
  const browserProject = JSON.parse(browserProjectText);
  const browserStage = section(
    dockerfile,
    "FROM toolchain AS browser-runtime-build",
    "# The controller is trusted infrastructure.",
  );
  const workerStage = section(dockerfile, "FROM ${NODE_IMAGE} AS worker", null);

  assert.equal(browserProject.dependencies["@playwright/cli"], "0.1.17");
  assert.match(browserLock, /'@playwright\/cli@0\.1\.17'/u);
  assert.match(browserStage, /pnpm install --prod --frozen-lockfile/u);
  assert.match(
    browserStage,
    /playwright-cli install-browser chromium;/u,
  );
  assert.equal(
    dockerfile.match(/install-browser chromium/gu)?.length,
    6,
  );
  assert.doesNotMatch(
    dockerfile,
    /install-browser chromium --only-shell/u,
  );
  assert.doesNotMatch(
    dockerfile,
    /install-browser chromium --no-shell/u,
  );
  assert.match(
    browserStage,
    /Playwright mirror download failed; retrying with the default upstream\./u,
  );
  assert.doesNotMatch(browserStage, /\b(?:npm|npx)\b/u);
  assert.match(browserWrapper, /\/app\/dist\/browser\/cli-wrapper\.js "\$@"/u);
  assert.match(browserInitPage, /export default async function initializePage/u);
  assert.match(
    browserInitPage,
    /LINKSENSE_BROWSER_READ_ONLY !== "1"/u,
  );
  assert.match(browserInitPage, /page\.route\("\*\*\/\*"/u);
  assert.match(
    browserInitPage,
    /new Set\(\["GET", "HEAD", "OPTIONS"\]\)/u,
  );
  assert.match(browserInitPage, /route\.abort\("blockedbyclient"\)/u);
  assert.match(browserInitPage, /page\.routeWebSocket\("\*\*\/\*"/u);
  assert.match(browserInitPage, /route\.close\(\{/u);
  assert.match(browserCliWrapper, /acceptDownloads: !input\.readOnly/u);
  assert.match(browserCliWrapper, /userAgent: await readBrowserUserAgent\(input\.runtimeRoot\)/u);
  for (const stageName of ["worker", "worker-cached-browser"]) {
    const stage = dockerfile.split(/(?=^FROM )/mu).find((value) => value.split("\n")[0].endsWith(` AS ${stageName}`));
    assert.ok(stage, `missing ${stageName} stage`);
    assert.ok(stage.includes('task_home="/tmp/browser-smoke/home/task-homes/$conversation_id"'));
    assert.ok(stage.includes('env HOME="/tmp/browser-smoke/home" CODEX_HOME="$task_home/.codex"'));
    assert.match(stage, /COPY --chmod=0644 deploy\/runtime\/browser\/generate-user-agent\.mjs \/opt\/linksense\/runtime\/browser\/generate-user-agent\.mjs\nRUN node \/opt\/linksense\/runtime\/browser\/generate-user-agent\.mjs/u);
  }
  assert.match(
    browserCliWrapper,
    /serviceWorkers: input\.readOnly \? "block" : "allow"/u,
  );
  assert.match(workerStage, /PLAYWRIGHT_BROWSERS_PATH=/u);
  assert.match(
    workerStage,
    /Playwright mirror dependency install failed; retrying with the default upstream\./u,
  );
  assert.match(
    workerStage,
    /CMD \["\/usr\/bin\/setpriv", "--reuid=1000", "--regid=1000", "--keep-groups", "--inh-caps=\+setuid,\+kill,\+dac_override,\+fowner,\+chown", "--ambient-caps=\+setuid,\+kill,\+dac_override,\+fowner,\+chown", "node", "dist\/index\.js"\]/u,
  );
  assert.match(
    workerStage,
    /linksense-browser open-workspace-html artifacts\/browser-smoke\.html/u,
  );
  assert.match(
    workerStage,
    /linksense-browser screenshot --filename=chromium-smoke\.png/u,
  );
  assert.match(workerStage, /setpriv --reuid=1001 --regid=1000/u);
  const runtimeToolValidation = runnerIndex.indexOf(
    "runtimeToolBin: managedRuntimeToolBin",
  );
  const startupInitialization = runnerIndex.indexOf(
    "await ensureUserRuntime(workerOwnerId)",
  );
  const serverConstruction = runnerIndex.indexOf(
    "const server = buildRunnerServer",
  );
  assert.notEqual(runtimeToolValidation, -1);
  assert.ok(runtimeToolValidation < startupInitialization);
  assert.ok(startupInitialization < serverConstruction);
  assert.match(
    runnerIndex,
    /path\.join\(\s*managedRuntimeToolBin,\s*"linksense-browser",?\s*\)/u,
  );
  assert.match(codexConfig, /^browser_use = false$/mu);
  assert.match(codexConfig, /^browser_use_external = false$/mu);
  assert.match(codexConfig, /^in_app_browser = false$/mu);
  await Promise.all([
    access(browserRuntimeWrapperPath),
    access(browserRuntimeInitPagePath),
    access(resolve("scripts/codex-browser-skill-discovery-smoke.mjs")),
  ]);
});

test("worker shell bootstrap restores managed PATH after a login profile", async () => {
  const [dockerfile, bootstrap] = await Promise.all([
    readFile(runnerDockerfilePath, "utf8"),
    readFile(bashEnvironmentBootstrapPath, "utf8"),
  ]);
  const workerStage = section(dockerfile, "FROM ${NODE_IMAGE} AS worker", null);
  const managedPath = bootstrap.match(/^PATH=(.+)$/mu)?.[1];
  assert.ok(managedPath);

  assert.ok(workerStage.includes(`ENV PATH=${managedPath}`));
  assert.match(
    workerStage,
    /ENV BASH_ENV=\/opt\/linksense\/runtime\/shell\/linksense-bash-env\.sh/u,
  );
  assert.match(
    workerStage,
    /RUN install -d -o root -g root -m 0755 \/opt\/linksense\/runtime\/shell/u,
  );
  assert.match(
    workerStage,
    /COPY --chown=root:root --chmod=0444 deploy\/runtime\/shell\/linksense-bash-env\.sh \/opt\/linksense\/runtime\/shell\/linksense-bash-env\.sh/u,
  );
  assert.match(
    workerStage,
    /test "\$\(stat -c %a \/opt\/linksense\/runtime\/shell\)" = 755/u,
  );
  assert.match(
    workerStage,
    /test "\$\(stat -c %a \/opt\/linksense\/runtime\/shell\/linksense-bash-env\.sh\)" = 444/u,
  );
  for (const command of [
    "linksense-browser",
    "linksense-pnpm",
    "linksense-uv",
  ]) {
    assert.match(
      workerStage,
      new RegExp(
        `ln -s \/opt\/linksense\/bin\/${command} \/usr\/local\/bin\/${command}`,
        "u",
      ),
    );
  }
  assert.match(
    workerStage,
    /\/usr\/bin\/bash -lc 'test "\$\(command -v linksense-browser\)" = \/opt\/linksense\/bin\/linksense-browser/u,
  );
  assert.match(bootstrap, /^export PATH$/mu);

  const fakeHome = await mkdtemp(resolve(tmpdir(), "linksense-bash-home-"));
  try {
    await writeFile(
      resolve(fakeHome, ".bash_profile"),
      "PATH=/usr/bin:/bin\nexport PATH\n",
    );
    const { stdout } = await execFileAsync(
      "/bin/bash",
      ["-lc", 'printf "%s" "$PATH"'],
      {
        env: {
          BASH_ENV: bashEnvironmentBootstrapPath,
          HOME: fakeHome,
          PATH: "/tmp/profile-overridden-bin",
        },
      },
    );
    assert.equal(stdout, managedPath);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("worker images expose the protected plugin STDIO launcher", async () => {
  const [dockerfile, wrapper] = await Promise.all([
    readFile(runnerDockerfilePath, "utf8"),
    readFile(pluginStdioWrapperPath, "utf8"),
  ]);

  assert.equal(
    dockerfile.match(
      /COPY --chmod=0755 deploy\/runtime\/node\/linksense-plugin-stdio \/opt\/linksense\/bin\/linksense-plugin-stdio/gu,
    )?.length,
    2,
  );
  assert.equal(
    dockerfile.match(
      /ln -s \/opt\/linksense\/bin\/linksense-plugin-stdio \/usr\/local\/bin\/linksense-plugin-stdio/gu,
    )?.length,
    2,
  );
  assert.equal(
    dockerfile.match(
      /test "\$\(command -v linksense-plugin-stdio\)" = \/opt\/linksense\/bin\/linksense-plugin-stdio/gu,
    )?.length,
    2,
  );
  assert.match(wrapper, /^#!\/bin\/sh\nset -eu\n/u);
  assert.match(
    wrapper,
    /exec node \/app\/dist\/mcp\/personal-stdio-launcher\.js "\$@"/u,
  );
});

test("per-user package managers serialize writes and preserve immutable fallbacks", async () => {
  const [
    pythonWrapper,
    nodePnpmLauncher,
    nodeWrapper,
    nodeHook,
    userNodePackageText,
  ] = await Promise.all([
    readFile(pythonRuntimeWrapperPath, "utf8"),
    readFile(nodePnpmLauncherPath, "utf8"),
    readFile(nodeRuntimeWrapperPath, "utf8"),
    readFile(nodeRuntimeHookPath, "utf8"),
    readFile(
      new URL("../deploy/runtime/node/user-package.json", import.meta.url),
      "utf8",
    ),
  ]);
  const userNodePackage = JSON.parse(userNodePackageText);

  assert.match(
    pythonWrapper,
    /user_runtime_root="\$HOME\/\.local\/share\/linksense"/u,
  );
  assert.match(
    pythonWrapper,
    /LINKSENSE_USER_PYTHON_ROOT:-\$user_runtime_root\/python/u,
  );
  assert.doesNotMatch(pythonWrapper, /\/data\/linksense\/user-runtime/u);
  assert.match(pythonWrapper, /\/usr\/bin\/flock 9/u);
  assert.match(
    pythonWrapper,
    /\/usr\/local\/bin\/uv pip "\$operation" --python/u,
  );
  assert.match(pythonWrapper, /--default-index "\$package_index"/u);
  assert.match(pythonWrapper, /--index-strategy first-index/u);
  assert.match(
    pythonWrapper,
    /managed_source_root=\/tmp\/linksense-package-sources/u,
  );
  assert.match(pythonWrapper, /python-index-url/u);
  assert.match(pythonWrapper, /export UV_NO_CONFIG=1/u);
  assert.match(
    pythonWrapper,
    /linksense-uv does not allow package-index overrides/u,
  );
  assert.match(pythonWrapper, /linksense-public-runtime\.pth/u);
  assert.doesNotMatch(pythonWrapper, /protected_packages|cannot be removed/u);
  assert.match(
    nodeWrapper,
    /user_runtime_root="\$HOME\/\.local\/share\/linksense"/u,
  );
  assert.match(
    nodeWrapper,
    /LINKSENSE_USER_NODE_PROJECT:-\$user_runtime_root\/node/u,
  );
  assert.doesNotMatch(nodeWrapper, /\/data\/linksense\/user-runtime/u);
  assert.match(nodeWrapper, /\/usr\/bin\/flock 9/u);
  assert.match(
    nodeWrapper,
    /\/usr\/local\/bin\/node \/opt\/linksense\/tooling\/pnpm\/bin\/pnpm\.cjs/u,
  );
  assert.match(nodeWrapper, /cache\/pnpm\/store/u);
  assert.match(nodeWrapper, /export npm_config_store_dir="\$store"/u);
  assert.doesNotMatch(nodeWrapper, /--store-dir/u);
  assert.match(nodeWrapper, /--ignore-workspace/u);
  assert.match(nodeWrapper, /--registry "\$package_registry"/u);
  assert.match(
    nodeWrapper,
    /managed_source_root=\/tmp\/linksense-package-sources/u,
  );
  assert.match(nodeWrapper, /node-registry-url/u);
  assert.match(nodeWrapper, /NPM_CONFIG_USERCONFIG=\/dev\/null/u);
  assert.match(nodeWrapper, /--config\.\*/u);
  assert.match(
    nodeWrapper,
    /scoped-bypass|scoped registry|user project \.npmrc/u,
  );
  assert.match(
    nodeWrapper,
    /linksense-pnpm does not allow package-registry overrides/u,
  );
  assert.match(pythonWrapper, /--torch-backend/u);
  assert.match(pythonWrapper, /UV_TORCH_BACKEND/u);
  assert.match(
    nodeWrapper,
    /\/usr\/bin\/chmod 0660 "\$project\/package\.json"/u,
  );
  assert.doesNotMatch(nodeWrapper, /protected_packages|cannot be removed/u);
  assert.match(
    nodePnpmLauncher,
    /\/usr\/local\/bin\/node \/opt\/linksense\/tooling\/pnpm\/bin\/pnpm\.cjs/u,
  );
  assert.equal(userNodePackage.packageManager, "pnpm@10.6.4");

  const normalResolution = nodeHook.indexOf(
    "return nextResolve(specifier, context)",
  );
  const managedFallback = nodeHook.indexOf(
    "for (const parentURL of fallbackParents)",
  );
  assert.notEqual(normalResolution, -1);
  assert.notEqual(managedFallback, -1);
  assert.ok(normalResolution < managedFallback);
  assert.match(nodeHook, /new Set\(\[userProject, publicProject\]\)/u);
  assert.match(
    nodeHook,
    /path\.join\(userHome, "\.local", "share", "linksense", "node"\)/u,
  );
  assert.doesNotMatch(nodeHook, /\/data\/linksense\/user-runtime/u);
});

test("Compose exposes the Docker socket only to the controller and prebuilds workers", async () => {
  const compose = await readFile(composePath, "utf8");
  const workerImageService = section(
    compose,
    "  runner-worker-image:",
    "  runner:",
  );
  const controllerService = section(compose, "  runner:", "  api:");
  const apiService = section(compose, "  api:", "  web:");

  assert.match(
    workerImageService,
    /target: \$\{LINKSENSE_WORKER_BUILD_TARGET:-worker\}/u,
  );
  assert.match(workerImageService, /entrypoint: \["\/bin\/true"\]/u);
  assert.doesNotMatch(workerImageService, /docker\.sock|volumes:/u);
  assert.match(controllerService, /target: controller/u);
  assert.match(controllerService, /user: "0:0"/u);
  assert.match(controllerService, /LINKSENSE_RUNNER_MODE: controller/u);
  assert.match(controllerService, /docker\.sock/u);
  assert.match(
    controllerService,
    /networks:\s*\n\s+- default\s*\n\s+- worker-control/u,
  );
  assert.doesNotMatch(apiService, /docker\.sock/u);
  assert.doesNotMatch(apiService, /worker-control/u);
  assert.match(compose, /worker-control:\s*\n\s+name:.*\n\s+internal: true/u);
  assert.match(compose, /worker-egress:\s*\n\s+name:/u);
});

test("Compose API healthcheck runs once per minute with a bounded timeout", async () => {
  const compose = await readFile(composePath, "utf8");
  const apiService = section(compose, "  api:", "  web:");
  const healthcheck = section(apiService, "    healthcheck:");

  assert.match(
    healthcheck,
    /http:\/\/127\.0\.0\.1:4000\/api\/v1\/system\/health\/ready/u,
  );
  assert.match(healthcheck, /^\s+interval: 1m$/mu);
  assert.doesNotMatch(healthcheck, /^\s+interval: 10s$/mu);
  assert.match(healthcheck, /^\s+timeout: 10s$/mu);
  assert.doesNotMatch(healthcheck, /^\s+timeout: 5s$/mu);
});

test("knowledge infrastructure remains externally managed", async () => {
  const [compose, developmentScript] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(developmentScriptPath, "utf8"),
  ]);

  for (const service of [
    "minio",
    "minio-init",
    "docling",
    "docling-serve",
    "elasticsearch",
  ]) {
    assert.doesNotMatch(compose, new RegExp(`^  ${service}:`, "mu"));
  }
  assert.doesNotMatch(
    developmentScript,
    /composeArguments\(\[[^\]]*["']minio["']/su,
  );
  assert.doesNotMatch(developmentScript, /["']minio-init["']/u);
});

test("deployment keeps development host storage but production uses managed external volumes", async () => {
  const [compose, productionCompose, example] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(productionComposePath, "utf8"),
    readFile(environmentExamplePath, "utf8"),
  ]);
  const defaults = {
    LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "500",
    LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "20",
    LINKSENSE_WORKER_IDLE_TTL_SECONDS: "900",
    LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: "false",
    LINKSENSE_WORKER_MEMORY_MB: "4096",
    LINKSENSE_WORKER_CPUS: "2",
    LINKSENSE_WORKER_PIDS_LIMIT: "4096",
    LINKSENSE_WORKER_TMPFS_MB: "4096",
    LINKSENSE_WORKER_SHM_MB: "2048",
    LINKSENSE_BROWSER_SESSION_LIMIT: "2",
    LINKSENSE_AGENTS_TEMPLATE_VERSION: "7",
    LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
      "https://pypi.org/simple/",
    LINKSENSE_NODE_PACKAGE_REGISTRY_URL: "https://registry.npmjs.org/",
    LINKSENSE_USER_DATA_VOLUME: "linksense-user-data",
    LINKSENSE_BACKUP_VOLUME: "linksense-backups",
    LINKSENSE_REDIS_VOLUME: "linksense-redis",
  };

  for (const [name, value] of Object.entries(defaults)) {
    assert.match(example, new RegExp(`^${name}=${value}$`, "mu"));
  }
  for (const [name, value] of Object.entries(defaults)) {
    assert.ok(
      compose.includes(`\${${name}:-${value}}`) ||
        productionCompose.includes(`\${${name}:-${value}}`),
    );
  }
  const portableUserDataRoot = "${PWD}/.data/users";
  const portableUserDataRootExpression =
    "${LINKSENSE_USER_DATA_ROOT:-${PWD}/.data/users}";
  assert.ok(
    example.includes(`LINKSENSE_USER_DATA_ROOT=${portableUserDataRoot}`),
  );
  assert.ok(
    compose.includes(
      `LINKSENSE_USER_DATA_ROOT: "${portableUserDataRootExpression}"`,
    ),
  );
  assert.ok(
    compose.includes(
      `- "${portableUserDataRootExpression}:${portableUserDataRootExpression}"`,
    ),
  );
  assert.doesNotMatch(example, /LINKSENSE_USER_DATA_ROOT=\/Users\//u);
  assert.doesNotMatch(compose, /LINKSENSE_USER_DATA_ROOT[^\n]*\/Users\//u);
  assert.doesNotMatch(
    compose,
    /LINKSENSE_(?:WORKSPACE|CODEX_HOME|USER_RUNTIME|USER_CAPABILITY)_VOLUME/u,
  );
  assert.doesNotMatch(
    compose,
    /(?:workspaces|codex-homes|codex-home-template|user-runtimes|user-capabilities):\s*$/mu,
  );

  const productionStorageInit = section(
    productionCompose,
    "  storage-init:",
    "  backup-init:",
  );
  const productionRunner = section(
    productionCompose,
    "  runner:",
    "  api:",
  );
  const productionApi = section(productionCompose, "  api:", "  web:");
  const productionBackupInit = section(
    productionCompose,
    "  backup-init:",
    "  migrate:",
  );
  const productionPostgresBackup = section(
    productionCompose,
    "  postgres-backup:",
    "\nvolumes:",
  );
  for (const service of [
    productionStorageInit,
    productionRunner,
    productionApi,
  ]) {
    assert.match(service, /LINKSENSE_USER_DATA_ROOT: \/srv\/linksense\/users/u);
    assert.match(service, /type: volume\s+source: user-data\s+target: \/srv\/linksense\/users/u);
    assert.match(service, /nocopy: true/u);
    assert.doesNotMatch(service, /type: bind[\s\S]*target: \/srv\/linksense\/users/u);
    assert.doesNotMatch(service, /\.data\/users/u);
  }
  assert.match(
    productionRunner,
    /LINKSENSE_USER_DATA_VOLUME: \$\{LINKSENSE_USER_DATA_VOLUME:-linksense-user-data\}/u,
  );
  assert.match(productionRunner, /volumes: !override/u);
  assert.match(productionApi, /volumes: !override/u);
  assert.match(productionStorageInit, /volumes: !override/u);
  for (const service of [productionBackupInit, productionPostgresBackup]) {
    assert.match(service, /type: volume\s+source: backup-data\s+target: \/backups/u);
    assert.match(service, /nocopy: true/u);
    assert.doesNotMatch(service, /\.data\/backups|type: bind[\s\S]*target: \/backups/u);
  }
  assert.match(
    productionCompose,
    /user-data:\s+external: true\s+name: \$\{LINKSENSE_USER_DATA_VOLUME:-linksense-user-data\}/u,
  );
  assert.match(
    productionCompose,
    /backup-data:\s+external: true\s+name: \$\{LINKSENSE_BACKUP_VOLUME:-linksense-backups\}/u,
  );
  assert.doesNotMatch(
    section(productionCompose, "\nvolumes:", "\nnetworks:"),
    /driver_opts|device:|\btype:\s*(?:none|bind)\b|\bo:\s*bind\b/u,
  );
});

test("destructive runtime cutover uses only current unversioned Redis and queue names", async () => {
  const [
    redisAdapter,
    maintenanceJobs,
    passwordResetMailQueue,
  ] = await Promise.all([
    readFile(redisAdapterPath, "utf8"),
    readFile(maintenanceJobsPath, "utf8"),
    readFile(
      resolve("apps/api/src/adapters/password-reset-mail-queue.ts"),
      "utf8",
    ),
  ]);

  assert.match(redisAdapter, /["']linksense:running-turn-slots["']/u);
  assert.match(redisAdapter, /["']linksense:running-turn-release-markers["']/u);
  assert.doesNotMatch(redisAdapter, /linksense:v\d+:running-turn-/u);
  assert.match(maintenanceJobs, /["']linksense-maintenance["']/u);
  assert.doesNotMatch(maintenanceJobs, /linksense-maintenance-v\d+/u);
  assert.match(
    passwordResetMailQueue,
    /["']linksense-password-reset-mail["']/u,
  );
  assert.doesNotMatch(
    passwordResetMailQueue,
    /linksense-password-reset-mail-v\d+/u,
  );
});

test("owner runtime migration discards the legacy graph and creates only the final owner route", async () => {
  const migration = await readFile(runtimeOwnerMigrationPath, "utf8");

  for (const table of [
    "conversation_drafts",
    "pending_requests",
    "conversation_turns",
    "conversation_messages",
    "conversation_events",
    "conversation_files",
    "retained_artifacts",
    "runtime_cleanup_outbox",
    "conversations",
  ]) {
    assert.match(migration, new RegExp(`"${table}"`, "u"));
  }
  assert.match(migration, /ADD COLUMN "owner_id" UUID NOT NULL/u);
  assert.match(
    migration,
    /CREATE INDEX "runtime_cleanup_outbox_owner_status_created_idx"\s+ON "runtime_cleanup_outbox"\("owner_id", "status", "created_at"\)/u,
  );
  assert.doesNotMatch(migration, /temporary|shadow|legacy_owner/iu);
});

test("plugin credential mapping migration discards only legacy bindings", async () => {
  const migration = await readFile(pluginCredentialMappingMigrationPath, "utf8");

  assert.match(migration, /TRUNCATE TABLE "credential_bindings"/u);
  assert.match(
    migration,
    /ADD COLUMN "credential_key" VARCHAR\(120\) NOT NULL/u,
  );
  assert.match(migration, /credential_bindings_env_key_check/u);
  assert.match(migration, /credential_bindings_credential_key_check/u);
  assert.doesNotMatch(migration, /(?:TRUNCATE|DELETE FROM) "credentials"/u);
  assert.doesNotMatch(migration, /temporary|shadow|legacy_/iu);
});

test("form response snapshot migration is additive and preserves existing requests", async () => {
  const migration = await readFile(formResponseSnapshotsMigrationPath, "utf8");

  assert.match(
    migration,
    /ADD COLUMN "form_response_semantics_json" JSONB/u,
  );
  assert.match(migration, /ADD COLUMN "response_content_json" JSONB/u);
  assert.match(
    migration,
    /UPDATE "conversation_user_input_requests"[\s\S]*WHERE "request_kind" = 'form'/u,
  );
  assert.match(
    migration,
    /conversation_user_input_requests_response_shape_check/u,
  );
  assert.match(
    migration,
    /conversation_user_input_requests_response_content_object_check/u,
  );
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/iu);
});

test("published migrations stay immutable and later schema changes use a follow-up migration", async () => {
  const [publishedMigration, followUpMigration] = await Promise.all([
    readFile(publishedStartIntentMigrationPath, "utf8"),
    readFile(turnIdempotencyMetadataMigrationPath, "utf8"),
  ]);

  for (const [migrationPath, expectedChecksum] of publishedMigrationChecksums) {
    const migration = await readFile(resolve(migrationPath), "utf8");
    assert.equal(
      createHash("sha256").update(migration).digest("hex"),
      expectedChecksum,
      `${migrationPath} must not change after publication`,
    );
  }
  assert.doesNotMatch(
    publishedMigration,
    /idempotency_request_hash|credential_usage_receipts_json/u,
  );
  assert.match(followUpMigration, /ADD COLUMN "idempotency_request_hash"/u);
  assert.match(
    followUpMigration,
    /ADD COLUMN "credential_usage_receipts_json" JSONB NOT NULL DEFAULT '\[\]'::jsonb/u,
  );
  assert.match(followUpMigration, /legacy-unverifiable:/u);
  assert.match(
    followUpMigration,
    /DROP CONSTRAINT "conversation_turn_start_intents_json_shapes_check"/u,
  );
});

test("production user-volume normalizer performs the real migration cleanup without touching the source", async () => {
  const deploymentScript = await readFile(productionDeployPath, "utf8");
  const normalizer = extractProductionHeredoc(
    deploymentScript,
    "normalize-user-volume.mjs",
  );
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "linksense-normalizer-fixture-"),
  );
  const source = resolve(temporaryRoot, "legacy-source");
  const target = resolve(temporaryRoot, "volume-target");
  const ownerId = "123e4567-e89b-12d3-a456-426614174000";
  const owner = resolve(source, ownerId);

  try {
    for (const directory of [
      resolve(source, ".capabilities/source"),
      resolve(source, ".runner-health"),
      resolve(owner, "home/.agents/legacy"),
      resolve(owner, "home/.codex/plugins/cache"),
      resolve(owner, "home/workspaces"),
      resolve(owner, "managed/agents/skills"),
      resolve(owner, `managed/.capabilities-${ownerId}`),
      resolve(owner, "control"),
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o777 });
    }
    await Promise.all([
      writeFile(resolve(source, ".capabilities/source/skill.md"), "global"),
      writeFile(resolve(source, ".runner-health/stale"), "stale"),
      writeFile(resolve(owner, "home/.agents/legacy/skill.md"), "legacy-agent"),
      writeFile(
        resolve(owner, "home/.codex/plugins/cache/plugin.json"),
        "legacy-plugin",
      ),
      writeFile(resolve(owner, "home/.codex/config.toml"), "model='test'"),
      writeFile(resolve(owner, "home/workspaces/report.txt"), "workspace"),
      writeFile(resolve(owner, "home/notes.txt"), "private"),
      writeFile(
        resolve(owner, "managed/agents/skills/managed.md"),
        "managed",
      ),
      writeFile(
        resolve(owner, `managed/.capabilities-${ownerId}/staged`),
        "stale-staging",
      ),
      writeFile(resolve(owner, "control/.workspace-permissions-v1"), "old"),
      writeFile(resolve(owner, "control/runtime.json"), "control"),
    ]);
    for (const targetPath of [
      source,
      resolve(source, ".capabilities"),
      owner,
      resolve(owner, "home"),
      resolve(owner, "home/.codex"),
      resolve(owner, "home/workspaces"),
      resolve(owner, "managed"),
      resolve(owner, "managed/agents"),
      resolve(owner, "control"),
    ]) {
      await chmod(targetPath, 0o777);
    }
    const sourceBefore = await snapshotTree(source);
    await cp(source, target, { recursive: true, preserveTimestamps: true });

    const result = await runUnprivilegedNormalizer(
      normalizer,
      target,
      temporaryRoot,
    );

    assert.equal(result.stdout, "");
    assert.deepEqual(await snapshotTree(source), sourceBefore);
    await assert.rejects(access(resolve(target, ".runner-health")), {
      code: "ENOENT",
    });
    await assert.rejects(
      access(resolve(target, ownerId, "home/.agents/legacy/skill.md")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(resolve(target, ownerId, "home/.codex/plugins/cache/plugin.json")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(resolve(target, ownerId, `managed/.capabilities-${ownerId}`)),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(resolve(target, ownerId, "control/.workspace-permissions-v1")),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(resolve(target, ".capabilities/source/skill.md"), "utf8"),
      "global",
    );
    assert.equal(
      await readFile(
        resolve(target, ownerId, "managed/agents/skills/managed.md"),
        "utf8",
      ),
      "managed",
    );
    assert.equal(await modeOf(target), 0o770);
    assert.equal(await modeOf(resolve(target, ".capabilities")), 0o750);
    assert.equal(
      await modeOf(resolve(target, ".capabilities/source/skill.md")),
      0o640,
    );
    assert.equal(await modeOf(resolve(target, ownerId, "home")), 0o770);
    assert.equal(
      await modeOf(resolve(target, ownerId, "home/workspaces")),
      0o2770,
    );
    assert.equal(
      await modeOf(resolve(target, ownerId, "home/workspaces/report.txt")),
      0o640,
    );
    assert.equal(
      await modeOf(resolve(target, ownerId, "home/.codex/config.toml")),
      0o660,
    );
    assert.equal(
      await modeOf(resolve(target, ownerId, "managed/agents/skills/managed.md")),
      0o640,
    );
    assert.equal(await modeOf(resolve(target, ownerId, "control")), 0o700);
    assert.equal(
      await modeOf(resolve(target, ownerId, "control/runtime.json")),
      0o600,
    );
    assert.ok(
      result.ownershipCalls.some(
        ({ target: path, uid, gid }) => path === target && uid === 1000 && gid === 1000,
      ),
    );
    assert.ok(
      result.ownershipCalls.some(
        ({ target: path, uid, gid }) =>
          path.endsWith(`/${ownerId}/home`) && uid === 1001 && gid === 1000,
      ),
    );
    assert.ok(
      result.ownershipCalls.some(
        ({ target: path, uid, gid }) =>
          path.endsWith(`/${ownerId}/managed`) && uid === 1000 && gid === 1000,
      ),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("production user-volume normalizer fails closed on symlink roots and unexpected entries", async (context) => {
  const deploymentScript = await readFile(productionDeployPath, "utf8");
  const normalizer = extractProductionHeredoc(
    deploymentScript,
    "normalize-user-volume.mjs",
  );

  await context.test("rejects a symlink volume root without traversing it", async () => {
    const temporaryRoot = await mkdtemp(
      resolve(tmpdir(), "linksense-normalizer-symlink-"),
    );
    const realRoot = resolve(temporaryRoot, "real-volume");
    const linkedRoot = resolve(temporaryRoot, "linked-volume");
    try {
      await mkdir(realRoot);
      await writeFile(resolve(realRoot, "sentinel"), "unchanged");
      const before = await snapshotTree(realRoot);
      await symlink(realRoot, linkedRoot, "dir");
      await assert.rejects(
        runUnprivilegedNormalizer(normalizer, linkedRoot, temporaryRoot),
        (error) => {
          assert.match(error.stderr, /user-data volume root is not a real directory/u);
          return true;
        },
      );
      assert.deepEqual(await snapshotTree(realRoot), before);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await context.test("rejects an unexpected volume-root entry", async () => {
    const temporaryRoot = await mkdtemp(
      resolve(tmpdir(), "linksense-normalizer-unexpected-"),
    );
    const root = resolve(temporaryRoot, "volume");
    try {
      await mkdir(root);
      await writeFile(resolve(root, "unexpected-owner"), "must-not-be-accepted");
      await assert.rejects(
        runUnprivilegedNormalizer(normalizer, root, temporaryRoot),
        (error) => {
          assert.match(
            error.stderr,
            /unexpected entry at user-data volume root: unexpected-owner/u,
          );
          return true;
        },
      );
      assert.equal(
        await readFile(resolve(root, "unexpected-owner"), "utf8"),
        "must-not-be-accepted",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
