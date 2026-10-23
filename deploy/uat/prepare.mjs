import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

export function prepareUat(root, { revision, project = "linksense-uat", publicUrl, port = "19090" }) {
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error("A committed source revision is required");
  if (!/^[a-z][a-z0-9_-]{2,40}$/u.test(project)) throw new Error("Invalid UAT project name");
  if (!/^\d{1,5}$/u.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error("UAT port must be between 1024 and 65535");
  const url = new URL(publicUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Public URL must be an HTTP(S) origin");
  const directory = resolve(root, ".data/uat");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, "runtime.env");
  if (existsSync(file) && !lstatSync(file).isFile()) throw new Error("UAT environment must be a regular file");
  const previous = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  if (previous.COMPOSE_PROJECT_NAME && previous.COMPOSE_PROJECT_NAME !== project) throw new Error("Refusing to reuse another project's UAT credentials");
  const baseline = JSON.parse(readFileSync(resolve(root, "deploy/baselines/images.lock.json"), "utf8"));
  const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Invalid source package version");
  const secret = (key, encoding = "hex") => previous[key] ?? randomBytes(32).toString(encoding);
  const databasePassword = secret("POSTGRES_PASSWORD");
  const redisPassword = secret("REDIS_PASSWORD");
  const tag = revision.slice(0, 12);
  const environment = {
    COMPOSE_PROJECT_NAME: project,
    LINKSENSE_SOURCE_ROOT: resolve(root),
    LINKSENSE_EDITION: "core",
    LINKSENSE_VERSION: `v${version}`,
    LINKSENSE_PUBLIC_BASE_URL: url.origin,
    LINKSENSE_PUBLIC_SCHEME: url.protocol.slice(0, -1),
    LINKSENSE_HTTP_PORT: String(port),
    POSTGRES_DB: "linksense",
    POSTGRES_USER: "linksense",
    POSTGRES_PASSWORD: databasePassword,
    DATABASE_URL: `postgresql://linksense:${encodeURIComponent(databasePassword)}@postgres:5432/linksense`,
    REDIS_PASSWORD: redisPassword,
    REDIS_URL: `redis://:${encodeURIComponent(redisPassword)}@redis:6379/0`,
    LINKSENSE_JWT_SECRET: secret("LINKSENSE_JWT_SECRET"),
    LINKSENSE_INITIALIZATION_TOKEN: secret("LINKSENSE_INITIALIZATION_TOKEN"),
    LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET: secret("LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET"),
    LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET: secret("LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET"),
    LINKSENSE_CREDENTIAL_MASTER_KEY: secret("LINKSENSE_CREDENTIAL_MASTER_KEY", "base64"),
    LINKSENSE_CREDENTIAL_KEY_ID: "v1",
    LINKSENSE_RUNNER_SHARED_SECRET: secret("LINKSENSE_RUNNER_SHARED_SECRET"),
    MINIO_ROOT_USER: "linksense-root",
    MINIO_ROOT_PASSWORD: secret("MINIO_ROOT_PASSWORD"),
    MINIO_ACCESS_KEY: "linksense-app",
    MINIO_SECRET_KEY: secret("MINIO_SECRET_KEY"),
    MINIO_BUCKET: "linksense-files",
    MINIO_KNOWLEDGE_BUCKET: "linksense-knowledge",
    MINIO_ENDPOINT: "minio",
    MINIO_PORT: "9000",
    MINIO_USE_SSL: "false",
    MINIO_PUBLIC_URL: url.origin,
    MINIO_REGION: "us-east-1",
    LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "1",
    LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "2",
    LINKSENSE_WORKER_MEMORY_MB: "4096",
    LINKSENSE_WORKER_CPUS: "2",
    LINKSENSE_WORKER_READY_TIMEOUT_SECONDS: "120",
    LINKSENSE_API_MEMORY_MB: "2048",
    LINKSENSE_API_NODE_OPTIONS: "--max-old-space-size=1536",
    LINKSENSE_RUNNER_MEMORY_MB: "1024",
    LINKSENSE_RUNNER_NODE_OPTIONS: "--max-old-space-size=768",
    LINKSENSE_POSTGRES_MEMORY_MB: "1024",
    LINKSENSE_REDIS_MEMORY_MB: "512",
    LINKSENSE_MINIO_MEMORY_MB: "512",
    LINKSENSE_WORKER_IMAGE_REVISION: revision,
  };
  for (const role of ["API", "WEB", "MIGRATE", "RUNNER", "WORKER"]) environment[`LINKSENSE_${role}_IMAGE`] = `${project}-${role.toLowerCase()}:${tag}`;
  for (const role of ["POSTGRES", "REDIS", "MINIO", "MINIO_CLIENT", "BUSYBOX", "GATEWAY"]) {
    const image = baseline.services[role];
    if (!/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/u.test(image)) throw new Error(`Unpinned baseline image: ${role}`);
    environment[`${role}_IMAGE`] = image;
  }
  for (const [role, suffix] of Object.entries({ POSTGRES: "postgres", REDIS: "redis", MINIO: "minio", USER_DATA: "users", BACKUP: "backups" })) environment[`LINKSENSE_${role}_VOLUME`] = `${project}-${suffix}`;
  for (const [role, suffix] of Object.entries({ INTERNAL: "internal", WORKER_CONTROL: "worker-control", WORKER_EGRESS: "worker-egress" })) environment[`LINKSENSE_${role}_NETWORK`] = `${project}-${suffix}`;
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  renameSync(temporary, file);
  const credentialFile = resolve(directory, "initialization.txt");
  if (!existsSync(credentialFile)) writeFileSync(credentialFile, environment.LINKSENSE_INITIALIZATION_TOKEN + "\n", { mode: 0o600, flag: "wx" });
  return environment;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  prepareUat(process.cwd(), {
    revision: process.env.LINKSENSE_SOURCE_REVISION,
    project: process.env.COMPOSE_PROJECT_NAME || "linksense-uat",
    publicUrl: process.env.LINKSENSE_PUBLIC_BASE_URL,
    port: process.env.LINKSENSE_HTTP_PORT || "19090",
  });
}
