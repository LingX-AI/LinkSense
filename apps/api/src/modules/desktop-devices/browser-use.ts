import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  browserUseFailure, browserUseReadOnly, browserUseResultSchema,
  desktopBrowserScreenshotMaxBytes, desktopBrowserScreenshotParamsSchema, desktopBrowserScreenshotPath,
  desktopRunTokenSchema, type BrowserUseRequest, type DesktopBrowserUseResult,
} from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import type { BrowserUseService } from "../browser-use/service.js";
import type { BrowserStore } from "../browser-use/store.js";
import { desktopRunScopeSchema, type DesktopRunLeases, type DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { WebSiteService } from "../web-sites/service.js";

const screenshotTtlMs = 15_000;
const screenshotSchema = z.strictObject({
  id: z.uuid(),
  scope: desktopRunScopeSchema,
  browserConnectionId: z.uuid(),
  image: z.base64().max(Math.ceil(desktopBrowserScreenshotMaxBytes / 3) * 4),
});
const screenshotKey = (scope: DesktopRunScope) =>
  `linksense:desktop-browser-screenshot:${scope.turnId}:${scope.connectionId}`;
type BrowserAuthorityStore = {
  [Delegate in "conversationTurn" | "conversationTurnStartIntent" | "applicationExternalSession"]:
    Pick<PrismaClient[Delegate], "findFirst">;
};

export class DesktopBrowserUse {
  constructor(
    private readonly prisma: BrowserAuthorityStore,
    private readonly browser: Pick<BrowserUseService, "execute" | "status">,
    private readonly screenshots: Pick<BrowserStore, "get" | "put" | "takeIf">,
    private readonly config: Pick<AppConfig, "credentialMasterKey" | "credentialKeyId">,
    private readonly webSites?: Pick<WebSiteService, "publishedSlugForOwner">,
  ) {}

  async execute(
    scope: DesktopRunScope, request: BrowserUseRequest, signal: AbortSignal, checkRun: () => Promise<void>,
  ): Promise<{ data: DesktopBrowserUseResult; assertCurrent?: () => Promise<void> }> {
    const { ownerId, conversationId, turnId, runtimeGeneration } = scope;
    const external = await this.prisma.applicationExternalSession.findFirst({
      where: { conversationId }, select: { id: true },
    });
    const requireDefault = !browserUseReadOnly(request);
    const assertAuthority = async () => {
      if (requireDefault) {
        const turn = await this.prisma.conversationTurn.findFirst({
          where: { id: turnId, conversationId, submittedBy: ownerId, status: "running" },
          select: { collaborationMode: true },
        });
        const start = turn ? null : await this.prisma.conversationTurnStartIntent.findFirst({
          where: { projectionTurnId: turnId, ownerId, conversationId, runtimeGeneration, runnerStatus: { in: ["prepared", "runner_succeeded"] } },
          select: { collaborationMode: true },
        });
        if ((turn ?? start)?.collaborationMode !== "default") throw new AppError("FORBIDDEN");
      }
      await checkRun();
    };
    if (external) throw new AppError("FORBIDDEN");
    const status = await this.browser.status(ownerId);
    await assertAuthority();
    const connectionId = status.connection_id;
    const assertCurrent = async () => {
      if ((await this.browser.status(ownerId)).connection_id !== connectionId) throw new AppError("FORBIDDEN");
      await checkRun();
      signal.throwIfAborted();
    };
    if (request.action === "status") return { data: { result: { ok: true, browser: "local", data: status } }, assertCurrent };
    if (!connectionId) return { data: { result: browserUseFailure("BROWSER_USE_NOT_CONNECTED") } };
    let command: Parameters<BrowserUseService["execute"]>[2];
    if (request.action === "open_site") {
      if (!this.webSites) return { data: { result: browserUseFailure("BROWSER_USE_ACCESS_DENIED") } };
      command = { action: "open_site_window", slug: await this.webSites.publishedSlugForOwner(ownerId, request.site_id) };
    } else command = request;
    const result = browserUseResultSchema.parse(await this.browser.execute(ownerId, conversationId, command, signal, {
      connectionId, scope, checkRun: assertAuthority,
    }));
    if (!result.ok) return { data: { result } };
    const { image, ...metadata } = result.data;
    if (!image && request.action !== "screenshot") return { data: { result: { ...result, data: metadata } }, assertCurrent };
    if (!image || request.action !== "screenshot" || metadata.mime_type !== "image/jpeg" || !metadata.viewport ||
        metadata.tab_id !== request.tab_id || !screenshotSchema.shape.image.safeParse(image).success ||
        detectSafeRasterImage(Buffer.from(image, "base64")) !== "image/jpeg")
      return { data: { result: browserUseFailure("BROWSER_USE_COMMAND_FAILED") } };
    await assertCurrent();
    const screenshotId = randomUUID();
    const stored = screenshotSchema.parse({ id: screenshotId, scope, browserConnectionId: connectionId, image });
    const key = screenshotKey(scope);
    const { credentialMasterKey, credentialKeyId } = this.config;
    // At most one pending image per live run, even if the caller never fetches it.
    if (!await this.screenshots.put(key, encryptJson(stored, credentialMasterKey, credentialKeyId, key), screenshotTtlMs))
      throw new AppError("RUNNER_UNAVAILABLE");
    return { data: { result: { ...result, data: metadata }, screenshot_id: screenshotId }, assertCurrent };
  }

  async takeScreenshot(scope: DesktopRunScope, screenshotId: string, checkRun: () => Promise<void>): Promise<Buffer> {
    const key = screenshotKey(scope);
    const raw = await this.screenshots.get(key);
    if (!raw) throw new AppError("NOT_FOUND");
    const { credentialMasterKey, credentialKeyId } = this.config;
    const stored = screenshotSchema.parse(decryptJson<unknown>(raw, credentialMasterKey, credentialKeyId, key));
    if (stored.id !== screenshotId || JSON.stringify(desktopRunScopeSchema.parse(scope)) !== JSON.stringify(stored.scope))
      throw new AppError("NOT_FOUND");
    if (!await this.screenshots.takeIf(key, key, raw))
      throw new AppError("NOT_FOUND");
    if ((await this.browser.status(scope.ownerId)).connection_id !== stored.browserConnectionId)
      throw new AppError("NOT_FOUND");
    await checkRun();
    return Buffer.from(stored.image, "base64");
  }
}

export function registerDesktopBrowserScreenshotRoute(
  app: FastifyInstance, browser: DesktopBrowserUse, leases: Pick<DesktopRunLeases, "authorizeToolResult" | "verifyRunBinding">,
): void {
  app.get(`${desktopBrowserScreenshotPath}/:turnId/:screenshotId`, { exposeHeadRoute: false }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    z.strictObject({}).parse(request.query);
    const { turnId, screenshotId } = desktopBrowserScreenshotParamsSchema.parse(request.params);
    const token = desktopRunTokenSchema.safeParse(request.headers.authorization?.replace(/^Bearer /u, ""));
    if (!token.success) throw new AppError("AUTH_REQUIRED");
    const scope = await leases.authorizeToolResult(turnId, token.data);
    const image = await browser.takeScreenshot(scope, screenshotId, () => leases.verifyRunBinding(scope, token.data, "use"));
    return reply.header("x-content-type-options", "nosniff").type("image/jpeg").send(image);
  });
}
