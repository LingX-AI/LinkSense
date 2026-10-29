import { z } from "zod";
import type { PrismaClient, Prisma } from "../apps/api/src/generated/prisma/client.js";
import { decryptJson, encryptJson } from "../apps/api/src/lib/crypto.js";
import {
  connectionSettingsEnvelopeSchema,
  connectionSettingsStorage,
} from "../packages/shared/src/connection-settings.js";
import { connectionProviderSchema } from "../packages/shared/src/connections.js";
import { initialSettings } from "./initial-settings.js";

// Frozen pre-split format. This runs during deployment, never on an OAuth request.
const previousConfigurationSchema = z.object({ client_id: z.string(), client_secret: z.string() });
const previousEnvelopeSchema = z.object({
  microsoft: previousConfigurationSchema.optional(),
  google: previousConfigurationSchema.optional(),
});
const encryptionSchema = z.strictObject({ masterKey: z.string().min(32), keyId: z.string().min(1) });

export async function upgradeConnectionSettings(
  prisma: PrismaClient,
  encryption: { masterKey: string; keyId: string },
): Promise<{ initialized: boolean; configuredProviders: number }> {
  const { masterKey, keyId } = encryptionSchema.parse(encryption);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectionSettingsStorage.lockKey}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`;
    const row = await tx.systemSetting.findUnique({
      where: { id: connectionSettingsStorage.id }, select: { settingsJson: true },
    });
    const json = jsonObject(row?.settingsJson);
    const saved = json[connectionSettingsStorage.key];
    if (saved !== undefined) {
      const existing = connectionSettingsEnvelopeSchema.parse(decryptJson<unknown>(
        z.string().parse(saved), masterKey, keyId, connectionSettingsStorage.context,
      ));
      return { initialized: false, configuredProviders: Object.keys(existing).length };
    }
    const old = json.social_authentication_encrypted;
    const previous = old === undefined ? {} : previousEnvelopeSchema.parse(decryptJson<unknown>(
      z.string().parse(old), masterKey, keyId, "linksense:social-authentication:v1",
    ));
    const envelope = connectionSettingsEnvelopeSchema.parse({});
    for (const provider of connectionProviderSchema.options) {
      const configuration = provider === "google_docs" || provider === "gmail"
        ? previous.google : previous.microsoft;
      if (configuration?.client_id && configuration.client_secret) {
        envelope[provider] = { revision: 1, client_id: configuration.client_id, client_secret: configuration.client_secret };
      }
    }
    const settingsJson = {
      ...initialSettings,
      ...json,
      [connectionSettingsStorage.key]: encryptJson(envelope, masterKey, keyId, connectionSettingsStorage.context),
    };
    await tx.systemSetting.upsert({
      where: { id: connectionSettingsStorage.id },
      create: { id: connectionSettingsStorage.id, settingsJson }, update: { settingsJson },
    });
    return { initialized: true, configuredProviders: Object.keys(envelope).length };
  }, { timeout: 30_000, maxWait: 10_000 });
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid system settings object.");
  return value;
}
