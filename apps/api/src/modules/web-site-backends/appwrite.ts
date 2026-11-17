import { z } from "zod";
import { webSiteFunctionScopes } from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../lib/errors.js";

export type AppwriteConfig = NonNullable<AppConfig["appwrite"]>;
export const appwriteObject = z.record(z.string(), z.unknown());
const credential = z.object({ secret: z.string().min(16) });
type ConsoleSession = { secret: string; organizationId?: string };
const managementScopes = [
  "project.read", "project.write", "databases.read", "databases.write",
  "tables.read", "tables.write", "columns.read", "columns.write", "indexes.read", "indexes.write",
  "buckets.read", "buckets.write", "functions.read", "functions.write",
  "platforms.read", "platforms.write",
  ...webSiteFunctionScopes,
];

export class AppwriteResponseError extends AppError {
  constructor(readonly upstreamStatus: number) {
    super(upstreamStatus === 409 ? "CONFLICT" : "WEB_SITE_BACKEND_UNAVAILABLE");
  }
}

/** REST keeps the version-specific organization API inside this adapter. */
export class AppwriteClient {
  constructor(readonly config: AppwriteConfig, private readonly fetcher: typeof fetch = fetch) {}

  async request(path: string, project: string, key: string | undefined, method = "GET", body?: unknown, session?: ConsoleSession): Promise<Record<string, unknown>> {
    const response = await this.send(path, project, key, method, body, session);
    if (response.status === 204) return {};
    try { return appwriteObject.parse(await response.json()); }
    catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
  }

  private async send(path: string, project: string, key: string | undefined, method: string, body?: unknown, session?: ConsoleSession): Promise<Response> {
    const headers = new Headers({ "x-appwrite-project": project });
    if (key) headers.set("x-appwrite-key", key);
    if (session) headers.set("x-appwrite-session", session.secret);
    if (session?.organizationId) headers.set("x-appwrite-organization", session.organizationId);
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers.set("content-type", "application/json"); payload = JSON.stringify(body); }
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.endpoint}${path}`, {
        method, headers, ...(payload !== undefined ? { body: payload } : {}),
        signal: AbortSignal.timeout(15_000), redirect: "error",
      });
    } catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppwriteResponseError(response.status);
    }
    return response;
  }

  async provision(projectId: string, name: string, origin: string): Promise<string> {
    return this.consoleSession(async (session, organizationId) => {
      const scopedSession = { ...session, organizationId };
      await this.createOrRead("/organization/projects", `/organization/projects/${projectId}`, "console", undefined,
        { projectId, name }, scopedSession);
      const createdKey = await this.createOrRead(`/organization/projects/${projectId}/keys`,
        `/organization/projects/${projectId}/keys/${projectId}`, "console", undefined, {
          keyId: projectId, name: "LinkSense control", scopes: managementScopes, expire: null,
        }, scopedSession);
      const key = credential.parse(createdKey).secret;
      const hostname = new URL(origin).hostname;
      const platform = await this.createOrRead("/project/platforms/web", `/project/platforms/${projectId}`, projectId, key, {
        platformId: projectId, type: "web", name: "LinkSense application", hostname,
      });
      if (z.string().parse(platform.hostname) !== hostname) {
        await this.request(`/projects/${encodeURIComponent(projectId)}/platforms/${encodeURIComponent(projectId)}`,
          "console", undefined, "PUT", { name: "LinkSense application", hostname }, session);
      }
      await this.createOrRead("/tablesdb", "/tablesdb/app", projectId, key, { databaseId: "app", name: "Application" });
      return key;
    });
  }

  /** A project key cannot rename its own web platform, so renames use the console API. */
  async setPlatformHostname(projectId: string, hostname: string): Promise<void> {
    await this.consoleSession(async session => {
      await this.request(`/projects/${encodeURIComponent(projectId)}/platforms/${encodeURIComponent(projectId)}`,
        "console", undefined, "PUT", { name: "LinkSense application", hostname }, session);
    });
  }

  // The self-hosted version has no organization-key issuer. Use a short native
  // console session for console-only changes and revoke it on completion.
  private async consoleSession<T>(run: (session: ConsoleSession, organizationId: string) => Promise<T>): Promise<T> {
    const login = await this.send("/account/sessions/email", "console", undefined, "POST", {
      email: this.config.adminEmail, password: this.config.adminPassword, duration: 300,
    });
    const cookie = login.headers.getSetCookie().find(value => value.startsWith("a_session_console="));
    await login.body?.cancel();
    const session: ConsoleSession = credential.parse({ secret: cookie?.split(";", 1)[0]?.slice("a_session_console=".length) });
    try {
      let organizationId = this.config.organizationId;
      if (organizationId) await this.request(`/teams/${encodeURIComponent(organizationId)}`, "console", undefined, "GET", undefined, session);
      else {
        const teams = z.object({ total: z.number(), teams: z.array(z.object({ $id: z.string() })) })
          .parse(await this.request("/teams", "console", undefined, "GET", undefined, session));
        organizationId = teams.total === 1 ? teams.teams[0]?.$id : undefined;
      }
      if (!organizationId) throw new AppError("WEB_SITE_BACKEND_NOT_CONFIGURED");
      return await run(session, organizationId);
    } finally {
      await this.request("/account/sessions/current", "console", undefined, "DELETE", undefined, session)
        .catch(() => { /* The native session expires after five minutes if cleanup is unavailable. */ });
    }
  }

  async createOrRead(path: string, existingPath: string, project: string, key: string | undefined, body: unknown, session?: ConsoleSession): Promise<Record<string, unknown>> {
    try { return await this.request(path, project, key, "POST", body, session); }
    catch (error) {
      if (!(error instanceof AppwriteResponseError) || error.upstreamStatus !== 409) throw error;
      return this.request(existingPath, project, key, "GET", undefined, session);
    }
  }

  async forward(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${this.config.endpoint}${path}`, {
        ...init, redirect: "error", signal: AbortSignal.timeout(35_000),
      });
    } catch { throw new AppError("WEB_SITE_BACKEND_UNAVAILABLE"); }
  }
}
