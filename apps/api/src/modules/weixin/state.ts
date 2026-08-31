import { z } from "zod";

import type { WeixinConnection } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import type { WeixinConnectionState } from "./repository.js";

const connectionStateSchema = z.strictObject({
  token: z.string().min(1).max(16_384),
  cursor: z.string().max(8 * 1_024 * 1_024),
});

const contextStateSchema = z.strictObject({
  contextToken: z.string().min(1).max(64 * 1_024),
});

export type WeixinEncryption = {
  masterKey: string;
  keyId: string;
};

export function decryptWeixinConnectionState(
  row: WeixinConnection,
  encryption: WeixinEncryption,
): WeixinConnectionState {
  return connectionStateSchema.parse(
    decryptJson(
      row.encryptedState,
      encryption.masterKey,
      row.encryptionKeyId,
      connectionStateContext(row.id),
    ),
  );
}

export function encryptWeixinConnectionState(
  connectionId: string,
  state: WeixinConnectionState,
  encryption: WeixinEncryption,
): string {
  return encryptJson(
    connectionStateSchema.parse(state),
    encryption.masterKey,
    encryption.keyId,
    connectionStateContext(connectionId),
  );
}

export function encryptWeixinContext(
  scope: "inbound" | "peer",
  id: string,
  contextToken: string,
  encryption: WeixinEncryption,
): string {
  return encryptJson(
    contextStateSchema.parse({ contextToken }),
    encryption.masterKey,
    encryption.keyId,
    contextStateContext(scope, id),
  );
}

export function decryptWeixinContext(
  scope: "inbound" | "peer",
  id: string,
  encrypted: string,
  encryptionKeyId: string,
  encryption: WeixinEncryption,
): string {
  return contextStateSchema.parse(
    decryptJson(
      encrypted,
      encryption.masterKey,
      encryptionKeyId,
      contextStateContext(scope, id),
    ),
  ).contextToken;
}

function connectionStateContext(connectionId: string): string {
  return `weixin-connection:${connectionId}`;
}

function contextStateContext(scope: "inbound" | "peer", id: string): string {
  return `weixin-${scope}-context:${id}`;
}
