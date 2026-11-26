import { randomUUID } from "node:crypto";

import {
  webSiteTargetSchema,
  type InternalWebSiteToolConfirm,
  type InternalWebSiteToolRequest,
  type LinkedWebSite,
  type Locale,
  type WebSite,
  type WebSiteToolApproval,
  type WebSiteToolConfirmation,
  type WebSiteToolResult,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { translateBackend } from "../../lib/i18n.js";
import { normalizeLocale } from "../../lib/locale.js";
import { webSiteCursorSchema, type WebSiteService } from "./service.js";

type ToolPrisma = Pick<PrismaClient, "user" | "conversation" | "conversationTurn">;
type SiteOperations = Pick<WebSiteService, "list" | "get" | "create" | "update" |
  "publish" | "delete" | "taskSources" | "sourceDetails">;

export class WebSiteToolService {
  constructor(
    private readonly prisma: ToolPrisma,
    private readonly sites: SiteOperations,
    private readonly publicBaseUrl: string,
  ) {}

  async execute(ownerId: string, input: InternalWebSiteToolRequest): Promise<WebSiteToolResult | WebSiteToolApproval> {
    const { conversationId, request } = input;
    const locale = await this.authorizeTurn(ownerId, input);
    switch (request.tool) {
      case "list_sites": {
        const { items, next_cursor } = await this.sites.list(ownerId, {
          limit: request.limit,
          ...(request.search === undefined ? {} : { search: request.search }),
          ...(request.status === undefined ? {} : { status: request.status }),
          ...(request.cursor === undefined ? {} : { cursor: webSiteCursorSchema.parse(request.cursor) }),
        });
        return { tool: request.tool, items: items.map(site => this.linkedSite(site)), next_cursor };
      }
      case "publish_site": {
        if (!request.site) {
          return { tool: request.tool, outcome: "sources", sources: await this.sites.taskSources(ownerId, conversationId) };
        }
        const { items: [existing] } = await this.sites.list(ownerId, { originFileId: request.site.file_id, limit: 1 });
        if (existing) return { tool: request.tool, outcome: "existing", site: this.linkedSite(existing) };
        const source = await this.sites.sourceDetails(ownerId, request.site.file_id);
        const site = {
          ...request.site,
          conversation_id: source.conversationId,
          slug: request.site.slug ?? randomUUID(),
        };
        return this.approval(locale, { tool: request.tool, site }, source);
      }
      case "update_site": {
        if (!("file_id" in request.changes)) {
          const site = await this.sites.update(ownerId, request.site_id, request.changes);
          return { tool: request.tool, site: this.linkedSite(site) };
        }
        const site = await this.sites.get(ownerId, request.site_id);
        const expected = webSiteTargetSchema.parse(site);
        const { file_id } = request.changes;
        if (expected.status === "disabled") {
          // Recheck the status under the write lock even for an unpublished site.
          const updated = await this.sites.publish(ownerId, site.id, file_id, expected);
          return { tool: request.tool, site: this.linkedSite(updated) };
        }
        const source = await this.sites.sourceDetails(ownerId, file_id);
        return this.approval(locale, { tool: request.tool, site_id: site.id, file_id, expected: { ...expected, status: "published" } }, source);
      }
      case "unpublish_site": {
        const site = await this.sites.update(ownerId, request.site_id, { status: "disabled" });
        return { tool: request.tool, site: this.linkedSite(site) };
      }
      case "delete_site": {
        const site = this.linkedSite(await this.sites.get(ownerId, request.site_id));
        return {
          confirmation: { tool: request.tool, site_id: site.id, expected: webSiteTargetSchema.parse(site) },
          message: translateBackend("webSiteTool.confirmDelete", locale, {
            name: markdownText(site.name),
            url: markdownText(site.url),
          }),
          decisionLabel: translateBackend("webSiteTool.deleteDecision", locale),
          approveLabel: translateBackend("webSiteTool.approveDelete", locale),
          rejectLabel: translateBackend("webSiteTool.reject", locale),
        };
      }
    }
  }

  async confirm(ownerId: string, input: InternalWebSiteToolConfirm): Promise<WebSiteToolResult> {
    await this.authorizeTurn(ownerId, input);
    const { confirmation } = input;
    if (confirmation.tool === "delete_site") {
      await this.sites.delete(ownerId, confirmation.site_id, confirmation.expected);
      return { tool: confirmation.tool, site_id: confirmation.site_id };
    }
    if (confirmation.tool === "update_site") {
      const site = await this.sites.publish(ownerId, confirmation.site_id, confirmation.file_id, confirmation.expected);
      return { tool: confirmation.tool, site: this.linkedSite(site) };
    }
    const site = await this.sites.create(ownerId, confirmation.site);
    // A concurrent create can return a site already linked to the approved source.
    const published = site.status === "published" &&
      site.slug === confirmation.site.slug && site.name === confirmation.site.name &&
      site.description === confirmation.site.description &&
      site.source_file_id.toLowerCase() === confirmation.site.file_id.toLowerCase();
    return { tool: confirmation.tool, outcome: published ? "published" : "existing", site: this.linkedSite(site) };
  }

  private async authorizeTurn(ownerId: string, { conversationId, turnId }: { conversationId: string; turnId: string }): Promise<Locale> {
    const [user, conversation, turn] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: ownerId, status: "active" }, select: { preferredLocale: true } }),
      this.prisma.conversation.findFirst({
        where: { id: conversationId, ownerId, archiveStatus: "active", applicationId: null },
        select: { id: true },
      }),
      this.prisma.conversationTurn.findFirst({
        where: { id: turnId, conversationId, submittedBy: ownerId, status: "running", collaborationMode: "default", interruptRequestedAt: null },
        select: { id: true },
      }),
    ]);
    if (!user || !conversation || !turn) throw new AppError("FORBIDDEN");
    return normalizeLocale(user.preferredLocale) ?? "zh-CN";
  }

  private linkedSite(site: WebSite): LinkedWebSite {
    const { url_path, ...details } = site;
    return { ...details, url: new URL(url_path, this.publicBaseUrl).href };
  }

  private approval(
    locale: Locale,
    confirmation: Exclude<WebSiteToolConfirmation, { tool: "delete_site" }>,
    source: { taskTitle: string; filename: string },
  ): WebSiteToolApproval {
    const creating = confirmation.tool === "publish_site";
    const target = creating ? confirmation.site : confirmation.expected;
    const url = new URL(`/web/${target.slug}`, this.publicBaseUrl).href;
    const description = creating ? confirmation.site.description : "";
    return {
      confirmation,
      message: translateBackend(creating ? "webSiteTool.confirmPublish" : "webSiteTool.confirmUpdate", locale, {
        name: markdownText(target.name),
        description: markdownText(description || translateBackend("webSiteTool.emptyDescription", locale)),
        url: markdownText(url),
        task: markdownText(source.taskTitle),
        file: markdownText(source.filename),
      }),
      decisionLabel: translateBackend("webSiteTool.decision", locale),
      approveLabel: translateBackend(creating ? "webSiteTool.approvePublish" : "webSiteTool.approveUpdate", locale),
      rejectLabel: translateBackend("webSiteTool.reject", locale),
    };
  }
}

function markdownText(value: string): string {
  // Keep names and descriptions as plain text inside the existing Markdown form.
  return value.replace(/\p{Bidi_Control}/gu, "").replace(/\s+/gu, " ").replace(/[!-/:-@[-\x60{-~]/gu, "\\$&");
}
