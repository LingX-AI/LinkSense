import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBrowserService } from "../src/modules/local-browser/service.js";
import { MemoryBrowserStore } from "./local-browser-store.js";
import { createHash } from "node:crypto";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const task = "20000000-0000-4000-8000-000000000001";
afterEach(() => vi.useRealTimers());
async function fixture() {
  const store = new MemoryBrowserStore();
  const service = new LocalBrowserService(
    store,
    "https://linksense.example/api/v1/local-browser",
  );
  const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
  const token = await service.pair(pairing.code);
  const connection = await service.connect(owner, token, "chrome");
  return { store, service, token, connection, pairing };
}
describe("local browser connection and delivery", () => {
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
    ).toMatchObject({ ok: false, code: "LOCAL_BROWSER_BUSY" });
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
      code: "LOCAL_BROWSER_CANCELLED",
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
    expect(await service.activeCommand(owner)).toBe(command!.id);
    await service.revoke(owner);
    const active = await service.activeCommand(owner);
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
