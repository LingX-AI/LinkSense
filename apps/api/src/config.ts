import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import { containsControlCharacter } from "./lib/text.js";

const DEFAULT_FILE_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/yaml",
  "application/xml",
  "application/zip",
  "application/x-zip-compressed",
  "application/zip-compressed",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-bzip2",
  "application/x-xz",
  "application/zstd",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/opus",
  "audio/aac",
  "audio/flac",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/x-aac",
  "audio/x-flac",
  "audio/aiff",
  "audio/3gpp",
  "audio/3gpp2",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-m4v",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
  "video/3gpp",
  "video/3gpp2",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const safePositiveInteger = (fallback?: number) => {
  const schema = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER);
  return fallback === undefined ? schema : schema.default(fallback);
};

const boundedPositiveInteger = (fallback: number, maximum: number) =>
  z.coerce.number().int().positive().max(maximum).default(fallback);

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(32).max(1_024).optional(),
);

const optionalMimeTypeList = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().default(DEFAULT_FILE_MIME_TYPES),
);

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "unsupported_time_zone");

const doclingHybridTokenizerSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) => !containsControlCharacter(value),
    "docling_hybrid_tokenizer_must_not_contain_control_characters",
  );

const minioEndpointSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      if (z.ipv6().safeParse(value).success) return true;
      if (/^[0-9.]+$/u.test(value) && value.includes(".")) {
        return z.ipv4().safeParse(value).success;
      }
      return z.hostname().safeParse(value).success;
    },
    { message: "minio_endpoint_must_be_hostname_or_ip_without_port" },
  );

const minioPublicUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "minio_public_url_must_use_http_or_https",
    });
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    context.addIssue({
      code: "custom",
      message: "minio_public_url_must_be_origin_only",
    });
  }
});

const smtpSchema = z
  .object({
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.coerce.number().int().min(1).max(65_535).optional(),
    ),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalString,
  })
  .transform((value) => {
    const values = Object.values(value);
    const configured = values.some((item) => item !== undefined);
    const complete =
      value.SMTP_HOST !== undefined &&
      value.SMTP_PORT !== undefined &&
      value.SMTP_FROM !== undefined;
    return {
      status: configured
        ? complete
          ? "configured"
          : "invalid"
        : "not_configured",
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      user: value.SMTP_USER,
      password: value.SMTP_PASSWORD,
      from: value.SMTP_FROM,
    } as const;
  });

const oidcSchema = z
  .object({
    OIDC_ISSUER_URL: optionalString,
    OIDC_CLIENT_ID: optionalString,
    OIDC_CLIENT_SECRET: optionalString,
    OIDC_REDIRECT_URI: optionalString,
  })
  .transform((value) => {
    const fields = [
      value.OIDC_ISSUER_URL,
      value.OIDC_CLIENT_ID,
      value.OIDC_CLIENT_SECRET,
      value.OIDC_REDIRECT_URI,
    ];
    return {
      status: fields.every(Boolean)
        ? ("configured" as const)
        : fields.some(Boolean)
          ? ("invalid" as const)
          : ("not_configured" as const),
      issuerUrl: value.OIDC_ISSUER_URL,
      clientId: value.OIDC_CLIENT_ID,
      clientSecret: value.OIDC_CLIENT_SECRET,
      redirectUri: value.OIDC_REDIRECT_URI,
    };
  });

const teamsSchema = z
  .object({
    TEAMS_TENANT_ID: optionalString,
    TEAMS_CLIENT_ID: optionalString,
  })
  .transform((value) => ({
    status:
      value.TEAMS_TENANT_ID && value.TEAMS_CLIENT_ID
        ? ("configured" as const)
        : value.TEAMS_TENANT_ID || value.TEAMS_CLIENT_ID
          ? ("invalid" as const)
          : ("not_configured" as const),
    tenantId: value.TEAMS_TENANT_ID,
    clientId: value.TEAMS_CLIENT_ID,
  }));

const rawConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LINKSENSE_EDITION: z.enum(["core", "full"]).default("full"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    LINKSENSE_BILLING_TIME_ZONE: timeZoneSchema.default("Asia/Shanghai"),
    LINKSENSE_CLAWHUB_SYNC_TIME_ZONE: timeZoneSchema.default("Asia/Shanghai"),
    LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(1_800_000)
      .default(300_000),
    LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    LINKSENSE_PUBLIC_BASE_URL: z.url(),
    LINKSENSE_JWT_SECRET: z.string().min(32),
    LINKSENSE_INITIALIZATION_TOKEN: optionalSecret,
    LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET: z.string().min(32),
    LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET: z.string().min(32),
    LINKSENSE_CREDENTIAL_MASTER_KEY: z.string().min(32),
    LINKSENSE_CREDENTIAL_KEY_ID: z.string().min(1).default("v1"),
    LINKSENSE_INVALID_AUTH_TOKEN_RETENTION_DAYS: positiveInteger(90),
    LINKSENSE_LOCAL_LOGIN_EMAIL_FAILURE_LIMIT: positiveInteger(5),
    LINKSENSE_LOCAL_LOGIN_EMAIL_WINDOW_SECONDS: positiveInteger(900),
    LINKSENSE_LOCAL_LOGIN_EMAIL_COOLDOWN_SECONDS: positiveInteger(900),
    LINKSENSE_LOCAL_LOGIN_IP_FAILURE_LIMIT: positiveInteger(100),
    LINKSENSE_LOCAL_LOGIN_IP_WINDOW_SECONDS: positiveInteger(600),
    LINKSENSE_LOCAL_LOGIN_IP_COOLDOWN_SECONDS: positiveInteger(600),
    LINKSENSE_PASSWORD_RESET_EMAIL_LIMIT: positiveInteger(3),
    LINKSENSE_PASSWORD_RESET_EMAIL_WINDOW_SECONDS: positiveInteger(900),
    LINKSENSE_PASSWORD_RESET_IP_LIMIT: positiveInteger(20),
    LINKSENSE_PASSWORD_RESET_IP_WINDOW_SECONDS: positiveInteger(3600),
    LINKSENSE_PASSWORD_RESET_TOKEN_TTL_MINUTES: positiveInteger(30),
    LINKSENSE_MAX_CONCURRENT_CONVERSATIONS: positiveInteger(20),
    LINKSENSE_UPLOAD_MAX_FILE_SIZE_MB: positiveInteger(100),
    LINKSENSE_UPLOAD_MAX_FILES_PER_CONVERSATION: positiveInteger(100),
    LINKSENSE_UPLOAD_ALLOWED_TYPES: z.string().default(DEFAULT_FILE_MIME_TYPES),
    LINKSENSE_ARTIFACT_ALLOWED_TYPES: optionalMimeTypeList,
    MINIO_ENDPOINT: minioEndpointSchema,
    MINIO_PORT: z.coerce.number().int().min(1).max(65_535).default(9000),
    MINIO_USE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MINIO_PUBLIC_URL: minioPublicUrlSchema,
    MINIO_REGION: z.string().trim().min(1).max(120).default("us-east-1"),
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z.string().min(1).default("linksense-files"),
    MINIO_KNOWLEDGE_BUCKET: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .default("linksense-knowledge"),
    LINKSENSE_ARTIFACT_DOWNLOAD_TTL_SECONDS: positiveInteger(300),
    LINKSENSE_KB_MAX_FILE_SIZE_BYTES: safePositiveInteger(209_715_200),
    LINKSENSE_KB_UPLOAD_MAX_FILES_PER_BATCH: safePositiveInteger(100),
    LINKSENSE_KB_STORAGE_QUOTA_BYTES: safePositiveInteger(10_737_418_240),
    LINKSENSE_KB_HYBRID_TOKENIZER: doclingHybridTokenizerSchema.optional(),
    LINKSENSE_KB_HYBRID_MAX_TOKENS: safePositiveInteger(768),
    LINKSENSE_KB_PARENT_MAX_TOKENS: safePositiveInteger(3_000),
    LINKSENSE_KB_EMBEDDING_DIMENSIONS: safePositiveInteger().optional(),
    LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS: safePositiveInteger().optional(),
    LINKSENSE_KB_ELASTICSEARCH_URL: z.url().optional(),
    LINKSENSE_KB_ELASTICSEARCH_USERNAME: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional(),
    LINKSENSE_KB_ELASTICSEARCH_PASSWORD: z.string().min(1).optional(),
    LINKSENSE_KB_ELASTICSEARCH_INDEX: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9][a-z0-9._-]*$/u)
      .default("linksense-knowledge"),
    LINKSENSE_KB_RERANK_TIMEOUT_MS: safePositiveInteger(60_000),
    LINKSENSE_KB_RERANK_MAX_INPUT_TOKENS: safePositiveInteger(8_192),
    LINKSENSE_KB_PARSING_CONCURRENCY: safePositiveInteger(4),
    LINKSENSE_KB_CHUNKING_CONCURRENCY: safePositiveInteger(8),
    LINKSENSE_KB_PARENTING_CONCURRENCY: safePositiveInteger(8),
    LINKSENSE_KB_EMBEDDING_CONCURRENCY: safePositiveInteger(8),
    LINKSENSE_KB_INDEXING_CONCURRENCY: safePositiveInteger(8),
    LINKSENSE_KB_ACTIVATION_CONCURRENCY: safePositiveInteger(16),
    LINKSENSE_KB_MAINTENANCE_REBUILD_CONCURRENCY: boundedPositiveInteger(3, 16),
    DOCLING_SERVE_URL: z.url().optional(),
    DOCLING_SERVE_API_KEY: z.string().min(1).optional(),
    DOCLING_SERVE_TENANT_ID: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("linksense"),
    LINKSENSE_DOCLING_DOCUMENT_TIMEOUT_SECONDS: safePositiveInteger(1_800),
    LINKSENSE_USER_DATA_ROOT: z
      .string()
      .min(1)
      .refine(isAbsolute, "user_data_root_must_be_absolute"),
    LINKSENSE_RUNNER_URL: z.url(),
    LINKSENSE_RUNNER_SHARED_SECRET: z.string().min(32),
    LINKSENSE_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    LINKSENSE_SAFE_HTTP_ALLOW_BENCHMARK_PROXY: z
      .enum(["true", "false"])
      .default("false"),
    DASHSCOPE_API_KEY: optionalString,
    DASHSCOPE_BASE_URL: z
      .url()
      .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    DASHSCOPE_ASR_MODEL: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("qwen3-asr-flash"),
  })
  .superRefine((config, context) => {
    if (config.LINKSENSE_EDITION === "full") {
      const requiredKnowledgeSettings = [
        ["LINKSENSE_KB_HYBRID_TOKENIZER", config.LINKSENSE_KB_HYBRID_TOKENIZER],
        ["LINKSENSE_KB_EMBEDDING_DIMENSIONS", config.LINKSENSE_KB_EMBEDDING_DIMENSIONS],
        ["LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS", config.LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS],
        ["LINKSENSE_KB_ELASTICSEARCH_URL", config.LINKSENSE_KB_ELASTICSEARCH_URL],
        ["LINKSENSE_KB_ELASTICSEARCH_USERNAME", config.LINKSENSE_KB_ELASTICSEARCH_USERNAME],
        ["LINKSENSE_KB_ELASTICSEARCH_PASSWORD", config.LINKSENSE_KB_ELASTICSEARCH_PASSWORD],
        ["DOCLING_SERVE_URL", config.DOCLING_SERVE_URL],
        ["DOCLING_SERVE_API_KEY", config.DOCLING_SERVE_API_KEY],
      ] as const;
      for (const [path, value] of requiredKnowledgeSettings) {
        if (value === undefined) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: "full_edition_knowledge_setting_required",
          });
        }
      }
    }

    if (
      config.LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS !== undefined &&
      config.LINKSENSE_KB_HYBRID_MAX_TOKENS >=
        config.LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS
    ) {
      context.addIssue({
        code: "custom",
        path: ["LINKSENSE_KB_HYBRID_MAX_TOKENS"],
        message:
          "linksense_kb_hybrid_max_tokens_must_be_less_than_embedding_max_input_tokens",
      });
    }

    if (new URL(config.DASHSCOPE_BASE_URL).protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["DASHSCOPE_BASE_URL"],
        message: "dashscope_base_url_must_use_https",
      });
    }

    const secrets = [
      ["LINKSENSE_JWT_SECRET", config.LINKSENSE_JWT_SECRET],
      [
        "LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET",
        config.LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET,
      ],
      [
        "LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET",
        config.LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET,
      ],
      [
        "LINKSENSE_CREDENTIAL_MASTER_KEY",
        config.LINKSENSE_CREDENTIAL_MASTER_KEY,
      ],
      ["LINKSENSE_RUNNER_SHARED_SECRET", config.LINKSENSE_RUNNER_SHARED_SECRET],
    ] as const;
    for (let left = 0; left < secrets.length; left += 1) {
      for (let right = left + 1; right < secrets.length; right += 1) {
        if (secrets[left]?.[1] === secrets[right]?.[1]) {
          context.addIssue({
            code: "custom",
            path: [secrets[right]?.[0] ?? "secret"],
            message: "security_secrets_must_be_distinct",
          });
        }
      }
    }
  });

