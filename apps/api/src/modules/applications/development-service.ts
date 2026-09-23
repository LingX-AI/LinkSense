import { randomUUID } from "node:crypto";
import { chmod, lstat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_APPLICATION_ICON_PRESET,
  isLocale,
  supportedLocales,
  applicationDevelopmentSchema, applicationDevelopmentDiagnosticSchema, applicationDevelopmentOpenSchema,
  applicationBuilderDevelopmentSchema, userWorkspacePathSchema,
  interactiveApplicationManifestSchema, workspacePermissionPolicy,
  sanitizeApplicationDevelopmentDiagnostic,
  applicationDevelopmentCapabilitiesSchema, applicationDevelopmentCapabilitiesUpdateSchema,
  applicationDevelopmentMetadataUpdateSchema, type ApplicationDevelopmentMetadataUpdate,
  interactiveDependencyDeclarations, interactiveDependencyBindingsSchema,
  type ApplicationDevelopmentCapabilities, type ApplicationDevelopmentCapabilitiesUpdate, type InteractiveDependencyBinding, type InteractiveDependencyType,
  type ApplicationDevelopment, type ApplicationDevelopmentOpen, type ApplicationBuilderRequest,
  type ApplicationVersionInput,
  type ApplicationDevelopmentDiagnostic, type Locale, type ApplicationTestInspection, type ApplicationTestSessionsQuery, type ApplicationTestRestart,
} from "@linksense/shared";
import type { ApplicationDevelopment as DevelopmentRow, Conversation, Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { truncateConversationTitle } from "../../lib/conversation-title.js";
import { translateBackend } from "../../lib/i18n.js";
import { ensureSharedWorkspaceDirectory } from "../../lib/shared-workspace-directory.js";
import { projectWorkspaceRelativePath, resolveConversationWorkspaceRoot, userWorkspacePath } from "../../lib/user-runtime-paths.js";
import type { RequestActor } from "../capabilities/types.js";
import type { ConversationService } from "../conversations/service.js";
import type { ApplicationService, InteractiveApplicationAssetStore } from "./service.js";
import type { ApplicationDevelopmentStore } from "./development-repository.js";
import { readApplicationSource, type ApplicationSourceSnapshot } from "./development-source.js";
import { withApplicationSourceLock, writeApplicationDependencies, writeApplicationMetadata } from "./development-source-write.js";
import { dependencyBindings } from "./interactive-dependencies.js";
import { applicationDevelopmentTemplate } from "./development-template.js";
import { readVerifiedInteractiveAsset } from "./interactive-asset-integrity.js";
import { readWorkspaceApplicationIcon } from "./icon-input.js";

export interface ApplicationDevelopmentServiceOptions {
  store: ApplicationDevelopmentStore;
  applications: Pick<ApplicationService, "get" | "importInteractive" | "updateInteractivePackage" | "interactiveDependencies" | "resolvePreviewRuntime" | "projectIcon">;
  conversations: Pick<ConversationService, "create" | "createDevelopmentConversation" | "createDevelopmentPreview" | "patch" | "delete">;
  assets: Pick<InteractiveApplicationAssetStore, "get">;
  workspaceRoot: string;
}

export class ApplicationDevelopmentService {
  constructor(private readonly options: ApplicationDevelopmentServiceOptions) {}

  async create(actor: RequestActor, input: ApplicationDevelopmentOpen, locale: Locale): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const data = applicationDevelopmentOpenSchema.parse(input);
    const project = await this.options.store.ensureProject(actor.id);
    const conversation = await this.options.conversations.create(actor.id, { collaborationMode: "default", fallbackLocale: locale, projectId: project.id });
    return this.open(actor, conversation.id, data, locale);
  }

  async open(actor: RequestActor, conversationId: string, input: ApplicationDevelopmentOpen, locale: Locale): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    return withApplicationSourceLock(join(this.options.workspaceRoot, actor.id, "home"), `development-task-${conversationId}`,
      () => this.openLocked(actor, conversationId, input, locale));
  }

  private async openLocked(actor: RequestActor, conversationId: string, input: ApplicationDevelopmentOpen, locale: Locale): Promise<ApplicationDevelopment> {
    const data = applicationDevelopmentOpenSchema.parse(input);
    const conversation = await this.options.store.conversation(actor.id, conversationId);
    if (conversation.collaborationMode !== "default") throw new AppError("FORBIDDEN");
    const existing = await this.options.store.byConversation(actor.id, conversationId);
    if (existing) {
      await this.syncConversationTitle(actor, existing, locale);
      return this.get(actor, existing.id);
    }
    const project = await this.options.store.ensureProject(actor.id);
    const id = randomUUID();
    const workspaceRelPath = projectWorkspaceRelativePath(actor.id, project.id);
    const sameWorkspace = workspaceRelPath === conversation.workspaceRelPath;
    const directory = sameWorkspace && data.directory ? data.directory : `applications/${id}`;
    const workspace = resolveConversationWorkspaceRoot(this.options.workspaceRoot, actor.id, workspaceRelPath);
    // The user's home already exists for the current task. Do not follow a project symlink.
    await ensureSharedWorkspaceDirectory(join(this.options.workspaceRoot, actor.id, "home"), workspace);
    const root = join(workspace, directory);
    if (!data.directory) {
      await ensureSharedWorkspaceDirectory(workspace, root);
      await this.writeSources(workspace, directory, applicationDevelopmentTemplate(data.name, id, locale));
    } else if (sameWorkspace) {
      await readApplicationSource(workspace, directory);
    } else {
      const sourceWorkspace = resolveConversationWorkspaceRoot(this.options.workspaceRoot, actor.id, conversation.workspaceRelPath);
      const source = await readApplicationSource(sourceWorkspace, data.directory);
      await ensureSharedWorkspaceDirectory(workspace, root);
      await this.writeSources(workspace, directory, Object.fromEntries(source.files));
    }
    const row = await this.options.store.create({ id, ownerId: actor.id, conversationId, name: data.name, directory, projectId: project.id });
    return this.sync(actor, row.id, locale);
  }

  async resume(actor: RequestActor, applicationId: string, locale: Locale): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const { application, assets } = await this.options.store.sourceApplication(actor.id, applicationId);
    const existing = await this.options.store.byApplication(actor.id, applicationId);
    if (existing) return this.reopen(actor, existing.id, locale);
    const project = await this.options.store.ensureProject(actor.id);
    const conversation = await this.options.conversations.create(actor.id, { collaborationMode: "default", fallbackLocale: locale, projectId: project.id });
    const sourceConversation = await this.options.store.conversation(actor.id, conversation.id);
    const workspace = resolveConversationWorkspaceRoot(this.options.workspaceRoot, actor.id, sourceConversation.workspaceRelPath);
    const id = randomUUID();
    const directory = `applications/${id}`;
    const files: Record<string, Buffer> = {};
    for (const asset of assets) files[asset.path] = await readVerifiedInteractiveAsset(this.options.assets, asset);
    await ensureSharedWorkspaceDirectory(workspace, join(workspace, directory));
    await this.writeSources(workspace, directory, files);
    const row = await this.options.store.create({ id, ownerId: actor.id, conversationId: conversation.id, name: application.name, directory, applicationId, projectId: project.id });
    // Imported packages may refer to another installation's IDs. Retain the owner's mappings.
    return withApplicationSourceLock(this.workspace(row), row.directory, () => this.syncSource(actor, row.id, {
      locale, initializePublishedSource: true,
      initialDependencyBindings: interactiveDependencyBindingsSchema.parse(application.interactiveDependencyBindings),
    }));
  }

  async byConversation(actor: RequestActor, conversationId: string): Promise<ApplicationDevelopment | null> {
    this.assertActor(actor);
    // Regular application tasks have no development project.
    const row = await this.options.store.byConversation(actor.id, conversationId);
    return row ? this.get(actor, row.id) : null;
  }

  async get(actor: RequestActor, id: string): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    return this.project(await this.options.store.owned(actor.id, id));
  }

  async reopen(actor: RequestActor, id: string, locale: Locale): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    let row = await this.options.store.owned(actor.id, id);
    if (!row.conversationId) {
      try {
        await this.options.conversations.createDevelopmentConversation(actor.id,
          { id: row.id, workspaceRelPath: row.workspaceRelPath, projectId: row.projectId }, locale);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
        // Concurrent opens share the winning conversation; failed creation cleans its own runtime.
        const winner = await this.options.store.owned(actor.id, id);
        if (!winner.conversationId) throw error;
      }
      row = await this.options.store.owned(actor.id, id);
    }
    if (!row.conversationId) throw new AppError("CONFLICT");
    const conversation = await this.options.store.conversation(actor.id, row.conversationId);
    if (conversation.archiveStatus === "archived") await this.options.conversations.patch(actor.id, row.conversationId, { archiveStatus: "active" });
    await this.syncConversationTitle(actor, row, locale, conversation);
    return this.project(row);
  }

  async delete(actor: RequestActor, id: string): Promise<void> {
    this.assertActor(actor);
    await this.options.store.owned(actor.id, id);
    await this.options.store.deleteDraft(actor.id, id);
  }

  async sync(actor: RequestActor, id: string, locale?: Locale): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const row = await this.options.store.owned(actor.id, id);
    try { return await withApplicationSourceLock(this.workspace(row), row.directory, () => this.syncSource(actor, id, locale ? { locale } : {})); }
    catch (error) {
      if (!(error instanceof AppError && error.code === "APPLICATION_PACKAGE_INVALID") && !isMissingFile(error)) throw error;
      return this.invalidSource(actor, row, locale);
    }
  }

  async updateMetadata(actor: RequestActor, id: string, input: ApplicationDevelopmentMetadataUpdate): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const { source_hash, ...metadata } = applicationDevelopmentMetadataUpdateSchema.parse(input);
    const row = await this.options.store.owned(actor.id, id);
    return withApplicationSourceLock(this.workspace(row), row.directory, async () => {
      const current = await this.options.store.owned(actor.id, id);
      await writeApplicationMetadata(this.workspace(current), current.directory, source_hash, metadata);
      return this.syncSource(actor, id, {});
    });
  }

  async capabilities(actor: RequestActor, id: string): Promise<ApplicationDevelopmentCapabilities> {
    this.assertActor(actor);
    const row = await this.options.store.owned(actor.id, id);
    const source = await this.source(row);
    const preview = await this.options.store.previewApplication(row);
    const dependencies = await this.options.store.resolveDependencies(actor.id, source.manifest, preview?.interactiveDependencyBindings ?? []);
    return applicationDevelopmentCapabilitiesSchema.parse({ source_hash: source.hash, dependencies });
  }

  async updateCapabilities(actor: RequestActor, id: string, input: ApplicationDevelopmentCapabilitiesUpdate): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const data = applicationDevelopmentCapabilitiesUpdateSchema.parse(input);
    const row = await this.options.store.owned(actor.id, id);
    return withApplicationSourceLock(this.workspace(row), row.directory, async () => {
      const current = await this.options.store.owned(actor.id, id);
      const source = await this.source(current);
      if (source.hash !== data.source_hash) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
      const manifest = { ...source.manifest, dependencies: data.dependencies };
      // Explicit selections require ownership, the correct type and an enabled resource.
      const selected = interactiveDependencyDeclarations(data.dependencies).map(({ type, id: resourceId }) => ({ type, id: resourceId, resource_id: resourceId }));
      const state = await this.options.store.resolveDependencies(actor.id, manifest, [], selected);
      const declarations = (type: InteractiveDependencyType) => state.items.filter(item => item.type === type).map(item => ({ id: item.id, name: item.resource_name ?? item.name }));
      await writeApplicationDependencies(this.workspace(current), current.directory, data.source_hash, {
        plugins: declarations("plugin"), skills: declarations("skill"),
        knowledge_bases: declarations("knowledge_base"), mcp_servers: declarations("mcp_server"),
      });
      return this.syncSource(actor, id, { selections: dependencyBindings(state) });
    });
  }

  private async syncSource(actor: RequestActor, id: string, { locale, selections, initialDependencyBindings, initializePublishedSource }: {
    locale?: Locale; selections?: InteractiveDependencyBinding[]; initialDependencyBindings?: InteractiveDependencyBinding[];
    initializePublishedSource?: boolean;
  }): Promise<ApplicationDevelopment> {
    let row = await this.options.store.owned(actor.id, id);
    let source: ApplicationSourceSnapshot;
    try { source = await this.source(row); }
    catch (error) {
      if (!(error instanceof AppError && error.code === "APPLICATION_PACKAGE_INVALID") && !isMissingFile(error)) throw error;
      return this.invalidSource(actor, row, locale);
    }
    if (source.hash !== row.sourceHash || selections !== undefined) {
      const revision = row.revision + 1;
      const archive = await source.archive(`dev.${revision}`);
      const complete = async (tx: Prisma.TransactionClient, applicationId: string): Promise<void> => {
        await this.options.store.update(row, { previewApplicationId: applicationId, name: source.manifest.name,
          sourceHash: source.hash, sourceError: null, revision, diagnosticsJson: [],
          ...(initializePublishedSource ? { installedSourceHash: source.hash } : {}),
          ...(selections !== undefined ? { installedSourceHash: null } : {}) }, tx);
      };
      try {
        if (row.previewApplicationId) await this.options.applications.updateInteractivePackage(actor, row.previewApplicationId, archive, {}, selections ?? [], { complete });
        else await this.options.applications.importInteractive(actor, archive, {}, selections ?? [], { developmentOnly: true, complete, ...(initialDependencyBindings ? { initialDependencyBindings } : {}) });
      } catch (error) {
        // A concurrent sync publishes one snapshot. The caller reads the winner.
        if (selections !== undefined || !(error instanceof AppError && error.code === "CONFLICT")) throw error;
      }
      row = await this.options.store.owned(actor.id, id);
    } else if (row.sourceError) {
      await this.options.store.update(row, { sourceError: null });
      row = await this.options.store.owned(actor.id, id);
    }
    await this.ensurePreviewConversation(actor, row);
    await this.syncConversationTitle(actor, row, locale);
    return this.get(actor, id);
  }

  private async invalidSource(actor: RequestActor, row: DevelopmentRow, locale?: Locale): Promise<ApplicationDevelopment> {
    await this.options.store.update(row, { sourceError: "APPLICATION_PACKAGE_INVALID" });
    await this.syncConversationTitle(actor, row, locale);
    return this.get(actor, row.id);
  }

  async install(actor: RequestActor, id: string, expectedHash: string, release: ApplicationVersionInput): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const row = await this.options.store.owned(actor.id, id);
    const source = await this.source(row);
    if (source.hash !== expectedHash || row.sourceHash !== expectedHash || row.sourceError) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
    const preview = await this.options.store.previewState(row);
    if (!preview.application) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
    await this.options.applications.resolvePreviewRuntime(actor.id, preview.application.id);
    const bindings = (await this.options.applications.interactiveDependencies(actor, preview.application.id)).items.map(({ type, id: dependencyId, resource_id }) => ({ type, id: dependencyId, resource_id }));
    const archive = await source.archive(release.version_number);
    const complete = async (tx: Prisma.TransactionClient, applicationId: string): Promise<void> => {
      await this.options.store.activateInstalledApplication(actor.id, applicationId, tx);
      await this.options.store.update(row, { applicationId, installedSourceHash: source.hash, installedVersion: row.installedVersion + 1 }, tx);
    };
    if (row.applicationId) await this.options.applications.updateInteractivePackage(actor, row.applicationId, archive, {}, bindings, { complete, release });
    else await this.options.applications.importInteractive(actor, archive, {}, bindings, { complete, release,
      staged: async (tx, applicationId) => { await this.options.store.update(row, { applicationId }, tx); },
    });
    return this.get(actor, id);
  }

  async reportDiagnostics(actor: RequestActor, id: string, revision: number, diagnostics: ApplicationDevelopmentDiagnostic[]): Promise<void> {
    this.assertActor(actor);
    const parsed = z.array(applicationDevelopmentDiagnosticSchema).max(20).parse(diagnostics);
    await this.options.store.diagnostics(actor.id, id, revision, parsed.map(sanitizeApplicationDevelopmentDiagnostic));
  }

  async tool(actor: RequestActor, conversationId: string, turnId: string, request: ApplicationBuilderRequest, locale: Locale, executionWorkspace: string): Promise<ApplicationDevelopment | ApplicationTestInspection | null> {
    this.assertActor(actor);
    await this.options.store.assertActiveTurn(actor.id, conversationId, turnId);
    if (request.operation === "open") return this.open(actor, conversationId, { name: request.name, directory: request.directory }, locale);
    const row = await this.options.store.byConversation(actor.id, conversationId);
    if (!row) return null;
    if (request.operation === "metadata") {
      const { icon } = request;
      await this.options.store.owned(actor.id, row.id);
      return this.updateMetadata(actor, row.id, {
        source_hash: request.source_hash,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(icon ? { icon: icon.type === "file" ? await readWorkspaceApplicationIcon(executionWorkspace, icon.path) : icon } : {}),
      });
    }
    if (request.operation === "tests") {
      await this.options.store.owned(actor.id, row.id);
      return { sessions: await this.options.store.testSessions(row, { limit: 20, cursor: request.cursor }),
        detail: request.conversation_id ? await this.options.store.inspectTest(row, request.conversation_id) : null };
    }
    return this.sync(actor, row.id, locale);
  }

  private async syncConversationTitle(actor: RequestActor, row: DevelopmentRow, locale?: Locale, currentConversation?: Conversation): Promise<void> {
    if (!row.conversationId) return;
    const conversation = currentConversation ?? await this.options.store.conversation(actor.id, row.conversationId);
    const titleFor = (language: Locale): string => truncateConversationTitle(
      translateBackend("applicationDevelopment.taskTitle", language, { name: row.name }),
    );
    // Polling keeps an already localized title and never adds a second prefix.
    if (locale ? conversation.title === titleFor(locale)
      : supportedLocales.some((supportedLocale) => conversation.title === titleFor(supportedLocale))) return;
    const preferredLocale = (await this.options.store.actor(actor.id)).preferredLocale;
    const language = locale ?? (isLocale(preferredLocale) ? preferredLocale : "zh-CN");
    await this.options.conversations.patch(actor.id, row.conversationId, { title: titleFor(language) });
  }

  private async ensurePreviewConversation(actor: RequestActor, row: DevelopmentRow, restart = false): Promise<void> {
    const { application, conversation } = await this.options.store.previewState(row);
    if (!application?.interactivePackageId) {
      if (restart) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
      return;
    }
    if (!restart && conversation?.interactiveApplicationPackageId === application.interactivePackageId) return;
    if (conversation && conversation.interactiveApplicationPackageId !== application.interactivePackageId && await this.options.store.isRunning(conversation.id)) {
      if (restart) throw new AppError("APPLICATION_DEVELOPMENT_TEST_BUSY");
      return;
    }
    // Missing bindings should keep the preview project accessible for repair.
    try { await this.options.applications.resolvePreviewRuntime(actor.id, application.id); }
    catch (error) { if (!restart && error instanceof AppError && error.code === "APPLICATION_DEPENDENCY_UNAVAILABLE") return; throw error; }
    try {
      await this.options.conversations.createDevelopmentPreview(actor.id,
        { id: application.id, name: application.name, kind: "interactive", interactivePackageId: application.interactivePackageId },
        { id: row.id, revision: row.revision, previousConversationId: row.previewConversationId });
    } catch (error) {
      if (restart || !(error instanceof AppError && ["APPLICATION_DEVELOPMENT_TEST_CHANGED", "APPLICATION_DEVELOPMENT_TEST_BUSY"].includes(error.code))) throw error;
    }
  }

  async testSessions(actor: RequestActor, id: string, query: ApplicationTestSessionsQuery) {
    this.assertActor(actor);
    return this.options.store.testSessions(await this.options.store.owned(actor.id, id), query);
  }

  async restartTest(actor: RequestActor, id: string, input: ApplicationTestRestart): Promise<ApplicationDevelopment> {
    this.assertActor(actor);
    const row = await this.options.store.owned(actor.id, id);
    if (row.revision !== input.revision || row.previewConversationId !== input.preview_conversation_id) throw new AppError("APPLICATION_DEVELOPMENT_TEST_CHANGED");
    if (row.sourceError || !row.previewApplicationId) throw new AppError("APPLICATION_DEVELOPMENT_SOURCE_CHANGED");
    await this.ensurePreviewConversation(actor, row, true);
    return this.get(actor, id);
  }

  async deleteTest(actor: RequestActor, id: string, conversationId: string): Promise<void> {
    this.assertActor(actor);
    const row = await this.options.store.owned(actor.id, id);
    await this.options.store.assertTestSession(row, conversationId);
    if (row.previewConversationId === conversationId) throw new AppError("APPLICATION_DEVELOPMENT_TEST_CHANGED");
    if (await this.options.store.isRunning(conversationId)) throw new AppError("APPLICATION_DEVELOPMENT_TEST_BUSY");
    await this.options.conversations.delete(actor.id, conversationId, {});
  }

  async toolForOwner(ownerId: string, conversationId: string, turnId: string, request: ApplicationBuilderRequest, workspacePath: string): Promise<z.infer<typeof applicationBuilderDevelopmentSchema> | ApplicationTestInspection | null> {
    const user = await this.options.store.actor(ownerId);
    const executionWorkspace = resolveConversationWorkspaceRoot(this.options.workspaceRoot, ownerId, `${ownerId}/home/${userWorkspacePathSchema.parse(workspacePath)}`);
    const result = await this.tool({ id: user.id, role: user.role === "admin" ? "admin" : "user", status: "active" }, conversationId, turnId, request, isLocale(user.preferredLocale) ? user.preferredLocale : "zh-CN", executionWorkspace);
    if (!result || !("id" in result)) return result;
    const row = await this.options.store.owned(ownerId, result.id);
    return applicationBuilderDevelopmentSchema.parse({ ...result, workspace_path: userWorkspacePath(ownerId, row.workspaceRelPath) });
  }

  private async source(row: DevelopmentRow): Promise<ApplicationSourceSnapshot> {
    return readApplicationSource(this.workspace(row), row.directory);
  }

  private workspace(row: DevelopmentRow): string {
    return resolveConversationWorkspaceRoot(this.options.workspaceRoot, row.ownerId, row.workspaceRelPath);
  }

  private async project(row: DevelopmentRow): Promise<ApplicationDevelopment> {
    const preview = await this.options.store.previewState(row);
    return applicationDevelopmentSchema.parse({
      id: row.id, conversation_id: row.conversationId, name: row.name, directory: row.directory,
      icon: preview.application ? await this.options.applications.projectIcon(preview.application) : { type: "preset", preset: DEFAULT_APPLICATION_ICON_PRESET },
      application_id: row.applicationId, preview_application_id: row.previewApplicationId,
      preview_conversation_id: preview.conversation?.id ?? null, revision: row.revision,
      preview_current: Boolean(preview.application?.interactivePackageId && preview.conversation?.interactiveApplicationPackageId === preview.application.interactivePackageId),
      source_hash: row.sourceHash, installed_source_hash: row.installedSourceHash, source_error: row.sourceError,
      manifest: preview.package_ ? interactiveApplicationManifestSchema.parse(preview.package_.manifestJson) : null,
      diagnostics: row.diagnosticsJson, updated_at: row.updatedAt.toISOString(),
    });
  }

  private assertActor(actor: RequestActor): void { if (actor.status !== "active") throw new AppError("USER_DISABLED"); }

  private async writeSources(workspace: string, directory: string, files: Record<string, string | Buffer>): Promise<void> {
    for (const [path, data] of Object.entries(files)) {
      // Imported assets passed package validation, but validate paths again before writing.
      if (path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".")) || path.includes("\\")) throw new AppError("APPLICATION_PACKAGE_INVALID");
      const target = join(workspace, directory, path);
      await ensureSharedWorkspaceDirectory(workspace, dirname(target));
      await writeFile(target, data, { flag: "wx", mode: workspacePermissionPolicy.sharedWritableFile });
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new AppError("APPLICATION_PACKAGE_INVALID");
      await chmod(target, workspacePermissionPolicy.sharedWritableFile);
    }
  }
}

function isMissingFile(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
