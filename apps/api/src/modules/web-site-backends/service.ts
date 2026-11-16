import { z } from "zod";
import { getDomain } from "tldts";
import { webSiteBackendSchema, type WebSiteBackend, type WebSiteBackendChange } from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { WebSiteBackend as BackendRow } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { readResource, sha256 } from "../web-sites/resources.js";
import { AppwriteClient } from "./appwrite.js";
import type { WebSiteBackendStore } from "./repository.js";

const secretSchema = z.object({ key: z.string().min(16) });
const permissions = (publicRead: boolean, clientCreate = true) => [...(clientCreate ? ['create("users")'] : []), ...(publicRead ? ['read("any")'] : [])];
const privateResourceFields = new Set(["vars", "varsProject", "variables", "secret", "password", "apiKey", "encryptedCredential", "buildLogs", "logs", "errors"]);
function publicResource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResource);
  if (value === null || typeof value !== "object") return value;
  const object = z.record(z.string(), z.unknown()).parse(value);
  return Object.fromEntries(Object.entries(object).filter(([key]) => !privateResourceFields.has(key)).map(([key, item]) => [key, publicResource(item)]));
}

export class WebSiteBackendService {
  readonly client: AppwriteClient | undefined;
  constructor(
    readonly store: WebSiteBackendStore,
    private readonly storage: ObjectStorage,
    private readonly config: Pick<AppConfig, "appwrite" | "credentialMasterKey" | "credentialKeyId" | "publicBaseUrl">,
    fetcher: typeof fetch = fetch,
  ) {
    if (config.appwrite) {
      const appHost = new URL(config.appwrite.appsBaseUrl).hostname;
      const consoleHost = new URL(config.publicBaseUrl).hostname;
      if (appHost === consoleHost || consoleHost.endsWith(`.${appHost}`)) throw new Error("Dynamic applications require a separate host namespace");
      const appDomain = getDomain(appHost, { allowPrivateDomains: true });
      const trustedHosts = [consoleHost, new URL(config.appwrite.endpoint).hostname];
      if (appDomain && trustedHosts.some(host => getDomain(host, { allowPrivateDomains: true }) === appDomain)) {
        throw new Error("Dynamic applications and trusted services require separate registrable domains");
      }
      this.client = new AppwriteClient(config.appwrite, fetcher);
    }
  }

  origin(id: string): string {
    const url = new URL(this.requiredClient().config.appsBaseUrl);
    url.hostname = `${z.uuid().parse(id)}.${url.hostname}`;
    return url.origin;
  }

  matchHost(host: string): string | undefined {
    if (!this.client) return undefined;
    const base = new URL(this.client.config.appsBaseUrl);
    try {
      const candidate = new URL(`${base.protocol}//${host}`);
      if (candidate.username || candidate.password || candidate.port !== base.port) return undefined;
      const hostname = candidate.hostname.toLowerCase().replace(/\.$/u, "");
      if (!hostname.endsWith(`.${base.hostname}`)) return undefined;
      return z.uuid().safeParse(hostname.slice(0, -(base.hostname.length + 1))).data;
    } catch { return undefined; }
  }

