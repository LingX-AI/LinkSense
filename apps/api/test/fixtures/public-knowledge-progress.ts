import { vi } from "vitest";
import type { PublicKnowledgeProgressStore } from "../../src/modules/public-knowledge/progress.js";

export function publicKnowledgeProgressFixture() {
  return {
    close: vi.fn(() => undefined),
    step: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined),
    ingest: vi.fn(async () => undefined),
    snapshot: vi.fn(async (id: string) => ({
      events: [],
      event_cursor: `${id}:0`,
    })),
    stream: vi.fn(async function* () {
      yield ": ready\n\n";
    }),
  } satisfies PublicKnowledgeProgressStore;
}
