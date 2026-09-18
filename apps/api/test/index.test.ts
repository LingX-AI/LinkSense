import { describe, expect, it, vi } from "vitest";

import {
  ApiStartupError,
  configureApiFileCreationMask,
  createApiLifecycle,
  formatApiStartupFailure,
  loadApiWithOfficeWarmup,
} from "../src/index.js";

describe("API implementation loading", () => {
  it("waits for the converter process to spawn before evaluating application modules", async () => {
    let spawned = () => {};
    let ready = () => {};
    const processStarted = new Promise<void>((resolve) => { spawned = resolve; });
    const warmup = new Promise<void>((resolve) => { ready = resolve; });
    const load = vi.fn(async () => "loaded");
    const result = loadApiWithOfficeWarmup(load, { start: () => warmup }, processStarted);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    spawned();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    ready();
    await expect(result).resolves.toBe("loaded");
  });
  it("loads application modules while Office initializes and waits for both", async () => {
    let finishWarmup = () => {};
    const pendingWarmup = new Promise<void>((resolve) => { finishWarmup = resolve; });
    const stages: string[] = [];
    const result = loadApiWithOfficeWarmup(
      async () => { stages.push("modules"); return "loaded"; },
      { start: async () => { stages.push("office"); await pendingWarmup; } },
    );
    let completed = false;
    void result.then(() => { completed = true; });
    await Promise.resolve();
    expect(stages).toEqual(["office", "modules"]);
    expect(completed).toBe(false);
    finishWarmup();
    await expect(result).resolves.toBe("loaded");
  });

  it("retains optional Office failure handling and propagates module loading failures", async () => {
    await expect(loadApiWithOfficeWarmup(async () => "loaded", {
      start: async () => { throw new Error("converter unavailable"); },
    })).resolves.toBe("loaded");
    const failure = new Error("invalid application module");
    await expect(loadApiWithOfficeWarmup(async () => { throw failure; }, null)).rejects.toBe(failure);
  });
});