export type AppConfig = ReturnType<typeof parseConfig>;
export type FullAppConfig = AppConfig & {
  knowledge: Extract<AppConfig["knowledge"], { enabled: true }>;
};

export function isFullAppConfig(config: AppConfig): config is FullAppConfig {
  return config.knowledge.enabled;
}

export function requireFullAppConfig(config: AppConfig): FullAppConfig {
  if (!isFullAppConfig(config)) {
    throw new Error("Full-edition configuration is required");
  }
  return config;
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = rawConfigSchema.parse(env);
  const userDataRoot = resolve(raw.LINKSENSE_USER_DATA_ROOT);
  const minioPublicUrl = new URL(raw.MINIO_PUBLIC_URL);
  const smtp = smtpSchema.parse(env);
  const oidc = oidcSchema.parse(env);
  const teams = teamsSchema.parse(env);
  return {
    nodeEnv: raw.NODE_ENV,
    edition: raw.LINKSENSE_EDITION,
    host: raw.HOST,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    redisUrl: raw.REDIS_URL,
    billingTimeZone: raw.LINKSENSE_BILLING_TIME_ZONE,
    clawHubSyncTimeZone: raw.LINKSENSE_CLAWHUB_SYNC_TIME_ZONE,
    clawHubSyncTransactionTimeoutMs:
      raw.LINKSENSE_CLAWHUB_SYNC_TRANSACTION_TIMEOUT_MS,
    adminModelManagementEnabled: raw.LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED,
    publicBaseUrl: raw.LINKSENSE_PUBLIC_BASE_URL,
    publicUrlUsesHttps:
      new URL(raw.LINKSENSE_PUBLIC_BASE_URL).protocol === "https:",
    jwtSecret: raw.LINKSENSE_JWT_SECRET,
    initializationToken: raw.LINKSENSE_INITIALIZATION_TOKEN,
    loginRateLimitHmacSecret: raw.LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET,
    passwordResetRateLimitHmacSecret:
      raw.LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET,
    credentialMasterKey: raw.LINKSENSE_CREDENTIAL_MASTER_KEY,
    credentialKeyId: raw.LINKSENSE_CREDENTIAL_KEY_ID,
    invalidAuthTokenRetentionDays:
      raw.LINKSENSE_INVALID_AUTH_TOKEN_RETENTION_DAYS,
    localLogin: {
      emailFailureLimit: raw.LINKSENSE_LOCAL_LOGIN_EMAIL_FAILURE_LIMIT,
      emailWindowSeconds: raw.LINKSENSE_LOCAL_LOGIN_EMAIL_WINDOW_SECONDS,
      emailCooldownSeconds: raw.LINKSENSE_LOCAL_LOGIN_EMAIL_COOLDOWN_SECONDS,
      ipFailureLimit: raw.LINKSENSE_LOCAL_LOGIN_IP_FAILURE_LIMIT,
      ipWindowSeconds: raw.LINKSENSE_LOCAL_LOGIN_IP_WINDOW_SECONDS,
      ipCooldownSeconds: raw.LINKSENSE_LOCAL_LOGIN_IP_COOLDOWN_SECONDS,
    },
    passwordReset: {
      emailLimit: raw.LINKSENSE_PASSWORD_RESET_EMAIL_LIMIT,
      emailWindowSeconds: raw.LINKSENSE_PASSWORD_RESET_EMAIL_WINDOW_SECONDS,
      ipLimit: raw.LINKSENSE_PASSWORD_RESET_IP_LIMIT,
      ipWindowSeconds: raw.LINKSENSE_PASSWORD_RESET_IP_WINDOW_SECONDS,
      tokenTtlMinutes: raw.LINKSENSE_PASSWORD_RESET_TOKEN_TTL_MINUTES,
    },
    maxConcurrentConversations: raw.LINKSENSE_MAX_CONCURRENT_CONVERSATIONS,
    upload: {
      maxFileSizeBytes: raw.LINKSENSE_UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
      maxFilesPerConversation: raw.LINKSENSE_UPLOAD_MAX_FILES_PER_CONVERSATION,
      allowedTypes: new Set(
        raw.LINKSENSE_UPLOAD_ALLOWED_TYPES.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
      artifactAllowedTypes: new Set(
        raw.LINKSENSE_ARTIFACT_ALLOWED_TYPES.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    },
    minio: {
      endpoint: raw.MINIO_ENDPOINT,
      port: raw.MINIO_PORT,
      useSsl: raw.MINIO_USE_SSL,
      publicEndpoint: minioPublicUrl.hostname.replace(/^\[(.*)\]$/u, "$1"),
      publicPort: Number(
        minioPublicUrl.port ||
          (minioPublicUrl.protocol === "https:" ? "443" : "80"),
      ),
      publicUseSsl: minioPublicUrl.protocol === "https:",
      publicUrl: minioPublicUrl.origin,
      region: raw.MINIO_REGION,
      accessKey: raw.MINIO_ACCESS_KEY,
      secretKey: raw.MINIO_SECRET_KEY,
      bucket: raw.MINIO_BUCKET,
      knowledgeBucket: raw.MINIO_KNOWLEDGE_BUCKET,
      downloadTtlSeconds: raw.LINKSENSE_ARTIFACT_DOWNLOAD_TTL_SECONDS,
    },
    knowledge: projectKnowledgeConfig(raw),
    userDataRoot,
    // These are internal boundaries derived from the single deployment root.
    // They are not independently configurable.
    workspaceRoot: userDataRoot,
    capabilityRoot: join(userDataRoot, ".capabilities"),
    runnerUrl: raw.LINKSENSE_RUNNER_URL,
    runnerSharedSecret: raw.LINKSENSE_RUNNER_SHARED_SECRET,
    trustProxy: raw.LINKSENSE_TRUST_PROXY === "true",
    safeHttp: {
      allowBenchmarkProxyAddresses:
        raw.LINKSENSE_SAFE_HTTP_ALLOW_BENCHMARK_PROXY === "true",
    },
    dashscopeAsr: {
      ...(raw.DASHSCOPE_API_KEY ? { apiKey: raw.DASHSCOPE_API_KEY } : {}),
      baseUrl: raw.DASHSCOPE_BASE_URL,
      model: raw.DASHSCOPE_ASR_MODEL,
    },
    smtp,
    oidc,
    teams,
  };
}

function projectKnowledgeConfig(raw: z.infer<typeof rawConfigSchema>) {
  const upload = {
    maxFileSizeBytes: raw.LINKSENSE_KB_MAX_FILE_SIZE_BYTES,
    maxFilesPerBatch: raw.LINKSENSE_KB_UPLOAD_MAX_FILES_PER_BATCH,
    storageQuotaBytes: raw.LINKSENSE_KB_STORAGE_QUOTA_BYTES,
  };
  if (raw.LINKSENSE_EDITION === "core") {
    return { enabled: false as const, upload };
  }
  return {
    enabled: true as const,
    upload,
    chunks: {
      tokenizer: requireFullKnowledgeSetting(raw.LINKSENSE_KB_HYBRID_TOKENIZER),
      childMaxTokens: raw.LINKSENSE_KB_HYBRID_MAX_TOKENS,
      parentMaxTokens: raw.LINKSENSE_KB_PARENT_MAX_TOKENS,
    },
    embedding: {
      dimensions: requireFullKnowledgeSetting(
        raw.LINKSENSE_KB_EMBEDDING_DIMENSIONS,
      ),
      maxInputTokens: requireFullKnowledgeSetting(
        raw.LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS,
      ),
    },
    elasticsearch: {
      url: requireFullKnowledgeSetting(raw.LINKSENSE_KB_ELASTICSEARCH_URL),
      username: requireFullKnowledgeSetting(
        raw.LINKSENSE_KB_ELASTICSEARCH_USERNAME,
      ),
      password: requireFullKnowledgeSetting(
        raw.LINKSENSE_KB_ELASTICSEARCH_PASSWORD,
      ),
      index: raw.LINKSENSE_KB_ELASTICSEARCH_INDEX,
    },
    rerank: {
      timeoutMs: raw.LINKSENSE_KB_RERANK_TIMEOUT_MS,
      maxInputTokens: raw.LINKSENSE_KB_RERANK_MAX_INPUT_TOKENS,
    },
    docling: {
      url: requireFullKnowledgeSetting(raw.DOCLING_SERVE_URL),
      apiKey: requireFullKnowledgeSetting(raw.DOCLING_SERVE_API_KEY),
      tenantId: raw.DOCLING_SERVE_TENANT_ID,
      documentTimeoutSeconds: raw.LINKSENSE_DOCLING_DOCUMENT_TIMEOUT_SECONDS,
    },
    concurrency: {
      parsing: raw.LINKSENSE_KB_PARSING_CONCURRENCY,
      chunking: raw.LINKSENSE_KB_CHUNKING_CONCURRENCY,
      parenting: raw.LINKSENSE_KB_PARENTING_CONCURRENCY,
      embedding: raw.LINKSENSE_KB_EMBEDDING_CONCURRENCY,
      indexing: raw.LINKSENSE_KB_INDEXING_CONCURRENCY,
      activation: raw.LINKSENSE_KB_ACTIVATION_CONCURRENCY,
      maintenanceRebuild: raw.LINKSENSE_KB_MAINTENANCE_REBUILD_CONCURRENCY,
    },
  };
}

function requireFullKnowledgeSetting<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Validated Full knowledge setting is missing");
  }
  return value;
}

export const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
