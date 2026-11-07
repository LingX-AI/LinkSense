import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserPanelScript,
  executeBrowserPanelOperation,
  parseBrowserPanelOutput,
} from "../src/browser/panel-operation.js";
import {
  readBrowserControl,
  withBrowserSessionLock,
} from "../src/browser/session-control.js";

const roots: string[] = [];
const token = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const frame = {
  image: "YQ==",
  url: "https://example.test/",
  title: "Example",
  width: 800,
  height: 600,
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "linksense-browser-panel-"),
  );
  roots.push(directory);
  let now = 1_000;
  const run = vi.fn(async () => frame);
  return {
    context: {
      directory,
      cliEntry: "unused",
      sessionName: "task",
      environment: {},
      cwd: directory,
      run,
      now: () => now,
    },
    run,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("task browser panel", () => {
  it("executes a screenshot in the pinned CLI's restricted VM without host globals", async () => {
    const screenshot = vi.fn(async () => Buffer.from("a"));
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      screenshot,
      url: () => "https://example.test/",
      title: async () => "Example",
    };
    const invoke = vm.runInNewContext(`(${browserPanelScript()})`, {}) as (
      value: typeof page,
    ) => Promise<unknown>;
    await expect(invoke(page)).resolves.toEqual(frame);
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it("validates script inputs and keeps typed text as a literal", async () => {
    const insertText = vi.fn(async () => undefined);
    const source = '"); throw new Error("injected"); //';
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      screenshot: async () => Buffer.from("a"),
      url: () => frame.url,
      title: async () => frame.title,
      keyboard: { insertText },
    };
    const invoke = vm.runInNewContext(
      `(${browserPanelScript({ type: "text", text: source })})`,
      {},
    ) as (value: typeof page) => Promise<unknown>;
    await invoke(page);
    expect(insertText).toHaveBeenCalledWith(source);
  });

  it("keeps one control owner, rejects foreign input, and releases expired control", async () => {
    const f = await fixture();
    expect(
      await executeBrowserPanelOperation(f.context, { action: "claim", token }),
    ).toMatchObject({ has_control: true, mode: "human" });
    await expect(
      executeBrowserPanelOperation(f.context, {
        action: "claim",
        token: other,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_CONTROL_REQUIRED" });
    await expect(
      executeBrowserPanelOperation(f.context, {
        action: "input",
        token: other,
        input: { type: "key", key: "Enter" },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_CONTROL_REQUIRED" });
    expect(
      await executeBrowserPanelOperation(f.context, {
        action: "frame",
        token: other,
      }),
    ).toMatchObject({ has_control: false, mode: "human" });
    f.advance(30_001);
    await expect(
      executeBrowserPanelOperation(f.context, {
        action: "input",
        token,
        input: { type: "key", key: "Enter" },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_CONTROL_REQUIRED" });
    expect(
      await executeBrowserPanelOperation(f.context, {
        action: "claim",
        token: other,
      }),
    ).toMatchObject({ has_control: true });
    expect(await readBrowserControl(f.context.directory)).toMatchObject({
      token: other,
    });
  });

  it("does not renew the lease when only reading a frame", async () => {
    const f = await fixture();
    await executeBrowserPanelOperation(f.context, { action: "claim", token });
    const before = await readBrowserControl(f.context.directory);
    f.advance(5_000);
    await executeBrowserPanelOperation(f.context, { action: "frame", token });
    expect(await readBrowserControl(f.context.directory)).toEqual(before);
  });

  it("releases control idempotently and leaves a short continuation window", async () => {
    const f = await fixture();
    await executeBrowserPanelOperation(f.context, { action: "claim", token });
    expect(
      await executeBrowserPanelOperation(f.context, {
        action: "release",
        token,
      }),
    ).toMatchObject({ has_control: false, mode: "agent" });
    expect(
      await executeBrowserPanelOperation(f.context, {
        action: "release",
        token,
      }),
    ).toMatchObject({ has_control: false, mode: "agent" });
    expect(await readBrowserControl(f.context.directory)).toMatchObject({
      token,
      expiresAt: 0,
      retainUntil: 61_000,
    });
  });

  it("serializes commands across callers and releases locks after failures", async () => {
    const f = await fixture();
    let unblock: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withBrowserSessionLock(f.context.directory, async () => {
      entered?.();
      await gate;
      throw new Error("command failed");
    });
    const rejection = expect(first).rejects.toThrow("command failed");
    await started;
    await expect(
      withBrowserSessionLock(f.context.directory, async () => undefined, 0),
    ).rejects.toMatchObject({ code: "BROWSER_CONTROL_BUSY" });
    unblock?.();
    await rejection;
    await expect(
      withBrowserSessionLock(f.context.directory, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("reads only structured frame results and removes URL credentials", () => {
    const output = `### Result\n${JSON.stringify({ ...frame, url: "https://name:password@example.test/path?q=redacted" })}\n### Ran Playwright code\nignored`;
    expect(parseBrowserPanelOutput(output).url).toBe(
      "https://example.test/path?q=redacted",
    );
    expect(() =>
      parseBrowserPanelOutput("### Error\nprivate diagnostic"),
    ).toThrow();
  });
});
