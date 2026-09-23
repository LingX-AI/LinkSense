import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { interactiveApplicationManifestSchema, type InteractiveDependencyBinding } from "@linksense/shared";
import type { ApplicationDevelopment, Prisma } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { ApplicationDevelopmentService, type ApplicationDevelopmentServiceOptions } from "../src/modules/applications/development-service.js";
import type { ApplicationDevelopmentStore } from "../src/modules/applications/development-repository.js";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";
import { dependencyBindings, resolveInteractiveDependencies } from "../src/modules/applications/interactive-dependencies.js";

export const OWNER = "10000000-0000-4000-8000-000000000001";
export const TASK = "20000000-0000-4000-8000-000000000001";
export const DEVELOPMENT_PROJECT = "60000000-0000-4000-8000-000000000001";
export const actor = { id: OWNER, role: "user" as const, status: "active" as const };
const now = new Date("2026-09-17T00:00:00Z");
type PreviewState = Awaited<ReturnType<ApplicationDevelopmentStore["previewState"]>>;

export async function developmentFixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-builder-test-"));
  const workspaceRelPath = `${OWNER}/home/projects/${DEVELOPMENT_PROJECT}`;
  const workspace = join(root, workspaceRelPath);
  await mkdir(workspace, { recursive: true });
  let row: ApplicationDevelopment | null = null;
  const conversation = { id: TASK, ownerId: OWNER, applicationId: null, collaborationMode: "default", projectId: DEVELOPMENT_PROJECT as string | null, workspaceRelPath, title: "Untitled task" };
  let preview: PreviewState = { application: null, package_: null, conversation: null };
  const installed = new Map<string, Buffer>();
  const dependencyDb = {
    capability: { findMany: vi.fn(async () => [
      { id: "30000000-0000-4000-8000-000000000001", name: "Plugin", type: "plugin" },
      { id: "30000000-0000-4000-8000-000000000002", name: "Skill", type: "skill" },
    ]) },
    knowledgeBase: { findMany: vi.fn(async () => [{ id: "30000000-0000-4000-8000-000000000003", name: "Knowledge" }]) },
    mcpServer: { findMany: vi.fn(async () => [{ id: "30000000-0000-4000-8000-000000000004", name: "MCP" }]) },
  } as unknown as Parameters<typeof resolveInteractiveDependencies>[0];
  const submittedTests = new Set<string>();
  const store = {
    ensureProject: vi.fn(async () => ({ id: DEVELOPMENT_PROJECT })),
    actor: vi.fn(async () => ({ id: OWNER, role: "user", status: "active", preferredLocale: "zh-CN" })),
    resolveDependencies: vi.fn((...args: Parameters<ApplicationDevelopmentStore["resolveDependencies"]>) => resolveInteractiveDependencies(dependencyDb, ...args)),
    conversation: vi.fn(async () => ({ ...conversation })),
    owned: vi.fn(async (owner: string, id: string) => { if (owner !== OWNER || row?.id !== id) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND"); return { ...row }; }),
    byConversation: vi.fn(async () => row), byApplication: vi.fn(async () => row),
    create: vi.fn(async (data: { id: string; ownerId: string; conversationId: string; name: string; directory: string; projectId: string; applicationId?: string }) => {
      Object.assign(conversation, { projectId: data.projectId, workspaceRelPath });
      row = { workspaceRelPath, applicationId: null, previewApplicationId: null, previewConversationId: null, revision: 0, installedVersion: 0, sourceHash: null, installedSourceHash: null, sourceError: null, diagnosticsJson: [], createdAt: now, updatedAt: now, ...data }; return { ...row };
    }),
    update: vi.fn(async (before: ApplicationDevelopment, data: Prisma.ApplicationDevelopmentUpdateManyMutationInput) => {
      if (!row || row.revision !== before.revision || row.installedVersion !== before.installedVersion) throw new AppError("CONFLICT");
      // Service mutations use scalar values; the production repository enforces optimistic writes.
      Object.assign(row, data);
    }),
    deleteDraft: vi.fn(async () => { row = null; }),
    activateInstalledApplication: vi.fn(async () => {}),
    sourceApplication: vi.fn(), previewApplication: vi.fn(async () => preview.application),
    previewState: vi.fn(async () => preview), isRunning: vi.fn(async () => false),
    testSessions: vi.fn(async () => ({ items: [], next_cursor: null })),
    inspectTest: vi.fn(async () => ({ conversation_id: TASK, messages: [], truncated: false })),
    assertTestSession: vi.fn(async () => {}),
    assertActiveTurn: vi.fn(async () => {}),
    diagnostics: vi.fn(async (_owner: string, _id: string, revision: number, value: Prisma.InputJsonValue) => {
      if (!row || row.revision !== revision) throw new AppError("CONFLICT");
      row.diagnosticsJson = value as Prisma.JsonValue;
    }),
  };
  type WriteOptions = Parameters<ApplicationDevelopmentServiceOptions["applications"]["importInteractive"]>[4];
  async function publish(id: string, archive: Buffer, bindings: InteractiveDependencyBinding[], options: WriteOptions) {
    const source = await inspectInteractiveApplicationArchive(archive);
    const state = await resolveInteractiveDependencies(dependencyDb, OWNER, source.manifest, options?.initialDependencyBindings ?? preview.application?.interactiveDependencyBindings ?? [], bindings);
    const packageId = randomUUID();
    await options?.complete?.({} as Prisma.TransactionClient, id);
    if (options?.developmentOnly || row?.previewApplicationId === id) {
      preview = { ...preview,
        application: { id, ownerId: OWNER, name: source.manifest.name, kind: "interactive",
          iconPreset: source.manifest.icon_preset ?? "bot", iconObjectKey: null, description: source.manifest.description,
          instructions: source.manifest.instructions ?? "", usageInstructions: "", publishedVersionId: null,
          model: null, reasoningEffort: null, interactivePackageId: packageId,
          interactiveDependencyBindings: dependencyBindings(state), developmentOnly: true, status: "active",
          deletedAt: null, deletedBy: null, createdAt: now, updatedAt: now },
        package_: { id: packageId, applicationId: id, manifestJson: source.manifest, version: source.manifest.version, createdAt: now, createdBy: OWNER, archiveSha256: "a".repeat(64), fileCount: 3, expandedBytes: 100 },
      };
    } else installed.set(id, archive);
    return { id };
  }
  const applications = {
    projectIcon: vi.fn(async (row: { iconPreset: string }) => ({ type: "preset" as const, preset: row.iconPreset })),
    get: vi.fn(), delete: vi.fn(async () => {}),
    importInteractive: vi.fn(async (_actor, archive: Buffer, _context, bindings: InteractiveDependencyBinding[], options: WriteOptions) => publish(randomUUID(), archive, bindings, options)),
    updateInteractivePackage: vi.fn(async (_actor, id: string, archive: Buffer, _context, bindings: InteractiveDependencyBinding[], options: WriteOptions) => publish(id, archive, bindings, options)),
    interactiveDependencies: vi.fn(async () => preview.package_
      ? resolveInteractiveDependencies(dependencyDb, OWNER, interactiveApplicationManifestSchema.parse(preview.package_.manifestJson), preview.application?.interactiveDependencyBindings ?? [], [], false)
      : { items: [] }), resolvePreviewRuntime: vi.fn(async () => ({})),
  };
  const conversations = {
    createDevelopmentConversation: vi.fn(async () => {
      if (!row) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND");
      row.conversationId = randomUUID();
      return { id: row.conversationId };
    }),
    create: vi.fn(async () => ({ id: TASK })), createDevelopmentPreview: vi.fn(async () => {
      if (!row || !preview.application) throw new Error("fixture preview missing");
      const id = preview.conversation && !submittedTests.has(preview.conversation.id) ? preview.conversation.id : randomUUID(); row.previewConversationId = id;
      preview = { ...preview, conversation: { id, ownerId: OWNER, applicationId: preview.application.id, interactiveApplicationPackageId: preview.application.interactivePackageId } as NonNullable<PreviewState["conversation"]> }; return { id };
    }), delete: vi.fn(async () => {}), patch: vi.fn(async (_owner: string, _id: string, data: { title?: string }) => {
      if (data.title) conversation.title = data.title;
      return { ...conversation };
    }),
  };
  const assets = { get: vi.fn() };
  const service = new ApplicationDevelopmentService({
    store: store as unknown as ApplicationDevelopmentStore,
    applications: applications as unknown as ApplicationDevelopmentServiceOptions["applications"],
    conversations: conversations as unknown as ApplicationDevelopmentServiceOptions["conversations"], assets, workspaceRoot: root,
  });
  return { root, workspace, conversation, service, store, applications, conversations, assets, installed, submittedTests, row: () => { if (!row) throw new Error("fixture project missing"); return row; }, preview: () => preview };
}
