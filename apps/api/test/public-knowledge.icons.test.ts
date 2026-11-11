import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { publicKnowledgeSettingsSchema, type ApplicationIconInput } from "@linksense/shared";
import type { Application, PrismaClient } from "../src/generated/prisma/client.js";
import type { PublishedApplicationDefinition } from "../src/modules/applications/published-definition.js";
import type { ApplicationIconStore } from "../src/modules/applications/icon-service.js";
import { PublicKnowledgeService } from "../src/modules/public-knowledge/service.js";
import { publicKnowledgeProgressFixture } from "./fixtures/public-knowledge-progress.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const upload: ApplicationIconInput = {
  type: "upload", filename: "website.png", mime_type: "image/png", data_base64: png,
};

function fixture() {
  const actor = { id: randomUUID(), role: "user", status: "active" } as const;
  const baseId = randomUUID();
  const settings = publicKnowledgeSettingsSchema.parse({
    name: "Website assistant", instructions: "Use website evidence", model: "model",
    reasoning_effort: "medium", knowledge_base_ids: [baseId], allowed_origins: ["https://website.example.test"],
  });
  const application = {
    id: randomUUID(), ownerId: actor.id, kind: "public_knowledge", status: "active",
    name: settings.name, description: null, publishedVersionId: null as string | null,
    iconPreset: "bot", iconObjectKey: null as string | null,
  };
  const configuration = {
    applicationId: application.id, publicId: "public-application-identifier-1234", settingsJson: settings,
  };
  type Version = { id: string; versionNumber: number; versionLabel: string; definitionJson: PublishedApplicationDefinition; assetsReady: boolean };
  const versions: Version[] = [];
  const db = {
    application: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; ownerId?: string; iconObjectKey?: string } }) => {
        if (where.iconObjectKey !== undefined)
          return application.iconObjectKey === where.iconObjectKey ? application : null;
        return (!where.id || where.id === application.id) && (!where.ownerId || where.ownerId === actor.id) && application.status !== "deleted"
          ? application : null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<Application> }) => Object.assign(application, data)),
      update: vi.fn(async ({ data }: { data: Partial<Application> }) => Object.assign(application, data)),
    },
    applicationVersion: {
      findFirst: vi.fn(async ({ where }: { where: { definitionJson?: { equals: string } } }) =>
        where.definitionJson
          ? versions.find((version) => version.assetsReady && version.definitionJson.iconObjectKey === where.definitionJson?.equals) ?? null
          : versions.at(-1) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions.find((version) => version.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Version }) => {
        versions.push(data);
        return data;
      }),
    },
    applicationKnowledgeBase: { deleteMany: vi.fn(), createMany: vi.fn() },
    applicationCapability: { deleteMany: vi.fn(), createMany: vi.fn() },
    knowledgeBase: { findMany: vi.fn(async () => [{ id: baseId, name: "Website knowledge" }]) },
    publicKnowledgeApplication: {
      findUnique: vi.fn(async () => configuration),
      upsert: vi.fn(async ({ create }: { create: typeof configuration }) => Object.assign(configuration, create)),
    },
    $queryRaw: vi.fn(async () => [{ id: application.id }]),
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) => work(db)),
  } as unknown as PrismaClient;
  const iconStore = {
    put: vi.fn<ApplicationIconStore["put"]>(async () => undefined), remove: vi.fn(async () => undefined),
    enqueueRemoval: vi.fn(async () => undefined),
    presignGet: vi.fn(async (key: string) => `https://objects.example.test/${key}`),
  };
  const captured = { snapshots: [], assertCurrent: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
  const service = new PublicKnowledgeService({
    prisma, iconStore, progress: publicKnowledgeProgressFixture(),
    models: { resolveRuntime: vi.fn(), resolveRuntimeForSelection: vi.fn(), resolveModelTransitionRuntime: vi.fn() },
    knowledge: { resolveUsableKnowledgeBaseIds: vi.fn(async () => [baseId]) }, retrieve: vi.fn(),
    skills: { capture: vi.fn(async () => captured), resolve: vi.fn() },
    audit: { write: vi.fn() }, coordinator: { acquire: vi.fn(), rateLimit: vi.fn() },
    queue: { start: vi.fn(), enqueue: vi.fn(), close: vi.fn() },
    runner: { runPublicKnowledgeTurn: vi.fn(), readPublicKnowledgeResult: vi.fn(), interruptPublicKnowledgeTurn: vi.fn() },
  });
  return { service, actor, settings, application, configuration, versions, db, iconStore, captured };
}