  isAppHost(host: string): boolean {
    if (!this.client) return false;
    const base = new URL(this.client.config.appsBaseUrl).hostname;
    try {
      const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/u, "");
      return hostname === base || hostname.endsWith(`.${base}`);
    } catch { return false; }
  }

  async prepare(ownerId: string, conversationId: string, name: string, id?: string): Promise<WebSiteBackend> {
    const client = this.requiredClient();
    const row = id ? await this.store.owned(ownerId, id) : await this.store.reserve(ownerId, conversationId, name);
    if (row.status === "ready" && row.encryptedCredential) return this.project(row);
    const lease = new Date(Date.now() + 180_000);
    await this.store.acquire(ownerId, row.id, lease);
    try {
      const key = await client.provision(row.projectId, row.name, this.origin(row.id));
      const encrypted = encryptJson({ key }, this.config.credentialMasterKey, this.config.credentialKeyId, `web-site-backend:${row.id}`);
      await this.store.finish(row.id, lease, "ready", encrypted);
      return this.project({ ...row, status: "ready" });
    } catch (error) {
      await this.store.finish(row.id, lease, "failed");
      throw error;
    }
  }

  async inspect(ownerId: string, id: string): Promise<WebSiteBackend> {
    return this.project(await this.store.owned(ownerId, id));
  }

  async withPublishable<T>(ownerId: string, id: string, publish: (lease: Date) => Promise<T>): Promise<T> {
    const row = await this.store.owned(ownerId, id);
    if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) throw new AppError("WEB_SITE_BACKEND_PENDING");
    const lease = new Date(Date.now() + 60_000);
    await this.store.acquire(ownerId, id, lease);
    try {
      await this.assertPublishable(ownerId, id, lease);
      return await publish(lease);
    } finally { await this.store.finish(id, lease); }
  }

  async assertPublishable(ownerId: string, id: string, lease?: Date): Promise<void> {
    const row = await this.store.owned(ownerId, id);
    if (lease
      ? row.leaseUntil?.getTime() !== lease.getTime() || lease.getTime() <= Date.now()
      : row.leaseUntil && row.leaseUntil.getTime() > Date.now()) throw new AppError("WEB_SITE_BACKEND_PENDING");
    const key = this.key(row);
    const query = new URLSearchParams({ "queries[]": JSON.stringify({ method: "limit", values: [100] }) });
    const functions = z.object({ total: z.number(), functions: z.array(z.object({
      deploymentId: z.string(), latestDeploymentId: z.string(), latestDeploymentStatus: z.string(),
    })) }).parse(await this.requiredClient().request(`/functions?${query}`, row.projectId, key));
    if (functions.total > 100) throw new AppError("FILE_LIMIT_EXCEEDED");
    for (const fn of functions.functions) {
      if (!fn.deploymentId) throw new AppError("WEB_SITE_BACKEND_PENDING");
    }
    const tables = z.object({ total: z.number(), tables: z.array(z.object({
      columns: z.array(z.object({ status: z.string() })), indexes: z.array(z.object({ status: z.string() })),
    })) }).parse(await this.requiredClient().request(`/tablesdb/app/tables?${query}`, row.projectId, key));
    if (tables.total > 100) throw new AppError("FILE_LIMIT_EXCEEDED");
    if (tables.tables.some(table => [...table.columns, ...table.indexes].some(item => item.status !== "available"))) throw new AppError("WEB_SITE_BACKEND_PENDING");
  }

  async configure(ownerId: string, id: string, change: WebSiteBackendChange): Promise<Record<string, unknown>> {
    const row = await this.store.owned(ownerId, id);
    const client = this.requiredClient();
    const key = this.key(row);
    const request = async (path: string, method = "GET", body?: unknown) =>
      z.record(z.string(), z.unknown()).parse(publicResource(await client.request(path, row.projectId, key, method, body)));
    const lease = new Date(Date.now() + 60_000);
    await this.store.acquire(ownerId, row.id, lease);
    try {
      switch (change.action) {
        case "inspect": return await request(change.path);
        case "create_table": return await request("/tablesdb/app/tables", "POST", {
          tableId: change.id, name: change.name, rowSecurity: true, permissions: permissions(change.public_read, change.client_create),
          columns: change.columns,
          indexes: change.indexes.map(index => ({ key: index.key, type: index.type, attributes: index.columns })),
        });
        case "add_column": return await request(`/tablesdb/app/tables/${change.table_id}/columns/${change.column.type === "double" ? "float" : change.column.type}`, "POST", change.column);
        case "create_bucket": return await request("/storage/buckets", "POST", {
          bucketId: change.id, name: change.name, permissions: permissions(change.public_read), fileSecurity: true,
          maximumFileSize: change.maximum_file_size, allowedFileExtensions: change.extensions,
          encryption: true, antivirus: true,
        });
        case "create_function": return await request("/functions", "POST", {
          functionId: change.id, name: change.name, runtime: "node-24", entrypoint: change.entrypoint,
          execute: [change.public_execute ? "any" : "users"], scopes: change.scopes, timeout: change.timeout,
          events: [], schedule: "", commands: "", logging: false,
        });
        case "deploy_function": {
          const file = await this.store.source(ownerId, change.file_id);
          const data = await readResource(await this.storage.getObjectStream(file.objectKey), file.size);
          if (file.checksum && sha256(data) !== file.checksum) throw new AppError("WEB_SITE_BUNDLE_INVALID");
          const form = new FormData();
          form.set("code", new Blob([new Uint8Array(data)], { type: "application/gzip" }), "code.tar.gz");
          form.set("activate", "false");
          form.set("commands", "");
          return await request(`/functions/${change.function_id}/deployments`, "POST", form);
        }
        case "activate_function": {
          const deployment = await request(`/functions/${change.function_id}/deployments/${change.deployment_id}`);
          if (deployment.status !== "ready") throw new AppError("WEB_SITE_BACKEND_PENDING");
          return await request(`/functions/${change.function_id}/deployment`, "PATCH", { deploymentId: change.deployment_id });
        }
      }
    } finally { await this.store.finish(row.id, lease); }
  }

  key(row: BackendRow): string {
    if (row.status !== "ready" || !row.encryptedCredential) throw new AppError("WEB_SITE_BACKEND_PENDING");
    try {
      return secretSchema.parse(decryptJson<unknown>(row.encryptedCredential, this.config.credentialMasterKey, this.config.credentialKeyId, `web-site-backend:${row.id}`)).key;
    } catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
  }

  private project(row: BackendRow): WebSiteBackend {
    const origin = this.origin(row.id);
    return webSiteBackendSchema.parse({
      id: row.id, name: row.name, project_id: row.projectId, status: row.status,
      origin, endpoint: `${origin}/appwrite/v1`, database_id: "app",
    });
  }

  requiredClient(): AppwriteClient {
    if (!this.client) throw new AppError("WEB_SITE_BACKEND_NOT_CONFIGURED");
    return this.client;
  }
}
