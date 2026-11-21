import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import jwt from "@fastify/jwt";
import { localComputerStatusSchema } from "@linksense/shared";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { sendAppError } from "../../src/lib/http.js";
import { projectWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import type { DesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { isDesktopRunActive, lockDesktopConversation } from "../../src/modules/desktop-credentials/run-authority.js";
import { DesktopRunLeases, type DesktopRunScope } from "../../src/modules/desktop-credentials/run-leases.js";
import {
  authorizeLocalComputerAction, type LocalComputerActionCapability,
} from "../../src/modules/local-computer/authorization.js";
import { localComputerRoutes } from "../../src/modules/local-computer/routes.js";
import { LocalComputerService } from "../../src/modules/local-computer/service.js";
import { authenticationPlugin } from "../../src/plugins/authentication.js";

export async function verifyLocalComputerSessions(input: {
  prisma: PrismaClient;
  ownerId: string;
  deviceId: string;
  otherOwnerId: string;
  legacyConversationId: string;
  cloudConversationId: string;
  conversations: Pick<ConversationService, "patch">;
  redis: Pick<Redis, "get" | "set" | "eval">;
  connections: Pick<DesktopDeviceCoordinator, "connect" | "disconnect" | "isCurrentConnection">;
}): Promise<{ sessionId: string; grantId: string; conversationId: string }> {
  const { prisma, ownerId, deviceId, conversations } = input;
  const app = Fastify();
  try {
    let now = Date.UTC(2026, 10, 19, 1);
    app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
    await app.register(jwt, { secret: randomBytes(32).toString("base64") });
    await app.register(authenticationPlugin, { prisma });
    await app.register(localComputerRoutes, {
      prefix: "/api/v1/conversations",
      service: new LocalComputerService(prisma, () => new Date(now)),
    });
    const createUserToken = async (id: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      return `Bearer ${app.jwt.sign({
        sub: id, email: user.email, role: user.role, auth_valid_after: user.authValidAfter.toISOString(),
      }, { expiresIn: "5m" })}`;
    };
    const owner = await createUserToken(ownerId);
    const other = await createUserToken(input.otherOwnerId);
    const createConversation = () => prisma.conversation.create({ data: {
      ownerId, title: "Mac permissions fixture", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null), runtimeGeneration: randomUUID(),
      executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const conversation = await createConversation();
    const second = await createConversation();
    const statusPath = (id: string) => `/api/v1/conversations/${id}/local-computer`;
    const permissionsPath = (id: string) => `/api/v1/conversations/${id}/computer-permissions`;
    const inject = (method: "GET" | "POST" | "DELETE", url: string, payload?: object, authorization = owner) =>
      app.inject({ method, url, ...(payload ? { payload } : {}), headers: { authorization } });
    const status = (response: Awaited<ReturnType<typeof inject>>) => {
      assert.equal(response.statusCode, 200);
      return localComputerStatusSchema.parse(response.json().data);
    };
    const url = statusPath(conversation.id);
    const permissions = permissionsPath(conversation.id);
    const empty = { device_id: deviceId, session: null, grants: [] };
    assert.equal((await inject("GET", url, undefined, "")).statusCode, 401);
    assert.equal((await inject("GET", url, undefined, other)).statusCode, 403);
    assert.equal((await inject("POST", url, { session_id: randomUUID() }, other)).statusCode, 403);
    assert.equal((await inject("GET", statusPath(input.cloudConversationId))).statusCode, 403);
    const legacyPath = statusPath(input.legacyConversationId);
    assert.deepEqual(status(await inject("GET", legacyPath)), empty);
    const freshLegacySession = randomUUID();
    const legacyStarted = status(await inject("POST", legacyPath, { session_id: freshLegacySession }));
    assert.equal(legacyStarted.session?.id, freshLegacySession);
    assert.deepEqual(legacyStarted.grants, []);
    const freshLegacyGrant = {
      action: "grant", session_id: freshLegacySession, grant_id: randomUUID(),
      capability: "computer.observe", target: { bundle_id: "com.example.Fixture" },
    };
    assert.deepEqual(status(await inject("POST", permissionsPath(input.legacyConversationId), freshLegacyGrant)).grants.map(grant => grant.id), [freshLegacyGrant.grant_id]);
    assert.deepEqual(status(await inject("DELETE", `${legacyPath}?session_id=${freshLegacySession}`)), empty);
    assert.deepEqual(status(await inject("GET", url)), empty);

    // Internal dispatch-time authority: a live run, the fenced device/account/generation binding,
    // a current session, and an exact unrevoked app grant. The caller only supplies the canonical
    // scope, capability, bundle, and run bearer; lease and connection authority come from the real
    // DesktopRunLeases and Redis device coordinator.
    const authorizationConversation = await createConversation();
    const authorizationTurnId = randomUUID();
    const authorizationStartIntent = {
      projectionTurnId: authorizationTurnId, ownerId, conversationId: authorizationConversation.id,
      runtimeGeneration: authorizationConversation.runtimeGeneration, capabilityGeneration: "0".repeat(64),
      inputText: "Mac computer use authorization fixture", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared",
    };
    await prisma.conversationTurnStartIntent.create({ data: authorizationStartIntent });
    const connectionId = randomUUID();
    const authorizationScope: DesktopRunScope = {
      ownerId, deviceId, connectionId, conversationId: authorizationConversation.id,
      turnId: authorizationTurnId, runtimeGeneration: authorizationConversation.runtimeGeneration,
    };
    await input.connections.connect(deviceId, connectionId);
    const authorizationNow = now;
    let leaseNow = authorizationNow;
    const authorizationLeases = new DesktopRunLeases(
      input.redis,
      (scope, phase) => isDesktopRunActive(prisma, input.connections, scope, phase),
      () => leaseNow,
    );
    const modelProvider = {
      revision: 1, protocolMode: "native_responses" as const,
      baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(),
    };
    const { run_token: authorizationRunToken } = await authorizationLeases.issue({ deviceId, connectionId }, {
      ownerId, conversationId: authorizationConversation.id, projectionTurnId: authorizationTurnId,
      expectedRuntimeGeneration: authorizationConversation.runtimeGeneration,
      model: "fixture-model", modelProvider,
    });
    const authorize = (
      scope: DesktopRunScope, capability: LocalComputerActionCapability, bundleId: string,
      runToken = authorizationRunToken, clock: () => Date = () => new Date(authorizationNow),
    ) => authorizeLocalComputerAction(prisma, {
      leases: authorizationLeases, connections: input.connections,
    }, { scope, capability, bundleId, runToken }, clock);
    const authorizationPath = statusPath(authorizationConversation.id);
    const authorizationPermissions = permissionsPath(authorizationConversation.id);
    const authorizationSessionId = randomUUID();
    const authorizationStarted = status(await inject("POST", authorizationPath, { session_id: authorizationSessionId }));
    if (!authorizationStarted.session) throw new Error("Missing authorization fixture session");
    const authorizationExpiresAt = Date.parse(authorizationStarted.session.expires_at);
    const observeGrant = {
      action: "grant" as const, session_id: authorizationSessionId, grant_id: randomUUID(),
      capability: "computer.observe" as const, target: { bundle_id: "com.example.Fixture" },
    };
    const actGrant = { ...observeGrant, grant_id: randomUUID(), capability: "computer.act" as const };
    status(await inject("POST", authorizationPermissions, observeGrant));
    const observePermit = await authorize(
      { ...authorizationScope, deviceId: authorizationScope.deviceId.toUpperCase() },
      "computer.observe", "com.example.Fixture",
    );
    // The permit carries the exact canonical run scope for downstream occupancy binding.
    assert.deepEqual(observePermit.scope, authorizationScope);
    await assert.rejects(authorize(authorizationScope, "computer.act", "com.example.Fixture"), { code: "FORBIDDEN" });
    status(await inject("POST", authorizationPermissions, actGrant));
    await assert.doesNotReject(authorize(authorizationScope, "computer.act", "com.example.Fixture"));
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Other"), { code: "FORBIDDEN" });
    // Missing and wrong run bearers are rejected by the real lease verification.
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture", ""), { code: "AUTH_REQUIRED" });
    const wrongRunToken = `lsdr_${randomBytes(32).toString("base64url")}`;
    await assert.rejects(
      authorize(authorizationScope, "computer.observe", "com.example.Fixture", wrongRunToken),
      { code: "AUTH_REQUIRED" },
    );
    // A well-formed bearer is rejected once its Redis lease expires.
    leaseNow = authorizationNow + 10 * 60_000 + 1;
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "AUTH_REQUIRED" });
    leaseNow = authorizationNow;
    await prisma.conversationTurnStartIntent.update({
      where: { projectionTurnId: authorizationTurnId }, data: { collaborationMode: "plan" },
    });
    await assert.rejects(authorize(authorizationScope, "computer.act", "com.example.Fixture"), { code: "FORBIDDEN" });
    await assert.doesNotReject(authorize(authorizationScope, "computer.observe", "com.example.Fixture"));
    await prisma.conversationTurnStartIntent.update({
      where: { projectionTurnId: authorizationTurnId }, data: { collaborationMode: "default" },
    });
    await prisma.conversationTurnStartIntent.update({
      where: { projectionTurnId: authorizationTurnId }, data: { runnerStatus: "release_pending" },
    });
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await prisma.conversationTurnStartIntent.update({
      where: { projectionTurnId: authorizationTurnId }, data: { runnerStatus: "prepared" },
    });
    await assert.rejects(
      authorize({ ...authorizationScope, ownerId: input.otherOwnerId }, "computer.observe", "com.example.Fixture"),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      authorize({ ...authorizationScope, runtimeGeneration: randomUUID() }, "computer.observe", "com.example.Fixture"),
      { code: "FORBIDDEN" },
    );
    const shortLivedBundle = "com.example.ShortLived";
    await prisma.computerPermissionGrant.create({ data: {
      id: randomUUID(), ownerId, conversationId: authorizationConversation.id, deviceId,
      sessionId: authorizationSessionId, capability: "computer.observe", scope: "session",
      targetJson: { bundle_id: shortLivedBundle }, createdAt: new Date(authorizationNow),
      expiresAt: new Date(authorizationNow + 60_000),
    } });
    await assert.doesNotReject(authorize(authorizationScope, "computer.observe", shortLivedBundle));
    await assert.rejects(
      authorize(authorizationScope, "computer.observe", shortLivedBundle, authorizationRunToken,
        () => new Date(authorizationNow + 120_000)),
      { code: "FORBIDDEN" },
    );
    const malformedBundle = "com.example.Malformed";
    await prisma.computerPermissionGrant.create({ data: {
      id: randomUUID(), ownerId, conversationId: authorizationConversation.id, deviceId,
      sessionId: authorizationSessionId, capability: "computer.observe", scope: "session",
      targetJson: { bundle_id: malformedBundle, extra: true }, expiresAt: new Date(authorizationExpiresAt),
    } });
    await assert.rejects(authorize(authorizationScope, "computer.observe", malformedBundle), { code: "FORBIDDEN" });
    await prisma.applicationExternalSession.create({ data: {
      externalAccessId: randomUUID(), applicationId: randomUUID(), runtimePrincipalId: randomUUID(),
      conversationId: authorizationConversation.id, origin: "authorization-fixture",
      credentialVersion: 1, absoluteExpiresAt: new Date(authorizationNow + 86_400_000),
    } });
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await prisma.applicationExternalSession.delete({ where: { conversationId: authorizationConversation.id } });
    // Legacy rows without a runtime generation/session binding stay denied with a valid live lease.
    const legacyRuntime = await prisma.conversation.findUniqueOrThrow({
      where: { id: input.legacyConversationId }, select: { runtimeGeneration: true },
    });
    const legacyTurn = await prisma.conversationTurn.findFirstOrThrow({
      where: { conversationId: input.legacyConversationId, status: "running" }, select: { id: true },
    });
    const legacyScope: DesktopRunScope = {
      ownerId, deviceId, connectionId, conversationId: input.legacyConversationId,
      turnId: legacyTurn.id, runtimeGeneration: legacyRuntime.runtimeGeneration,
    };
    await prisma.conversationTurnStartIntent.create({ data: {
      ...authorizationStartIntent, projectionTurnId: legacyTurn.id,
      conversationId: input.legacyConversationId, runtimeGeneration: legacyRuntime.runtimeGeneration,
      inputText: "Legacy malformed storage fixture",
    } });
    const { run_token: legacyRunToken } = await authorizationLeases.issue({ deviceId, connectionId }, {
      ownerId, conversationId: input.legacyConversationId, projectionTurnId: legacyTurn.id,
      expectedRuntimeGeneration: legacyRuntime.runtimeGeneration, model: "fixture-model", modelProvider,
    });
    await assert.rejects(authorize(legacyScope, "computer.act", "com.example.Legacy", legacyRunToken), { code: "FORBIDDEN" });
    await prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId: legacyTurn.id } });
    await authorizationLeases.discardUndelivered(legacyTurn.id, legacyRunToken);
    // The same decision must bind a materialized running turn, not only a start intent.
    const authorizationThreadId = randomUUID();
    await prisma.$transaction([
      prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId: authorizationTurnId } }),
      prisma.conversation.update({
        where: { id: authorizationConversation.id }, data: { codexThreadId: authorizationThreadId },
      }),
      prisma.conversationTurn.create({ data: {
        id: authorizationTurnId, conversationId: authorizationConversation.id, sequenceNo: 1,
        submittedBy: ownerId, codexThreadId: authorizationThreadId, codexTurnId: randomUUID(),
        status: "running", submitMode: "normal", capabilityGeneration: "0".repeat(64),
        capabilitiesJson: [], startedAt: new Date(authorizationNow),
      } }),
    ]);
    await assert.doesNotReject(authorize(authorizationScope, "computer.observe", "com.example.Fixture"));
    await prisma.conversationTurn.update({ where: { id: authorizationTurnId }, data: { collaborationMode: "plan" } });
    await assert.rejects(authorize(authorizationScope, "computer.act", "com.example.Fixture"), { code: "FORBIDDEN" });
    await assert.doesNotReject(authorize(authorizationScope, "computer.observe", "com.example.Fixture"));
    await prisma.conversationTurn.update({ where: { id: authorizationTurnId }, data: { collaborationMode: "default" } });
    await prisma.conversationTurn.update({ where: { id: authorizationTurnId }, data: { interruptRequestedAt: new Date() } });
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await prisma.conversationTurn.update({ where: { id: authorizationTurnId }, data: { interruptRequestedAt: null } });
    // A stopped/interrupted materialized turn must not fall through to a visible start intent.
    await prisma.conversationTurnStartIntent.create({ data: {
      ...authorizationStartIntent, inputText: "Stopped turn must not fall through",
    } });
    await prisma.conversationTurn.update({ where: { id: authorizationTurnId }, data: { interruptRequestedAt: new Date() } });
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await prisma.conversationTurn.update({
      where: { id: authorizationTurnId },
      data: { status: "interrupted", interruptedAt: new Date() },
    });
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await prisma.conversationTurn.update({
      where: { id: authorizationTurnId },
      data: { status: "running", interruptRequestedAt: null, interruptedAt: null },
    });
    await prisma.conversationTurnStartIntent.delete({ where: { projectionTurnId: authorizationTurnId } });
    status(await inject("POST", authorizationPermissions, {
      action: "revoke", session_id: authorizationSessionId, grant_id: actGrant.grant_id,
    }));
    await assert.rejects(authorize(authorizationScope, "computer.act", "com.example.Fixture"), { code: "FORBIDDEN" });
    await assert.doesNotReject(authorize(authorizationScope, "computer.observe", "com.example.Fixture"));
    await assert.rejects(
      authorize(authorizationScope, "computer.observe", "com.example.Fixture", authorizationRunToken,
        () => new Date(authorizationExpiresAt + 1)),
      { code: "FORBIDDEN" },
    );
    // A lease that expires while the request waits for the conversation fence is still denied.
    let releaseFence!: () => void;
    let fenceHeld!: () => void;
    const fenceGate = new Promise<void>(resolve => { releaseFence = resolve; });
    const fenceLocked = new Promise<void>(resolve => { fenceHeld = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await lockDesktopConversation(tx, {
        ownerId, deviceId, conversationId: authorizationConversation.id,
        runtimeGeneration: authorizationConversation.runtimeGeneration,
      });
      fenceHeld();
      await fenceGate;
    });
    await fenceLocked;
    const waiting = authorize(authorizationScope, "computer.observe", "com.example.Fixture");
    await new Promise(resolve => setTimeout(resolve, 100));
    leaseNow = authorizationNow + 10 * 60_000 + 1;
    releaseFence();
    await blocker;
    await assert.rejects(waiting, { code: "AUTH_REQUIRED" });
    leaseNow = authorizationNow;
    // A replaced device connection no longer authorizes the original run scope.
    const replacementConnectionId = randomUUID();
    await input.connections.connect(deviceId, replacementConnectionId);
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await input.connections.connect(deviceId, connectionId);
    // The clock can advance during the final awaited connection check; an already-expired permit
    // must not be returned as authorization.
    let finalCheckNow = authorizationNow;
    const expiringConnections = {
      isCurrentConnection: async (id: string, current: string) => {
        const currentConnection = await input.connections.isCurrentConnection(id, current);
        if (!currentConnection) throw new Error("Expected the fixture connection to be current");
        finalCheckNow = authorizationExpiresAt + 1;
        return currentConnection;
      },
    };
    await assert.rejects(
      authorizeLocalComputerAction(prisma, {
        leases: authorizationLeases, connections: expiringConnections,
      }, {
        scope: authorizationScope, capability: "computer.observe",
        bundleId: "com.example.Fixture", runToken: authorizationRunToken,
      }, () => new Date(finalCheckNow)),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(status(await inject("DELETE", `${authorizationPath}?session_id=${authorizationSessionId}`)), empty);
    await assert.rejects(authorize(authorizationScope, "computer.observe", "com.example.Fixture"), { code: "FORBIDDEN" });
    await authorizationLeases.discardUndelivered(authorizationTurnId, authorizationRunToken);
    await input.connections.disconnect(deviceId, connectionId);
    await input.connections.disconnect(deviceId, replacementConnectionId);

    const firstId = randomUUID();
    assert.equal((await inject("POST", url, { session_id: firstId, device_id: deviceId })).statusCode, 400);
    const [first, duplicate, conflict] = await Promise.all([
      inject("POST", url, { session_id: firstId.toUpperCase() }),
      inject("POST", url, { session_id: firstId.toUpperCase() }),
      inject("POST", url, { session_id: randomUUID() }, other),
    ]);
    const expiresAt = new Date(now + 300_000).toISOString();
    const started = { ...empty, session: { id: firstId, expires_at: expiresAt } };
    assert.deepEqual(status(first), started);
    assert.deepEqual(status(duplicate), started);
    assert.equal(conflict.statusCode, 403);
    assert.equal((await inject("POST", url, { session_id: randomUUID() })).statusCode, 409);

    const grant = {
      action: "grant" as const, session_id: firstId, grant_id: randomUUID(),
      capability: "computer.observe", target: { bundle_id: "com.example.Fixture" },
    };
    const revoke = { action: "revoke", session_id: firstId, grant_id: grant.grant_id };
    assert.equal((await inject("POST", permissions, { ...grant, expires_at: expiresAt })).statusCode, 400);
    assert.equal((await inject("POST", permissions, { ...grant, target: { bundle_id: "/private/folder" } })).statusCode, 400);
    assert.equal((await inject("POST", permissions, grant, other)).statusCode, 403);
    assert.equal((await inject("POST", permissionsPath(second.id), grant)).statusCode, 409);
    const granted = {
      ...started, grants: [{
        id: grant.grant_id, target: grant.target, scope: "session", capability: grant.capability, expires_at: expiresAt,
      }],
    };
    for (const response of await Promise.all([
      inject("POST", permissions, grant),
      inject("POST", permissions, { ...grant, session_id: firstId.toUpperCase(), grant_id: grant.grant_id.toUpperCase() }),
    ])) assert.deepEqual(status(response), granted);
    assert.equal((await inject("POST", permissions, { ...grant, capability: "computer.act" })).statusCode, 409);
    assert.deepEqual(status(await inject("POST", permissions, revoke)), started);
    assert.deepEqual(status(await inject("POST", permissions, revoke)), started);
    assert.equal((await inject("POST", permissions, grant)).statusCode, 409);

    const expiredGrant = { ...grant, grant_id: randomUUID() };
    assert.equal(status(await inject("POST", permissions, expiredGrant)).grants.length, 1);
    now += 300_000;
    assert.deepEqual(status(await inject("GET", url)), empty);
    assert.equal((await inject("POST", permissions, { ...grant, grant_id: randomUUID() })).statusCode, 409);
    assert.equal((await inject("POST", url, { session_id: firstId })).statusCode, 409);

    const newId = randomUUID();
    assert.equal(status(await inject("POST", url, { session_id: newId })).session?.id, newId);
    assert.equal(status(await inject("DELETE", `${url}?session_id=${firstId}`)).session?.id, newId);
    assert.equal((await inject("DELETE", `${statusPath(second.id)}?session_id=${newId}`)).statusCode, 403);
    const archivedGrant = { ...grant, session_id: newId, grant_id: randomUUID() };
    assert.equal(status(await inject("POST", permissions, archivedGrant)).grants.length, 1);
    await conversations.patch(ownerId, conversation.id, { archiveStatus: "archived" });
    assert.equal((await inject("GET", url)).statusCode, 403);
    await conversations.patch(ownerId, conversation.id, { archiveStatus: "active" });
    assert.deepEqual(status(await inject("GET", url)), empty);
    assert.equal((await inject("POST", url, { session_id: newId })).statusCode, 409);

    const stoppedId = randomUUID();
    assert.equal(status(await inject("POST", url, { session_id: stoppedId })).session?.id, stoppedId);
    const stop = `${url}?session_id=${stoppedId}`;
    assert.deepEqual(status(await inject("DELETE", stop)), empty);
    assert.deepEqual(status(await inject("DELETE", stop)), empty);
    assert.equal((await inject("POST", url, { session_id: stoppedId })).statusCode, 409);

    const audited = await prisma.auditLog.findMany({
      where: { targetId: { in: [firstId, grant.grant_id, stoppedId] } },
      select: { actorId: true, action: true, metadataJson: true },
      orderBy: { action: "asc" },
    });
    assert.deepEqual(audited, [
      "computer_permission_granted", "computer_permission_revoked",
      "computer_session_started", "computer_session_started", "computer_session_stopped",
    ].map(action => ({ actorId: ownerId, action, metadataJson: {} })));

    const sessionId = randomUUID();
    assert.equal(status(await inject("POST", url, { session_id: sessionId })).session?.id, sessionId);
    await prisma.conversation.update({ where: { id: conversation.id }, data: { runtimeGeneration: randomUUID() } });
    assert.deepEqual(status(await inject("GET", url)), empty);
    const finalId = randomUUID();
    const finalGrant = { ...grant, session_id: finalId, grant_id: randomUUID() };
    assert.equal(status(await inject("POST", url, { session_id: finalId })).session?.id, finalId);
    assert.equal(status(await inject("POST", permissions, finalGrant)).grants.length, 1);
    return { sessionId: finalId, grantId: finalGrant.grant_id, conversationId: conversation.id };
  } finally {
    await app.close();
  }
}
