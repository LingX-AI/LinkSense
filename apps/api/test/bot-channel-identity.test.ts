import { describe, expect, it, vi } from "vitest";
import { BotChannelIdentityService } from "../src/modules/bot-channels/identity.js";
import type { PrismaBotChannelRepository } from "../src/modules/bot-channels/repository.js";
import type { RedisBotChannelCoordinator } from "../src/modules/bot-channels/coordinator.js";
const code = "AB".repeat(12);
function fixture() {
  const repository = {
    findAccessibleConnection: vi.fn().mockResolvedValue({ id: "connection" }),
    bindIdentity: vi.fn().mockResolvedValue(true),
    unlinkIdentity: vi.fn(),
  };
  const coordinator = {
    revokeLinkCode: vi.fn(),
    issueLinkCode: vi.fn(),
    consumeLinkCode: vi
      .fn()
      .mockResolvedValue("10000000-0000-4000-8000-000000000001"),
    acquireLease: vi.fn().mockResolvedValue({ key: "key", token: "token" }),
    releaseLease: vi.fn(),
  };
  return {
    repository,
    coordinator,
    service: new BotChannelIdentityService(
      repository as unknown as PrismaBotChannelRepository,
      coordinator as unknown as RedisBotChannelCoordinator,
    ),
  };
}
describe("verified channel identity", () => {
  it("issues a short-lived random command only for an accessible channel", async () => {
    const f = fixture();
    const result = await f.service.issue("user", "connection");
    expect(result.command).toMatch(/^LINK [A-F0-9]{24}$/u);
    expect(f.coordinator.issueLinkCode).toHaveBeenCalledWith(
      "connection",
      "user",
      result.command.slice(5),
      600,
    );
    f.repository.findAccessibleConnection.mockResolvedValue(null);
    await expect(f.service.issue("user", "private-channel")).rejects.toThrow(
      "NOT_FOUND",
    );
  });
  it("accepts only a complete command in a private conversation", async () => {
    const f = fixture();
    expect(
      await f.service.handleCommand(
        "connection",
        "sender",
        `LINK ${code}`,
        true,
      ),
    ).toBe("private_only");
    expect(f.coordinator.consumeLinkCode).toHaveBeenCalledWith(
      "connection",
      code,
    );
    expect(f.repository.bindIdentity).not.toHaveBeenCalled();
    expect(
      await f.service.handleCommand(
        "connection",
        "sender",
        `please LINK ${code}`,
        false,
      ),
    ).toBeNull();
    expect(
      await f.service.handleCommand(
        "connection",
        "sender",
        `LINK ${code}`,
        false,
      ),
    ).toBe("linked");
    expect(f.repository.bindIdentity).toHaveBeenCalledWith(
      "connection",
      "10000000-0000-4000-8000-000000000001",
      "sender",
    );
  });
  it("refuses expired or consumed codes and identity conflicts", async () => {
    const f = fixture();
    f.coordinator.consumeLinkCode.mockResolvedValueOnce(null);
    expect(
      await f.service.handleCommand(
        "connection",
        "sender",
        `LINK ${code}`,
        false,
      ),
    ).toBe("link_failed");
    expect(f.repository.bindIdentity).not.toHaveBeenCalled();
    f.repository.bindIdentity.mockResolvedValue(false);
    expect(
      await f.service.handleCommand(
        "connection",
        "sender",
        `LINK ${code}`,
        false,
      ),
    ).toBe("link_failed");
  });
});
