import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { interactiveApplicationSdkV1 } from "../src/modules/applications/interactive-sdk.js";

describe("interactive application SDK", () => {
  it("bridges file objects, list and remove calls without encoding and propagates upload errors", async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const parent = { postMessage: vi.fn() };
    const window = { parent, addEventListener: (_name: string, handler: (event: unknown) => void) => listeners.push(handler), dispatchEvent: vi.fn() };
    vm.runInNewContext(interactiveApplicationSdkV1, { window, CustomEvent: class {}, queueMicrotask });
    const sdk = (window as typeof window & { LinkSense: { files: { upload: (file: File) => Promise<unknown>; list: () => Promise<unknown>; remove: (id: string) => Promise<unknown> } } }).LinkSense;
    await expect(sdk.files.list()).rejects.toThrow("LINKSENSE_SDK_NOT_READY");
    const instanceId = "instance";
    dispatchMessage(listeners, parent, { protocol: "linksense.interactive.v1", type: "initialize", instanceId });
    const file = new File(["notes"], "notes.txt");
    const upload = sdk.files.upload(file);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ method: "files.upload", params: { file } }), "*");
    const response = (result: unknown, ok = true) => {
      const request = parent.postMessage.mock.calls.at(-1)?.[0];
      dispatchMessage(listeners, parent, { protocol: "linksense.interactive.v1", instanceId, type: "response", requestId: request.requestId, ok, result, error: result });
    };
    response({ id: "file-1" });
    await expect(upload).resolves.toEqual({ id: "file-1" });
    const listing = sdk.files.list();
    response({ items: [] });
    await expect(listing).resolves.toEqual({ items: [] });
    const removal = sdk.files.remove("file-1");
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ method: "files.remove", params: { file_id: "file-1" } }), "*");
    response("CONFLICT", false);
    await expect(removal).rejects.toThrow("CONFLICT");
  });

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
