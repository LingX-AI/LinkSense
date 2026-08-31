import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import { parseConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { LinkSenseRedis } from "./adapters/redis.js";
import { RunnerClient } from "./adapters/runner.js";
import { MinioObjectStorage } from "./adapters/object-storage.js";
import { createServices, type AppServices } from "./services.js";
import { buildApi } from "./app.js";

type ApiStartupResources = {
  app: Pick<FastifyInstance, "close" | "listen">;
  services: Pick<
    AppServices,
    | "events"
    | "jobs"
    | "passwordResetMail"
    | "knowledgeRuntime"
    | "knowledgeGovernance"
    | "knowledgeSourceRuntime"
    | "automationScheduler"
    | "billingStatementScheduler"
    | "clawHubScheduler"
    | "feishu"
    | "feishuRuntime"
    | "weixinRuntime"
  >;
  redis: Pick<LinkSenseRedis, "close">;
  prisma: { $disconnect(): Promise<void> };
  host: string;
  port: number;
};

export type ApiLifecycle = {
  close(): Promise<void>;
  start(): Promise<void>;
};

const STABLE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,119}$/u;

export function createApiLifecycle(
  resources: ApiStartupResources,
): ApiLifecycle {
  let closePromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = closeApiResources(resources);
    return closePromise;
  };
  return {
    close,
    async start() {
      try {
        await resources.services.knowledgeGovernance?.start();
        await resources.services.knowledgeRuntime?.start();
        await resources.services.knowledgeSourceRuntime?.start();
        await resources.services.automationScheduler.start();
        await resources.services.billingStatementScheduler.start();
        await resources.services.clawHubScheduler.start();
        await resources.services.feishuRuntime.start();
        await resources.services.weixinRuntime.start();
        await resources.services.events.recoverRunningTurns();
        await resources.app.listen({
          host: resources.host,
          port: resources.port,
        });
        resources.services.events.startRecoveryMonitor();
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
    },
  };
}

export function formatApiStartupFailure(error: unknown): string {
  const errorClass = error instanceof Error ? error.name : "unknown";
  const reasonCode = stableReasonCode(error);
  return `LinkSense API failed to start (${errorClass}${reasonCode ? `, reason=${reasonCode}` : ""}).\n`;
}

export function isMainModule(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  if (!executablePath) return false;
  return fileURLToPath(moduleUrl) === path.resolve(executablePath);
}

export async function main(): Promise<void> {
  configureApiFileCreationMask();
  const config = parseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const redis = new LinkSenseRedis(config);
  const runner = new RunnerClient(config);
  const storage = new MinioObjectStorage(config);
  let services: AppServices | null = null;
  let lifecycle: ApiLifecycle | null = null;

  try {
    await Promise.all([
      mkdir(config.userDataRoot, { recursive: true }),
      mkdir(config.capabilityRoot, { recursive: true }),
      redis.connect(),
    ]);
    await storage.ensureBucket();

    services = createServices({
      config,
      prisma,
      redis,
      runner,
      storage,
    });
    const app = await buildApi(services);
    lifecycle = createApiLifecycle({
      app,
      services,
      redis,
      prisma,
      host: config.host,
      port: config.port,
    });
    await lifecycle.start();
  } catch (error) {
    if (lifecycle) {
      await lifecycle.close().catch(() => undefined);
    } else {
      await closePartiallyStartedApi(services, redis, prisma);
    }
    throw error;
  }

  const close = lifecycle.close;
  const closeFromSignal = () => {
    void close().then(
      () => process.exit(0),
      (error: unknown) => {
        const errorClass = error instanceof Error ? error.name : "unknown";
        process.stderr.write(
          `LinkSense API shutdown failed (${errorClass}).\n`,
        );
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", closeFromSignal);
  process.once("SIGTERM", closeFromSignal);
}

export function configureApiFileCreationMask(): void {
  process.umask(0o007);
}

async function closeApiResources(
  resources: ApiStartupResources,
): Promise<void> {
  resources.services.events.stopRecoveryMonitor();
  const appResult = await Promise.allSettled([
    Promise.resolve().then(() => resources.app.close()),
  ]);
  const governanceResult = await Promise.allSettled([
    Promise.resolve().then(() =>
      resources.services.knowledgeGovernance?.close(),
    ),
  ]);
  const knowledgeResult = await Promise.allSettled([
    Promise.resolve().then(() =>
      resources.services.knowledgeSourceRuntime?.close(),
    ),
    Promise.resolve().then(() => resources.services.knowledgeRuntime?.close()),
  ]);
  const schedulerResults = await Promise.allSettled([
    Promise.resolve().then(() =>
      resources.services.automationScheduler.close(),
    ),
    Promise.resolve().then(() =>
      resources.services.billingStatementScheduler.close(),
    ),
    Promise.resolve().then(() => resources.services.clawHubScheduler.close()),
    Promise.resolve().then(() => resources.services.feishu.close()),
    Promise.resolve().then(() => resources.services.feishuRuntime.close()),
    Promise.resolve().then(() => resources.services.weixinRuntime.close()),
  ]);
  const dependencyResults = await Promise.allSettled([
    Promise.resolve().then(() => resources.services.jobs.close()),
    Promise.resolve().then(() => resources.services.passwordResetMail.close()),
    Promise.resolve().then(() => resources.redis.close()),
    Promise.resolve().then(() => resources.prisma.$disconnect()),
  ]);
  const failures = [
    ...appResult,
    ...governanceResult,
    ...knowledgeResult,
    ...schedulerResults,
    ...dependencyResults,
  ].flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (failures.length > 0) {
    throw new AggregateError(failures, "LinkSense API shutdown failed");
  }
}

async function closePartiallyStartedApi(
  services: AppServices | null,
  redis: Pick<LinkSenseRedis, "close">,
  prisma: { $disconnect(): Promise<void> },
): Promise<void> {
  services?.events.stopRecoveryMonitor();
  if (services) {
    await Promise.allSettled([
      Promise.resolve().then(() => services.knowledgeGovernance?.close()),
      Promise.resolve().then(() => services.knowledgeSourceRuntime?.close()),
    ]);
    await Promise.allSettled([
      Promise.resolve().then(() => services.automationScheduler.close()),
      Promise.resolve().then(() => services.billingStatementScheduler.close()),
      Promise.resolve().then(() => services.clawHubScheduler.close()),
      Promise.resolve().then(() => services.feishu.close()),
      Promise.resolve().then(() => services.feishuRuntime.close()),
      Promise.resolve().then(() => services.weixinRuntime.close()),
    ]);
    await Promise.allSettled([
      Promise.resolve().then(() => services.knowledgeRuntime?.close()),
      Promise.resolve().then(() => services.jobs.close()),
      Promise.resolve().then(() => services.passwordResetMail.close()),
    ]);
  }
  await Promise.allSettled([
    Promise.resolve().then(() => redis.close()),
    Promise.resolve().then(() => prisma.$disconnect()),
  ]);
}

function stableReasonCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const reasonCode =
    "reasonCode" in error && typeof error.reasonCode === "string"
      ? error.reasonCode
      : error.message;
  return STABLE_REASON_CODE.test(reasonCode) ? reasonCode : null;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(formatApiStartupFailure(error));
    process.exitCode = 1;
  });
}
