import { describe, expect, it } from "vitest"

import { parseConfig } from "../src/config.js"
import { testEnvironment } from "./test-config.js"

describe("parseConfig", () => {
  it("accepts a deployment without optional SMTP, OIDC, or Teams", () => {
    const config = parseConfig(testEnvironment())
    expect(config.smtp.status).toBe("not_configured")
    expect(config.oidc.status).toBe("not_configured")
    expect(config.teams.status).toBe("not_configured")
    expect(config.maxConcurrentConversations).toBe(20)
    expect(config.runnerAppServerProcessLimit).toBe(20)
    expect(config.minio.downloadTtlSeconds).toBe(7_200)
    expect(config.adminModelManagementEnabled).toBe(true)
    expect(config.releaseVersion).toBe("v0.1.1")
    expect(config.initializationToken).toBeUndefined()
    expect(config.clawHubSyncTimeZone).toBe("Asia/Shanghai")
    expect(config.clawHubSyncTransactionTimeoutMs).toBe(300_000)
    expect(config.userDataRoot).toBe("/tmp/linksense-test/users")
    expect(config.workspaceRoot).toBe(config.userDataRoot)
    expect(config.capabilityRoot).toBe(
      "/tmp/linksense-test/users/.capabilities",
    )
    expect(config.safeHttp.allowBenchmarkProxyAddresses).toBe(false)
    expect([...config.upload.allowedTypes]).toEqual(
      expect.arrayContaining([
        "application/pdf",
        "text/plain",
        "text/javascript",
        "application/json",
        "application/vnd.ms-excel",
        "application/x-7z-compressed",
        "application/vnd.rar",
        "application/gzip",
        "image/avif",
        "audio/mpeg",
        "audio/webm",
        "audio/wav",
        "video/mp4",
        "video/x-matroska",
        "video/x-msvideo",
      ]),
    )
  })

  it("accepts only a stable v-prefixed deployment release version", () => {
    expect(
      parseConfig(
        testEnvironment({ LINKSENSE_VERSION: "v1.24.3" }),
      ).releaseVersion,
    ).toBe("v1.24.3")
    expect(() =>
      parseConfig(testEnvironment({ LINKSENSE_VERSION: "1.24.3" })),
    ).toThrow()
    expect(() =>
      parseConfig(testEnvironment({ LINKSENSE_VERSION: "v1.24.3-beta.1" })),
    ).toThrow()
  })

  it("accepts only a sufficiently strong optional initialization token", () => {
    expect(
      parseConfig(
        testEnvironment({ LINKSENSE_INITIALIZATION_TOKEN: "i".repeat(64) }),
      ).initializationToken,
    ).toBe("i".repeat(64))
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_INITIALIZATION_TOKEN: "too-short" }),
      ),
    ).toThrow()
  })

  it("validates the ClawHub synchronization time zone", () => {
    expect(
      parseConfig(
        testEnvironment({
          LINKSENSE_CLAWHUB_SYNC_TIME_ZONE: "America/New_York",
        }),
      ).clawHubSyncTimeZone,
    ).toBe("America/New_York")
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_CLAWHUB_SYNC_TIME_ZONE: "Invalid/Time_Zone",
        }),
      ),
    ).toThrow()
  })

  it("bounds the ClawHub synchronization transaction timeout", () => {
    expect(
      parseConfig(
        testEnvironment({
          LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS: "600000",
        })
      ).clawHubSyncTransactionTimeoutMs
    ).toBe(600_000)
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS: "9999",
        })
      )
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS: "1800001",
        })
      )
    ).toThrow()
  })

  it("parses the administrator model-management deployment switch", () => {
    expect(
      parseConfig(
        testEnvironment({
          LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: "false",
        }),
      ).adminModelManagementEnabled,
    ).toBe(false)

    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: "yes",
        }),
      ),
    ).toThrow()
  })

  it("requires one absolute user data root", () => {
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_USER_DATA_ROOT: "relative/users" }),
      ),
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_USER_DATA_ROOT: undefined }),
      ),
    ).toThrow()
  })

  it("only trusts container benchmark proxy addresses when explicitly enabled", () => {
    expect(
      parseConfig(
        testEnvironment({
          LINKSENSE_SAFE_HTTP_ALLOW_BENCHMARK_PROXY: "true",
        }),
      ).safeHttp.allowBenchmarkProxyAddresses,
    ).toBe(true)
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_SAFE_HTTP_ALLOW_BENCHMARK_PROXY: "yes",
        }),
      ),
    ).toThrow()
  })

  it("keeps the legacy Agent artifact allowlist independent from the attachment allowlist", () => {
    const config = parseConfig(
      testEnvironment({
        LINKSENSE_UPLOAD_ALLOWED_TYPES: "text/plain",
        LINKSENSE_ARTIFACT_ALLOWED_TYPES: "",
      }),
    )

    expect([...config.upload.allowedTypes]).toEqual(["text/plain"])
    expect([...config.upload.artifactAllowedTypes]).toEqual(
      expect.arrayContaining([
        "audio/mpeg",
        "audio/mp4",
        "audio/wav",
        "audio/webm",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-matroska",
        "application/x-7z-compressed",
        "application/vnd.rar",
      ]),
    )
  })

  it("still parses an explicit legacy deployment allowlist for Agent artifacts", () => {
    const config = parseConfig(
      testEnvironment({
        LINKSENSE_ARTIFACT_ALLOWED_TYPES: "audio/mpeg,video/mp4",
      }),
    )

    expect([...config.upload.artifactAllowedTypes]).toEqual([
      "audio/mpeg",
      "video/mp4",
    ])
  })

  it("marks a partial optional integration as invalid without failing startup", () => {
    const config = parseConfig(
      testEnvironment({ SMTP_HOST: "smtp.example.test", OIDC_CLIENT_ID: "client" }),
    )
    expect(config.smtp.status).toBe("invalid")
    expect(config.oidc.status).toBe("invalid")
  })

  it("rejects reused security secrets and non-positive limits", () => {
    const same = "same-secret-which-is-at-least-thirty-two-bytes"
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_JWT_SECRET: same,
          LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET: same,
        }),
      ),
    ).toThrow()
    expect(() =>
      parseConfig(testEnvironment({ LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: "0" })),
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT: "0",
        }),
      ),
    ).toThrow()
  })

  it("allows HTTP in production and reports whether the public URL uses HTTPS", () => {
    const insecure = parseConfig(
      testEnvironment({
        NODE_ENV: "production",
        LINKSENSE_PUBLIC_BASE_URL: "http://linksense.example.test",
      }),
    )
    const secure = parseConfig(
      testEnvironment({
        NODE_ENV: "production",
        LINKSENSE_PUBLIC_BASE_URL: "https://linksense.example.test",
      }),
    )

    expect(insecure.publicBaseUrl).toBe("http://linksense.example.test")
    expect(insecure.publicUrlUsesHttps).toBe(false)
    expect(secure.publicUrlUsesHttps).toBe(true)
  })

  it("loads the fixed knowledge-base limits and external service boundaries", () => {
    const config = parseConfig(testEnvironment())
    if (!config.knowledge.enabled) throw new Error("expected Full config")

    expect(config.minio).toMatchObject({
      endpoint: "127.0.0.1",
      port: 9000,
      useSsl: false,
      publicEndpoint: "localhost",
      publicPort: 9000,
      publicUseSsl: false,
      publicUrl: "http://localhost:9000",
      region: "us-east-1",
    })
    expect(config.minio.knowledgeBucket).toBe("linksense-knowledge")
    expect(config.knowledge.upload).toEqual({
      maxFileSizeBytes: 209_715_200,
      maxFilesPerBatch: 100,
      storageQuotaBytes: 10_737_418_240,
    })
    expect(config.knowledge.chunks).toEqual({
      tokenizer: "/models/tokenizers/test-embedding",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
    })
    expect(config.knowledge.rerank).toEqual({
      timeoutMs: 60_000,
      maxInputTokens: 8_192,
    })
    expect(config.knowledge.concurrency.maintenanceRebuild).toBe(3)
    const customConcurrency = parseConfig(
      testEnvironment({
        LINKSENSE_KB_MAINTENANCE_REBUILD_CONCURRENCY: "4",
      }),
    )
    if (!customConcurrency.knowledge.enabled) {
      throw new Error("expected Full config")
    }
    expect(customConcurrency.knowledge.concurrency.maintenanceRebuild).toBe(4)
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_KB_MAINTENANCE_REBUILD_CONCURRENCY: "17",
        }),
      ),
    ).toThrow()
  })

  it.each([
    "minio",
    "minio.internal",
    "host.docker.internal",
    "localhost",
    "127.0.0.1",
    "2001:db8::1",
    "::1",
  ])("accepts a pure MinIO hostname or IP endpoint: %s", (endpoint) => {
    expect(
      parseConfig(testEnvironment({ MINIO_ENDPOINT: endpoint })).minio.endpoint,
    ).toBe(endpoint)
  })

  it.each([
    "http://minio.internal",
    "https://minio.internal",
    "minio.internal/path",
    "minio.internal?region=test",
    "minio.internal#fragment",
    "minio.internal:9000",
    "127.0.0.1:9000",
    "[2001:db8::1]",
    "[2001:db8::1]:9000",
    "999.999.999.999",
  ])("rejects a MinIO endpoint containing URL or port syntax: %s", (endpoint) => {
    expect(() =>
      parseConfig(testEnvironment({ MINIO_ENDPOINT: endpoint })),
    ).toThrow("minio_endpoint_must_be_hostname_or_ip_without_port")
  })

  it("parses the browser-facing MinIO origin independently from the internal endpoint", () => {
    expect(
      parseConfig(
        testEnvironment({
          MINIO_ENDPOINT: "minio.internal",
          MINIO_PORT: "9000",
          MINIO_PUBLIC_URL: "https://files.example.test:9443",
          MINIO_REGION: "cn-north-1",
        }),
      ).minio,
    ).toMatchObject({
      endpoint: "minio.internal",
      port: 9000,
      publicEndpoint: "files.example.test",
      publicPort: 9443,
      publicUseSsl: true,
      publicUrl: "https://files.example.test:9443",
      region: "cn-north-1",
    })
  })

  it.each([
    "ftp://files.example.test",
    "https://user:secret@files.example.test",
    "https://files.example.test/minio",
    "https://files.example.test?token=secret",
    "https://files.example.test#fragment",
  ])("rejects an unsafe or unsupported public MinIO URL: %s", (publicUrl) => {
    expect(() =>
      parseConfig(testEnvironment({ MINIO_PUBLIC_URL: publicUrl })),
    ).toThrow()
  })

  it("rejects a Hybrid budget without embedding headroom", () => {
    expect(() =>
      parseConfig(
        testEnvironment({
          LINKSENSE_KB_HYBRID_MAX_TOKENS: "8192",
        }),
      ),
    ).toThrow()
  })

  it("requires every mandatory knowledge external-service setting", () => {
    expect(() =>
      parseConfig(testEnvironment({ DOCLING_SERVE_URL: undefined })),
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_KB_EMBEDDING_DIMENSIONS: "0" }),
      ),
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_KB_HYBRID_TOKENIZER: undefined }),
      ),
    ).toThrow()
    expect(() =>
      parseConfig(
        testEnvironment({ LINKSENSE_KB_HYBRID_TOKENIZER: "bad\r\nvalue" }),
      ),
    ).toThrow(
      "docling_hybrid_tokenizer_must_not_contain_control_characters",
    )
  })

  it("starts Core without Elasticsearch, Docling, or tokenizer settings", () => {
    const config = parseConfig(
      testEnvironment({
        LINKSENSE_EDITION: "core",
        DOCLING_SERVE_URL: undefined,
        DOCLING_SERVE_API_KEY: undefined,
        LINKSENSE_KB_HYBRID_TOKENIZER: undefined,
        LINKSENSE_KB_EMBEDDING_DIMENSIONS: undefined,
        LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS: undefined,
        LINKSENSE_KB_ELASTICSEARCH_URL: undefined,
        LINKSENSE_KB_ELASTICSEARCH_USERNAME: undefined,
        LINKSENSE_KB_ELASTICSEARCH_PASSWORD: undefined,
      }),
    )

    expect(config.edition).toBe("core")
    expect(config.knowledge).toEqual({
      enabled: false,
      upload: {
        maxFileSizeBytes: 209_715_200,
        maxFilesPerBatch: 100,
        storageQuotaBytes: 10_737_418_240,
      },
    })
  })
})
