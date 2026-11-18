import { randomUUID } from "node:crypto";
import {
  DESKTOP_MODEL_PROXY_PATH,
  DESKTOP_MODEL_PURPOSE_HEADER,
  desktopModelPurposeSchema,
  desktopModelProxyUrl,
  desktopModelTokenSchema,
  type ModelProviderProtocolMode,
} from "@linksense/shared";
import Fastify from "fastify";
import { treeifyError, ZodError } from "zod";

import type { RunnerModelProviderRuntime } from "../../src/adapters/runner.js";
import { sendAppError } from "../../src/lib/http.js";
import { DesktopRunLeases } from "../../src/modules/desktop-credentials/run-leases.js";
import { desktopModelProxyRoutes } from "../../src/modules/model-proxy/routes.js";
import { createRedisFixture } from "./redis.js";

type FixtureProvider = {
  model: string;
  revision: number;
  protocolMode: ModelProviderProtocolMode;
  upstreamBaseUrl: string;
  upstreamKey: string;
};

export async function startDesktopModelProxyFixture(configured: readonly FixtureProvider[]) {
  const redis = await createRedisFixture();
  const leases = new DesktopRunLeases(redis.client, async () => true);
  const app = Fastify();
  const providers = new Map(configured.map(provider => [provider.revision, provider]));
  const close = async () => { try { await app.close(); } finally { await redis.close(); } };
  try {
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ZodError) {
        // This fixture sends synthetic inputs only. Avoid logging request bodies or credentials.
        console.error("Desktop model fixture rejected fields:", JSON.stringify(treeifyError(error)));
      }
      return sendAppError(reply, request, error);
    });
    await app.register(desktopModelProxyRoutes, {
      prefix: DESKTOP_MODEL_PROXY_PATH,
      redis: redis.client,
      rateLimitSecret: randomUUID(),
      leases,
      settings: { resolveDesktopProxyProvider: async ({ model, revision, protocolMode }) => {
        const configured = providers.get(revision);
        if (!configured || model !== configured.model || protocolMode !== configured.protocolMode) {
          throw new Error("Unexpected desktop fixture provider");
        }
        return { baseUrl: configured.upstreamBaseUrl, apiKey: configured.upstreamKey };
      } },
      creditLimits: { assertCanStartTask: async () => undefined },
      privacyMasking: { runtimeForUser: async () => undefined },
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const purposes = new Set<string>();
    const scopedFetch: typeof fetch = (url, init) => {
      const target = new URL(url instanceof Request ? url.url : String(url));
      const headers = new Headers(init?.headers);
      const authorization = headers.get("authorization") ?? "";
      const purpose = desktopModelPurposeSchema.parse(headers.get(DESKTOP_MODEL_PURPOSE_HEADER));
      const turnId = target.pathname.split("/")[5];
      if (!turnId || target.origin !== origin ||
          !target.href.startsWith(`${desktopModelProxyUrl(origin, turnId, purpose)}/`) ||
          !authorization.startsWith("Bearer ") ||
          !desktopModelTokenSchema.safeParse(authorization.slice(7)).success ||
          configured.some(({ upstreamKey }) => authorization.includes(upstreamKey) || String(init?.body).includes(upstreamKey))) {
        throw new Error("A desktop fixture model call escaped its credential boundary");
      }
      purposes.add(purpose);
      return fetch(url, init);
    };
    const provider = (revision: number): { model: string; provider: RunnerModelProviderRuntime } => {
      const match = providers.get(revision);
      if (!match) throw new Error("Missing desktop fixture provider");
      return { model: match.model, provider: {
        revision, baseUrl: match.upstreamBaseUrl, apiKey: match.upstreamKey, protocolMode: match.protocolMode,
      } };
    };
    return {
      origin, fetch: scopedFetch, close, purposes,
      issue: async (revision: number, transitionRevision?: number) => {
        const primary = provider(revision);
        return leases.issue({ deviceId: randomUUID(), connectionId: randomUUID() }, {
          ownerId: randomUUID(), conversationId: randomUUID(), projectionTurnId: randomUUID(),
          expectedRuntimeGeneration: randomUUID(),
          model: primary.model, modelProvider: primary.provider,
          ...(transitionRevision === undefined ? {} : { modelTransitionSource: provider(transitionRevision) }),
        });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
