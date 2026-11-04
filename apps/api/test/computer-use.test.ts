import { afterEach, expect, it, vi } from "vitest";
import { ComputerUseService } from "../src/modules/computer-use/service.js";
import { MemoryBrowserStore } from "./browser-use-store.js";
import type { ComputerUseRequest, ComputerUseResult } from "@linksense/shared";

const owner = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const turnId = "30000000-0000-4000-8000-000000000001";
const context = { conversationId, turnId, title: "Test desktop", readOnly: false };
const permissions = { accessibility: "granted", screen_recording: "denied" } as const;
afterEach(() => vi.useRealTimers());

async function fixture() {
  const store = new MemoryBrowserStore();
  const service = new ComputerUseService(store, "https://example.test/api/v1/computer-use");
  const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
  const pair = await service.pair(pairing.code, "Test computer", "darwin");
  const credential = await service.authenticate(pair.token);
  if (!credential) throw new Error("credential missing");
  const id = await service.connect(credential, pair.token);
  await service.maintain(owner, id, { control: "ready", permissions });
  return { store, service, pair, id, credential, pairing };
}

it("pairs a scoped one-use device without sharing Browser Use credentials", async () => {
  const { service, pair, pairing, store } = await fixture();
  await expect(service.pair(pairing.code, "Other", "darwin")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(await service.authenticate("t".repeat(43))).toBeNull();
  expect(await service.status(owner)).toMatchObject({ connected: true, device: pair.device, permissions });
  expect(await service.status("10000000-0000-4000-8000-000000000002")).toEqual({ connected: false });
  expect([...store.values.keys()].every((key) => key.startsWith("computer-use:"))).toBe(true);
  expect(JSON.stringify([...store.values])).not.toContain(pair.token);
  expect(JSON.stringify([...store.values])).not.toContain(pairing.code);
});

it("rejects a pairing code after user revocation and preserves browser keys", async () => {
  const store = new MemoryBrowserStore();
  const service = new ComputerUseService(store, "https://example.test/api/v1/computer-use");
  const code = await service.pairing(owner, "date");
  await store.put(`browser-use:${owner}:credential`, "browser-stays", 60_000);
  await service.revoke(owner);
  await expect(service.pair(code.code, "Computer", "darwin")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(await store.get(`browser-use:${owner}:credential`)).toBe("browser-stays");
});

it("does not accept credentials issued by another configured server origin", async () => {
  const { service, pair, store } = await fixture();
  const other = new ComputerUseService(store, "https://other.test/api/v1/computer-use");
  expect(await other.authenticate(pair.token)).toBeNull();
  expect(await service.authenticate(pair.token)).not.toBeNull();
});

it("expires short pairing codes and online leases without restoring control", async () => {
  vi.useFakeTimers();
  const { service, id, pair } = await fixture();
  await vi.advanceTimersByTimeAsync(41_000);
  expect((await service.status(owner)).connected).toBe(false);
  expect(await service.maintain(owner, id)).toBe(false);
  expect(await service.authenticate(pair.token)).not.toBeNull();
});

it("dispatches once, fences connection/device identities and returns only matching replies", async () => {
  vi.useFakeTimers();
  const { service, pair, id, store } = await fixture();
  const input: ComputerUseRequest = { action: "apps", device_id: pair.device.id };
  const pending = service.execute(owner, context, input);
  await vi.advanceTimersByTimeAsync(1);
  const command = await service.next(owner, id);
  expect(command).toMatchObject({ request: input, conversation_id: conversationId, turn_id: turnId, device_id: pair.device.id });
  expect(await service.next(owner, id)).toBeNull();
  expect(await service.next(owner, "40000000-0000-4000-8000-000000000004")).toBeNull();
  if (!command) throw new Error("command missing");
  const result: ComputerUseResult = { ok: true, data: { text: "observed apps" } };
  await service.reply(owner, "40000000-0000-4000-8000-000000000004", command.id, result);
  await service.reply(owner, id, command.id, result);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual(result);
  expect([...store.values.keys()].some((key) => /:(command|request|lock|reply:)/u.test(key))).toBe(false);
});

it("rejects another device, serializes in-flight commands and cancels without replay", async () => {
  vi.useFakeTimers();
  const { service, pair } = await fixture();
  expect(await service.execute(owner, context, { action: "apps", device_id: conversationId })).toMatchObject({ code: "COMPUTER_USE_ACCESS_DENIED" });
  const controller = new AbortController();
  const request = { action: "apps", device_id: pair.device.id } as const;
  const pending = service.execute(owner, context, request, controller.signal);
  await vi.advanceTimersByTimeAsync(1);
  expect(await service.execute(owner, context, request)).toMatchObject({ code: "COMPUTER_USE_BUSY" });
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ code: "COMPUTER_USE_CANCELLED", delivery: "unknown", retryable: false });
});

