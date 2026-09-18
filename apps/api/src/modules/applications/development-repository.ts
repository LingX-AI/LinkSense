import { applicationTestInspectionSchema, applicationTestSessionsSchema, type ApplicationTestSessions, type ApplicationTestSessionsQuery, type InteractiveApplicationManifest, type InteractiveDependencyBinding, type InteractiveDependencyState } from "@linksense/shared";
import { Prisma, type PrismaClient, type ApplicationDevelopment, type Conversation } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { deleteApplicationDevelopment } from "./development-deletion.js";
import { developmentTestActivity } from "./development-test-activity.js";
import { resolveInteractiveDependencies } from "./interactive-dependencies.js";

export class ApplicationDevelopmentRepository {
  constructor(private readonly db: PrismaClient) {}

  resolveDependencies(ownerId: string, manifest: InteractiveApplicationManifest, previous: unknown = [], selections: InteractiveDependencyBinding[] = []): Promise<InteractiveDependencyState> {
    return resolveInteractiveDependencies(this.db, ownerId, manifest, previous, selections);
  }

  async actor(ownerId: string) {
    const actor = await this.db.user.findFirst({ where: { id: ownerId, status: "active" } });
    if (!actor) throw new AppError("FORBIDDEN");
    return actor;
  }

  async conversation(ownerId: string, id: string) {
    const row = await this.db.conversation.findFirst({ where: { id, ownerId, applicationId: null } });
    if (!row) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND");
    return row;
  }

  async owned(ownerId: string, id: string): Promise<ApplicationDevelopment> {
    const row = await this.db.applicationDevelopment.findFirst({ where: { id, ownerId } });
    if (!row) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND");
    return row;
  }

  byConversation(ownerId: string, conversationId: string) {
    return this.db.applicationDevelopment.findFirst({ where: { ownerId, conversationId } });
  }

  byApplication(ownerId: string, applicationId: string) {
    return this.db.applicationDevelopment.findFirst({ where: { ownerId, applicationId } });
  }

  async create(input: { id: string; ownerId: string; conversationId: string; name: string; directory: string; applicationId?: string }) {
    return this.db.$transaction(async tx => {
      const [parent] = await tx.$queryRaw<Array<{ workspaceRelPath: string; projectId: string | null }>>(Prisma.sql`
        SELECT workspace_rel_path AS "workspaceRelPath", project_id AS "projectId" FROM conversations
        WHERE id = ${input.conversationId}::uuid AND owner_id = ${input.ownerId}::uuid AND application_id IS NULL FOR SHARE
      `);
      if (!parent) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND");
      return tx.applicationDevelopment.upsert({ where: { conversationId: input.conversationId }, create: { ...input, ...parent }, update: {} });
    });
  }

  async deleteDraft(ownerId: string, developmentId: string): Promise<void> {
    await this.db.$transaction(tx => deleteApplicationDevelopment(tx, ownerId, { developmentId }, {}), { timeout: 30_000 });
  }

  async update(row: ApplicationDevelopment, data: Prisma.ApplicationDevelopmentUpdateManyMutationInput, tx: Prisma.TransactionClient = this.db): Promise<void> {
    const result = await tx.applicationDevelopment.updateMany({
      where: { id: row.id, ownerId: row.ownerId, revision: row.revision, installedVersion: row.installedVersion, previewApplicationId: row.previewApplicationId }, data,
    });
    if (result.count !== 1) throw new AppError("CONFLICT");
  }

  async sourceApplication(ownerId: string, id: string) {
    const application = await this.db.application.findFirst({ where: { id, ownerId, kind: "interactive", developmentOnly: false, status: { in: ["active", "disabled"] } } });
    if (!application?.interactivePackageId) throw new AppError("APPLICATION_NOT_FOUND");
    const assets = await this.db.interactiveApplicationAsset.findMany({ where: { packageId: application.interactivePackageId } });
    return { application, assets };
  }

  async activateInstalledApplication(ownerId: string, id: string, tx: Prisma.TransactionClient = this.db): Promise<void> {
    const result = await tx.application.updateMany({
      where: { id, ownerId, kind: "interactive", developmentOnly: false, status: { in: ["active", "disabled"] } },
      data: { status: "active" },
    });
    if (result.count !== 1) throw new AppError("APPLICATION_NOT_FOUND");
  }

  async previewApplication(row: ApplicationDevelopment) {
    if (!row.previewApplicationId) return null;
    return this.db.application.findFirst({ where: { id: row.previewApplicationId, ownerId: row.ownerId, developmentOnly: true, status: "active" } });
  }

  async previewState(row: ApplicationDevelopment) {
    const application = await this.previewApplication(row);
    const package_ = application?.interactivePackageId
      ? await this.db.interactiveApplicationPackage.findFirst({ where: { id: application.interactivePackageId, applicationId: application.id } }) : null;
    const conversation = row.previewConversationId
      ? await this.db.conversation.findFirst({ where: { id: row.previewConversationId, ownerId: row.ownerId, applicationId: row.previewApplicationId } }) : null;
    return { application, package_, conversation };
  }

