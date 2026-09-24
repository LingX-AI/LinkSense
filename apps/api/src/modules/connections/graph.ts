import { Client } from "@microsoft/microsoft-graph-client";
import {
  MICROSOFT_FILE_MAX_BYTES,
  isMicrosoftFilesWrite,
  microsoftFileEntrySchema,
  type MicrosoftFilesInput,
  type MicrosoftFilesResult,
} from "@linksense/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { fetchPublicHttpResource } from "../../lib/safe-http-fetch.js";
import { MicrosoftFileWriter } from "./graph-write.js";

const entrySchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(320).optional(),
  displayName: z.string().max(320).optional(),
  webUrl: z.url().optional(),
  size: z.number().int().nonnegative().optional(),
  eTag: z.string().max(1024).optional(),
  parentReference: z.object({ driveId: z.string().max(512).optional() }).optional(),
  file: z.object({ mimeType: z.string().max(160).optional() }).optional(),
  folder: z.object({}).optional(),
  remoteItem: z.unknown().optional(),
  "@microsoft.graph.downloadUrl": z.url().optional(),
});
const pageSchema = z.object({
  value: z.array(entrySchema).max(200),
  "@odata.nextLink": z.url().optional(),
});
type GraphOperation = Exclude<MicrosoftFilesInput, { operation: "list_connections" }>;
type GraphPage = { result: MicrosoftFilesResult; nextLink: string | null };
interface GraphRequest {
  select(value: string): GraphRequest;
  top(value: number): GraphRequest;
  query(value: Record<string, string>): GraphRequest;
  option(key: string, value: unknown): GraphRequest;
  get(): Promise<unknown>;
}
export interface DelegatedGraphClient {
  api(path: string): GraphRequest;
}
export interface ConnectionGraph {
  execute(
    token: string,
    input: GraphOperation,
    nextLink?: string,
    signal?: AbortSignal,
  ): Promise<GraphPage>;
}

export class MicrosoftFilesGraph implements ConnectionGraph {
  constructor(
    private readonly options: {
      createClient?: (token: string) => DelegatedGraphClient;
      download?: typeof fetchPublicHttpResource;
      allowBenchmarkProxyAddresses?: boolean;
      writer?: Pick<MicrosoftFileWriter, "execute">;
    } = {},
  ) {}

