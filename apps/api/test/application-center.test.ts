import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { authenticationPlugin } from "../src/plugins/authentication.js";
import type { ApplicationService } from "../src/modules/applications/service.js";
import { ApplicationCenterService } from "../src/modules/applications/center-service.js";
import { AppError } from "../src/lib/errors.js";
import type { RequestActor } from "../src/modules/capabilities/types.js";
import { adminApplicationCenterRoutes, applicationCenterRoutes } from "../src/modules/applications/center-routes.js";
import { ApplicationDistributionRepository } from "../src/modules/applications/distribution-repository.js";
import { sendAppError } from "../src/lib/http.js";

const ownerId = randomUUID(), applicationId = randomUUID(), versionId = randomUUID(), releaseId = randomUUID();
const actor: RequestActor = { id: ownerId, role: "user", status: "active", registrationSource: "organization_invitation", ipAddress: "127.0.0.1" };
const context = { ipAddress: "127.0.0.1" };
function fixture() {
  const listingId = randomUUID();
  const release = { id: releaseId, listingId, applicationId, versionId, name: "Reports", description: null, publisherName: "Publisher", usageModes: ["install"], releaseNotes: "Initial release", status: "pending", reviewComment: null, submittedAt: new Date("2026-09-16T00:00:00Z"), reviewedAt: null };
  const repository = {
    prisma: {
      applicationRelease: { findMany: vi.fn(async () => [release]) },
      applicationRuntimeInstallation: { findMany: vi.fn(async () => []) },
      application: { findFirst: vi.fn(async () => ({ id: applicationId, kind: "standard" })) },
      applicationVersion: { findMany: vi.fn(async () => [{ id: versionId, versionNumber: 1, versionLabel: "1.0.0", definitionJson: {} }]) },
      applicationListing: { findMany: vi.fn(async () => [{ id: listingId, status: "draft", suspensionReason: null }]) },
      applicationInstallation: { findMany: vi.fn(async () => []) },
    },
    submit: vi.fn(async () => release),
    ownPublications: vi.fn(async () => [release]),
    release: vi.fn(async () => ({ release })), review: vi.fn(), withdraw: vi.fn(), setStatus: vi.fn(), catalog: vi.fn(async () => [release]),
  };
  const publications = {
    verifyVersion: vi.fn(),
    parseDefinition: vi.fn(() => ({ kind: "standard", usageInstructions: "Configure your own account" })),
    readVersion: vi.fn(async () => ({ instructions: "Review instructions", capabilities: [], knowledgeBaseIds: [], mcpServerIds: [], interactivePackageId: null })),
  };
  const audit = { write: vi.fn() };
  const transaction = {};
  const applications = { captureDistributionVersion: vi.fn<ApplicationService["captureDistributionVersion"]>(async (_actor, _applicationId, input, complete) => {
    await complete(transaction as never, { id: versionId } as never);
    return { version_id: versionId, version_number: input.version_number, usage_instructions: input.usage_instructions };
  }) };
  const service = new ApplicationCenterService(repository as never, publications as never, audit, applications);
  return { service, repository, publications, audit, applications, transaction };
}

