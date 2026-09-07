import {
  botChannelCreateSchema,
  type BotChannelCreate,
} from "@linksense/shared";
import type {
  BotChannelConnection,
  BotChannelInboundMessage,
} from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { replyContextSchema, type ReplyContext } from "./types.js";

export type ChannelEncryption = { masterKey: string; keyId: string };

export function encryptChannelCredentials(
  id: string,
  value: BotChannelCreate,
  encryption: ChannelEncryption,
): string {
  return encryptJson(
    botChannelCreateSchema.parse(value),
    encryption.masterKey,
    encryption.keyId,
    `bot-channel:${id}`,
  );
}
export function decryptChannelCredentials(
  row: BotChannelConnection,
  encryption: ChannelEncryption,
): BotChannelCreate {
  return botChannelCreateSchema.parse(
    decryptJson(
      row.encryptedCredentials,
      encryption.masterKey,
      row.encryptionKeyId,
      `bot-channel:${row.id}`,
    ),
  );
}
export function encryptReplyContext(
  id: string,
  value: ReplyContext,
  encryption: ChannelEncryption,
): string {
  return encryptJson(
    replyContextSchema.parse(value),
    encryption.masterKey,
    encryption.keyId,
    `bot-channel-inbound:${id}`,
  );
}
export function decryptReplyContext(
  row: BotChannelInboundMessage,
  encryption: ChannelEncryption,
): ReplyContext {
  return replyContextSchema.parse(
    decryptJson(
      row.encryptedContext,
      encryption.masterKey,
      row.encryptionKeyId,
      `bot-channel-inbound:${row.id}`,
    ),
  );
}