describe("API startup lifecycle", () => {
  it("uses a group-sharing umask before creating runtime files", () => {
    const umask = vi.spyOn(process, "umask").mockReturnValue(0o022);

    configureApiFileCreationMask();

    expect(umask).toHaveBeenCalledExactlyOnceWith(0o007);
  });

  it.each([
    "governance",
    "knowledge",
    "knowledge-source",
    "automation",
    "billing",
    "clawhub",
    "feishu",
    "weixin",
    "runner",
    "recover",
    "listen",
    "monitor",
  ] as const)(
    "closes every resource and preserves the original %s failure",
    async (failureStage) => {
      const startupError = new Error(`${failureStage} failed`);
      const fixture = apiLifecycleFixture();
      if (failureStage === "governance") {
        fixture.startKnowledgeGovernance.mockRejectedValueOnce(startupError);
      } else if (failureStage === "knowledge") {
        fixture.startKnowledgeRuntime.mockRejectedValueOnce(startupError);
      } else if (failureStage === "knowledge-source") {
        fixture.startKnowledgeSourceRuntime.mockRejectedValueOnce(startupError);
      } else if (failureStage === "automation") {
        fixture.startAutomationScheduler.mockRejectedValueOnce(startupError);
      } else if (failureStage === "billing") {
        fixture.startBillingStatementScheduler.mockRejectedValueOnce(
          startupError,
        );
      } else if (failureStage === "clawhub") {
        fixture.startClawHubScheduler.mockRejectedValueOnce(startupError);
      } else if (failureStage === "feishu") {
        fixture.startFeishuRuntime.mockRejectedValueOnce(startupError);
      } else if (failureStage === "weixin") {
        fixture.startWeixinRuntime.mockRejectedValueOnce(startupError);
      } else if (failureStage === "runner") {
        fixture.waitForRunner.mockRejectedValueOnce(startupError);
      } else if (failureStage === "recover") {
        fixture.recoverRunningTurns.mockRejectedValueOnce(startupError);
      } else if (failureStage === "listen") {
        fixture.listen.mockRejectedValueOnce(startupError);
      } else {
        fixture.startRecoveryMonitor.mockImplementationOnce(() => {
          throw startupError;
        });
      }
      fixture.closeApp.mockRejectedValueOnce(new Error("app close failed"));
      fixture.closeJobs.mockImplementationOnce(() => {
        throw new Error("jobs close failed");
      });

      await expect(fixture.lifecycle.start()).rejects.toBe(startupError);

      expect(fixture.stopRecoveryMonitor).toHaveBeenCalledOnce();
      expect(fixture.closeApp).toHaveBeenCalledOnce();
      expect(fixture.closeJobs).toHaveBeenCalledOnce();
      expect(fixture.closePasswordResetMail).toHaveBeenCalledOnce();
      expect(fixture.closeAutomationScheduler).toHaveBeenCalledOnce();
      expect(fixture.closeBillingStatementScheduler).toHaveBeenCalledOnce();
      expect(fixture.closeClawHubScheduler).toHaveBeenCalledOnce();
      expect(fixture.closeFeishuService).toHaveBeenCalledOnce();
      expect(fixture.closeFeishuRuntime).toHaveBeenCalledOnce();
      expect(fixture.closeWeixinRuntime).toHaveBeenCalledOnce();
      expect(fixture.closeKnowledgeRuntime).toHaveBeenCalledOnce();
      expect(fixture.closeKnowledgeSourceRuntime).toHaveBeenCalledOnce();
      expect(fixture.closeKnowledgeGovernance).toHaveBeenCalledOnce();
      expect(fixture.closeRedis).toHaveBeenCalledOnce();
      expect(fixture.disconnectPrisma).toHaveBeenCalledOnce();
      expect(fixture.listen).toHaveBeenCalledTimes(
        failureStage === "governance" ||
          failureStage === "knowledge" ||
          failureStage === "knowledge-source" ||
          failureStage === "automation" ||
          failureStage === "billing" ||
          failureStage === "clawhub" ||
          failureStage === "feishu" ||
          failureStage === "weixin" ||
          failureStage === "runner" ||
          failureStage === "recover"
          ? 0
          : 1,
      );
      expect(fixture.startRecoveryMonitor).toHaveBeenCalledTimes(
        failureStage === "monitor" ? 1 : 0,
      );
    },
  );

  it("waits for Runner readiness before recovering persisted tasks or listening", async () => {
    const fixture = apiLifecycleFixture();
    let ready = () => {};
    fixture.waitForRunner.mockReturnValueOnce(new Promise<void>((resolve) => { ready = resolve; }));
    const startup = fixture.lifecycle.start();

    try {
      await vi.waitFor(() => expect(fixture.waitForRunner).toHaveBeenCalledOnce());
      expect(fixture.recoverRunningTurns).not.toHaveBeenCalled();
      expect(fixture.listen).not.toHaveBeenCalled();
    } finally {
      ready();
      await startup;
    }

    expect(fixture.recoverRunningTurns).toHaveBeenCalledOnce();
    expect(fixture.listen).toHaveBeenCalledOnce();
    expect(fixture.startRecoveryMonitor).toHaveBeenCalledOnce();
  });

  it("reports a sanitized startup failure before waiting for resource cleanup", async () => {
    const fixture = apiLifecycleFixture();
    const failure = Object.assign(new Error("private connection details"), {
      reasonCode: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
    });
    fixture.recoverRunningTurns.mockRejectedValueOnce(failure);
    let closed = () => {};
    fixture.closeApp.mockReturnValueOnce(new Promise<void>((resolve) => { closed = resolve; }));
    const startup = expect(fixture.lifecycle.start()).rejects.toBe(failure);

    try {
      await vi.waitFor(() => expect(fixture.closeApp).toHaveBeenCalledOnce());
      expect(fixture.startupLog).toHaveBeenCalledWith({ stage: "http" }, "API shutdown stage started");
      expect(fixture.startupLog).not.toHaveBeenCalledWith(expect.objectContaining({ stage: "http" }), "API shutdown stage finished");
      expect(fixture.startupErrorLog).toHaveBeenCalledExactlyOnceWith({
        error_class: "Error",
        reason_code: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
      }, "API startup failed");
      expect(JSON.stringify(fixture.startupErrorLog.mock.calls)).not.toContain("private connection details");
    } finally {
      closed();
      await startup;
    }
  });

  it("starts recovery before listening and closes successfully only once", async () => {
    const fixture = apiLifecycleFixture();

    await fixture.lifecycle.start();

    expect(fixture.startupLog).toHaveBeenCalledWith(
      { stage: "task-recovery", duration_ms: expect.any(Number) },
      "API startup stage ready",
    );
    expect(fixture.startKnowledgeGovernance).toHaveBeenCalledOnce();
    expect(fixture.startKnowledgeRuntime).toHaveBeenCalledOnce();
    expect(fixture.startKnowledgeSourceRuntime).toHaveBeenCalledOnce();
    expect(fixture.startAutomationScheduler).toHaveBeenCalledOnce();
    expect(fixture.startBillingStatementScheduler).toHaveBeenCalledOnce();
    expect(fixture.startClawHubScheduler).toHaveBeenCalledOnce();
    expect(fixture.startFeishuRuntime).toHaveBeenCalledOnce();
    expect(fixture.startWeixinRuntime).toHaveBeenCalledOnce();
    expect(fixture.recoverRunningTurns).toHaveBeenCalledOnce();
    expect(
      fixture.startKnowledgeGovernance.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.startKnowledgeRuntime.mock.invocationCallOrder[0]!);
    expect(
      fixture.startKnowledgeRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.startKnowledgeSourceRuntime.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.startKnowledgeSourceRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.startAutomationScheduler.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.startAutomationScheduler.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.recoverRunningTurns.mock.invocationCallOrder[0]!);
    expect(
      fixture.startBillingStatementScheduler.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.recoverRunningTurns.mock.invocationCallOrder[0]!);
    expect(
      fixture.startClawHubScheduler.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.recoverRunningTurns.mock.invocationCallOrder[0]!);
    expect(
      fixture.startFeishuRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.recoverRunningTurns.mock.invocationCallOrder[0]!);
    expect(
      fixture.startWeixinRuntime.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.recoverRunningTurns.mock.invocationCallOrder[0]!);
    expect(fixture.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 4000,
    });
    expect(fixture.startRecoveryMonitor).toHaveBeenCalledOnce();
    expect(fixture.closeApp).not.toHaveBeenCalled();

    await Promise.all([fixture.lifecycle.close(), fixture.lifecycle.close()]);

    expect(fixture.stopRecoveryMonitor).toHaveBeenCalledOnce();
    expect(fixture.closeApp).toHaveBeenCalledOnce();
    expect(fixture.closeJobs).toHaveBeenCalledOnce();
    expect(fixture.closePasswordResetMail).toHaveBeenCalledOnce();
    expect(fixture.closeAutomationScheduler).toHaveBeenCalledOnce();
    expect(fixture.closeBillingStatementScheduler).toHaveBeenCalledOnce();
    expect(fixture.closeClawHubScheduler).toHaveBeenCalledOnce();
    expect(fixture.closeFeishuService).toHaveBeenCalledOnce();
    expect(fixture.closeFeishuRuntime).toHaveBeenCalledOnce();
    expect(fixture.closeWeixinRuntime).toHaveBeenCalledOnce();
    expect(fixture.closeKnowledgeRuntime).toHaveBeenCalledOnce();
    expect(fixture.closeKnowledgeSourceRuntime).toHaveBeenCalledOnce();
    expect(fixture.closeKnowledgeGovernance).toHaveBeenCalledOnce();
    expect(
      fixture.closeKnowledgeGovernance.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.closeKnowledgeRuntime.mock.invocationCallOrder[0]!);
    expect(fixture.closeRedis).toHaveBeenCalledOnce();
    expect(fixture.disconnectPrisma).toHaveBeenCalledOnce();
    expect(
      fixture.closeClawHubScheduler.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.closeRedis.mock.invocationCallOrder[0]!);
    expect(
      fixture.closeClawHubScheduler.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.disconnectPrisma.mock.invocationCallOrder[0]!);
  });
});

