import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flushCompileCache } from "node:module";

import type { FastifyInstance } from "fastify";

import { isFullAppConfig, parseConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { LinkSenseRedis } from "./adapters/redis.js";
import { RunnerClient } from "./adapters/runner.js";
import { createObjectStorage } from "./adapters/object-storage.js";
import type { AppServices } from "./services.js";
import { LocalUnoserverRuntime, type OfficeConversionRuntime } from "./modules/knowledge-processing/office-converter.js";

type ApiStartupResources = {
  app: Pick<FastifyInstance, "close" | "listen" | "log">;
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
    | "botChannelRuntime"
    | "feishuRuntime"
    | "weixinRuntime"
  >;
  redis: Pick<LinkSenseRedis, "close">;
  runner: Pick<RunnerClient, "waitUntilReady">;
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
  const startStage = async (stage: string, operation: () => Promise<void> | undefined): Promise<void> => {
    const started = performance.now();
    await operation();
    resources.app.log.info({ stage, duration_ms: Math.round(performance.now() - started) }, "API startup stage ready");
  };
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = closeApiResources(resources);
    return closePromise;
  };
  return {
    close,
    async start() {
      try {
        await startStage("knowledge-governance", () => resources.services.knowledgeGovernance?.start());
        await startStage("knowledge-runtime", () => resources.services.knowledgeRuntime?.start());
        await startStage("knowledge-sources", () => resources.services.knowledgeSourceRuntime?.start());
        await startStage("automation", () => resources.services.automationScheduler.start());
        await startStage("billing", () => resources.services.billingStatementScheduler.start());
        await startStage("clawhub", () => resources.services.clawHubScheduler.start());
        await startStage("bot-channels", () => resources.services.botChannelRuntime.start());
        await startStage("feishu", () => resources.services.feishuRuntime.start());
        await startStage("weixin", () => resources.services.weixinRuntime.start());
        await startStage("runner-readiness", () => resources.runner.waitUntilReady());
        await startStage("task-recovery", () => resources.services.events.recoverRunningTurns());
        await resources.app.listen({
          host: resources.host,
          port: resources.port,
        });
        await resources.services.events.startRecoveryMonitor();
      } catch (error) {
        resources.app.log.error({
          error_class: error instanceof Error ? error.name : "unknown",
          reason_code: stableReasonCode(error),
        }, "API startup failed");
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

export async function loadApiWithOfficeWarmup<T>(
  load: () => Promise<T>,
  office: Pick<OfficeConversionRuntime, "start"> | null,
  processStarted?: Promise<void>,
): Promise<T> {
  // Unoserver includes a fixed startup wait. Overlap that wait with loading
  // the application graph, while preserving the same readiness requirement.
  const warmup = office?.start().catch(() => undefined);
  // Let the child process start before module evaluation occupies Node's
  // event loop; both initialization paths can then make progress together.
  if (processStarted) await Promise.race([processStarted, warmup]);
  const [implementation] = await Promise.all([load(), warmup]);
  return implementation;
}

export async function main(): Promise<void> {
  const bootstrapStarted = performance.now();
  configureApiFileCreationMask();
  const config = parseConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const redis = new LinkSenseRedis(config);
  const runner = new RunnerClient(config);
  const storage = createObjectStorage(config);
  let officeProcessStarted = () => {};
  const officeSpawned = new Promise<void>((resolve) => { officeProcessStarted = resolve; });
  const officeRuntime = isFullAppConfig(config)
    ? new LocalUnoserverRuntime({ onProcessStarted: officeProcessStarted })
    : null;
  let services: AppServices | null = null;
  let lifecycle: ApiLifecycle | null = null;

  try {
    await Promise.all([
      mkdir(config.userDataRoot, { recursive: true }),
      mkdir(config.capabilityRoot, { recursive: true }),
      redis.connect(),
    ]);
    await storage.ensureBucket();

    const boot = await loadApiWithOfficeWarmup(async () => {
      const [{ createServices }, { buildApi }] = await Promise.all([
        import("./services.js"), import("./app.js"),
      ]);
      const preparedServices = createServices({
        config, prisma, redis, runner, storage,
        ...(officeRuntime ? { officeRuntime } : {}),
      });
      services = preparedServices;
      return { app: await buildApi(preparedServices), services: preparedServices };
    }, officeRuntime, officeRuntime ? officeSpawned : undefined);
    const { app } = boot;
    app.log.info({ stage: "bootstrap", duration_ms: Math.round(performance.now() - bootstrapStarted) }, "API startup stage ready");
    lifecycle = createApiLifecycle({
      app,
      services: boot.services,
      redis,
      runner,
      prisma,
      host: config.host,
      port: config.port,
    });
    await lifecycle.start();
    // Persist enabled Node compilation caches before a container can be stopped.
    const cacheStarted = performance.now();
    flushCompileCache();
    app.log.info({ stage: "compile-cache", duration_ms: Math.round(performance.now() - cacheStarted) }, "API startup stage ready");
  } catch (error) {
    if (lifecycle) {
      await lifecycle.close().catch(() => undefined);
    } else {
      await closePartiallyStartedApi(services, redis, prisma);
      if (!services) await officeRuntime?.close().catch(() => undefined);
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
  const recoveryResult = await Promise.allSettled([
    Promise.resolve().then(() => resources.services.events.stopRecoveryMonitor()),
  ]);
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
    Promise.resolve().then(() => resources.services.botChannelRuntime.close()),
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
    ...recoveryResult,
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
  if (services) {
    await Promise.allSettled([
      Promise.resolve().then(() => services.events.stopRecoveryMonitor()),
      Promise.resolve().then(() => services.knowledgeGovernance?.close()),
      Promise.resolve().then(() => services.knowledgeSourceRuntime?.close()),
    ]);
    await Promise.allSettled([
      Promise.resolve().then(() => services.automationScheduler.close()),
      Promise.resolve().then(() => services.billingStatementScheduler.close()),
      Promise.resolve().then(() => services.clawHubScheduler.close()),
      Promise.resolve().then(() => services.feishu.close()),
      Promise.resolve().then(() => services.botChannelRuntime.close()),
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
