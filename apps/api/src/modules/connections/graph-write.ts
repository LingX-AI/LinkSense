import { Client, RedirectHandlerOptions, RetryHandlerOptions, type GraphRequest } from "@microsoft/microsoft-graph-client";
import { MICROSOFT_FILE_MAX_BYTES, type MicrosoftFilesWriteInput } from "@linksense/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";

export class MicrosoftFileWriter {
  async execute(token: string, input: MicrosoftFilesWriteInput, signal: AbortSignal): Promise<unknown> {
    const client = Client.initWithMiddleware({
      authProvider: { getAccessToken: async () => token },
      fetchOptions: { signal, redirect: "error" },
    });
    const request = (path: string): GraphRequest => client.api(path).middlewareOptions([
      // The SDK's Node redirect handler otherwise overrides fetch's policy.
      // A write may have committed before an error; never replay it blindly.
      new RedirectHandlerOptions(0), new RetryHandlerOptions(0, 0),
    ]);
    const drive = `/drives/${encodeURIComponent(input.drive_id)}`;
    const itemPath = "item_id" in input ? `${drive}/items/${encodeURIComponent(input.item_id)}` : undefined;
    const parent = "folder_id" in input && input.folder_id
      ? `${drive}/items/${encodeURIComponent(input.folder_id)}` : `${drive}/root`;
    if (input.operation === "create_folder") {
      return request(`${parent}/children`).post({ name: input.name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
    }
    if (input.operation === "create_file" || input.operation === "update_file") {
      const bytes = Buffer.from(input.content_base64, "base64");
      if (!bytes.length || bytes.toString("base64") !== input.content_base64)
        throw new AppError("VALIDATION_ERROR");
      if (bytes.length > MICROSOFT_FILE_MAX_BYTES) throw new AppError("CONNECTION_FILE_TOO_LARGE");
      // Graph's content endpoint supports 250 MB, above our 20 MiB limit.
      // It enforces conflicts and If-Match on the actual write, unlike the
      // personal OneDrive upload-session behavior verified with real accounts.
      if (input.operation === "update_file") {
        if (!itemPath) throw new AppError("VALIDATION_ERROR");
        const item = z.object({ file: z.object({}), remoteItem: z.unknown().optional() })
          .parse(await request(itemPath).select("file,remoteItem").get());
        if (item.remoteItem) throw new AppError("CONNECTION_ACCESS_DENIED");
        return request(`${itemPath}/content`)
          .header("If-Match", input.expected_etag)
          .header("Content-Type", "application/octet-stream")
          .put(bytes);
      }
      const path = `${parent}:/${encodeURIComponent(input.name).replace(/'/gu, "%27")}:/content`;
      return request(path)
        .query({ "@microsoft.graph.conflictBehavior": "fail" })
        .header("Content-Type", "application/octet-stream")
        .put(bytes);
    }
    if (!itemPath) throw new AppError("VALIDATION_ERROR");
    const mutation = request(itemPath).header("If-Match", input.expected_etag);
    if (input.operation === "delete_file") return mutation.delete();
    if (input.operation === "rename_file") return mutation.patch({ name: input.name });
    return mutation.patch({ parentReference: { id: input.folder_id } });
  }
}