describe("public knowledge application logos", () => {
  it.each([undefined, { type: "preset", preset: "globe-2" }] as const)(
    "creates and publishes the default or chosen logo (%j)", async (icon) => {
      const f = fixture();
      const result = await f.service.save(f.actor, { ...f.settings, ...(icon ? { icon } : {}) });
      expect(result.icon).toEqual(icon ?? { type: "preset", preset: "bot" });
      expect(f.versions[0]?.definitionJson).toMatchObject({ iconPreset: icon?.preset ?? "bot", iconObjectKey: null });
      expect(f.configuration.settingsJson).toEqual(f.settings);
      expect(f.iconStore.put).not.toHaveBeenCalled();
    },
  );

  it("validates and stores an uploaded logo in the application and its immutable published version", async () => {
    const f = fixture();
    const result = await f.service.save(f.actor, { ...f.settings, icon: upload });
    expect(f.iconStore.put).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(new RegExp(`^applications/${f.actor.id}/icons/.+\\.png$`)), Buffer.from(png, "base64"), "image/png",
    );
    expect(result.icon).toEqual({ type: "custom", url: `https://objects.example.test/${f.application.iconObjectKey}`, fallback_preset: "bot" });
    expect(f.versions[0]?.definitionJson.iconObjectKey).toBe(f.application.iconObjectKey);
    expect(f.configuration.settingsJson).not.toHaveProperty("icon");
    expect(JSON.stringify(f.configuration.settingsJson)).not.toContain(png);
    expect(await f.service.publicConfiguration(f.configuration.publicId, f.settings.allowed_origins[0]!))
      .toMatchObject({ icon: result.icon });
  });

  it("keeps an existing custom logo usable when pre-change settings are edited without an icon", async () => {
    const f = fixture();
    f.application.iconPreset = "book-open";
    f.application.iconObjectKey = `applications/${f.actor.id}/icons/existing.png`;
    const before = structuredClone(f.configuration.settingsJson);
    const result = await f.service.save(f.actor, { ...before, name: "Updated assistant" }, f.application.id);
    expect(result.icon).toEqual({ type: "custom", url: `https://objects.example.test/${f.application.iconObjectKey}`, fallback_preset: "book-open" });
    expect(f.versions[0]?.definitionJson).toMatchObject({ iconPreset: "book-open", iconObjectKey: f.application.iconObjectKey });
    expect(f.iconStore.put).not.toHaveBeenCalled();
    expect(f.iconStore.remove).not.toHaveBeenCalled();
    expect(f.iconStore.enqueueRemoval).not.toHaveBeenCalled();
  });

  it("replaces an upload with a preset while retaining the image referenced by an older publication", async () => {
    const f = fixture();
    await f.service.save(f.actor, { ...f.settings, icon: upload });
    const previousKey = f.application.iconObjectKey;
    const result = await f.service.save(f.actor, { ...f.settings, icon: { type: "preset", preset: "book-open" } }, f.application.id);
    expect(result.icon).toEqual({ type: "preset", preset: "book-open" });
    expect(f.application.iconObjectKey).toBeNull();
    expect(f.versions.map((version) => version.definitionJson.iconObjectKey)).toEqual([previousKey, null]);
    expect(f.iconStore.remove).not.toHaveBeenCalled();
    expect(f.iconStore.enqueueRemoval).not.toHaveBeenCalled();
  });

  it("replaces a custom logo with a newly uploaded image and preserves the old publication", async () => {
    const f = fixture();
    await f.service.save(f.actor, { ...f.settings, icon: upload });
    const previousKey = f.application.iconObjectKey;
    await f.service.save(f.actor, { ...f.settings, icon: upload }, f.application.id);
    expect(f.application.iconObjectKey).not.toBe(previousKey);
    expect(f.versions[0]?.definitionJson.iconObjectKey).toBe(previousKey);
    expect(f.versions[1]?.definitionJson.iconObjectKey).toBe(f.application.iconObjectKey);
    expect(f.iconStore.put).toHaveBeenCalledTimes(2);
    expect(f.iconStore.remove).not.toHaveBeenCalled();
  });

  it("removes a staged image and rolls back Skill snapshots when publication fails", async () => {
    const f = fixture();
    f.application.iconObjectKey = `applications/${f.actor.id}/icons/previous.png`;
    f.db.applicationVersion.create.mockRejectedValueOnce(new Error("Publication failed"));
    await expect(f.service.save(f.actor, { ...f.settings, icon: upload }, f.application.id)).rejects.toThrow("Publication failed");
    const stagedKey = f.iconStore.put.mock.calls[0]?.[0];
    expect(f.iconStore.remove).toHaveBeenCalledExactlyOnceWith(stagedKey);
    expect(f.application.iconObjectKey).toBe(`applications/${f.actor.id}/icons/previous.png`);
    expect(f.captured.rollback).toHaveBeenCalledOnce();
    expect(f.captured.commit).not.toHaveBeenCalled();
  });

  it("cleans up partial uploads and reports a stable error before writing a publication", async () => {
    const f = fixture();
    f.iconStore.put.mockRejectedValueOnce(new Error("Object storage failed"));
    await expect(f.service.save(f.actor, { ...f.settings, icon: upload })).rejects.toMatchObject({ code: "APPLICATION_ICON_UPLOAD_INVALID" });
    expect(f.iconStore.remove).toHaveBeenCalledOnce();
    expect(f.db.applicationVersion.create).not.toHaveBeenCalled();
    expect(f.captured.rollback).toHaveBeenCalledOnce();
  });

  it.each(["not an image", "<svg onload='unsafe()' />"])("rejects invalid image bytes (%s) before storing anything", async (bytes) => {
    const f = fixture();
    await expect(f.service.save(f.actor, { ...f.settings, icon: { ...upload, data_base64: Buffer.from(bytes).toString("base64") } }))
      .rejects.toMatchObject({ code: "APPLICATION_ICON_UPLOAD_INVALID" });
    expect(f.iconStore.put).not.toHaveBeenCalled();
    expect(f.db.applicationVersion.create).not.toHaveBeenCalled();
  });

  it.each(["foreign", "disabled"])("denies a %s actor before accepting a logo", async (reason) => {
    const f = fixture();
    const actor = reason === "foreign" ? { ...f.actor, id: randomUUID() } : { ...f.actor, status: "disabled" as const };
    await expect(f.service.save(actor, { ...f.settings, icon: upload }, f.application.id)).rejects.toThrow();
    expect(f.iconStore.put).not.toHaveBeenCalled();
    expect(f.db.application.update).not.toHaveBeenCalled();
  });

  it("removes a staged image when ownership is revoked before the transaction acquires its lock", async () => {
    const f = fixture();
    f.db.application.findFirst.mockResolvedValueOnce(f.application).mockResolvedValueOnce(null);
    await expect(f.service.save(f.actor, { ...f.settings, icon: upload }, f.application.id)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(f.iconStore.remove).toHaveBeenCalledOnce();
    expect(f.db.applicationVersion.create).not.toHaveBeenCalled();
  });
});
