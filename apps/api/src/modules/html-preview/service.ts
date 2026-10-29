import { randomBytes } from "node:crypto";
import { z } from "zod";
import { htmlPreviewSessionIdSchema, htmlPreviewSourceSchema, type HtmlPreviewSource } from "@linksense/shared";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import { AppError } from "../../lib/errors.js";
import { WebArtifactResources } from "../web-sites/artifact-resources.js";
import { sha256 } from "../web-sites/resources.js";
import { encodeResourcePath } from "../web-sites/service.js";

const sessionSchema = z.strictObject({ ownerId: z.uuid(), conversationId: z.uuid(), fileId: z.uuid(), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/u), expiresAt: z.number().int() });
type Session = z.infer<typeof sessionSchema>;
export interface HtmlPreviewSessionStore {
  save(id: string, value: Session, ttlSeconds: number): Promise<void>;
  get(id: string): Promise<Session | null>;
}
export class RedisHtmlPreviewSessionStore implements HtmlPreviewSessionStore {
  constructor(private readonly redis: Pick<LinkSenseRedis, "client">) {}
  private key(id: string): string { return `html-preview:${sha256(Buffer.from(htmlPreviewSessionIdSchema.parse(id)))}`; }
  async save(id: string, value: Session, ttlSeconds: number): Promise<void> {
    await this.redis.client.set(this.key(id), JSON.stringify(sessionSchema.parse(value)), "EX", ttlSeconds);
  }
  async get(id: string): Promise<Session | null> {
    const value = await this.redis.client.get(this.key(id));
    if (!value) return null;
    try { return sessionSchema.parse(JSON.parse(value)); } catch { return null; }
  }
}

const lifetimeSeconds = 15 * 60;
export class HtmlPreviewService {
  constructor(private readonly resources: WebArtifactResources, private readonly sessions: HtmlPreviewSessionStore, private readonly activeOwner: (ownerId: string) => Promise<boolean>) {}
  async open(ownerId: string, conversationId: string, fileId: string, previousId?: string): Promise<HtmlPreviewSource> {
    if (!await this.activeOwner(ownerId)) throw new AppError("WEB_SITE_NOT_FOUND");
    const previous = previousId ? await this.sessions.get(htmlPreviewSessionIdSchema.parse(previousId)) : null;
    if (previousId && (!previous || previous.ownerId !== ownerId || previous.conversationId !== conversationId || previous.fileId !== fileId || previous.expiresAt <= Date.now())) throw new AppError("WEB_SITE_NOT_FOUND");
    const { manifest } = await this.resources.source(ownerId, conversationId, fileId);
    const manifestDigest = sha256(Buffer.from(JSON.stringify(manifest)));
    if (previous && previous.manifestDigest !== manifestDigest) throw new AppError("WEB_SITE_NOT_FOUND");
    const missing = new Set<string>();
    const document = await this.resources.resource(manifest, manifest.entry_path, missing);
    const id = previousId ?? randomBytes(32).toString("hex");
    const expiresAt = Date.now() + lifetimeSeconds * 1_000;
    await this.sessions.save(id, { ownerId, conversationId, fileId, manifestDigest, expiresAt }, lifetimeSeconds);
    return htmlPreviewSourceSchema.parse({ session_id: id, entry_url: `/html-preview/${id}/${encodeResourcePath(manifest.entry_path)}`, html: document.data.toString("utf8"), expires_at: new Date(expiresAt).toISOString(), missing_resources: [...missing] });
  }
  async resource(id: string, path: string): Promise<{ data: Buffer; mimeType: string }> {
    if (!htmlPreviewSessionIdSchema.safeParse(id).success) throw new AppError("WEB_SITE_NOT_FOUND");
    const session = await this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now() || !await this.activeOwner(session.ownerId)) throw new AppError("WEB_SITE_NOT_FOUND");
    let source: Awaited<ReturnType<WebArtifactResources["source"]>>;
    try { source = await this.resources.source(session.ownerId, session.conversationId, session.fileId); }
    catch (error) { if (error instanceof AppError && error.code === "WEB_SITE_SOURCE_UNAVAILABLE") throw new AppError("WEB_SITE_NOT_FOUND"); throw error; }
    if (sha256(Buffer.from(JSON.stringify(source.manifest))) !== session.manifestDigest) throw new AppError("WEB_SITE_NOT_FOUND");
    return this.resources.resource(source.manifest, path, new Set());
  }
}
