import { describe, expect, it } from "vitest";

import { LinkSenseRedis } from "../src/adapters/redis.js";
import {
  SENSITIVE_REQUEST_LOG_PATHS,
  sanitizeRequestForLog,
} from "../src/app.js";
import { sanitizeAuditMetadata } from "../src/modules/audit/service.js";
import { fileServiceTesting } from "../src/modules/files/service.js";
import { errorDetails } from "../src/lib/errors.js";
import {
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "../src/lib/password.js";
import { testConfig } from "./test-config.js";

describe("security boundaries", () => {
  it("uses the required Argon2id parameters and verifies hashes", async () => {
    const hash = await hashPassword("Valid-Password1!");
    expect(hash).toContain("$argon2id$v=19$m=65536,t=3,p=4$");
    await expect(verifyPassword(hash, "Valid-Password1!")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong")).resolves.toBe(false);
    await expect(getDummyPasswordHash()).resolves.toContain("$argon2id$");
  });

  it("never embeds raw email or IP in Redis rate-limit keys", () => {
    const redis = new LinkSenseRedis(testConfig());
    const keys = redis.loginKeys("Member@Example.COM", "::ffff:192.0.2.10");
    const serialized = JSON.stringify(keys);
    expect(serialized).not.toContain("member@example.com");
    expect(serialized).not.toContain("192.0.2.10");
    expect(
      Object.values(keys).every((key) => key.startsWith("linksense:login:")),
    ).toBe(true);
    redis.client.disconnect();
  });

  it("drops sensitive audit metadata fields", () => {
    expect(
      sanitizeAuditMetadata("audit_exported", {
        row_count: 3,
        token_hash: "secret",
        credential_value: "secret",
        object_key: "private/path",
        unknown_safe_looking_key: true,
      }),
    ).toEqual({ row_count: 3 });
  });

  it("keeps only non-secret external application session audit metadata", () => {
    expect(
      sanitizeAuditMetadata("application_embed_ticket_issued", {
        application_id: "00000000-0000-4000-8000-000000000001",
        auth_mode: "required",
        authenticated_subject: true,
        app_secret: "secret",
        ticket: "secret-ticket",
        external_subject: "partner-user-42",
        origin: "https://partner.example.test",
      }),
    ).toEqual({
      application_id: "00000000-0000-4000-8000-000000000001",
      auth_mode: "required",
      authenticated_subject: true,
    });
  });

  it("records only whether an external application session id is configured", () => {
    expect(
      sanitizeAuditMetadata("external_application_session_id_updated", {
        application_id: "00000000-0000-4000-8000-000000000001",
        session_id_configured: true,
        session_id: "must-not-be-recorded",
      }),
    ).toEqual({
      application_id: "00000000-0000-4000-8000-000000000001",
      session_id_configured: true,
    });
  });

  it("keeps only stable capability HOME synchronization audit metadata", () => {
    expect(
      sanitizeAuditMetadata("capability_home_sync_failed", {
        operation: "update",
        source_type: "local",
        error_code: "CAPABILITY_HOME_SYNC_FAILED",
        recovery: "next_turn_preflight",
        capability_source_path: "/private/capability/current",
        filesystem_error: "permission denied",
      }),
    ).toEqual({
      operation: "update",
      source_type: "local",
      error_code: "CAPABILITY_HOME_SYNC_FAILED",
      recovery: "next_turn_preflight",
    });
  });

  it("keeps immutable marketplace evidence without package paths or content", () => {
    expect(
      sanitizeAuditMetadata("marketplace_release_submitted", {
        listing_id: "00000000-0000-4000-8000-000000000001",
        release_number: 2,
        capability_id: "00000000-0000-4000-8000-000000000002",
        content_sha256: "a".repeat(64),
        package_path: "/private/store/release/current",
        manifest: { secret: true },
        release_notes: "private notes",
      }),
    ).toEqual({
      listing_id: "00000000-0000-4000-8000-000000000001",
      release_number: 2,
      capability_id: "00000000-0000-4000-8000-000000000002",
      content_sha256: "a".repeat(64),
    });
  });

  it.each([
    "knowledge_document.original_previewed",
    "knowledge_document.original_downloaded",
  ])("keeps only redacted original-read metadata for %s", (action) => {
    expect(
      sanitizeAuditMetadata(action, {
        knowledge_base_id: "00000000-0000-4000-8000-000000000001",
        document_version_id: "00000000-0000-4000-8000-000000000002",
        canonical_extension: "png",
        original_filename: "private-diagram.png",
        object_key: "private/object/key",
        download_url: "https://signed.example.test",
      }),
    ).toEqual({
      knowledge_base_id: "00000000-0000-4000-8000-000000000001",
      document_version_id: "00000000-0000-4000-8000-000000000002",
      canonical_extension: "png",
    });
  });

  it("rejects traversal filenames and paths", () => {
    expect(fileServiceTesting.safeFilename("../../report.pdf")).toBe(
      "report.pdf",
    );
    expect(() => fileServiceTesting.safeFilename("..")).toThrow();
    expect(() =>
      fileServiceTesting.assertDescendant("/data/a", "/data/another/file"),
    ).toThrow();
    expect(() =>
      fileServiceTesting.assertDescendant("/data/a", "/data/a/file"),
    ).not.toThrow();
  });

  it("localizes stable errors in both supported locales", () => {
    expect(
      errorDetails("PENDING_REQUEST_LIMIT_REACHED", "zh-CN").message,
    ).toContain("上限");
    expect(
      errorDetails("PENDING_REQUEST_LIMIT_REACHED", "en-US").message,
    ).toContain("limit");
    expect(
      errorDetails("PENDING_REQUEST_RESTORE_DRAFT_NOT_EMPTY", "zh-CN").message,
    ).toContain("输入框");
    expect(
      errorDetails("PENDING_REQUEST_RESTORE_DRAFT_NOT_EMPTY", "en-US").message,
    ).toContain("composer");
    expect(
      errorDetails("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN", "zh-CN").message,
    ).toContain("请求来源");
    expect(
      errorDetails("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN", "en-US").message,
    ).toContain("origin");
    expect(
      errorDetails("OIDC_ACCOUNT_PENDING_APPROVAL", "zh-CN").message,
    ).toContain("联系管理员");
    expect(
      errorDetails("OIDC_ACCOUNT_PENDING_APPROVAL", "en-US").message,
    ).toContain("Contact an administrator");
    expect(
      errorDetails("EXTERNAL_ACCOUNT_PENDING_APPROVAL", "zh-CN").message,
    ).toContain("联系管理员");
    expect(
      errorDetails("EXTERNAL_ACCOUNT_PENDING_APPROVAL", "en-US").message,
    ).toContain("Contact an administrator");
    expect(errorDetails("TEAMS_SSO_FAILED", "zh-CN").message).toContain(
      "Teams 登录失败",
    );
    expect(errorDetails("TEAMS_SSO_FAILED", "en-US").message).toContain(
      "Teams sign-in failed",
    );
  });

  it("logs only request pathnames and never OAuth or reset query secrets", () => {
    const serialized = sanitizeRequestForLog({
      id: "request-1",
      method: "GET",
      url: "/api/v1/auth/oidc/callback?code=oauth-secret&state=state-secret#ignored",
      headers: { host: "linksense.example" },
      socket: { remoteAddress: "192.0.2.1", remotePort: 443 },
    });
    expect(serialized).toEqual({
      requestId: "request-1",
      method: "GET",
      url: "/api/v1/auth/oidc/callback",
      host: "linksense.example",
      remoteAddress: "192.0.2.1",
      remotePort: 443,
    });
    const logJson = JSON.stringify(serialized);
    expect(logJson).not.toContain("oauth-secret");
    expect(logJson).not.toContain("state-secret");
    expect(
      sanitizeRequestForLog({
        method: "GET",
        url: "/reset-password?token=reset-secret",
      }).url,
    ).toBe("/reset-password");
  });

  it("redacts sensitive request bodies if request-body logging is enabled", () => {
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain(
      "req.body.initialization_credential",
    );
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.audio_data_url");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.environment");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.json");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.instruction");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.app_secret");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.ticket");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.renewal_token");
    expect(SENSITIVE_REQUEST_LOG_PATHS).toContain("req.body.values[*].value");
  });
});
