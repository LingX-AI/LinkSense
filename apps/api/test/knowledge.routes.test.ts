import { Readable } from "node:stream";

import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { knowledgeRoutes } from "../src/modules/knowledge/routes.js";
import type { KnowledgeRoutesOptions } from "../src/modules/knowledge/routes.js";
import type { KnowledgeService } from "../src/modules/knowledge/service.js";
import type { KnowledgeSourceService } from "../src/modules/knowledge-sources/service.js";

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "user" as const,
  status: "active" as const,
};
const BASE_ID = "00000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const VERSION_ID = "00000000-0000-4000-8000-000000000004";
const ASSET_ID = "00000000-0000-4000-8000-000000000005";
const GRANT_ID = "00000000-0000-4000-8000-000000000006";
const GRANT_CURSOR = "00000000-0000-4000-8000-000000000007";
const GRANT_TARGET_ID = "00000000-0000-4000-8000-000000000008";
const ENTRY_ID = "00000000-0000-4000-8000-000000000009";
const PUBLIC_BASE_URL = "https://linksense.example.test/app";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("knowledge routes", () => {
  it("does not expose a failed-candidate discard endpoint", async () => {
    const app = await createApp({});

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/failed-candidate`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("writes strict CORS headers on a hijacked knowledge event stream", async () => {
    const subscribeEvents = vi.fn(() =>
      (async function* () {
        yield { type: "knowledge_document_updated" };
      })(),
    );
    const app = await createApp({ subscribeEvents });

    const allowed = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/events`,
      headers: { origin: "https://linksense.example.test" },
    });
    const rejected = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/events`,
      headers: { origin: "https://untrusted.example.test" },
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://linksense.example.test",
    );
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers.vary).toBe("Origin");
    expect(rejected.statusCode).toBe(200);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
    expect(
      rejected.headers["access-control-allow-credentials"],
    ).toBeUndefined();
    expect(rejected.headers.vary).toBeUndefined();
  });

  it("returns only the authenticated user's safe knowledge-search capability", async () => {
    const getSearchCapability = vi.fn(async () => ({
      status: "unavailable" as const,
      reason_code: "EMBEDDING_DIMENSION_MISMATCH" as const,
      checked_at: "2026-07-22T08:00:00.000Z",
    }));
    const app = await createApp({}, getSearchCapability);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases/search-capability",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        status: "unavailable",
        reason_code: "EMBEDDING_DIMENSION_MISMATCH",
        checked_at: "2026-07-22T08:00:00.000Z",
      },
    });
    expect(getSearchCapability).toHaveBeenCalledOnce();
  });

  it("does not probe knowledge-search dependencies before actor authentication", async () => {
    const getSearchCapability = vi.fn(async () => ({
      status: "available" as const,
      reason_code: null,
      checked_at: "2026-07-22T08:00:00.000Z",
    }));
    const resolveActor = vi.fn(async () => {
      throw new Error("authentication rejected");
    });
    const app = await createApp({}, getSearchCapability, resolveActor);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases/search-capability",
    });

    expect(response.statusCode).not.toBe(200);
    expect(resolveActor).toHaveBeenCalledOnce();
    expect(getSearchCapability).not.toHaveBeenCalled();
  });

  it("returns the authenticated user's safe knowledge-base creation capability", async () => {
    const read = vi.fn(async () => ({
      status: "unready" as const,
      checks: {
        object_storage: "available" as const,
        document_parsing: "available" as const,
        embedding_model: "not_configured" as const,
        search_and_indexing: "available" as const,
      },
      checked_at: "2026-08-31T08:00:00.000Z",
    }));
    const app = await createApp({}, undefined, undefined, undefined, {
      read,
      assertReady: vi.fn(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases/creation-capability?refresh=true",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        status: "unready",
        checks: { embedding_model: "not_configured" },
      },
    });
    expect(read).toHaveBeenCalledWith(true);
  });

  it("checks creation readiness before writing a local knowledge base", async () => {
    const createKnowledgeBase = vi.fn();
    const assertReady = vi.fn(async () => {
      throw new Error("creation unavailable");
    });
    const app = await createApp(
      { createKnowledgeBase },
      undefined,
      undefined,
      undefined,
      {
        read: vi.fn(),
        assertReady,
      },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge-bases",
      payload: { name: "Blocked", source_type: "local" },
    });

    expect(response.statusCode).not.toBe(201);
    expect(assertReady).toHaveBeenCalledOnce();
    expect(createKnowledgeBase).not.toHaveBeenCalled();
  });

  it("checks creation readiness before resolving a SharePoint source", async () => {
    const createSharePointKnowledgeBase = vi.fn();
    const assertReady = vi.fn(async () => {
      throw new Error("creation unavailable");
    });
    const app = await createApp(
      {},
      undefined,
      async () => ({ ...ACTOR, role: "admin" as const }),
      { createSharePointKnowledgeBase },
      { read: vi.fn(), assertReady },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge-bases",
      payload: {
        name: "Blocked SharePoint",
        source_type: "sharepoint",
        sharepoint_folder_url:
          "https://contoso.sharepoint.com/:f:/s/policy/share-token",
        sync_schedule: {
          frequency: "daily",
          time: "09:00",
          time_zone: "Asia/Shanghai",
        },
      },
    });

    expect(response.statusCode).not.toBe(201);
    expect(assertReady).toHaveBeenCalledOnce();
    expect(createSharePointKnowledgeBase).not.toHaveBeenCalled();
  });

  it("forwards the knowledge-base scope when searching share targets", async () => {
    const searchShareTargets = vi.fn(async () => ({
      items: [
        {
          id: GRANT_TARGET_ID,
          type: "user" as const,
          name: "Lin",
          secondary_label: "lin@example.test",
        },
      ],
      next_cursor: null,
    }));
    const app = await createApp({ searchShareTargets });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/share-targets?knowledge_base_id=${BASE_ID}&type=user&search=lin%40example.test`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            name: "Lin",
            secondary_label: "lin@example.test",
          },
        ],
      },
    });
    expect(searchShareTargets).toHaveBeenCalledWith(ACTOR, {
      knowledgeBaseId: BASE_ID,
      type: "user",
      search: "lin@example.test",
      limit: 30,
    });
  });

  it("returns deployment upload limits instead of a browser hard-coded batch size", async () => {
    const limits = {
      max_file_size_bytes: 209_715_200,
      max_files_per_batch: 37,
      storage_quota_bytes: 10_737_418_240,
    };
    const getUploadLimits = vi.fn(() => limits);
    const app = await createApp({ getUploadLimits });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: limits });
    expect(getUploadLimits).toHaveBeenCalledWith(ACTOR);
  });

  it("lists one directory level with its breadcrumb path", async () => {
    const listDirectoryEntries = vi.fn(async () => ({
      breadcrumbs: [{ id: ENTRY_ID, name: "Policies" }],
      items: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          knowledge_base_id: BASE_ID,
          parent_entry_id: ENTRY_ID,
          entry_type: "folder" as const,
          name: "HR",
          document: null,
          updated_at: "2026-07-30T08:00:00.000Z",
        },
      ],
      next_cursor: null,
    }));
    const app = await createApp({ listDirectoryEntries });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/entries?parent_entry_id=${ENTRY_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        breadcrumbs: [{ id: ENTRY_ID, name: "Policies" }],
        items: [{ entry_type: "folder", name: "HR" }],
      },
    });
    expect(listDirectoryEntries).toHaveBeenCalledWith(ACTOR, BASE_ID, {
      parentEntryId: ENTRY_ID,
      limit: 100,
    });
  });

  it("requests a recursive flat entry view without a parent directory", async () => {
    const listDirectoryEntries = vi.fn(async () => ({
      breadcrumbs: [],
      items: [],
      next_cursor: null,
    }));
    const app = await createApp({ listDirectoryEntries });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/entries?view=flat`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { breadcrumbs: [], items: [], next_cursor: null },
    });
    expect(listDirectoryEntries).toHaveBeenCalledWith(ACTOR, BASE_ID, {
      view: "flat",
      limit: 100,
    });
  });

  it("forwards a SharePoint folder sharing link unchanged to source resolution", async () => {
    const sharingUrl =
      "https://aisgzorg.sharepoint.com/:f:/s/policyforai/fake-share-token-for-tests?e=test01";
    const createSharePointKnowledgeBase = vi.fn(async () => ({ id: BASE_ID }));
    const admin = { ...ACTOR, role: "admin" as const };
    const app = await createApp({}, undefined, async () => admin, {
      createSharePointKnowledgeBase,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge-bases",
      payload: {
        name: "Policy",
        source_type: "sharepoint",
        sharepoint_folder_url: sharingUrl,
        sync_schedule: {
          frequency: "weekly",
          weekday: 3,
          time: "14:35",
          time_zone: "Asia/Shanghai",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createSharePointKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining(admin),
      {
        name: "Policy",
        folderUrl: sharingUrl,
        schedule: {
          frequency: "weekly",
          weekday: 3,
          time: "14:35",
          time_zone: "Asia/Shanghai",
        },
      },
    );
  });

  it("maps the public owned scope to the service's owner scope", async () => {
    const listKnowledgeBases = vi.fn(async () => ({
      items: [],
      next_cursor: null,
    }));
    const app = await createApp({ listKnowledgeBases });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases?scope=owned&lifecycle_status=active&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [], next_cursor: null },
    });
    expect(listKnowledgeBases).toHaveBeenCalledWith(ACTOR, {
      scope: "mine",
      lifecycleStatus: "active",
      limit: 20,
    });
  });

  it("forwards the explicit all-lifecycle filter", async () => {
    const listKnowledgeBases = vi.fn(async () => ({
      items: [],
      next_cursor: null,
    }));
    const app = await createApp({ listKnowledgeBases });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-bases?scope=all&lifecycle_status=all&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(listKnowledgeBases).toHaveBeenCalledWith(ACTOR, {
      scope: "all",
      lifecycleStatus: "all",
      limit: 20,
    });
  });

  it("forwards grant keyset pagination and preserves the real next cursor", async () => {
    const listGrants = vi.fn(async () => ({
      items: [],
      next_cursor: GRANT_CURSOR,
    }));
    const app = await createApp({ listGrants });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/grants?cursor=${GRANT_ID}&limit=25`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { items: [], next_cursor: GRANT_CURSOR },
    });
    expect(listGrants).toHaveBeenCalledWith(ACTOR, BASE_ID, {
      cursor: GRANT_ID,
      limit: 25,
    });
  });

  it.each([
    "cursor=not-a-uuid",
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=20&offset=20",
  ])(
    "rejects an invalid grant pagination query before the service: %s",
    async (query) => {
      const listGrants = vi.fn();
      const app = await createApp({ listGrants });

      const response = await app.inject({
        method: "GET",
        url: `/api/v1/knowledge-bases/${BASE_ID}/grants?${query}`,
      });

      expect(response.statusCode).not.toBe(200);
      expect(listGrants).not.toHaveBeenCalled();
    },
  );

  it("returns the recipient's privacy-safe remaining access after revocation", async () => {
    const result = {
      revoked_grant_id: GRANT_ID,
      target_type: "user" as const,
      target_id: GRANT_TARGET_ID,
      remaining_access: {
        subject_type: "user" as const,
        has_access: true,
        source_types: ["user_group" as const],
      },
    };
    const revokeGrant = vi.fn(async () => result);
    const app = await createApp({ revokeGrant });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/knowledge-bases/${BASE_ID}/grants/${GRANT_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: result });
    expect(revokeGrant).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      GRANT_ID,
      undefined,
    );
  });

  it("authorizes assets with an exact document version and emits safe headers", async () => {
    const getAsset = vi.fn(async () => ({
      filename: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const app = await createApp({ getAsset });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/assets/${ASSET_ID}?document_version_id=${VERSION_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from("png"));
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-disposition"]).toContain("inline");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(getAsset).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
      ASSET_ID,
    );
  });

  it("separates inline file preview from attachment download for an exact version", async () => {
    const getDocument = vi.fn(async () => ({ id: DOCUMENT_ID }));
    const getParsedContent = vi.fn(async () => ({
      document_id: DOCUMENT_ID,
      document_version_id: VERSION_ID,
      markdown: "# Historical",
    }));
    const downloadOriginal = vi.fn(async () => ({
      filename: "historical.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 3n,
      stream: Readable.from("doc"),
    }));
    const getOriginalPreview = vi.fn(async () => ({
      filename: "historical.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const app = await createApp({
      getParsedContent,
      downloadOriginal,
      getOriginalPreview,
      getDocument,
    });
    const suffix = `?document_version_id=${VERSION_ID}`;

    const [detail, content, original, filePreview] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}${suffix}`,
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/content${suffix}`,
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/original${suffix}`,
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/preview${suffix}`,
      }),
    ]);

    expect(detail.statusCode).toBe(200);
    expect(content.statusCode).toBe(200);
    expect(original.statusCode).toBe(200);
    expect(filePreview.statusCode).toBe(200);
    expect(original.headers["content-disposition"]).toContain("attachment");
    expect(filePreview.headers["content-type"]).toBe("image/png");
    expect(filePreview.headers["cache-control"]).toBe("private, no-store");
    expect(filePreview.headers["content-disposition"]).toContain("inline");
    expect(filePreview.headers["content-security-policy"]).toBe(
      "default-src 'none'; sandbox",
    );
    expect(filePreview.headers["x-content-type-options"]).toBe("nosniff");
    expect(getDocument).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    expect(getParsedContent).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    expect(downloadOriginal).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    expect(getOriginalPreview).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
  });

  it("persists a stable owner reason when the UI confirms deletion without a body", async () => {
    const deleteKnowledgeBase = vi.fn(async () => undefined);
    const app = await createApp({ deleteKnowledgeBase });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/knowledge-bases/${BASE_ID}`,
    });

    expect(response.statusCode).toBe(204);
    expect(deleteKnowledgeBase).toHaveBeenCalledWith(
      ACTOR,
      BASE_ID,
      "user_requested",
    );
  });

  it("maps the rebuild action path to the rebuild-index domain operation", async () => {
    const document = { id: DOCUMENT_ID, status: "processing" };
    const rebuildDocument = vi.fn(async () => document);
    const app = await createApp({ rebuildDocument });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/rebuild`,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ success: true, data: document });
    expect(rebuildDocument).toHaveBeenCalledWith(ACTOR, BASE_ID, DOCUMENT_ID);
  });

  it("renames a document through the metadata-only route", async () => {
    const document = { id: DOCUMENT_ID, display_name: "Updated.pdf" };
    const renameDocument = vi.fn(async () => document);
    const app = await createApp({ renameDocument });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}`,
      payload: { display_name: "Updated.pdf" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: document });
    expect(renameDocument).toHaveBeenCalledWith(ACTOR, BASE_ID, DOCUMENT_ID, {
      displayName: "Updated.pdf",
    });
  });

  it("supports selected and whole-knowledge-base rebuild scopes", async () => {
    const rebuildDocuments = vi.fn(async () => ({
      items: [],
      next_cursor: null,
    }));
    const app = await createApp({ rebuildDocuments });

    const selected = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/rebuild`,
      payload: { document_ids: [DOCUMENT_ID] },
    });
    const all = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/rebuild`,
      payload: {},
    });
    const nextPage = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents/rebuild`,
      payload: { cursor: GRANT_CURSOR },
    });

    expect(selected.statusCode).toBe(202);
    expect(all.statusCode).toBe(202);
    expect(nextPage.statusCode).toBe(202);
    expect(rebuildDocuments).toHaveBeenNthCalledWith(
      1,
      ACTOR,
      BASE_ID,
      [DOCUMENT_ID],
      undefined,
    );
    expect(rebuildDocuments).toHaveBeenNthCalledWith(
      2,
      ACTOR,
      BASE_ID,
      undefined,
      undefined,
    );
    expect(rebuildDocuments).toHaveBeenNthCalledWith(
      3,
      ACTOR,
      BASE_ID,
      undefined,
      GRANT_CURSOR,
    );
  });

  it("rejects unbounded or ambiguous document rebuild batches", async () => {
    const rebuildDocuments = vi.fn();
    const app = await createApp({ rebuildDocuments });
    const tooManyIds = Array.from(
      { length: 101 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );

    for (const payload of [
      { document_ids: tooManyIds },
      { document_ids: [DOCUMENT_ID], cursor: GRANT_CURSOR },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents/rebuild`,
        payload,
      });
      expect(response.statusCode).not.toBe(202);
    }
    expect(rebuildDocuments).not.toHaveBeenCalled();
  });

  it("forwards only valid conditional upload conflict options", async () => {
    const uploadDocument =
      vi.fn<
        (
          actor: typeof ACTOR,
          knowledgeBaseId: string,
          input: unknown,
        ) => Promise<{ id: string }>
      >();
    uploadDocument.mockResolvedValue({ id: DOCUMENT_ID });
    const app = await createApp({ uploadDocument });

    const replacement = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents`,
      ...multipartUpload({
        conflict_resolution: "replace",
        replace_document_id: DOCUMENT_ID,
        ocr_enabled: "true",
      }),
    });
    const keepBoth = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents`,
      ...multipartUpload({ conflict_resolution: "keep_both" }),
    });
    const directoryReplacement = await app.inject({
      method: "POST",
      url: `/api/v1/knowledge-bases/${BASE_ID}/documents`,
      ...multipartUpload({
        conflict_resolution: "replace_path",
        relative_path: "Policies/HR/manual.pdf",
        parent_entry_id: ENTRY_ID,
      }),
    });

    expect(replacement.statusCode).toBe(202);
    expect(keepBoth.statusCode).toBe(202);
    expect(directoryReplacement.statusCode).toBe(202);
    expect(uploadDocument).toHaveBeenNthCalledWith(
      1,
      ACTOR,
      BASE_ID,
      expect.objectContaining({
        filename: "manual.pdf",
        conflictResolution: "replace",
        replaceDocumentId: DOCUMENT_ID,
        ocrEnabled: true,
      }),
    );
    expect(uploadDocument).toHaveBeenNthCalledWith(
      2,
      ACTOR,
      BASE_ID,
      expect.objectContaining({
        filename: "manual.pdf",
        conflictResolution: "keep_both",
        ocrEnabled: false,
      }),
    );
    expect(uploadDocument.mock.calls[1]?.[2]).not.toHaveProperty(
      "replaceDocumentId",
    );
    expect(uploadDocument).toHaveBeenNthCalledWith(
      3,
      ACTOR,
      BASE_ID,
      expect.objectContaining({
        filename: "manual.pdf",
        conflictResolution: "replace_path",
        relativePath: "Policies/HR/manual.pdf",
        parentEntryId: ENTRY_ID,
      }),
    );
  });

  it.each([
    { conflict_resolution: "replace" },
    {
      conflict_resolution: "keep_both",
      replace_document_id: DOCUMENT_ID,
    },
    { replace_document_id: DOCUMENT_ID },
    { conflict_resolution: "replace_path" },
    { ocr_enabled: "yes" },
  ])(
    "rejects an invalid upload conflict field combination before calling the service: %j",
    async (fields) => {
      const uploadDocument = vi.fn();
      const app = await createApp({ uploadDocument });

      const response = await app.inject({
        method: "POST",
        url: `/api/v1/knowledge-bases/${BASE_ID}/documents`,
        ...multipartUpload(fields),
      });

      expect(response.statusCode).not.toBe(202);
      expect(uploadDocument).not.toHaveBeenCalled();
    },
  );
});

async function createApp(
  methods: Record<string, unknown>,
  getSearchCapability: KnowledgeRoutesOptions["getSearchCapability"] = vi.fn(
    async () => ({
      status: "available" as const,
      reason_code: null,
      checked_at: "2026-07-22T08:00:00.000Z",
    }),
  ),
  resolveActor: NonNullable<
    KnowledgeRoutesOptions["resolveActor"]
  > = async () => ACTOR,
  sourceMethods?: Record<string, unknown>,
  creationCapability: KnowledgeRoutesOptions["creationCapability"] = {
    read: vi.fn(async () => ({
      status: "ready" as const,
      checks: {
        object_storage: "available" as const,
        document_parsing: "available" as const,
        embedding_model: "available" as const,
        search_and_indexing: "available" as const,
      },
      checked_at: "2026-08-31T08:00:00.000Z",
    })),
    assertReady: vi.fn(async () => undefined),
  },
) {
  const app = Fastify();
  apps.push(app);
  await app.register(multipart, { limits: { files: 1, fileSize: 1_024 } });
  await app.register(knowledgeRoutes, {
    prefix: "/api/v1/knowledge-bases",
    service: methods as unknown as KnowledgeService,
    getSearchCapability,
    creationCapability,
    publicBaseUrl: PUBLIC_BASE_URL,
    resolveActor,
    ...(sourceMethods === undefined
      ? {}
      : {
          sourceService: sourceMethods as unknown as KnowledgeSourceService,
        }),
  });
  return app;
}

function multipartUpload(fields: Record<string, string | undefined>) {
  const boundary = "linksense-knowledge-upload-boundary";
  const textFields = Object.entries(fields)
    .map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
    .join("");
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `${textFields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="manual.pdf"\r\nContent-Type: application/pdf\r\n\r\npdf\r\n--${boundary}--\r\n`,
    ),
  };
}
