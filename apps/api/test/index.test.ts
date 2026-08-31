import { describe, expect, it, vi } from "vitest";

import {
  configureApiFileCreationMask,
  createApiLifecycle,
  formatApiStartupFailure,
} from "../src/index.js";

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
          failureStage === "recover"
          ? 0
          : 1,
      );
      expect(fixture.startRecoveryMonitor).toHaveBeenCalledTimes(
        failureStage === "monitor" ? 1 : 0,
      );
    },
  );

  it("starts recovery before listening and closes successfully only once", async () => {
    const fixture = apiLifecycleFixture();

    await fixture.lifecycle.start();

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
  const startRecoveryMonitor = vi.fn();
  const stopRecoveryMonitor = vi.fn();
  const listen = vi.fn().mockResolvedValue("http://127.0.0.1:4000");
  const closeApp = vi.fn().mockResolvedValue(undefined);
  const closeJobs = vi.fn().mockResolvedValue(undefined);
  const closePasswordResetMail = vi.fn().mockResolvedValue(undefined);
  const closeRedis = vi.fn().mockResolvedValue(undefined);
  const disconnectPrisma = vi.fn().mockResolvedValue(undefined);
  return {
    lifecycle: createApiLifecycle({
      app: { listen, close: closeApp },
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
