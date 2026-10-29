import { randomBytes } from "node:crypto";
import { z } from "zod";
import { botChannelLinkingSessionSchema } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { PrismaBotChannelRepository } from "./repository.js";
import type { RedisBotChannelCoordinator } from "./coordinator.js";

export type IdentityCommandResult =
  "linked" | "link_failed" | "private_only" | "unlinked";
export class BotChannelIdentityService {
  constructor(
    private readonly repository: PrismaBotChannelRepository,
    private readonly coordinator: RedisBotChannelCoordinator,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async issue(
    userId: string,
    connectionId: string,
  ): Promise<z.infer<typeof botChannelLinkingSessionSchema>> {
    if (!(await this.repository.findAccessibleConnection(userId, connectionId)))
      throw new AppError("NOT_FOUND");
    const code = randomBytes(12).toString("hex").toUpperCase();
    await this.coordinator.issueLinkCode(connectionId, userId, code, 600);
    return {
      command: `LINK ${code}`,
      expires_at: new Date(this.now().getTime() + 600_000).toISOString(),
    };
  }
  async unlink(userId: string, connectionId: string): Promise<void> {
    if (
      !(await this.repository.findAccessibleConnection(
        userId,
        connectionId,
        true,
      ))
    )
      throw new AppError("NOT_FOUND");
    const lease = await this.coordinator.acquireLease(
      "connection",
      connectionId,
      30_000,
    );
    if (!lease) throw new AppError("BOT_CHANNEL_BUSY");
    try {
      await this.coordinator.revokeLinkCode(connectionId, userId);
      await this.repository.unlinkIdentity(connectionId, userId);
    } finally {
      await this.coordinator.releaseLease(lease);
    }
  }
  async handleCommand(
    connectionId: string,
    senderId: string,
    text: string,
    group: boolean,
  ): Promise<IdentityCommandResult | null> {
    // Codes are processed before the durable inbox, so they never become task content.
    const match = /^LINK ([A-F0-9]{24})$/iu.exec(text.trim());
    if (!match?.[1]) return null;
    if (group) {
      // A code exposed to a group must not remain redeemable by another member.
      await this.coordinator.consumeLinkCode(
        connectionId,
        match[1].toUpperCase(),
      );
      return "private_only";
    }
    const userId = await this.coordinator.consumeLinkCode(
      connectionId,
      match[1].toUpperCase(),
    );
    if (!z.uuid().safeParse(userId).success || !userId) return "link_failed";
    return (await this.repository.bindIdentity(connectionId, userId, senderId))
      ? "linked"
      : "link_failed";
  }
}
