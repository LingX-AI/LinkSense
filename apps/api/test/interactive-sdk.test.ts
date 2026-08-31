import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { interactiveApplicationSdkV1 } from "../src/modules/applications/interactive-sdk.js";

describe("interactive application SDK", () => {
  it("buffers replayed events until subscription and deduplicates by event id", async () => {
    const messageListeners: Array<(event: unknown) => void> = [];
    const readyListeners: Array<() => void> = [];
    const parent = { postMessage: vi.fn() };
    const window = {
      parent,
      addEventListener: vi.fn(
        (name: string, listener: (event: unknown) => void) => {
          if (name === "message") messageListeners.push(listener);
          if (name === "linksense:ready") {
            readyListeners.push(listener as () => void);
          }
        },
      ),
      dispatchEvent: vi.fn(() => {
        for (const listener of readyListeners.splice(0)) listener();
      }),
    };

    vm.runInNewContext(interactiveApplicationSdkV1, {
      window,
      CustomEvent: class CustomEvent {
        constructor(readonly type: string) {}
      },
      Error,
      Map,
      Object,
      Promise,
      Set,
      TypeError,
      queueMicrotask,
    });

    const instanceId = "10000000-0000-4000-8000-000000000001";
    dispatchMessage(messageListeners, parent, {
      protocol: "linksense.interactive.v1",
      type: "initialize",
      instanceId,
    });

    const firstEvent = {
      id: "20000000-0000-4000-8000-000000000001",
      sequence: 4,
      payload: { title: "First" },
    };
    const secondEvent = {
      id: "20000000-0000-4000-8000-000000000002",
      sequence: 8,
      payload: { title: "Second" },
    };
    for (const event of [firstEvent, firstEvent, secondEvent]) {
      dispatchMessage(messageListeners, parent, {
        protocol: "linksense.interactive.v1",
        type: "custom-event",
        instanceId,
        name: "research.section_ready",
        event,
      });
    }

    const handler = vi.fn();
    const sdk = (
      window as typeof window & {
        LinkSense: {
          ready: () => Promise<void>;
          events: { on: (name: string, handler: (event: unknown) => void) => void };
        };
      }
    ).LinkSense;
    await sdk.ready();
    sdk.events.on("research.section_ready", handler);

    expect(handler.mock.calls).toEqual([[firstEvent], [secondEvent]]);

    dispatchMessage(messageListeners, parent, {
      protocol: "linksense.interactive.v1",
      type: "custom-event",
      instanceId,
      name: "research.section_ready",
      event: secondEvent,
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

function dispatchMessage(
  listeners: Array<(event: unknown) => void>,
  parent: { postMessage: ReturnType<typeof vi.fn> },
  data: Record<string, unknown>,
) {
  for (const listener of listeners) listener({ source: parent, data });
}
