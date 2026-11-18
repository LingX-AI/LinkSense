import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import jwt from "@fastify/jwt";
import { localComputerStatusSchema } from "@linksense/shared";
import Fastify from "fastify";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { sendAppError } from "../../src/lib/http.js";
import { projectWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
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
