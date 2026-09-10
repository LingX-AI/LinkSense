import type { ThreadGoalSetParams } from "./protocol.js";

type ShutdownProcess = {
  codexThreadId: string | null;
  activeTurnId: string | null;
  activeGoal: { status: string } | null;
  client: { request(method: string, params: unknown): Promise<unknown> };
};

/** Best-effort native cancellation; the caller still closes every process. */
export async function interruptNativeExecutionForShutdown(
  processes: readonly ShutdownProcess[],
): Promise<void> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, 1_000);
  });
  try {
    await Promise.race([
      deadline,
      Promise.allSettled(
        processes.map(async (managed) => {
          const threadId = managed.codexThreadId;
          if (!threadId) return;
          if (managed.activeGoal?.status === "active") {
            try {
              await managed.client.request("thread/goal/set", {
                threadId,
                status: "paused",
              } satisfies ThreadGoalSetParams);
            } catch {
              /* Container/process shutdown remains authoritative. */
            }
          }
          if (!expired && managed.activeTurnId) {
            await managed.client.request("turn/interrupt", {
              threadId,
              turnId: managed.activeTurnId,
            });
          }
        }),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