describe("API startup failure reporting", () => {
  it("identifies a refused object storage connection without exposing credentials or addresses", () => {
    const cause = Object.assign(new Error("connect refused http://private:password@storage.internal:9000"), {
      code: "ECONNREFUSED",
    });
    const failure = new ApiStartupError("object-storage", cause);

    expect(formatApiStartupFailure(failure)).toBe(
      "LinkSense API failed to start (Error, stage=object-storage, reason=ECONNREFUSED).\n",
    );
    expect(failure.cause).toBe(cause);
  });

  it("keeps the startup stage when the underlying failure has no safe reason code", () => {
    const failure = new ApiStartupError("bootstrap", new Error("password=private-value"));

    expect(formatApiStartupFailure(failure)).toBe(
      "LinkSense API failed to start (Error, stage=bootstrap).\n",
    );
  });

  it("reports an explicitly supplied stable recovery reason code", () => {
    const error = Object.assign(new Error("private detail"), {
      name: "RunningTurnRecoveryCycleError",
      reasonCode: "RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE",
    });

    expect(formatApiStartupFailure(error)).toBe(
      "LinkSense API failed to start (RunningTurnRecoveryCycleError, " +
        "reason=RUNNING_TURN_RECOVERY_RUNNER_UNAVAILABLE).\n",
    );
  });

  it("accepts a stable reason code from the error message", () => {
    const error = new Error("RUNNING_TURN_RECOVERY_DATABASE_UNAVAILABLE");
    error.name = "RunningTurnRecoveryCycleError";

    expect(formatApiStartupFailure(error)).toContain(
      "reason=RUNNING_TURN_RECOVERY_DATABASE_UNAVAILABLE",
    );
  });

  it("never exposes an arbitrary error message or invalid reason property", () => {
    const error = Object.assign(new Error("database password=private-value"), {
      reasonCode: "private reason",
    });

    expect(formatApiStartupFailure(error)).toBe(
      "LinkSense API failed to start (Error).\n",
    );
  });
});

