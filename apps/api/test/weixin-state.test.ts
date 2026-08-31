import { describe, expect, it } from "vitest";

import type { WeixinConnection } from "../src/generated/prisma/client.js";
import {
  decryptWeixinConnectionState,
  decryptWeixinContext,
  encryptWeixinConnectionState,
  encryptWeixinContext,
} from "../src/modules/weixin/state.js";

const encryption = {
  masterKey: Buffer.alloc(32, 7).toString("base64"),
  keyId: "test-key",
};

describe("Weixin encrypted state", () => {
  it("binds bot credentials to the connection id", () => {
    const encryptedState = encryptWeixinConnectionState(
      "10000000-0000-4000-8000-000000000001",
      { token: "bot-token-secret", cursor: "cursor-secret" },
      encryption,
    );
    const row = {
      id: "10000000-0000-4000-8000-000000000001",
      encryptedState,
      encryptionKeyId: "test-key",
    } as WeixinConnection;

    expect(encryptedState).not.toContain("bot-token-secret");
    expect(encryptedState).not.toContain("cursor-secret");
    expect(decryptWeixinConnectionState(row, encryption)).toEqual({
      token: "bot-token-secret",
      cursor: "cursor-secret",
    });
    expect(() =>
      decryptWeixinConnectionState(
        { ...row, id: "20000000-0000-4000-8000-000000000001" },
        encryption,
      ),
    ).toThrow();
  });

  it("encrypts each inbound context token with record-bound AAD", () => {
    const encrypted = encryptWeixinContext(
      "inbound",
      "30000000-0000-4000-8000-000000000001",
      "context-token-secret",
      encryption,
    );

    expect(encrypted).not.toContain("context-token-secret");
    expect(
      decryptWeixinContext(
        "inbound",
        "30000000-0000-4000-8000-000000000001",
        encrypted,
        "test-key",
        encryption,
      ),
    ).toBe("context-token-secret");
    expect(() =>
      decryptWeixinContext(
        "peer",
        "30000000-0000-4000-8000-000000000001",
        encrypted,
        "test-key",
        encryption,
      ),
    ).toThrow();
  });
});
