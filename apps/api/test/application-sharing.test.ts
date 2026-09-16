import { randomUUID } from "node:crypto";
import { applicationVersionInputSchema, type ApplicationShareInput } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationVersion } from "../src/generated/prisma/client.js";
import { ApplicationPublicationService } from "../src/modules/applications/publication-service.js";
import { ApplicationService } from "../src/modules/applications/service.js";
import type { RequestActor } from "../src/modules/capabilities/types.js";
import { AuditService } from "../src/modules/audit/service.js";

function fixture() {
  const applicationId = randomUUID(), ownerId = randomUUID(), recipientId = randomUUID();
  const actor: RequestActor = { id: ownerId, role: "user", status: "active", registrationSource: "organization_invitation", ipAddress: "127.0.0.1" };
  const app = { id: applicationId, ownerId, status: "active", kind: "standard", name: "Reports", instructions: "Write reports", model: null, reasoningEffort: null, interactivePackageId: null, updatedAt: new Date("2026-09-16T00:00:00Z") };
  const version: ApplicationVersion = { id: randomUUID(), applicationId, versionNumber: 1, versionLabel: "1.0.0", definitionJson: {}, assetsReady: true, createdBy: ownerId, createdAt: app.updatedAt };
  const prisma = {
    application: { findFirst: vi.fn(async () => app), update: vi.fn() },
    applicationCapability: { findMany: vi.fn(async () => []) },
    applicationKnowledgeBase: { findMany: vi.fn(async () => []) },
    applicationMcpServer: { findMany: vi.fn(async () => []) },
    capability: { findMany: vi.fn(async () => []) },
    knowledgeBase: { findMany: vi.fn(async () => []) },
    mcpServer: { findMany: vi.fn(async () => []) },
    user: { findFirst: vi.fn(async () => ({ id: recipientId })) },
    userGroup: { findUnique: vi.fn(async () => ({ id: recipientId })) },
    applicationGrant: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => null), create: vi.fn(), update: vi.fn() },
  };
  const publications = new ApplicationPublicationService(prisma as never, "/not-used");
  const capture = vi.spyOn(publications, "capture").mockImplementation(async (_owner, _app, input, options) => {
    const parsed = applicationVersionInputSchema.parse(input);
    await options.complete(prisma as never, version);
    return { version_id: version.id, version_number: parsed.version_number, usage_instructions: parsed.usage_instructions };
  });
  const audit = new AuditService(prisma as never);
  vi.spyOn(audit, "write").mockResolvedValue(undefined);
  const service = new ApplicationService(prisma as never, { resolveRuntime: vi.fn(), resolveRuntimeForSelection: vi.fn(), resolveModelTransitionRuntime: vi.fn() }, audit, { resolveForCapability: vi.fn() }, undefined, undefined, publications);
  const input: ApplicationShareInput = { version_number: "1.0.0", usage_instructions: "Configure your account", target: { grantee_type: "user", user_id: recipientId, usage_modes: ["service"] } };
  const share = (data = input, user = actor) => service.share(user, applicationId, data, { ipAddress: "127.0.0.1" });
  return { service, share, input, actor, applicationId, ownerId, recipientId, version, prisma, capture, audit };
}

describe("sharing an application version", () => {
  it("saves an explicitly cleared usage guide", async () => {
    const f = fixture();
    expect(await f.share({ ...f.input, usage_instructions: "" })).toMatchObject({ usage_instructions: "" });
    expect(f.prisma.application.update).toHaveBeenCalledWith({ where: { id: f.applicationId, ownerId: f.ownerId }, data: { publishedVersionId: f.version.id, usageInstructions: "" } });
  });
  it.each(["user", "user_group"] as const)("shares with a %s and activates the captured version atomically", async type => {
    const f = fixture();
    const target: ApplicationShareInput["target"] = type === "user" ? f.input.target : { grantee_type: "user_group", user_group_id: f.recipientId, usage_modes: ["install", "service"] };
    const result = await f.share({ ...f.input, target });
    expect(result.version_number).toBe("1.0.0");
    expect(f.capture).toHaveBeenCalledWith(f.ownerId, f.applicationId, { version_number: "1.0.0", usage_instructions: "Configure your account" }, expect.objectContaining({ runtimeInstructions: "Write reports" }));
    expect(f.prisma.applicationGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ applicationId: f.applicationId, granteeType: type, usageModes: target?.usage_modes, grantedBy: f.ownerId }) });
    expect(f.prisma.application.update).toHaveBeenCalledWith({ where: { id: f.applicationId, ownerId: f.ownerId }, data: { publishedVersionId: f.version.id, usageInstructions: "Configure your account" } });
    expect(f.audit.write).toHaveBeenCalledOnce();
  });

  it("updates an existing recipient's selected modes instead of duplicating the grant", async () => {
    const f = fixture(), grantId = randomUUID();
    f.prisma.applicationGrant.findFirst.mockResolvedValue({ id: grantId });
    await f.share();
    expect(f.prisma.applicationGrant.update).toHaveBeenCalledWith({ where: { id: grantId }, data: { usageModes: ["service"] } });
    expect(f.prisma.applicationGrant.create).not.toHaveBeenCalled();
  });

  it("saves a new version for existing recipients without creating additional grants", async () => {
    const f = fixture();
    f.prisma.applicationGrant.findFirst.mockResolvedValue({ id: randomUUID() });
    await f.share({ ...f.input, target: null });
    expect(f.prisma.application.update).toHaveBeenCalledOnce();
    expect(f.prisma.applicationGrant.create).not.toHaveBeenCalled();
    expect(f.prisma.applicationGrant.update).not.toHaveBeenCalled();
  });

  it.each(["missing_target", "self_target", "unavailable_user", "unavailable_group"] as const)("rejects %s without activating a service or changing grants", async scenario => {
    const f = fixture();
    let target = f.input.target;
    if (scenario === "missing_target") target = null;
    if (scenario === "self_target") target = { grantee_type: "user", user_id: f.ownerId, usage_modes: ["service"] };
    if (scenario === "unavailable_user") f.prisma.user.findFirst.mockResolvedValueOnce(null as never);
    if (scenario === "unavailable_group") {
      target = { grantee_type: "user_group", user_group_id: f.recipientId, usage_modes: ["service"] };
      f.prisma.userGroup.findUnique.mockResolvedValueOnce(null as never);
    }
    await expect(f.share({ ...f.input, target })).rejects.toMatchObject({ code: "APPLICATION_GRANT_TARGET_INVALID" });
    expect(f.prisma.application.update).not.toHaveBeenCalled();
    expect(f.prisma.applicationGrant.create).not.toHaveBeenCalled();
    expect(f.audit.write).not.toHaveBeenCalled();
  });

  it("denies non-owners and self-registered users before capturing their application", async () => {
    const f = fixture();
    await expect(f.share(f.input, { ...f.actor, registrationSource: "self_registration" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.prisma.application.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.share()).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(f.capture).not.toHaveBeenCalled();
  });
});