  async isRunning(conversationId: string): Promise<boolean> {
    const [turns, intents, pending] = await Promise.all([
      this.db.conversationTurn.count({ where: { conversationId, status: "running" } }),
      this.db.conversationTurnStartIntent.count({ where: { conversationId } }),
      this.db.pendingRequest.count({ where: { conversationId } }),
    ]);
    return turns > 0 || intents > 0 || pending > 0;
  }

  async testSessions(row: ApplicationDevelopment, query: ApplicationTestSessionsQuery): Promise<ApplicationTestSessions> {
    if (!row.previewApplicationId) return { items: [], next_cursor: null };
    const where = { ownerId: row.ownerId, applicationId: row.previewApplicationId };
    const cursor = query.cursor ? await this.db.conversation.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } }) : null;
    if (query.cursor && !cursor) throw new AppError("VALIDATION_ERROR");
    // Filter before pagination, including empty sessions produced by earlier versions.
    const rows = await this.db.$queryRaw<Array<Pick<Conversation, "id" | "interactiveApplicationPackageId" | "lastTurnStatus" | "createdAt" | "lastRunAt">>>(Prisma.sql`
      SELECT c.id, c.interactive_application_package_id AS "interactiveApplicationPackageId",
        c.last_turn_status AS "lastTurnStatus", c.created_at AS "createdAt", c.last_run_at AS "lastRunAt"
      FROM conversations c
      WHERE c.owner_id = ${row.ownerId}::uuid AND c.application_id = ${row.previewApplicationId}::uuid
        AND ${developmentTestActivity(Prisma.sql`c.id`)}
        ${cursor ? Prisma.sql`AND (c.created_at, c.id) < (SELECT created_at, id FROM conversations WHERE id = ${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${query.limit + 1}
    `);
    const visible = rows.slice(0, query.limit), ids = visible.map(item => item.id);
    const [packages, turns, intents, pending] = await Promise.all([
      this.db.interactiveApplicationPackage.findMany({ where: { applicationId: row.previewApplicationId, id: { in: visible.flatMap(item => item.interactiveApplicationPackageId ? [item.interactiveApplicationPackageId] : []) } }, select: { id: true, version: true } }),
      this.db.conversationTurn.groupBy({ by: ["conversationId", "status"], where: { conversationId: { in: ids } }, _count: { _all: true } }),
      this.db.conversationTurnStartIntent.findMany({ where: { conversationId: { in: ids } }, select: { conversationId: true } }),
      this.db.pendingRequest.findMany({ where: { conversationId: { in: ids } }, select: { conversationId: true } }),
    ]);
    const versions = new Map(packages.map(item => [item.id, item.version]));
    const busy = new Set([...intents, ...pending].map(item => item.conversationId));
    const counts = new Map<string, number>();
    for (const turn of turns) { counts.set(turn.conversationId, (counts.get(turn.conversationId) ?? 0) + turn._count._all); if (turn.status === "running") busy.add(turn.conversationId); }
    return applicationTestSessionsSchema.parse({ items: visible.map(item => ({
      id: item.id, current: item.id === row.previewConversationId,
      version: item.interactiveApplicationPackageId ? versions.get(item.interactiveApplicationPackageId) ?? null : null,
      status: busy.has(item.id) ? "running" : item.lastTurnStatus ?? "idle", busy: busy.has(item.id),
      turn_count: counts.get(item.id) ?? 0, created_at: item.createdAt.toISOString(), last_run_at: item.lastRunAt?.toISOString() ?? null,
    })), next_cursor: rows.length > query.limit ? visible.at(-1)?.id ?? null : null });
  }

  async inspectTest(row: ApplicationDevelopment, id: string) {
    await this.assertTestSession(row, id);
    const messages = await this.db.conversationMessage.findMany({ where: { conversationId: id, role: { in: ["user", "assistant"] } }, orderBy: { sequenceNo: "desc" }, take: 41, select: { role: true, contentText: true } });
    const visible = messages.slice(0, 40).reverse();
    return applicationTestInspectionSchema.shape.detail.unwrap().parse({ conversation_id: id,
      messages: visible.map(item => ({ role: item.role, content: item.contentText.slice(0, 8000) })),
      truncated: messages.length > 40 || visible.some(item => item.contentText.length > 8000),
    });
  }

  async assertTestSession(row: ApplicationDevelopment, conversationId: string): Promise<void> {
    if (!row.previewApplicationId || !await this.db.conversation.findFirst({ where: { id: conversationId, ownerId: row.ownerId, applicationId: row.previewApplicationId }, select: { id: true } })) throw new AppError("CONVERSATION_NOT_FOUND");
  }

  async assertActiveTurn(ownerId: string, conversationId: string, turnId: string): Promise<void> {
    const conversation = await this.conversation(ownerId, conversationId);
    if (conversation.collaborationMode !== "default" || !await this.db.conversationTurn.count({ where: { id: turnId, conversationId, status: "running" } })) throw new AppError("FORBIDDEN");
  }

  async diagnostics(ownerId: string, id: string, revision: number, value: Prisma.InputJsonValue): Promise<void> {
    await this.owned(ownerId, id);
    const result = await this.db.applicationDevelopment.updateMany({ where: { id, ownerId, revision }, data: { diagnosticsJson: value } });
    if (result.count !== 1) throw new AppError("CONFLICT");
  }
}

export type ApplicationDevelopmentStore = Pick<ApplicationDevelopmentRepository, keyof ApplicationDevelopmentRepository>;
