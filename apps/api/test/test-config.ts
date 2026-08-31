import { parseConfig } from "../src/config.js"

export function testEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/linksense_test",
    REDIS_URL: "redis://127.0.0.1:6379/15",
    LINKSENSE_PUBLIC_BASE_URL: "https://linksense.example.test",
    LINKSENSE_JWT_SECRET: "jwt-11111111111111111111111111111111",
    LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET:
      "login-222222222222222222222222222222",
    LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET:
      "reset-333333333333333333333333333333",
    LINKSENSE_CREDENTIAL_MASTER_KEY:
      "credential-444444444444444444444444444",
    LINKSENSE_RUNNER_SHARED_SECRET:
      "runner-555555555555555555555555555555",
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PUBLIC_URL: "http://localhost:9000",
    MINIO_ACCESS_KEY: "test-access",
    MINIO_SECRET_KEY: "test-secret",
    DOCLING_SERVE_URL: "http://127.0.0.1:5001",
    DOCLING_SERVE_API_KEY: "test-docling-key",
    LINKSENSE_KB_HYBRID_TOKENIZER: "/models/tokenizers/test-embedding",
    LINKSENSE_KB_EMBEDDING_DIMENSIONS: "8",
    LINKSENSE_KB_EMBEDDING_MAX_INPUT_TOKENS: "8192",
    LINKSENSE_KB_ELASTICSEARCH_URL: "http://127.0.0.1:9200",
    LINKSENSE_KB_ELASTICSEARCH_USERNAME: "elastic",
    LINKSENSE_KB_ELASTICSEARCH_PASSWORD: "test-elasticsearch-password",
    LINKSENSE_USER_DATA_ROOT: "/tmp/linksense-test/users",
    LINKSENSE_RUNNER_URL: "http://127.0.0.1:4010",
    ...overrides,
  }
}

export function testConfig(overrides: Record<string, string | undefined> = {}) {
  return parseConfig(testEnvironment(overrides))
}
