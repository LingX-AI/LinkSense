import {
  isRunnerTextDeltaEvent,
  runnerTextDeltaBatchKey,
  type RunnerTextDeltaEvent,
} from "@linksense/shared";
import type { RunnerEventBatch } from "./service.js";

export async function projectRunnerEventBatch<Entry extends RunnerEventBatch["events"][number]>(
  events: readonly Entry[],
  project: (entry: Entry, text: Array<{ deliveryId: string; event: RunnerTextDeltaEvent }>) => Promise<boolean>,
  onPartialFailure: (error: unknown, deliveryId: string) => void,
): Promise<string[]> {
  const accepted: string[] = [];
  for (let index = 0; index < events.length;) {
    const first = events[index];
    if (!first) break;
    const text: Array<{ deliveryId: string; event: RunnerTextDeltaEvent }> = [];
    const key = runnerTextDeltaBatchKey(first.event);
    if (key !== null) {
      for (const next of events.slice(index)) {
        if (!isRunnerTextDeltaEvent(next.event) || runnerTextDeltaBatchKey(next.event) !== key) break;
        text.push({ deliveryId: next.deliveryId, event: next.event });
      }
    }
    const entries = events.slice(index, index + Math.max(1, text.length));
    try {
      if (!await project(first, text)) break;
      accepted.push(...entries.map(entry => entry.deliveryId));
      index += entries.length;
    } catch (error) {
      if (accepted.length === 0) throw error;
      onPartialFailure(error, first.deliveryId);
      break;
    }
  }
  return accepted;
}
