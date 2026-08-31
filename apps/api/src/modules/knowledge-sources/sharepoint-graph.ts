import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type {
  ResolvedSharePointRuntime,
  SharePointCredentialProbe,
} from "./sharepoint-settings.js";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const SHARING_LINK_PREFER_HEADER = "redeemSharingLinkIfNecessary";
const driveItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(260).optional(),
  webUrl: z.string().url().optional(),
  size: z.number().int().nonnegative().optional(),
  eTag: z.string().optional(),
  cTag: z.string().optional(),
  parentReference: z
    .object({
      id: z.string().min(1).optional(),
      driveId: z.string().min(1).optional(),
      siteId: z.string().min(1).optional(),
    })
    .optional(),
  file: z.object({ mimeType: z.string().max(160).optional() }).optional(),
  folder: z
    .object({ childCount: z.number().int().nonnegative().optional() })
    .optional(),
  deleted: z.object({ state: z.string().optional() }).optional(),
});
const siteSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(260),
  webUrl: z.string().url(),
});
const driveSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(260),
  webUrl: z.string().url(),
});
const drivesSchema = z.object({ value: z.array(driveSchema) });
const deltaSchema = z.object({
  value: z.array(driveItemSchema),
  "@odata.nextLink": z.string().url().optional(),
  "@odata.deltaLink": z.string().url().optional(),
});
const sharedFolderSchema = driveItemSchema.extend({
  name: z.string().min(1).max(260),
  webUrl: z.string().url(),
  parentReference: z.object({
    driveId: z.string().min(1),
    siteId: z.string().min(1),
  }),
  folder: z.object({
    childCount: z.number().int().nonnegative().optional(),
  }),
});

export interface MicrosoftGraphRequest {
  select(fields: string): MicrosoftGraphRequest;
  header(name: string, value: string): MicrosoftGraphRequest;
  get(): Promise<unknown>;
  getStream(): Promise<unknown>;
}

export interface MicrosoftGraphRequestClient {
  api(path: string): MicrosoftGraphRequest;
}

export type SharePointResolvedFolder = {
  sourceUrl: string;
  siteId: string;
  siteName: string;
  driveId: string;
  driveName: string;
  rootItemId: string;
  folderName: string;
};

export type SharePointDeltaItem = {
  id: string;
  parentId: string | null;
  name: string;
  itemType: "file" | "folder";
  mimeType: string | null;
  sizeBytes: bigint;
  etag: string | null;
  ctag: string | null;
  webUrl: string | null;
  deleted: boolean;
};

export type SharePointDeltaPage = {
  items: SharePointDeltaItem[];
  nextLink: string | null;
  deltaLink: string | null;
};

export interface SharePointGraphClient {
  resolveFolder(url: string): Promise<SharePointResolvedFolder>;
  getDeltaPage(
    driveId: string,
    rootItemId: string,
    cursor?: string,
  ): Promise<SharePointDeltaPage>;
  download(driveId: string, itemId: string): Promise<Readable>;
}

export class SharePointDeltaCursorExpiredError extends Error {
  constructor(options?: ErrorOptions) {
    super("SHAREPOINT_DELTA_CURSOR_EXPIRED", options);
    this.name = "SharePointDeltaCursorExpiredError";
  }
}