function apiLifecycleFixture() {
  const startKnowledgeGovernance = vi.fn().mockResolvedValue(undefined);
  const closeKnowledgeGovernance = vi.fn().mockResolvedValue(undefined);
  const startKnowledgeRuntime = vi.fn().mockResolvedValue(undefined);
  const closeKnowledgeRuntime = vi.fn().mockResolvedValue(undefined);
  const startKnowledgeSourceRuntime = vi.fn().mockResolvedValue(undefined);
  const closeKnowledgeSourceRuntime = vi.fn().mockResolvedValue(undefined);
  const startAutomationScheduler = vi.fn().mockResolvedValue(undefined);
  const closeAutomationScheduler = vi.fn().mockResolvedValue(undefined);
  const startBillingStatementScheduler = vi.fn().mockResolvedValue(undefined);
  const closeBillingStatementScheduler = vi.fn().mockResolvedValue(undefined);
  const startClawHubScheduler = vi.fn().mockResolvedValue(undefined);
  const closeClawHubScheduler = vi.fn().mockResolvedValue(undefined);
  const startFeishuRuntime = vi.fn().mockResolvedValue(undefined);
  const closeFeishuRuntime = vi.fn().mockResolvedValue(undefined);
  const closeFeishuService = vi.fn().mockResolvedValue(undefined);
  const startWeixinRuntime = vi.fn().mockResolvedValue(undefined);
  const closeWeixinRuntime = vi.fn().mockResolvedValue(undefined);
  const recoverRunningTurns = vi.fn().mockResolvedValue(undefined);
  const waitForRunner = vi.fn().mockResolvedValue(undefined);
  const startRecoveryMonitor = vi.fn();
  const stopRecoveryMonitor = vi.fn();
  const listen = vi.fn().mockResolvedValue("http://127.0.0.1:4000");
  const closeApp = vi.fn().mockResolvedValue(undefined);
  const startupLog = vi.fn();
  const startupErrorLog = vi.fn();
  const closeJobs = vi.fn().mockResolvedValue(undefined);
  const closePasswordResetMail = vi.fn().mockResolvedValue(undefined);
  const closeRedis = vi.fn().mockResolvedValue(undefined);
  const disconnectPrisma = vi.fn().mockResolvedValue(undefined);
  return {
    lifecycle: createApiLifecycle({
      app: { listen, close: closeApp, log: { info: startupLog, error: startupErrorLog } },
      runner: { waitUntilReady: waitForRunner },
      services: {
        events: {
          recoverRunningTurns,
          startRecoveryMonitor,
          stopRecoveryMonitor,
        },
        jobs: { close: closeJobs },
        passwordResetMail: { close: closePasswordResetMail },
        automationScheduler: {
          start: startAutomationScheduler,
          close: closeAutomationScheduler,
        },
        billingStatementScheduler: {
          start: startBillingStatementScheduler,
          close: closeBillingStatementScheduler,
        },
        clawHubScheduler: {
          start: startClawHubScheduler,
          close: closeClawHubScheduler,
        },
        feishu: { close: closeFeishuService },
        botChannelRuntime: { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
        feishuRuntime: {
          start: startFeishuRuntime,
          close: closeFeishuRuntime,
        },
        weixinRuntime: {
          start: startWeixinRuntime,
          close: closeWeixinRuntime,
        },
        knowledgeGovernance: {
          start: startKnowledgeGovernance,
          close: closeKnowledgeGovernance,
        },
        knowledgeRuntime: {
          start: startKnowledgeRuntime,
          close: closeKnowledgeRuntime,
        },
        knowledgeSourceRuntime: {
          start: startKnowledgeSourceRuntime,
          close: closeKnowledgeSourceRuntime,
        },
      },
      redis: { close: closeRedis },
      prisma: { $disconnect: disconnectPrisma },
      host: "127.0.0.1",
      port: 4000,
    } as never),
    recoverRunningTurns,
    waitForRunner,
    startupLog,
    startupErrorLog,
    startKnowledgeGovernance,
    closeKnowledgeGovernance,
    startKnowledgeRuntime,
    closeKnowledgeRuntime,
    startKnowledgeSourceRuntime,
    closeKnowledgeSourceRuntime,
    startAutomationScheduler,
    closeAutomationScheduler,
    startBillingStatementScheduler,
    closeBillingStatementScheduler,
    startClawHubScheduler,
    closeClawHubScheduler,
    startFeishuRuntime,
    closeFeishuRuntime,
    closeFeishuService,
    startWeixinRuntime,
    closeWeixinRuntime,
    startRecoveryMonitor,
    stopRecoveryMonitor,
    listen,
    closeApp,
    closeJobs,
    closePasswordResetMail,
    closeRedis,
    disconnectPrisma,
  };
}
