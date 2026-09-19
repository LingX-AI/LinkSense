import { AsyncLocalStorage } from "node:async_hooks";

type Stage = "application_runtime_resolution" | "application_home_prepare" | "conversation_storage_prepare" | "application_development_open" | "http_response" | "user_lease_wait" | "conversation_lock_wait" | "capability_resolution" | "start_admission" | "runner_accept" | "start_projection";
type Identity = { conversationId?: string; turnId?: string };
type Context = {
  log: { info: (fields: Record<string, unknown>, message: string) => void };
  startedAt: number;
  now: () => number;
  identity: Identity;
  measured: boolean;
};
const contexts = new AsyncLocalStorage<Context>();

export function withTaskLatencyContext<T>(log: Context["log"], action: () => T, now = () => performance.now()): T {
  return contexts.run({ log, now, startedAt: now(), identity: {}, measured: false }, action);
}

export function bindTaskLatency(identity: Identity): void {
  const context = contexts.getStore();
  if (context) Object.assign(context.identity, identity);
}

export function startTaskStage(stage: Stage): (outcome?: "ok" | "error") => void {
  const context = contexts.getStore();
  const startedAt = context?.now() ?? 0;
  let finished = false;
  return (outcome = "ok") => {
    if (!context || finished) return;
    finished = true;
    context.measured = true;
    context.log.info({ ...context.identity, stage, outcome,
      durationMs: Math.max(0, context.now() - startedAt),
      elapsedMs: Math.max(0, context.now() - context.startedAt),
    }, "task admission latency");
  };
}

export async function measureTaskStage<T>(stage: Stage, action: () => Promise<T>): Promise<T> {
  const finish = startTaskStage(stage);
  try { const result = await action(); finish(); return result; }
  catch (error) { finish("error"); throw error; }
}

export function finishTaskRequest(): void {
  const context = contexts.getStore();
  if (!context?.measured) return;
  context.log.info({ ...context.identity, stage: "http_response", elapsedMs: Math.max(0, context.now() - context.startedAt) }, "task admission latency");
}
