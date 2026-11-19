import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionProtocol } from "../src/modules/connections/google-protocol.js";
import { connectionScopes } from "../src/modules/connections/protocol.js";

const settings = {
  revision: 1,
  client_id: "test-client",
  client_secret: "test-only-secret",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ["google_docs", "https://accounts.google.com"],
  ["onedrive", "https://login.microsoftonline.com/common/v2.0"],
] as const)("%s OAuth refresh", (provider, issuer) => {
  const token = {
    clientId: settings.client_id,
    accountId: "fixture-account",
    accessToken: "previous-access",
    refreshToken: "previous-refresh",
    expiresAt: 1,
    scopes: connectionScopes[provider],
    ...(provider === "onedrive" ? { tenantId: "00000000-0000-4000-8000-000000000001" } : {}),
  };
  const protocol = new ProviderConnectionProtocol("https://app.example.test");

  it.each(["discovery", "grant"])("aborts the provider transport during %s", async (stage) => {
    const caller = new AbortController();
    const reason = new DOMException("Run cancelled", "AbortError");
    let transportAbortReason: unknown;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, request) => {
      if (stage === "grant" && request?.method === "GET") {
        return Response.json({ issuer, token_endpoint: `${issuer}/token` });
      }
      caller.abort(reason);
      transportAbortReason = request?.signal?.reason;
      request?.signal?.throwIfAborted();
      throw new Error("Provider transport did not receive cancellation");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(protocol.refresh(provider, settings, token, caller.signal)).rejects.toBe(reason);
    expect(transportAbortReason).toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(stage === "discovery" ? 1 : 2);
  });

  it("keeps the OpenID client deadline when the caller supplies a signal", async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const reason = new DOMException("Provider deadline", "TimeoutError");
    let transportAbortReason: unknown;
    vi.stubGlobal("fetch", async (_input: unknown, request?: RequestInit) => {
      deadline.abort(reason);
      transportAbortReason = request?.signal?.reason;
      request?.signal?.throwIfAborted();
      throw new Error("Provider transport did not receive the deadline");
    });

    await expect(protocol.refresh(provider, settings, token, caller.signal)).rejects.toMatchObject({
      code: "CONNECTION_UNAVAILABLE",
    });
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(transportAbortReason).toBe(reason);
    expect(caller.signal.aborted).toBe(false);
  });
});