export class MicrosoftGraphSharePointClient
  implements SharePointGraphClient, SharePointCredentialProbe
{
  constructor(
    private readonly runtime?: ResolvedSharePointRuntime,
    private readonly clientFactory: (
      runtime: ResolvedSharePointRuntime,
    ) => MicrosoftGraphRequestClient = createGraphClient,
  ) {}

  async validateCredentials(runtime: ResolvedSharePointRuntime): Promise<void> {
    const credential = createCredential(runtime);
    const token = await credential.getToken(GRAPH_SCOPE);
    if (!token?.token) throw new Error("SHAREPOINT_TOKEN_UNAVAILABLE");
  }

  async resolveFolder(rawUrl: string): Promise<SharePointResolvedFolder> {
    const runtime = this.requiredRuntime();
    const target = parseSharePointSourceUrl(rawUrl, runtime.tenantDomain);
    const client = this.client(runtime);
    try {
      if (target.kind === "sharing") {
        return await resolveSharedFolder(client, target.url, runtime);
      }
      const site = siteSchema.parse(
        await client
          .api(`/sites/${target.hostname}:${target.sitePath}`)
          .select("id,displayName,webUrl")
          .get(),
      );
      const drives = drivesSchema.parse(
        await client
          .api(`/sites/${encodeURIComponent(site.id)}/drives`)
          .select("id,name,webUrl")
          .get(),
      ).value;
      const matching = drives
        .map((drive) => ({ drive, path: new URL(drive.webUrl).pathname }))
        .filter(({ path }) => pathPrefix(target.folderPath, path))
        .sort((left, right) => right.path.length - left.path.length)[0];
      if (!matching) throw new AppError("KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND");
      const relativePath = target.folderPath
        .slice(matching.path.length)
        .replace(/^\/+|\/+$/gu, "");
      const requestPath = relativePath
        ? `/drives/${encodeURIComponent(matching.drive.id)}/root:/${encodeGraphPath(relativePath)}`
        : `/drives/${encodeURIComponent(matching.drive.id)}/root`;
      const folder = driveItemSchema
        .extend({ name: z.string().min(1).max(260) })
        .parse(
          await client
            .api(requestPath)
            .select("id,name,webUrl,parentReference,folder")
            .get(),
        );
      if (!folder.folder)
        throw new AppError("KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND");
      return {
        sourceUrl: target.normalizedUrl,
        siteId: site.id,
        siteName: site.displayName,
        driveId: matching.drive.id,
        driveName: matching.drive.name,
        rootItemId: folder.id,
        folderName: folder.name,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND");
    }
  }

  async getDeltaPage(
    driveId: string,
    rootItemId: string,
    cursor?: string,
  ): Promise<SharePointDeltaPage> {
    const runtime = this.requiredRuntime();
    const client = this.client(runtime);
    const request = cursor
      ? client.api(assertGraphCursor(cursor))
      : client
          .api(
            `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootItemId)}/delta`,
          )
          .select(
            "id,name,size,eTag,cTag,webUrl,parentReference,file,folder,deleted",
          );
    try {
      const page = deltaSchema.parse(await request.get());
      return {
        items: page.value.map((item) => ({
          id: item.id,
          parentId: item.parentReference?.id ?? null,
          name: item.name ?? "deleted-item",
          itemType: item.folder ? "folder" : "file",
          mimeType: item.file?.mimeType ?? null,
          sizeBytes: BigInt(item.size ?? 0),
          etag: item.eTag ?? null,
          ctag: item.cTag ?? null,
          webUrl: item.webUrl ?? null,
          deleted: item.deleted !== undefined,
        })),
        nextLink: page["@odata.nextLink"] ?? null,
        deltaLink: page["@odata.deltaLink"] ?? null,
      };
    } catch (error) {
      if (cursor && isExpiredDeltaCursorError(error)) {
        throw new SharePointDeltaCursorExpiredError({ cause: error });
      }
      throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
    }
  }

  async download(driveId: string, itemId: string): Promise<Readable> {
    const client = this.client(this.requiredRuntime());
    try {
      const stream: unknown = await client
        .api(
          `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
        )
        .getStream();
      if (stream instanceof Readable) return stream;
      if (isWebReadableStream(stream)) return Readable.fromWeb(stream);
      if (stream instanceof ArrayBuffer)
        return Readable.from(Buffer.from(stream));
      if (ArrayBuffer.isView(stream)) {
        return Readable.from(
          Buffer.from(stream.buffer, stream.byteOffset, stream.byteLength),
        );
      }
      throw new Error("GRAPH_STREAM_INVALID");
    } catch {
      throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
    }
  }

  private requiredRuntime(): ResolvedSharePointRuntime {
    if (!this.runtime) throw new AppError("KNOWLEDGE_SOURCE_NOT_CONFIGURED");
    return this.runtime;
  }

  private client(runtime: ResolvedSharePointRuntime) {
    return this.clientFactory(runtime);
  }
}

function isExpiredDeltaCursorError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const response = isRecord(error.response) ? error.response : null;
  const body = isRecord(error.body) ? error.body : null;
  const nestedError = body && isRecord(body.error) ? body.error : null;
  const status = Number(
    error.statusCode ?? error.status ?? response?.status ?? Number.NaN,
  );
  const code = String(
    error.code ?? nestedError?.code ?? body?.code ?? "",
  ).toLocaleLowerCase("en-US");
  return (
    status === 410 ||
    code === "resyncrequired" ||
    code === "syncstatenotfound" ||
    code === "invaliddeltatoken"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWebReadableStream(
  value: unknown,
): value is WebReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof value.getReader === "function"
  );
}

function createCredential(runtime: ResolvedSharePointRuntime) {
  return new ClientSecretCredential(
    runtime.tenantId,
    runtime.clientId,
    runtime.clientSecret,
  );
}

function createGraphClient(
  runtime: ResolvedSharePointRuntime,
): MicrosoftGraphRequestClient {
  const authenticationProvider = new TokenCredentialAuthenticationProvider(
    createCredential(runtime),
    { scopes: [GRAPH_SCOPE] },
  );
  return Client.initWithMiddleware({ authProvider: authenticationProvider });
}

type DirectSharePointFolderTarget = {
  kind: "direct";
  hostname: string;
  sitePath: string;
  folderPath: string;
  normalizedUrl: string;
};

type SharePointSourceTarget =
  | DirectSharePointFolderTarget
  | { kind: "sharing"; url: string };

function parseSharePointSourceUrl(
  rawUrl: string,
  tenantDomain: string,
): SharePointSourceTarget {
  const url = parseAllowedTenantUrl(rawUrl, tenantDomain);
  const selectedPath = url.searchParams.get("id") ?? url.pathname;
  const direct = parseDirectFolderPath(url, selectedPath);
  if (direct) return direct;
  if (!/^\/:f:\/[a-z]\/.+/iu.test(url.pathname)) {
    throw new AppError("KNOWLEDGE_SOURCE_URL_INVALID");
  }
  url.hash = "";
  return { kind: "sharing", url: url.toString() };
}

export function parseSharePointFolderUrl(
  rawUrl: string,
  tenantDomain: string,
): {
  hostname: string;
  sitePath: string;
  folderPath: string;
  normalizedUrl: string;
} {
  const url = parseAllowedTenantUrl(rawUrl, tenantDomain);
  const selectedPath = url.searchParams.get("id") ?? url.pathname;
  const target = parseDirectFolderPath(url, selectedPath);
  if (!target) throw new AppError("KNOWLEDGE_SOURCE_URL_INVALID");
  return {
    hostname: target.hostname,
    sitePath: target.sitePath,
    folderPath: target.folderPath,
    normalizedUrl: target.normalizedUrl,
  };
}

function parseAllowedTenantUrl(rawUrl: string, tenantDomain: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("KNOWLEDGE_SOURCE_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.toLocaleLowerCase("en-US") !==
      tenantDomain.toLocaleLowerCase("en-US")
  ) {
    throw new AppError("KNOWLEDGE_SOURCE_URL_INVALID");
  }
  return url;
}

function parseDirectFolderPath(
  url: URL,
  selectedPath: string,
): DirectSharePointFolderTarget | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(selectedPath).replace(/\/{2,}/gu, "/");
  } catch {
    throw new AppError("KNOWLEDGE_SOURCE_URL_INVALID");
  }
  const match = /^\/(sites|teams)\/[^/]+/iu.exec(decoded);
  if (!match) return null;
  const sitePath = match[0];
  let folderPath = decoded;
  if (/\/Forms\/AllItems\.aspx$/iu.test(folderPath)) {
    folderPath = folderPath.replace(/\/Forms\/AllItems\.aspx$/iu, "");
  }
  const normalized = new URL(url.origin);
  normalized.pathname = folderPath;
  return {
    kind: "direct",
    hostname: url.hostname,
    sitePath,
    folderPath,
    normalizedUrl: normalized.toString(),
  };
}

export function encodeSharePointSharingUrl(value: string): string {
  return `u!${Buffer.from(value, "utf8").toString("base64url")}`;
}

async function resolveSharedFolder(
  client: MicrosoftGraphRequestClient,
  sharingUrl: string,
  runtime: ResolvedSharePointRuntime,
): Promise<SharePointResolvedFolder> {
  const sharedFolder = sharedFolderSchema.parse(
    await client
      .api(`/shares/${encodeSharePointSharingUrl(sharingUrl)}/driveItem`)
      .header("Prefer", SHARING_LINK_PREFER_HEADER)
      .select("id,name,webUrl,parentReference,folder")
      .get(),
  );
  let canonical: ReturnType<typeof parseSharePointFolderUrl>;
  try {
    canonical = parseSharePointFolderUrl(
      sharedFolder.webUrl,
      runtime.tenantDomain,
    );
  } catch {
    throw new AppError("KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND");
  }
  const [site, drive] = await Promise.all([
    client
      .api(`/sites/${encodeURIComponent(sharedFolder.parentReference.siteId)}`)
      .select("id,displayName,webUrl")
      .get()
      .then((value) => siteSchema.parse(value)),
    client
      .api(`/drives/${encodeURIComponent(sharedFolder.parentReference.driveId)}`)
      .select("id,name,webUrl")
      .get()
      .then((value) => driveSchema.parse(value)),
  ]);
  if (
    !siteIdMatchesReference(site.id, sharedFolder.parentReference.siteId) ||
    drive.id !== sharedFolder.parentReference.driveId ||
    !sameTenantSite(site.webUrl, canonical, runtime.tenantDomain) ||
    !sameTenantDrive(drive.webUrl, canonical, runtime.tenantDomain)
  ) {
    throw new AppError("KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND");
  }
  return {
    sourceUrl: canonical.normalizedUrl,
    siteId: site.id,
    siteName: site.displayName,
    driveId: drive.id,
    driveName: drive.name,
    rootItemId: sharedFolder.id,
    folderName: sharedFolder.name,
  };
}

function siteIdMatchesReference(siteId: string, referenceId: string): boolean {
  return siteId === referenceId || siteId.split(",").includes(referenceId);
}

function sameTenantSite(
  rawUrl: string,
  target: ReturnType<typeof parseSharePointFolderUrl>,
  tenantDomain: string,
): boolean {
  try {
    const url = parseAllowedTenantUrl(rawUrl, tenantDomain);
    return samePath(url.pathname, target.sitePath);
  } catch {
    return false;
  }
}

function sameTenantDrive(
  rawUrl: string,
  target: ReturnType<typeof parseSharePointFolderUrl>,
  tenantDomain: string,
): boolean {
  try {
    const url = parseAllowedTenantUrl(rawUrl, tenantDomain);
    return pathPrefix(target.folderPath, decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  return (
    left.replace(/\/+$/u, "").toLocaleLowerCase("en-US") ===
    right.replace(/\/+$/u, "").toLocaleLowerCase("en-US")
  );
}

function pathPrefix(target: string, prefix: string): boolean {
  const normalizedTarget = target
    .replace(/\/+$/u, "")
    .toLocaleLowerCase("en-US");
  const normalizedPrefix = prefix
    .replace(/\/+$/u, "")
    .toLocaleLowerCase("en-US");
  return (
    normalizedTarget === normalizedPrefix ||
    normalizedTarget.startsWith(`${normalizedPrefix}/`)
  );
}

function encodeGraphPath(value: string): string {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function assertGraphCursor(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
  }
  return value;
}