it("pauses a pending action locally and rejects stale replies and further dispatch until resume", async () => {
  vi.useFakeTimers();
  const { service, pair, id } = await fixture();
  const request = { action: "apps", device_id: pair.device.id } as const;
  const pending = service.execute(owner, context, request);
  await vi.advanceTimersByTimeAsync(1);
  const command = await service.next(owner, id);
  await service.pause(owner, id);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ code: "COMPUTER_USE_PAUSED" });
  if (command) await service.reply(owner, id, command.id, { ok: true, data: { text: "late" } });
  expect(await service.execute(owner, context, request)).toMatchObject({ code: "COMPUTER_USE_PAUSED" });
  await service.resume(owner, id);
  expect((await service.status(owner)).control).toBe("ready");
});

it("keeps remote release paused through ready heartbeats until explicit local resume", async () => {
  vi.useFakeTimers();
  const { service, pair, id } = await fixture();
  await service.execute(owner, context, { action: "release", device_id: pair.device.id });
  for (let index = 0; index < 6; index++) {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await service.maintain(owner, id, { control: "ready", permissions })).toBe(true);
    expect(await service.paused(owner, id)).toBe(true);
    expect((await service.status(owner)).control).toBe("paused");
  }
  await service.resume(owner, id);
  expect(await service.paused(owner, id)).toBe(false);
});

it("does not let a delayed pause from an old connection cancel its replacement's command", async () => {
  vi.useFakeTimers();
  const { service, store, pair, id, credential } = await fixture();
  const requestKey = `computer-use:${owner}:request`;
  const get = store.get.bind(store);
  let releaseRead = () => {};
  const readAllowed = new Promise<void>((resolve) => { releaseRead = resolve; });
  let blocked = false;
  const readStarted = new Promise<void>((resolve) => {
    vi.spyOn(store, "get").mockImplementation(async (name) => {
      if (name === requestKey && !blocked) {
        blocked = true;
        resolve();
        await readAllowed;
      }
      return get(name);
    });
  });
  const oldPause = service.pause(owner, id);
  await readStarted;
  const replacement = await service.connect(credential, pair.token);
  const pending = service.execute(owner, context, { action: "apps", device_id: pair.device.id });
  await vi.advanceTimersByTimeAsync(1);
  const command = await service.next(owner, replacement);
  releaseRead();
  await oldPause;
  if (!command) throw new Error("replacement command missing");
  const result: ComputerUseResult = { ok: true, data: { text: "replacement remains active" } };
  await service.reply(owner, replacement, command.id, result);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual(result);
  expect(await service.paused(owner, replacement)).toBe(false);
});

it.each(["release", "apps"] as const)("rejects %s when the paired device changes after its status read", async (action) => {
  vi.useFakeTimers();
  const { service, pair } = await fixture();
  await vi.advanceTimersByTimeAsync(1_001);
  const pairing = await service.pairing(owner, "2026-01-01T00:00:00.000Z");
  const status = service.status.bind(service);
  let replacementConnection: string | undefined;
  vi.spyOn(service, "status").mockImplementationOnce(async (ownerId) => {
    const observed = await status(ownerId);
    const replacement = await service.pair(pairing.code, "Replacement computer", "darwin");
    const credential = await service.authenticate(replacement.token);
    if (!credential) throw new Error("replacement credential missing");
    replacementConnection = await service.connect(credential, replacement.token);
    return observed;
  });
  const controller = new AbortController();
  const pending = service.execute(owner, context, { action, device_id: pair.device.id }, controller.signal);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ code: "COMPUTER_USE_ACCESS_DENIED", delivery: "not_delivered" });
  if (!replacementConnection) throw new Error("replacement connection missing");
  expect(await service.paused(owner, replacementConnection)).toBe(false);
});

it("revokes old connections and credentials without allowing a delayed disconnect to delete the replacement", async () => {
  const { service, pair, id, credential } = await fixture();
  const next = await service.connect(credential, pair.token);
  await service.disconnect(owner, id);
  expect((await service.status(owner)).connected).toBe(true);
  expect(await service.maintain(owner, next)).toBe(true);
  await service.revoke(owner);
  expect(await service.authenticate(pair.token)).toBeNull();
  expect((await service.status(owner)).connected).toBe(false);
});