describe("application center", () => {
  it.each(["self_registration", "organization_invitation", undefined] as const)(
    "allows active administrators from %s to list, inspect, review and govern releases",
    async registrationSource => {
      const f = fixture();
      const admin: RequestActor = {
        id: ownerId, role: "admin", status: "active",
        ...(registrationSource === undefined ? {} : { registrationSource }),
      };
      expect(await f.service.adminReleases(admin)).toEqual([
        expect.objectContaining({ id: releaseId, status: "pending" }),
      ]);
      expect(await f.service.detail(admin, releaseId)).toMatchObject({
        release: { id: releaseId }, instructions: "Review instructions",
      });
      await f.service.review(admin, releaseId, { decision: "approved", comment: "Checked" }, context);
      expect(f.publications.verifyVersion).toHaveBeenCalledWith(applicationId, versionId);
      expect(f.repository.review).toHaveBeenCalledWith(ownerId, releaseId, "approved", "Checked");
      await f.service.setStatus(admin, applicationId, { status: "suspended", reason: "Unsafe release" }, context);
      expect(f.repository.setStatus).toHaveBeenCalledWith(ownerId, true, applicationId, "suspended", "Unsafe release");
      expect(f.audit.write).toHaveBeenCalledWith(expect.objectContaining({ actorId: ownerId, action: "application_center_suspended" }));
    },
  );
  it.each(["self_registration", "organization_invitation"] as const)(
    "rejects ordinary and disabled accounts from %s before reading or changing admin resources",
    async registrationSource => {
      for (const deniedActor of [
        { ...actor, registrationSource },
        { ...actor, role: "admin" as const, status: "disabled" as const, registrationSource },
      ]) {
        const f = fixture();
        const code = deniedActor.status === "disabled" ? "USER_DISABLED" : "FORBIDDEN";
        await expect(f.service.adminReleases(deniedActor)).rejects.toMatchObject({ code });
        await expect(f.service.detail(deniedActor, releaseId)).rejects.toMatchObject({ code });
        await expect(f.service.review(deniedActor, releaseId, { decision: "approved", comment: "" }, context)).rejects.toMatchObject({ code });
        if (deniedActor.status === "disabled" || registrationSource === "self_registration") {
          await expect(f.service.setStatus(deniedActor, applicationId, { status: "suspended", reason: "Blocked" }, context)).rejects.toMatchObject({ code });
          expect(f.repository.setStatus).not.toHaveBeenCalled();
        }
        expect(f.repository.prisma.applicationRelease.findMany).not.toHaveBeenCalled();
        expect(f.repository.release).not.toHaveBeenCalled();
        expect(f.repository.review).not.toHaveBeenCalled();
        expect(f.audit.write).not.toHaveBeenCalled();
      }
    },
  );
  it("serves admin releases after a self-registered user's promotion and rejects stale or unauthorized sessions", async () => {
    const f = fixture();
    const app = Fastify();
    const user = {
      id: ownerId, email: "member@example.test", name: "Member",
      role: "user", status: "active", selfRegisteredAt: new Date("2026-09-21T00:00:00Z"),
      authValidAfter: new Date("2026-09-21T00:00:00Z"), preferredLocale: null, avatarObjectKey: null,
    };
    await app.register(jwt, { secret: "test-only-application-center-secret", sign: { expiresIn: 300 } });
    await app.register(authenticationPlugin, {
      prisma: { user: { findUnique: vi.fn(async () => user) } } as unknown as PrismaClient,
    });
    app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
    await app.register(async scope => {
      scope.addHook("preHandler", app.requireAdmin);
      await scope.register(adminApplicationCenterRoutes, { service: f.service });
    }, { prefix: "/api/v1/admin/application-center" });
    const token = () => app.jwt.sign({ sub: user.id, email: user.email, role: user.role, auth_valid_after: user.authValidAfter.toISOString() });
    const request = (accessToken?: string) => app.inject({
      url: "/api/v1/admin/application-center",
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    try {
      expect((await request()).statusCode).toBe(401);
      const ordinaryToken = token();
      expect((await request(ordinaryToken)).statusCode).toBe(403);
      user.role = "admin";
      expect((await request(ordinaryToken)).statusCode).toBe(401);
      const adminToken = token();
      const response = await request(adminToken);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ success: true, data: { items: [{ id: releaseId }], next_cursor: null } });
      expect(f.repository.prisma.applicationRelease.findMany).toHaveBeenCalledTimes(1);
      user.role = "user";
      expect((await request(adminToken)).statusCode).toBe(401);
      expect((await request(token())).statusCode).toBe(403);
      user.role = "admin";
      user.status = "disabled";
      expect((await request(token())).statusCode).toBe(401);
      expect(f.repository.prisma.applicationRelease.findMany).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it("rejects interactive install submissions and never promotes historical install-only releases to service access", async () => {
    const f = fixture();
    f.repository.prisma.application.findFirst.mockResolvedValue({ id: applicationId, kind: "interactive" });
    await expect(f.service.submit(actor, applicationId, { version_number: "1.0.0", usage_instructions: "", usage_modes: ["install"], release_notes: "" }, context)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.applications.captureDistributionVersion).not.toHaveBeenCalled();
    f.publications.parseDefinition.mockReturnValue({ kind: "interactive", usageInstructions: "Use online" });
    expect((await f.service.ownPublications(actor))[0]?.usage_modes).toEqual([]);
  });
  it("returns the owner's submissions with safe release metadata", async () => {
    const f = fixture();
    const releases = await f.service.ownPublications(actor);
    expect(f.repository.ownPublications).toHaveBeenCalledWith(ownerId);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ application_id: applicationId, version_number: "1.0.0", status: "pending", listing_status: "draft" });
    expect(releases[0]).not.toHaveProperty("definitionJson");
    expect(releases[0]).not.toHaveProperty("credentials");
    expect(releases[0]).not.toHaveProperty("instructions");
  });
  it.each([
    { ...actor, registrationSource: "self_registration" as const },
    { ...actor, status: "disabled" as const },
  ])("denies publication lists for an ineligible account", async deniedActor => {
    const f = fixture();
    await expect(f.service.ownPublications(deniedActor)).rejects.toBeInstanceOf(AppError);
    expect(f.repository.ownPublications).not.toHaveBeenCalled();
  });
  it("selects the latest release of each non-deleted owned application, including pending and unlisted publications", async () => {
    const prisma = {
      application: { findMany: vi.fn(async () => [{ id: applicationId }]) },
      applicationRelease: { findMany: vi.fn(async () => []) },
    };
    const repository = new ApplicationDistributionRepository(prisma as never);
    await repository.ownPublications(ownerId);
    expect(prisma.application.findMany).toHaveBeenCalledWith({ where: { ownerId, status: { not: "deleted" } }, select: { id: true } });
    expect(prisma.applicationRelease.findMany).toHaveBeenCalledWith({ where: { applicationId: { in: [applicationId] } }, distinct: ["applicationId"], orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 200 });
    prisma.application.findMany.mockResolvedValueOnce([]);
    prisma.applicationRelease.findMany.mockClear();
    expect(await repository.ownPublications(ownerId)).toEqual([]);
    expect(prisma.applicationRelease.findMany).not.toHaveBeenCalled();
  });
  it("serves my publications for the authenticated actor and rejects owner overrides", async () => {
    const f = fixture();
    const app = Fastify();
    app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
    await app.register(applicationCenterRoutes, {
      prefix: "/application-center", service: f.service,
      resolveActor: async request => {
        if (request.headers.authorization !== "Bearer test-user") throw new AppError("AUTH_REQUIRED");
        return actor;
      },
    });
    try {
      expect((await app.inject({ url: "/application-center/mine" })).statusCode).toBe(401);
      expect(f.repository.ownPublications).not.toHaveBeenCalled();
      const headers = { authorization: "Bearer test-user" };
      const response = await app.inject({ url: "/application-center/mine", headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ success: true, data: { items: [{ application_id: applicationId }], next_cursor: null } });
      expect((await app.inject({ url: `/application-center/mine?owner_id=${randomUUID()}`, headers })).statusCode).toBe(400);
      expect(f.repository.ownPublications).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it("accepts an empty usage guide and empty release notes", async () => {
    const f = fixture();
    const input = { version_number: "1.0.0", usage_instructions: "", usage_modes: ["install" as const], release_notes: "" };
    await f.service.submit(actor, applicationId, input, context);
    expect(f.applications.captureDistributionVersion).toHaveBeenCalledWith(actor, applicationId, input, expect.any(Function));
    expect(f.repository.submit).toHaveBeenCalledWith(f.transaction, ownerId, applicationId, versionId, input);
  });
  it("submits the selected immutable version and modes without publishing it before review", async () => {
    const f = fixture();
    const input = { version_number: "1.0.0", usage_instructions: "Configure your own account", usage_modes: ["install" as const], release_notes: "Initial release" };
    const result = await f.service.submit(actor, applicationId, input, context);
    expect(f.applications.captureDistributionVersion).toHaveBeenCalledWith(actor, applicationId, input, expect.any(Function));
    expect(f.repository.submit).toHaveBeenCalledWith(f.transaction, ownerId, applicationId, versionId, input);
    expect(result).toMatchObject({ status: "pending", listing_status: "draft", usage_modes: ["install"], version_id: versionId });
    expect(f.repository.review).not.toHaveBeenCalled();
  });
  it("does not read packages for a non-owner submission", async () => {
    const f = fixture();
    f.repository.prisma.application.findFirst.mockResolvedValueOnce(null as never);
    await expect(f.service.submit(actor, applicationId, { version_number: "1.0.0", usage_instructions: "Use the service", usage_modes: ["service"], release_notes: "Release" }, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.applications.captureDistributionVersion).not.toHaveBeenCalled();
    expect(f.repository.submit).not.toHaveBeenCalled();
  });
  it.each(["catalog", "adminReleases"] as const)("rejects self-registered users at %s", async method => {
    const f = fixture();
    await expect(f.service[method]({ ...actor, registrationSource: "self_registration" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects review by ordinary users and requires a reason for rejection", async () => {
    const f = fixture();
    await expect(f.service.review(actor, releaseId, { decision: "approved", comment: "" }, context)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.service.review({ ...actor, role: "admin" }, releaseId, { decision: "rejected", comment: " " }, context)).rejects.toThrow();
    expect(f.repository.review).not.toHaveBeenCalled();
  });
  it("checks frozen assets before approving and leaves corrupted releases pending", async () => {
    const f = fixture();
    f.publications.verifyVersion.mockRejectedValueOnce(new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"));
    await expect(f.service.review({ ...actor, role: "admin" }, releaseId, { decision: "approved", comment: "" }, context)).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.repository.review).not.toHaveBeenCalled();
    await f.service.review({ ...actor, role: "admin" }, releaseId, { decision: "approved", comment: "Checked" }, context);
    expect(f.repository.review).toHaveBeenCalledWith(ownerId, releaseId, "approved", "Checked");
  });
  it("passes owner and administrator authority separately when changing listing status", async () => {
    const f = fixture();
    await f.service.setStatus(actor, applicationId, { status: "unlisted", reason: "" }, context);
    expect(f.repository.setStatus).toHaveBeenCalledWith(ownerId, false, applicationId, "unlisted", "");
    await f.service.setStatus({ ...actor, role: "admin" }, applicationId, { status: "suspended", reason: "Review required" }, context);
    expect(f.repository.setStatus).toHaveBeenCalledWith(ownerId, true, applicationId, "suspended", "Review required");
  });
  it("projects only public release information without package contents or credentials", async () => {
    const f = fixture();
    const [release] = await f.service.catalog(actor);
    expect(release).not.toHaveProperty("definitionJson");
    expect(release).not.toHaveProperty("instructions");
    expect(release).not.toHaveProperty("credentials");
    expect(release).toMatchObject({ usage_instructions: "Configure your own account", installed_application_id: null });
  });
});
