import { describe, expect, it } from "vitest";
import { microsoftFilesInputSchema, connectionSchema, MICROSOFT_FILE_MAX_BYTES, isMicrosoftFilesWrite } from "./connections.js";

describe("personal connection contracts", () => {
  it.each(["../secret", "file?token=secret", "https://evil.test", "file/children", "id#fragment"])(
    "rejects Graph path injection: %s",
    (id) => {
      expect(
        microsoftFilesInputSchema.safeParse({
          operation: "read_file",
          provider: "onedrive",
          drive_id: id,
          item_id: "file",
        }).success,
      ).toBe(false);
    },
  );
  it("accepts real composite SharePoint IDs and refuses incomplete writes or caller-provided identities", () => {
    expect(
      microsoftFilesInputSchema.safeParse({
        operation: "list_drives",
        provider: "sharepoint",
        site_id:
          "example.sharepoint.com,00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(true);
    expect(
      microsoftFilesInputSchema.safeParse({ operation: "delete_file", provider: "onedrive" })
        .success,
    ).toBe(false);
    expect(
      microsoftFilesInputSchema.safeParse({
        operation: "list_connections",
        owner_id: "someone-else",
      }).success,
    ).toBe(false);
    expect(
      microsoftFilesInputSchema.safeParse({
        operation: "search_sites",
        provider: "onedrive",
        query: "site",
      }).success,
    ).toBe(false);
  });
  it("bounds file uploads and requires exact versions for existing item mutations", () => {
    const upload = { operation: "create_file", provider: "onedrive", drive_id: "drive", name: "test.txt", content_base64: "YWFh".repeat(Math.floor(MICROSOFT_FILE_MAX_BYTES / 3)) + "YWE=" };
    expect(isMicrosoftFilesWrite(microsoftFilesInputSchema.parse(upload))).toBe(true);
    expect(microsoftFilesInputSchema.safeParse({ ...upload, name: "../test.txt" }).success).toBe(false);
    expect(microsoftFilesInputSchema.safeParse({ ...upload, content_base64: upload.content_base64 + "AAAA" }).success).toBe(false);
    for (const expected_etag of [undefined, "*", " * ", '"one", *', '"one"\r\nHeader: bad']) {
      expect(microsoftFilesInputSchema.safeParse({ operation: "delete_file", provider: "onedrive", drive_id: "drive", item_id: "file", expected_etag }).success).toBe(false);
    }
  });
  it("prevents credential fields from crossing the public account contract", () => {
    const publicAccount = {
      provider: "onedrive",
      status: "disconnected",
      configured: true,
      access_mode: null,
      account_name: null,
      connected_at: null,
    };
    expect(connectionSchema.safeParse(publicAccount).success).toBe(true);
    expect(connectionSchema.safeParse({ ...publicAccount, enabled: false }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...publicAccount, access_token: "secret" }).success).toBe(
      false,
    );
  });
});
