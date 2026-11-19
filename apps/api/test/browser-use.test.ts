import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserUseService } from "../src/modules/browser-use/service.js";
import { MemoryBrowserStore } from "./browser-use-store.js";
import { createHash } from "node:crypto";
import { browserUseFailure, browserUseOpenSiteCapability, type BrowserUseResult } from "@linksense/shared";
import { z } from "zod";
import type { DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const task = "20000000-0000-4000-8000-000000000001";
const scope = {
  ownerId: owner, conversationId: task, turnId: task, deviceId: other,
  connectionId: task, runtimeGeneration: owner,
} satisfies DesktopRunScope;
const encryption = { credentialMasterKey: "test-only-browser-cache-key", credentialKeyId: "fixture" };
afterEach(() => vi.useRealTimers());
async function fixture(isActiveRun?: (scope: DesktopRunScope) => Promise<boolean>) {
  const store = new MemoryBrowserStore();
  const service = new BrowserUseService(
    store,
    "https://linksense.example/api/v1/browser-use",
    isActiveRun && { ...encryption, isActiveRun },
  );
  const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
  const token = await service.pair(pairing.code);
  const connection = await service.connect(owner, token, "chrome");
  return { store, service, token, connection, pairing };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

describe("local browser connection and delivery", () => {
  it("keeps new extension connections readable by pre-upgrade API replicas", async () => {
    const { service, store, token } = await fixture();
    const connection = await service.connect(owner, token, "chrome", browserUseOpenSiteCapability);
    // Previous API replicas strictly validate this shared Redis record.
    const previousConnectionSchema = z.strictObject({
      id: z.uuid(),
      browser: z.enum(["chrome", "edge"]),
      credential_hash: z.string(),
      approval_id: z.uuid().optional(),
    });
    const value = await store.get(`local-browser:${owner}:connection`);
    expect(previousConnectionSchema.parse(JSON.parse(value ?? "null"))).toMatchObject({
      id: connection,
      browser: "chrome",
    });
    const otherReplica = new BrowserUseService(store, service.endpoint);
    expect(await otherReplica.status(owner)).toMatchObject({ connected: true, connection_id: connection });
    expect(await otherReplica.maintain(owner, connection)).toBe(true);
  });
  it("renews site-window capability only with its current connection and denies it after expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { service, token } = await fixture();
    const connection = await service.connect(owner, token, "chrome", browserUseOpenSiteCapability);
    const request = { action: "open_site_window", slug: "sample-site" } as const;
    const cancelled = AbortSignal.abort();
    vi.setSystemTime(Date.now() + 30_000);
    expect(await service.maintain(owner, connection)).toBe(true);
    vi.setSystemTime(Date.now() + 30_000);
    await expect(service.execute(owner, task, request, cancelled)).resolves.toMatchObject({
      code: "BROWSER_USE_CANCELLED",
    });
    vi.setSystemTime(Date.now() + 45_001);
    await expect(service.execute(owner, task, request, cancelled)).resolves.toMatchObject({
      code: "BROWSER_USE_NOT_CONNECTED",
    });
  });
  it("does not carry site-window capability into a replacement legacy extension connection", async () => {
    const { service, token } = await fixture();
    const upgraded = await service.connect(owner, token, "chrome", browserUseOpenSiteCapability);
    const legacy = await service.connect(owner, token, "edge");
    expect(await service.maintain(owner, upgraded)).toBe(false);
    await service.disconnect(owner, upgraded);
    expect(await service.status(owner)).toMatchObject({ connection_id: legacy });
    await expect(service.execute(owner, task, {
      action: "open_site_window", slug: "sample-site",
    })).resolves.toMatchObject({ code: "BROWSER_USE_ACCESS_DENIED" });
    expect(await service.next(owner, legacy)).toBeNull();
  });
  it("does not send site-window commands to an older connected extension", async () => {
    const { service, store, connection, token } = await fixture();
    const request = { action: "open_site_window", slug: "sample-site" } as const;
    await expect(service.execute(owner, task, request)).resolves.toMatchObject({ ok: false, code: "BROWSER_USE_ACCESS_DENIED" });
    expect(await service.next(owner, connection)).toBeNull();
    const upgraded = await service.connect(owner, token, "chrome", browserUseOpenSiteCapability);
    const controller = new AbortController();
    const result = service.execute(owner, task, request, controller.signal);
    try {
      await vi.waitFor(async () => expect(await service.activeCommand(owner, upgraded)).not.toBeNull());
      // Pre-upgrade API replicas read only the original command and request keys.
      expect(await store.get(`local-browser:${owner}:request`)).toBeNull();
      expect(await store.get(`local-browser:${owner}:command`)).toBeNull();
      const command = await service.next(owner, upgraded);
      expect(command?.request).toEqual(request);
      if (!command) throw new Error("Missing site-window command");
      await service.reply(owner, upgraded, { id: command.id, result: { ok: true, browser: "local", data: {} } });
      await expect(result).resolves.toMatchObject({ ok: true });
    } finally {
      controller.abort();
      await result;
    }
  });
  it("keeps real pre-rename Redis credentials, approval and connection usable without re-pairing", async () => {
    const store = new MemoryBrowserStore();
    const token = "t".repeat(43);
    const hash = createHash("sha256").update(token).digest("hex");
    const approval = "30000000-0000-4000-8000-000000000001";
    const connection = "40000000-0000-4000-8000-000000000001";
    await store.put(`local-browser:credential:${hash}`, JSON.stringify({
      owner, auth_valid_after: "2026-01-01T00:00:00.000Z",
      origin: "https://linksense.example", approval_id: approval,
    }), 86_400_000);
    await store.put(`local-browser:${owner}:credential`, hash, 86_400_000);
    await store.put(`local-browser:${owner}:approval`, approval, 30 * 86_400_000);
    await store.put(`local-browser:${owner}:connection`, JSON.stringify({
      id: connection, browser: "chrome", credential_hash: hash, approval_id: approval,
    }), 45_000);
    const service = new BrowserUseService(store, "https://linksense.example/api/v1/local-browser");
    expect(await service.authenticate(token)).toMatchObject({ owner, approval_id: approval });
    expect(await service.status(owner)).toEqual({ connected: true, connection_id: connection, browser: "chrome" });
    expect(await service.maintain(owner, connection)).toBe(true);
    const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    const renewed = await service.pair(pairing.code, approval);
    expect(await service.authenticate(renewed)).toMatchObject({ owner, approval_id: approval });
    expect(await service.authenticate(token)).toBeNull();
    await service.revoke(owner);
    expect(await service.authenticate(renewed)).toBeNull();
    expect(await service.wasRevoked(renewed)).toBe(true);
  });
  it("consumes pairing once, stores only credential hashes and separates owners", async () => {
    const { service, store, token, pairing } = await fixture();
    await expect(service.pair(pairing.code)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(await service.authenticate(token)).toMatchObject({ owner });
    expect(await service.authenticate("invalid")).toBeNull();
    expect(await service.status(other)).toEqual({ connected: false });
    expect(JSON.stringify([...store.values])).not.toContain(token);
  });
  it("expires pairing and credentials and revokes a connected browser", async () => {
    vi.useFakeTimers();
    const { service, token } = await fixture();
    const pair = await service.pairing(other, "2026-01-01T00:00:00.000Z");
    vi.advanceTimersByTime(120001);
    await expect(service.pair(pair.code)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(await service.wasRevoked(token)).toBe(false);
    await service.revoke(owner);
    expect(await service.wasRevoked(token)).toBe(true);
    expect(await service.authenticate(token)).toBeNull();
    expect(await service.status(owner)).toEqual({ connected: false });
    await expect(service.connect(owner, token, "chrome")).rejects.toMatchObject(
      { code: "AUTH_REQUIRED" },
    );
  });
  it("delivers once, rejects competing commands and ignores replies from a replaced socket", async () => {
    const { service, connection } = await fixture();
    const running = service.execute(owner, task, {
      action: "open",
      url: "https://example.test",
    });
    await vi.waitFor(async () =>
      expect(
        await service.store.get(`local-browser:${owner}:command`),
      ).not.toBeNull(),
    );
    expect(
      await service.execute(owner, task, { action: "tabs" }),
    ).toMatchObject({ ok: false, code: "BROWSER_USE_BUSY" });
    const command = await service.next(owner, connection);
    expect(command).toMatchObject({
      conversation_id: task,
      request: { action: "open" },
    });
    expect(await service.next(owner, connection)).toBeNull();
    await service.reply(owner, other, {
      id: command!.id,
      result: { ok: true, browser: "local", data: { tab_id: 99 } },
    });
    expect(
      await service.store.get(`local-browser:${owner}:reply:${command!.id}`),
    ).toBeNull();
    await service.reply(owner, connection, {
      id: command!.id,
      result: { ok: true, browser: "local", data: { tab_id: 1 } },
    });
    expect(await running).toMatchObject({ ok: true, data: { tab_id: 1 } });
    expect(await service.store.get(`local-browser:${owner}:lock`)).toBeNull();
  });

  it("does not queue a browser mutation when the desktop lease disappears during mailbox preparation", async () => {
    const { store, service, connection } = await fixture(async () => true);
    const put = vi.spyOn(store, "put");
    const checkRun = vi.fn(async () => {
      if (await store.get(`local-browser:${owner}:desktop:request`)) throw new Error("fixture lease revoked");
    });
    await expect(service.execute(owner, task, { action: "open", url: "https://example.test" },
      AbortSignal.timeout(1_000), { connectionId: connection, checkRun, scope },
    )).rejects.toThrow("fixture lease revoked");
    expect(put.mock.calls.some(([key]) => key === `local-browser:${owner}:desktop:command`)).toBe(false);
    expect(await store.get(`local-browser:${owner}:desktop:request`)).toBeNull();
  });
  it("does not dispatch when cancellation removes the job during run authorization", async () => {
    const checking = deferred();
    const resume = deferred();
    const { service, store, connection } = await fixture(async () => {
      checking.resolve();
      await resume.promise;
      return true;
    });
    const controller = new AbortController();
    const running = service.execute(owner, task, { action: "click", tab_id: 1, ref: "fixture" },
      controller.signal, { connectionId: connection, scope, checkRun: async () => {} });
    try {
      await vi.waitFor(async () =>
        expect(await store.get(`local-browser:${owner}:desktop:command`)).not.toBeNull(),
      );
      const delivery = service.next(owner, connection);
      await checking.promise;
      controller.abort();
      await expect(running).resolves.toMatchObject({ code: "BROWSER_USE_CANCELLED" });
      resume.resolve();
      await expect(delivery).resolves.toBeNull();
    } finally {
      controller.abort();
      resume.resolve();
      await running;
    }
  });
  it.each([
    { claimed: false, stop: "cancel", code: "BROWSER_USE_CANCELLED" },
    { claimed: true, stop: "cancel", code: "RUNNER_OPERATION_UNCERTAIN" },
    { claimed: false, stop: "timeout", code: "BROWSER_USE_TIMEOUT" },
    { claimed: true, stop: "timeout", code: "RUNNER_OPERATION_UNCERTAIN" },
    { claimed: true, stop: "disconnect", code: "RUNNER_OPERATION_UNCERTAIN" },
  ])("returns $code on $stop of a Mac mutation (extension claimed: $claimed)", async ({ claimed, stop, code }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { store, service, connection } = await fixture(async () => true);
    const controller = new AbortController();
    const result = service.execute(owner, task, { action: "click", tab_id: 1, ref: "fixture" },
      controller.signal, { connectionId: connection, scope, checkRun: async () => {} });
    try {
      await vi.waitFor(async () =>
        expect(await store.get(`local-browser:${owner}:desktop:command`)).not.toBeNull(),
      );
      if (claimed) expect(await service.next(owner, connection)).toMatchObject({ request: { action: "click" } });
      if (stop === "cancel") controller.abort();
      else if (stop === "disconnect") await service.disconnect(owner, connection);
      else vi.setSystemTime(Date.now() + 30_001);
      await expect(result).resolves.toMatchObject({ ok: false, code, retryable: false });
      expect(await service.next(owner, connection)).toBeNull();
    } finally {
      controller.abort();
      await result;
    }
  });
  it.each([
    { action: "click", replyCode: "BROWSER_USE_COMMAND_FAILED", expected: "RUNNER_OPERATION_UNCERTAIN" },
    { action: "click", replyCode: "BROWSER_USE_CANCELLED", expected: "RUNNER_OPERATION_UNCERTAIN" },
    { action: "click", replyCode: "BROWSER_USE_ACCESS_DENIED", expected: "RUNNER_OPERATION_UNCERTAIN" },
    { action: "click", replyCode: "BROWSER_USE_TAB_BUSY", expected: "BROWSER_USE_TAB_BUSY" },
    { action: "snapshot", replyCode: "BROWSER_USE_COMMAND_FAILED", expected: "BROWSER_USE_COMMAND_FAILED" },
  ] as const)("preserves the outcome of a claimed Mac $action with reply $replyCode", async ({ action, replyCode, expected }) => {
    const { store, service, connection } = await fixture(async () => true);
    const controller = new AbortController();
    const running = service.execute(owner, task, action === "click" ? { action, tab_id: 1, ref: "fixture" } : { action, tab_id: 1 },
      controller.signal, { connectionId: connection, scope, checkRun: async () => {} });
    try {
      await vi.waitFor(async () =>
        expect(await store.get(`local-browser:${owner}:desktop:command`)).not.toBeNull(),
      );
      const command = await service.next(owner, connection);
      if (!command) throw new Error("Missing fixture command");
      await service.reply(owner, connection, { id: command.id, result: browserUseFailure(replyCode) });
      await expect(running).resolves.toMatchObject({ ok: false, code: expected, retryable: false });
      expect(await service.next(owner, connection)).toBeNull();
    } finally {
      controller.abort();
      await running;
    }
  });
  it("protects Mac commands and replies at rest and keeps the first reply", async () => {
    const { service, store, connection } = await fixture(async () => true);
    const extensionReplica = new BrowserUseService(store, service.endpoint, { ...encryption, isActiveRun: async () => true });
    const commandText = "fixture text visible only to the paired extension";
    const firstResult = { ok: true, browser: "local", data: { title: "fixture private document" } } satisfies BrowserUseResult;
    const controller = new AbortController();
    const running = service.execute(owner, task, { action: "type", tab_id: 1, text: commandText, clear: false },
      controller.signal, { connectionId: connection, scope, checkRun: async () => {} });
    try {
      await vi.waitFor(async () =>
        expect(await store.get(`local-browser:${owner}:desktop:command`)).not.toBeNull(),
      );
      expect(JSON.stringify([...store.values])).not.toContain(commandText);
      const command = await extensionReplica.next(owner, connection);
      expect(command?.request).toMatchObject({ text: commandText });
      if (!command) throw new Error("Missing fixture command");
      const replyKey = `local-browser:${owner}:desktop:reply:${command.id}`;
      const putReply = vi.spyOn(store, "putIf");
      await extensionReplica.reply(owner, connection, { id: command.id, result: firstResult });
      await extensionReplica.reply(owner, connection, {
        id: command.id, result: { ...firstResult, data: { title: "late duplicate" } },
      });
      const storedReply = putReply.mock.calls.find(([key]) => key === replyKey)?.[1];
      expect(storedReply).toMatch(/^v1\./u);
      expect(storedReply).not.toContain(firstResult.data.title);
      expect(await store.get(`local-browser:${owner}:reply:${command.id}`)).toBeNull();
      await expect(running).resolves.toEqual(firstResult);
      expect(await store.get(replyKey)).toBeNull();
    } finally {
      controller.abort();
      await running;
    }
  });
  it("withholds a successful Mac mutation reply if the run is revoked before the reply is read", async () => {
    const { service, store, connection } = await fixture(async () => true);
    const controller = new AbortController();
    let active = true;
    const result = service.execute(owner, task, { action: "click", tab_id: 1, ref: "fixture" },
      controller.signal, { connectionId: connection, scope, checkRun: async () => {
        if (!active) throw new Error("fixture lease revoked");
      } });
    try {
      await vi.waitFor(async () =>
        expect(await store.get(`local-browser:${owner}:desktop:command`)).not.toBeNull(),
      );
      const command = await service.next(owner, connection);
      if (!command) throw new Error("Missing fixture command");
      active = false;
      await service.reply(owner, connection, {
        id: command.id, result: { ok: true, browser: "local", data: { title: "fixture private result" } },
      });
      await expect(result).resolves.toMatchObject({ ok: false, code: "RUNNER_OPERATION_UNCERTAIN", retryable: false });
    } finally {
      controller.abort();
      await result.catch(() => undefined);
    }
  });
  it("rejects stale commands after reconnection and cannot revive the old connection", async () => {
    const { service, connection, token } = await fixture();
    const next = await service.connect(owner, token, "edge");
    expect(next).not.toBe(connection);
    expect(await service.maintain(owner, connection)).toBe(false);
    await service.disconnect(owner, connection);
    expect(await service.status(owner)).toMatchObject({
      connection_id: next,
      browser: "edge",
    });
    expect(await service.next(owner, connection)).toBeNull();
  });
  it("cancels pending work without requeueing a submitted mutation", async () => {
    const { service, connection } = await fixture();
    const controller = new AbortController();
    const running = service.execute(
      owner,
      task,
      { action: "type", tab_id: 1, text: "submit once", clear: false },
      controller.signal,
    );
    await vi.waitFor(async () =>
      expect(
        await service.store.get(`local-browser:${owner}:command`),
      ).not.toBeNull(),
    );
    await service.next(owner, connection);
    controller.abort();
    expect(await running).toMatchObject({
      ok: false,
      code: "BROWSER_USE_CANCELLED",
      retryable: false,
    });
    expect(await service.next(owner, connection)).toBeNull();
    expect(
      await service.store.get(`local-browser:${owner}:request`),
    ).toBeNull();
  });
  it("invalidates a dispatched command immediately when browser access is revoked", async () => {
    const { service, connection } = await fixture();
    const running = service.execute(owner, task, {
      action: "type", tab_id: 1, text: "do not continue", clear: false,
    });
    await vi.waitFor(async () =>
      expect(await service.store.get(`local-browser:${owner}:command`)).not.toBeNull(),
    );
    const command = await service.next(owner, connection);
    expect(await service.activeCommand(owner, connection)).toBe(command!.id);
    await service.revoke(owner);
    const active = await service.activeCommand(owner, connection);
    await running;
    expect(active).toBeNull();
  });
  it("renews an active browser approval without asking for another manual pairing", async () => {
    vi.useFakeTimers();
    const { service, token } = await fixture();
    const approval = (await service.authenticate(token))!.approval_id!;
    vi.advanceTimersByTime(1001);
    const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    const next = await service.pair(pairing.code, approval);
    expect(await service.authenticate(next)).toMatchObject({ owner, approval_id: approval });
    expect(await service.authenticate(token)).toBeNull();
  });
  it("does not let a closed browser renew after its approval is revoked", async () => {
    vi.useFakeTimers();
    const { service, token } = await fixture();
    const approval = (await service.authenticate(token))!.approval_id!;
    await service.revoke(owner);
    vi.advanceTimersByTime(1001);
    const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    await expect(service.pair(pairing.code, approval)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.status(owner)).toEqual({ connected: false });
  });
  it("does not let an old approval replace another explicitly paired browser", async () => {
    vi.useFakeTimers();
    const { service, token } = await fixture();
    const approval = (await service.authenticate(token))!.approval_id!;
    vi.advanceTimersByTime(1001);
    const replacement = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    const otherToken = await service.pair(replacement.code);
    const otherConnection = await service.connect(owner, otherToken, "edge");
    vi.advanceTimersByTime(1001);
    const automatic = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    await expect(service.pair(automatic.code, approval)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.status(owner)).toMatchObject({ connection_id: otherConnection });
  });
  it("fences a renewal if approval is revoked before its credential is published", async () => {
    vi.useFakeTimers();
    const { service, store, token } = await fixture();
    const approval = (await service.authenticate(token))!.approval_id!;
    vi.advanceTimersByTime(1001);
    const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
    const putIf = store.putIf.bind(store);
    vi.spyOn(store, "putIf").mockImplementationOnce(async (...args) => {
      await service.revoke(owner);
      return putIf(...args);
    });
    await expect(service.pair(pairing.code, approval)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await service.authenticate(token)).toBeNull();
  });
  it("continues accepting pre-upgrade credentials and connection records without approval metadata", async () => {
    const { service, store, token, connection } = await fixture();
    const hash = createHash("sha256").update(token).digest("hex");
    const credentialKey = `local-browser:credential:${hash}`;
    const connectionKey = `local-browser:${owner}:connection`;
    const credential = { owner, auth_valid_after: "2026-01-01T00:00:00.000Z", origin: new URL(service.endpoint).origin };
    const record = { id: connection, browser: "chrome", credential_hash: hash };
    await store.put(credentialKey, JSON.stringify(credential), 45_000);
    await store.put(connectionKey, JSON.stringify(record), 45_000);
    await store.remove(`local-browser:${owner}:approval`);
    expect(await service.authenticate(token)).toMatchObject({ owner });
    expect(await service.maintain(owner, connection)).toBe(true);
    expect(await service.status(owner)).toMatchObject({ connected: true });
    await expect(service.connect(owner, token, "edge")).resolves.toBeTypeOf("string");
  });
});
