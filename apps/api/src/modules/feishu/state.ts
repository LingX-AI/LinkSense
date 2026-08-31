import { z } from "zod";

import type { FeishuConnection } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";

const feishuCredentialsSchema = z.strictObject({
  appId: z.string().regex(/^cli_[a-zA-Z0-9]{8,60}$/u),
  appSecret: z.string().min(1).max(16_384),
  domain: z.enum(["feishu", "lark"]),
});

export type FeishuCredentials = z.infer<typeof feishuCredentialsSchema>;

export type FeishuEncryption = {
  masterKey: string;
  keyId: string;
};

export function encryptFeishuCredentials(
  connectionId: string,
  credentials: FeishuCredentials,
  encryption: FeishuEncryption,
): string {
  return encryptJson(
    feishuCredentialsSchema.parse(credentials),
    encryption.masterKey,
    encryption.keyId,
    credentialsContext(connectionId),
  );
}

export function decryptFeishuCredentials(
  row: FeishuConnection,
  encryption: FeishuEncryption,
): FeishuCredentials {
  return feishuCredentialsSchema.parse(
    decryptJson(
      row.encryptedCredentials,
      encryption.masterKey,
      row.encryptionKeyId,
      credentialsContext(row.id),
    ),
  );
}

function credentialsContext(connectionId: string): string {
  return `feishu-connection:${connectionId}`;
}