  async execute(
    token: string,
    input: GraphOperation,
    nextLink?: string,
    signal?: AbortSignal,
  ): Promise<GraphPage> {
    const requestSignal = AbortSignal.any([
      AbortSignal.timeout(isMicrosoftFilesWrite(input) ? 50_000 : 25_000),
      ...(signal ? [signal] : []),
    ]);
    try {
    if (isMicrosoftFilesWrite(input)) {
      const value = await (this.options.writer ?? new MicrosoftFileWriter()).execute(token, input, requestSignal);
      return { result: input.operation === "delete_file"
        ? { kind: "deleted", item_id: input.item_id }
        : { kind: "item", item: projectEntry(entrySchema.parse(value), "file", input.drive_id) }, nextLink: null };
    }
    const client =
      this.options.createClient?.(token) ??
      Client.initWithMiddleware({ authProvider: { getAccessToken: async () => token } });
    const target = graphTarget(input);
    const request = client
      .api(nextLink ? assertGraphNextLink(nextLink, target.path) : target.path)
      .option("signal", requestSignal)
      .option("redirect", "error");
    if (!nextLink) {
      if (input.operation !== "read_file" && input.operation !== "get_file") request.top(100);
      // Graph SDK query values are appended verbatim, including '&' and '#'.
      if (input.operation === "search_sites")
        request.query({ search: encodeURIComponent(input.query) });
      // Personal OneDrive can omit the download annotation when $select is
      // present, even when explicitly selected. Read the default metadata;
      // entrySchema and projectEntry still limit what leaves this adapter.
      if (input.operation !== "read_file")
        request.select(
          target.kind === "site"
            ? "id,displayName,webUrl"
            : target.kind === "drive"
              ? "id,name,webUrl"
              : "id,name,webUrl,size,eTag,parentReference,file,folder,remoteItem",
        );
    }
      if (input.operation === "get_file") {
        const item = entrySchema.parse(await request.get());
        if (item.remoteItem) throw new AppError("CONNECTION_ACCESS_DENIED");
        return { result: { kind: "item", item: projectEntry(item, "file", input.drive_id) }, nextLink: null };
      }
      if (input.operation === "read_file") {
        const item = entrySchema.parse(await request.get());
        if (!item.file || item.remoteItem || !item["@microsoft.graph.downloadUrl"])
          throw new AppError("CONNECTION_ACCESS_DENIED");
        if (item.size !== undefined && item.size > MICROSOFT_FILE_MAX_BYTES)
          throw new AppError("CONNECTION_FILE_TOO_LARGE");
        const downloaded = await (this.options.download ?? fetchPublicHttpResource)(
          new URL(item["@microsoft.graph.downloadUrl"]),
          {
            byteLimit: MICROSOFT_FILE_MAX_BYTES,
            redirectCount: 3,
            requestTimeoutMs: 20_000,
            accept: "application/octet-stream,*/*",
            userAgent: "LinkSense",
            errorCode: "CONNECTION_UNAVAILABLE",
            allowedProtocols: ["https:"],
            signal: requestSignal,
            allowBenchmarkProxyAddresses: this.options.allowBenchmarkProxyAddresses ?? false,
          },
        );
        return {
          result: {
            kind: "file",
            item: projectEntry(item, "file", input.drive_id),
            content_base64: downloaded.bytes.toString("base64"),
          },
          nextLink: null,
        };
      }
      const page = pageSchema.parse(await request.get());
      const continuation = page["@odata.nextLink"]
        ? assertGraphNextLink(page["@odata.nextLink"], target.path)
        : null;
      return {
        result: {
          kind: "page",
          items: page.value
            .filter((item) => !item.remoteItem)
            .map((item) =>
              projectEntry(item, target.kind, "drive_id" in input ? input.drive_id : undefined),
            ),
          next_cursor: null,
        },
        nextLink: continuation,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = z.object({ statusCode: z.number() }).safeParse(error);
      if (status.success && status.data.statusCode === 401)
        throw new AppError("CONNECTION_REQUIRED");
      if (status.success && [403, 404].includes(status.data.statusCode))
        throw new AppError("CONNECTION_ACCESS_DENIED");
      if (status.success && [409, 412].includes(status.data.statusCode))
        throw new AppError("CONNECTION_FILE_CONFLICT");
      throw new AppError("CONNECTION_UNAVAILABLE");
    }
  }
}

function graphTarget(input: Exclude<GraphOperation, import("@linksense/shared").MicrosoftFilesWriteInput>): { path: string; kind: "file" | "drive" | "site" } {
  switch (input.operation) {
    case "list_drives":
      if (input.provider === "sharepoint" && !input.site_id) throw new AppError("VALIDATION_ERROR");
      if (input.provider === "onedrive" && input.site_id) throw new AppError("VALIDATION_ERROR");
      return {
        path: input.site_id ? `/sites/${encodeURIComponent(input.site_id)}/drives` : "/me/drives",
        kind: "drive",
      };
    case "search_sites":
      return { path: "/sites", kind: "site" };
    case "list_files":
      return {
        path: `/drives/${encodeURIComponent(input.drive_id)}/${input.folder_id ? `items/${encodeURIComponent(input.folder_id)}` : "root"}/children`,
        kind: "file",
      };
    case "search_files":
      return {
        path: `/drives/${encodeURIComponent(input.drive_id)}/root/search(q='${encodeURIComponent(input.query.replace(/'/gu, "''")).replace(/'/gu, "%27")}')`,
        kind: "file",
      };
    case "read_file":
    case "get_file":
      return {
        path: `/drives/${encodeURIComponent(input.drive_id)}/items/${encodeURIComponent(input.item_id)}`,
        kind: "file",
      };
  }
}

export function assertGraphNextLink(value: string, expectedPath: string): string {
  const url = new URL(value);
  if (
    url.origin !== "https://graph.microsoft.com" ||
    url.username ||
    url.password ||
    url.hash ||
    decodeURIComponent(url.pathname) !== decodeURIComponent(`/v1.0${expectedPath}`)
  )
    throw new AppError("CONNECTION_UNAVAILABLE");
  return url.toString();
}

function projectEntry(
  item: z.infer<typeof entrySchema>,
  kind: "site" | "drive" | "file",
  driveId?: string,
) {
  let webUrl: string | null = null;
  if (item.webUrl) {
    const url = new URL(item.webUrl);
    if (url.protocol === "https:" && !url.username && !url.password) webUrl = url.toString();
  }
  return microsoftFileEntrySchema.parse({
    id: item.id,
    name: item.name ?? item.displayName ?? item.id,
    web_url: webUrl,
    kind: kind === "file" && item.folder ? "folder" : kind,
    drive_id: kind === "drive" ? item.id : (item.parentReference?.driveId ?? driveId ?? null),
    mime_type: item.file?.mimeType ?? null,
    size_bytes: item.size ?? null,
    etag: item.eTag ?? null,
  });
}
