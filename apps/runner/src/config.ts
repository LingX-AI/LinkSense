import path from "node:path"

import { z } from "zod"

import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  knowledgeSearchTimeoutMsSchema,
} from "./knowledge-search-timeout.js"

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback)
const booleanEnvironment = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true")
const uuid = z.uuid()
const absoluteDirectory = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    if (!path.isAbsolute(value)) {
      context.addIssue({
        code: "custom",
        message: "absolute_directory_required",
      })
    }
  })
  .transform((value) => path.resolve(value))
const dockerVolumeName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u, "docker_volume_name_required")
export const DEFAULT_PYTHON_PACKAGE_INDEX_URL =
  "https://pypi.org/simple/"
export const DEFAULT_NODE_PACKAGE_REGISTRY_URL =
  "https://registry.npmjs.org/"

const securePackageRepositoryUrl = z
  .url()
  .trim()
  .superRefine((value, context) => {
    const url = new URL(value)
    if (url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "package_repository_https_required",
      })
    }
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "package_repository_credentials_forbidden",
      })
    }
    if (value.includes("?") || value.includes("#")) {
      context.addIssue({
        code: "custom",
        message: "package_repository_query_or_fragment_forbidden",
      })
    }
  })
  .transform((value) => {
    const url = new URL(value)
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`
    return url.toString()
  })

const runnerConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    CODEX_BIN: z.string().trim().min(1).default("codex"),
    LINKSENSE_RUNNER_MODE: z
      .enum(["controller", "worker", "standalone"])
      .default("standalone"),
    LINKSENSE_WORKER_PROVIDER: z
      .enum(["docker", "local-process"])
      .default("docker"),
    LINKSENSE_WORKER_OWNER_ID: uuid.optional(),
    LINKSENSE_USER_DATA_ROOT: absoluteDirectory,
    LINKSENSE_USER_DATA_VOLUME: dockerVolumeName.optional(),
    LINKSENSE_PYTHON_BASE_SITE_PACKAGES: z
      .string()
      .trim()
      .min(1)
      .default("/opt/linksense/runtime/python/lib/python3.12/site-packages"),
    LINKSENSE_NODE_BASE_PROJECT: z
      .string()
      .trim()
      .min(1)
      .default("/opt/linksense/runtime/node"),
    LINKSENSE_NODE_REGISTER_HOOK: z
      .string()
      .trim()
      .min(1)
      .default("/opt/linksense/runtime/node/register-hooks.mjs"),
    LINKSENSE_PNPM_VERSION: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
      .default("10.6.4"),
    LINKSENSE_PYTHON_PACKAGE_INDEX_URL: securePackageRepositoryUrl.default(
      DEFAULT_PYTHON_PACKAGE_INDEX_URL,
    ),
    LINKSENSE_NODE_PACKAGE_REGISTRY_URL: securePackageRepositoryUrl.default(
      DEFAULT_NODE_PACKAGE_REGISTRY_URL,
    ),
    LINKSENSE_CODEX_HOME_TEMPLATE: z.string().trim().min(1).optional(),
    LINKSENSE_WORKER_CONTROL_ROOT: absoluteDirectory.optional(),
    LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS: positiveInteger(900),
    LINKSENSE_WORKER_IDLE_TTL_SECONDS: positiveInteger(900),
    LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: booleanEnvironment(false),
    LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: booleanEnvironment(false),
    LINKSENSE_WORKER_READY_TIMEOUT_SECONDS: positiveInteger(60),
    LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: positiveInteger(20),
    LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: positiveInteger(20),
    LINKSENSE_RUNNER_HOST: z.string().trim().min(1).default("127.0.0.1"),
    LINKSENSE_RUNNER_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(4010),
    LINKSENSE_WORKER_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(4010),
    LINKSENSE_RUNNER_SHARED_SECRET: z.string().min(32),
    LINKSENSE_RUNNER_INSTANCE_ID: uuid.optional(),
    LINKSENSE_API_INTERNAL_URL: z.url(),
    LINKSENSE_CONTROLLER_INTERNAL_URL: z.url().default("http://runner:4010"),
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS:
      knowledgeSearchTimeoutMsSchema.default(
        DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
      ),
    LINKSENSE_AGENTS_TEMPLATE_VERSION: z.string().trim().min(1).default("7"),
    LINKSENSE_DOCKER_SOCKET_PATH: z
      .string()
      .trim()
      .min(1)
      .default("/var/run/docker.sock"),
    LINKSENSE_DOCKER_API_VERSION: z
      .string()
      .regex(/^v?\d+\.\d+$/u)
      .default("v1.45"),
    LINKSENSE_DOCKER_COMPOSE_PROJECT_NAME: z
      .string()
      .trim()
      .min(1)
      .default("linksense"),
    LINKSENSE_WORKER_IMAGE: z
      .string()
      .trim()
      .min(1)
      .default("linksense-runner-worker:local"),
    LINKSENSE_WORKER_IMAGE_REVISION: z
      .string()
      .trim()
      .min(1)
      .default("unversioned"),
    LINKSENSE_WORKER_CONTROL_NETWORK: z
      .string()
      .trim()
      .min(1)
      .default("linksense-worker-control"),
    LINKSENSE_WORKER_EGRESS_NETWORK: z
      .string()
      .trim()
      .min(1)
      .default("linksense-worker-egress"),
    LINKSENSE_WORKER_MEMORY_MB: positiveInteger(4096),
    LINKSENSE_WORKER_CPUS: z.coerce.number().positive().max(64).default(2),
    LINKSENSE_WORKER_PIDS_LIMIT: positiveInteger(4096),
    LINKSENSE_WORKER_TMPFS_MB: positiveInteger(4096),
    LINKSENSE_WORKER_SHM_MB: positiveInteger(2048),
    LINKSENSE_BROWSER_SESSION_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(2),
  })
  .superRefine((config, context) => {
    if (
      config.LINKSENSE_RUNNER_MODE === "worker" &&
      !config.LINKSENSE_WORKER_OWNER_ID
    ) {
      context.addIssue({
        code: "custom",
        path: ["LINKSENSE_WORKER_OWNER_ID"],
        message: "worker_owner_id_required",
      })
    }
    if (config.LINKSENSE_WORKER_PROVIDER !== "local-process") return
    if (config.NODE_ENV !== "development") {
      context.addIssue({
        code: "custom",
        path: ["LINKSENSE_WORKER_PROVIDER"],
        message: "local_process_provider_development_only",
      })
    }
    if (
      config.LINKSENSE_RUNNER_MODE === "standalone" ||
      !["127.0.0.1", "::1", "localhost"].includes(
        config.LINKSENSE_RUNNER_HOST,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["LINKSENSE_RUNNER_HOST"],
        message: "local_process_provider_loopback_controller_or_worker_required",
      })
    }
    if (config.LINKSENSE_USER_DATA_VOLUME) {
      context.addIssue({
        code: "custom",
        path: ["LINKSENSE_USER_DATA_VOLUME"],
        message: "local_process_provider_docker_volume_forbidden",
      })
    }
    if (config.LINKSENSE_RUNNER_MODE === "worker") {
      if (!config.LINKSENSE_WORKER_CONTROL_ROOT) {
        context.addIssue({
          code: "custom",
          path: ["LINKSENSE_WORKER_CONTROL_ROOT"],
          message: "local_process_worker_path_required",
        })
      }
    }
  })

export type RunnerConfig = z.infer<typeof runnerConfigSchema>

export function parseRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RunnerConfig {
  return runnerConfigSchema.parse(env)
}
