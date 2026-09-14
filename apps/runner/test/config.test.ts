import { describe, expect, it } from "vitest"

import {
  DEFAULT_NODE_PACKAGE_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  parseRunnerConfig,
} from "../src/config.js"
import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  deriveKnowledgeSearchTimeouts,
} from "../src/knowledge-search-timeout.js"

const baseEnvironment = {
  LINKSENSE_USER_DATA_ROOT: "/tmp/linksense/users",
  LINKSENSE_RUNNER_SHARED_SECRET: "runner-111111111111111111111111111111",
  LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
}

describe("parseRunnerConfig", () => {
  it("uses the current conversation AGENTS template version by default", () => {
    const config = parseRunnerConfig({
      ...baseEnvironment,
      LINKSENSE_RUNNER_INSTANCE_ID: "11111111-1111-4111-8111-111111111111",
    })

    expect(config.LINKSENSE_AGENTS_TEMPLATE_VERSION).toBe("7")
    expect(config).not.toHaveProperty("LINKSENSE_CODEX_MODEL")
    expect(config.LINKSENSE_PNPM_VERSION).toBe("10.6.4")
    expect(config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL).toBe(
      DEFAULT_PYTHON_PACKAGE_INDEX_URL,
    )
    expect(config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL).toBe(
      DEFAULT_NODE_PACKAGE_REGISTRY_URL,
    )
    expect(config.LINKSENSE_RUNNER_INSTANCE_ID).toBe(
      "11111111-1111-4111-8111-111111111111",
    )
    expect(config.LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN).toBe(false)
    expect(config.LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS).toBe(false)
    expect(config.LINKSENSE_WORKER_IMAGE_REVISION).toBe("unversioned")
    expect(config.LINKSENSE_WORKER_PIDS_LIMIT).toBe(4096)
    expect(config.LINKSENSE_WORKER_TMPFS_MB).toBe(4096)
    expect(config.LINKSENSE_WORKER_SHM_MB).toBe(2048)
    expect(config.LINKSENSE_BROWSER_SESSION_LIMIT).toBe(2)
    expect(config.LINKSENSE_MANAGED_BROWSER_ENABLED).toBe(true)
    expect(config.LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS).toBe(900)
    expect(config.LINKSENSE_WORKER_IDLE_TTL_SECONDS).toBe(900)
    expect(config.LINKSENSE_DOCKER_COMPOSE_PROJECT_NAME).toBe("linksense")
    expect(config.LINKSENSE_USER_DATA_VOLUME).toBeUndefined()
    expect(config.LINKSENSE_WORKER_PROVIDER).toBe("docker")
    expect(config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS).toBe(
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    )
  })

  it("does not use the legacy deployment model setting", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_CODEX_MODEL: "legacy-model",
      }),
    ).not.toHaveProperty("LINKSENSE_CODEX_MODEL")
  })

  it("can explicitly disable the managed browser runtime", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_MANAGED_BROWSER_ENABLED: "false",
      }).LINKSENSE_MANAGED_BROWSER_ENABLED,
    ).toBe(false)
  })

  it("requires one absolute user data root", () => {
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_USER_DATA_ROOT: "relative/users",
      }),
    ).toThrow("absolute_directory_required")

    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_USER_DATA_ROOT: " /srv/linksense/users/../users ",
      }).LINKSENSE_USER_DATA_ROOT,
    ).toBe("/srv/linksense/users")
  })

  it("accepts only a Docker-managed user data volume name", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_USER_DATA_VOLUME: "linksense-user-data.production_1",
      }).LINKSENSE_USER_DATA_VOLUME,
    ).toBe("linksense-user-data.production_1")

    for (const value of [
      "relative/user-data",
      "../user-data",
      "/var/lib/linksense",
      "user data",
      "",
    ]) {
      expect(() =>
        parseRunnerConfig({
          ...baseEnvironment,
          LINKSENSE_USER_DATA_VOLUME: value,
        }),
      ).toThrow()
    }
  })

  it("only enables authenticated development endpoints when explicitly configured", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: "true",
        LINKSENSE_WORKER_IMAGE_REVISION: "sha256:development-image",
      }),
    ).toMatchObject({
      LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: true,
      LINKSENSE_WORKER_IMAGE_REVISION: "sha256:development-image",
    })
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: "1",
      }),
    ).toThrow()
  })

  it("only enables worker removal on shutdown when explicitly configured", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: "true",
      }).LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN,
    ).toBe(true)
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: "1",
      }),
    ).toThrow()
  })

  it("accepts local-process workers only for an explicit loopback development controller", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        NODE_ENV: "development",
        LINKSENSE_RUNNER_MODE: "controller",
        LINKSENSE_RUNNER_HOST: "127.0.0.1",
        LINKSENSE_WORKER_PROVIDER: "local-process",
      }).LINKSENSE_WORKER_PROVIDER,
    ).toBe("local-process")

    for (const overrides of [
      { NODE_ENV: "production" },
      { LINKSENSE_RUNNER_HOST: "0.0.0.0" },
      { LINKSENSE_RUNNER_MODE: "standalone" },
      { LINKSENSE_USER_DATA_VOLUME: "linksense-user-data" },
    ]) {
      expect(() =>
        parseRunnerConfig({
          ...baseEnvironment,
          NODE_ENV: "development",
          LINKSENSE_RUNNER_MODE: "controller",
          LINKSENSE_RUNNER_HOST: "127.0.0.1",
          LINKSENSE_WORKER_PROVIDER: "local-process",
          ...overrides,
        }),
      ).toThrow()
    }
  })

  it("requires an explicit control root in a local worker child", () => {
    const workerEnvironment = {
      ...baseEnvironment,
      NODE_ENV: "development",
      LINKSENSE_RUNNER_MODE: "worker",
      LINKSENSE_RUNNER_HOST: "127.0.0.1",
      LINKSENSE_WORKER_PROVIDER: "local-process",
      LINKSENSE_WORKER_OWNER_ID: "01900000-0000-7000-8000-000000000001",
    }
    expect(() => parseRunnerConfig(workerEnvironment)).toThrow()
    expect(
      parseRunnerConfig({
        ...workerEnvironment,
        LINKSENSE_WORKER_CONTROL_ROOT: "/tmp/linksense/control",
      }),
    ).toMatchObject({
      LINKSENSE_WORKER_CONTROL_ROOT: "/tmp/linksense/control",
    })
  })

  it("normalizes configured HTTPS package repository URLs", () => {
    const config = parseRunnerConfig({
      ...baseEnvironment,
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
        "  https://packages.example/pypi/simple  ",
      LINKSENSE_NODE_PACKAGE_REGISTRY_URL: "https://packages.example/npm",
    })

    expect(config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL).toBe(
      "https://packages.example/pypi/simple/",
    )
    expect(config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL).toBe(
      "https://packages.example/npm/",
    )
  })

  it.each([
    ["non-HTTPS", "http://packages.example/simple"],
    ["credentials", "https://user:secret@packages.example/simple"],
    ["query", "https://packages.example/simple?tenant=one"],
    ["empty query", "https://packages.example/simple?"],
    ["fragment", "https://packages.example/simple#mirror"],
    ["empty fragment", "https://packages.example/simple#"],
  ])("rejects %s package repository URLs", (_case, repositoryUrl) => {
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_PYTHON_PACKAGE_INDEX_URL: repositoryUrl,
      }),
    ).toThrow()
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_NODE_PACKAGE_REGISTRY_URL: repositoryUrl,
      }),
    ).toThrow()
  })

  it("allows a per-owner process limit below the global concurrency", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "50",
        LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "10",
      }),
    ).toMatchObject({
      LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: 50,
      LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: 10,
    })
  })

  it("accepts an explicit Docker Compose project name for resource monitoring", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_DOCKER_COMPOSE_PROJECT_NAME: "linksense-production",
      }).LINKSENSE_DOCKER_COMPOSE_PROJECT_NAME,
    ).toBe("linksense-production")
  })

  it("accepts only a bounded positive browser session limit", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_BROWSER_SESSION_LIMIT: "4",
      }).LINKSENSE_BROWSER_SESSION_LIMIT,
    ).toBe(4)
    for (const value of ["0", "21", "1.5", "invalid"]) {
      expect(() =>
        parseRunnerConfig({
          ...baseEnvironment,
          LINKSENSE_BROWSER_SESSION_LIMIT: value,
        }),
      ).toThrow()
    }
  })

  it("derives ordered knowledge search budgets from one safe deployment value", () => {
    expect(
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "181234",
      }).LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    ).toBe(181_234)
    expect(deriveKnowledgeSearchTimeouts(181_234)).toEqual({
      apiProxyMs: 181_234,
      workerRelayMs: 186_234,
      mcpHelperMs: 191_234,
      codexToolSeconds: 197,
    })

    for (const value of [
      "0",
      "-1",
      "1.5",
      "invalid",
      String(Number.MAX_SAFE_INTEGER),
    ]) {
      expect(() =>
        parseRunnerConfig({
          ...baseEnvironment,
          LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: value,
        }),
      ).toThrow()
    }
  })
})
