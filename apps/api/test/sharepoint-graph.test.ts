import { describe, expect, it } from "vitest";

import {
  encodeSharePointSharingUrl,
  MicrosoftGraphSharePointClient,
  parseSharePointFolderUrl,
  SharePointDeltaCursorExpiredError,
  type MicrosoftGraphRequest,
  type MicrosoftGraphRequestClient,
} from "../src/modules/knowledge-sources/sharepoint-graph.js";

const SHARING_URL =
  "https://aisgzorg.sharepoint.com/:f:/s/policyforai/fake-share-token-for-tests?e=test01";
const SITE_ID = "aisgzorg.sharepoint.com,site-collection-id,site-id";
const SITE_REFERENCE_ID = "site-collection-id";
const DRIVE_ID = "policy-drive-id";
const RUNTIME = {
  revision: 1,
  tenantId: "00000000-0000-4000-8000-000000000001",
  clientId: "00000000-0000-4000-8000-000000000002",
  tenantDomain: "aisgzorg.sharepoint.com",
  clientSecret: "not-used-by-the-injected-client",
};

describe("parseSharePointFolderUrl", () => {
  it("normalizes a direct folder URL on the configured tenant", () => {
    expect(
      parseSharePointFolderUrl(
        "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/Policies",
        "contoso.sharepoint.com",
      ),
    ).toMatchObject({
      hostname: "contoso.sharepoint.com",
      sitePath: "/sites/Finance",
      folderPath: "/sites/Finance/Shared Documents/Policies",
    });
  });

  it("uses the AllItems id parameter without inserting content at another path", () => {
    expect(
      parseSharePointFolderUrl(
        "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FFinance%2FShared%20Documents%2FQuarterly",
        "contoso.sharepoint.com",
      ).folderPath,
    ).toBe("/sites/Finance/Shared Documents/Quarterly");
  });

  it("rejects guessed URLs on every other host and non-HTTPS URLs", () => {
    expect(() =>
      parseSharePointFolderUrl(
        "https://other.sharepoint.com/sites/Finance/Shared%20Documents",
        "contoso.sharepoint.com",
      ),
    ).toThrowError("KNOWLEDGE_SOURCE_URL_INVALID");
    expect(() =>
      parseSharePointFolderUrl(
        "http://contoso.sharepoint.com/sites/Finance/Shared%20Documents",
        "contoso.sharepoint.com",
      ),
    ).toThrowError("KNOWLEDGE_SOURCE_URL_INVALID");
  });

  it("encodes sharing URLs using the Microsoft Graph u! base64url contract", () => {
    expect(encodeSharePointSharingUrl("https://example.com/shared?a=1")).toBe(
      "u!aHR0cHM6Ly9leGFtcGxlLmNvbS9zaGFyZWQ_YT0x",
    );
  });

  it("resolves a folder sharing link and stores only its canonical folder URL", async () => {
    const sharePath = `/shares/${encodeSharePointSharingUrl(SHARING_URL)}/driveItem`;
    const { client, requests } = createGraphClient({
      [sharePath]: {
        id: "shared-folder-id",
        name: "Policies",
        webUrl:
          "https://aisgzorg.sharepoint.com/sites/policyforai/Shared%20Documents/Policies",
        parentReference: { siteId: SITE_REFERENCE_ID, driveId: DRIVE_ID },
        folder: { childCount: 8 },
      },
      [`/sites/${encodeURIComponent(SITE_REFERENCE_ID)}`]: {
        id: SITE_ID,
        displayName: "Policy for AI",
        webUrl: "https://aisgzorg.sharepoint.com/sites/policyforai",
      },
      [`/drives/${DRIVE_ID}`]: {
        id: DRIVE_ID,
        name: "Documents",
        webUrl:
          "https://aisgzorg.sharepoint.com/sites/policyforai/Shared%20Documents",
      },
    });

    const resolved = await new MicrosoftGraphSharePointClient(
      RUNTIME,
      () => client,
    ).resolveFolder(SHARING_URL);

    expect(resolved).toEqual({
      sourceUrl:
        "https://aisgzorg.sharepoint.com/sites/policyforai/Shared%20Documents/Policies",
      siteId: SITE_ID,
      siteName: "Policy for AI",
      driveId: DRIVE_ID,
      driveName: "Documents",
      rootItemId: "shared-folder-id",
      folderName: "Policies",
    });
    expect(resolved.sourceUrl).not.toContain("fake-share-token-for-tests");
    expect(requests[0]).toMatchObject({
      path: sharePath,
      select: "id,name,webUrl,parentReference,folder",
      headers: { Prefer: "redeemSharingLinkIfNecessary" },
    });
  });

  it("rejects a sharing link that resolves outside the configured tenant", async () => {
    const sharePath = `/shares/${encodeSharePointSharingUrl(SHARING_URL)}/driveItem`;
    const { client } = createGraphClient({
      [sharePath]: {
        id: "shared-folder-id",
        name: "Policies",
        webUrl:
          "https://other.sharepoint.com/sites/policyforai/Shared%20Documents/Policies",
        parentReference: { siteId: SITE_REFERENCE_ID, driveId: DRIVE_ID },
        folder: { childCount: 8 },
      },
    });

    await expect(
      new MicrosoftGraphSharePointClient(RUNTIME, () => client).resolveFolder(
        SHARING_URL,
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND" });
  });

  it("rejects a file sharing link response before creating a source", async () => {
    const sharePath = `/shares/${encodeSharePointSharingUrl(SHARING_URL)}/driveItem`;
    const { client } = createGraphClient({
      [sharePath]: {
        id: "shared-file-id",
        name: "Policy.pdf",
        webUrl:
          "https://aisgzorg.sharepoint.com/sites/policyforai/Shared%20Documents/Policy.pdf",
        parentReference: { siteId: SITE_REFERENCE_ID, driveId: DRIVE_ID },
        file: { mimeType: "application/pdf" },
      },
    });

    await expect(
      new MicrosoftGraphSharePointClient(RUNTIME, () => client).resolveFolder(
        SHARING_URL,
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND" });
  });

  it("rejects a folder sharing link from a different input host before Graph", async () => {
    const { client, requests } = createGraphClient({});

    await expect(
      new MicrosoftGraphSharePointClient(RUNTIME, () => client).resolveFolder(
        SHARING_URL.replace("aisgzorg.sharepoint.com", "other.sharepoint.com"),
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SOURCE_URL_INVALID" });
    expect(requests).toHaveLength(0);
  });

  it("converts the Graph SDK web response stream into a Node readable", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("sharepoint-pdf"));
        controller.close();
      },
    });
    const client = createDownloadClient(body);

    const stream = await new MicrosoftGraphSharePointClient(
      RUNTIME,
      () => client,
    ).download(DRIVE_ID, "shared-file-id");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).toString("utf8")).toBe("sharepoint-pdf");
  });

  it("distinguishes an expired delta cursor so synchronization can resume from its baseline", async () => {
    const cursor =
      "https://graph.microsoft.com/v1.0/drives/policy-drive-id/items/root/delta?$token=expired";
    const client: MicrosoftGraphRequestClient = {
      api(path) {
        expect(path).toBe(cursor);
        const request: MicrosoftGraphRequest = {
          select: () => request,
          header: () => request,
          async get() {
            throw { statusCode: 410, code: "resyncRequired" };
          },
          async getStream() {
            throw new Error("Unexpected stream request");
          },
        };
        return request;
      },
    };

    await expect(
      new MicrosoftGraphSharePointClient(RUNTIME, () => client).getDeltaPage(
        DRIVE_ID,
        "root",
        cursor,
      ),
    ).rejects.toBeInstanceOf(SharePointDeltaCursorExpiredError);
  });
});

type CapturedRequest = {
  path: string;
  headers: Record<string, string>;
  select?: string;
};

function createGraphClient(responses: Record<string, unknown>): {
  client: MicrosoftGraphRequestClient;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  return {
    requests,
    client: {
      api(path) {
        const captured: CapturedRequest = { path, headers: {} };
        requests.push(captured);
        const request: MicrosoftGraphRequest = {
          select(fields) {
            captured.select = fields;
            return request;
          },
          header(name, value) {
            captured.headers[name] = value;
            return request;
          },
          async get() {
            if (!(path in responses)) throw new Error(`Unexpected ${path}`);
            return responses[path];
          },
          async getStream() {
            throw new Error("Unexpected stream request");
          },
        };
        return request;
      },
    },
  };
}

function createDownloadClient(stream: unknown): MicrosoftGraphRequestClient {
  return {
    api(path) {
      expect(path).toBe(
        `/drives/${DRIVE_ID}/items/shared-file-id/content`,
      );
      const request: MicrosoftGraphRequest = {
        select() {
          return request;
        },
        header() {
          return request;
        },
        async get() {
          throw new Error("Unexpected metadata request");
        },
        async getStream() {
          return stream;
        },
      };
      return request;
    },
  };
}
