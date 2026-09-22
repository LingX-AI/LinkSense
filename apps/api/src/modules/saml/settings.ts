import { createPrivateKey, X509Certificate } from "node:crypto";
import {
  samlConfigurationFieldsSchema,
  samlSettingsSchema,
  updateSamlSettingsSchema,
  type SamlSettings,
  type UpdateSamlSettings,
} from "@linksense/shared";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";

const ID = "00000000-0000-4000-8000-000000000001";
const KEY = "saml_authentication_encrypted";
const CONTEXT = "linksense:saml-authentication:v1";
const storedSchema = samlConfigurationFieldsSchema.extend({
  revision: z.number().int().positive(),
  signing_private_key: z.string().max(16_384),
});
export type SamlConfiguration = z.infer<typeof storedSchema>;
export type SamlSettingsReader = Pick<SamlSettingsService, "resolve" | "urls">;

export class SamlSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<
      AppConfig,
      "publicBaseUrl" | "credentialMasterKey" | "credentialKeyId"
    >,
  ) {}

  urls(): { entityId: string; acsUrl: string; metadataUrl: string } {
    const metadataUrl = new URL(
      "/api/v1/auth/saml/metadata",
      this.config.publicBaseUrl,
    ).toString();
    return {
      entityId: metadataUrl,
      metadataUrl,
      acsUrl: new URL(
        "/api/v1/auth/saml/acs",
        this.config.publicBaseUrl,
      ).toString(),
    };
  }

  private read(value: Prisma.JsonValue | undefined): SamlConfiguration | null {
    const raw = jsonObject(value)[KEY];
    if (raw === undefined) return null;
    if (typeof raw !== "string") throw new AppError("INTERNAL_ERROR");
    return storedSchema.parse(
      decryptJson<unknown>(
        raw,
        this.config.credentialMasterKey,
        this.config.credentialKeyId,
        CONTEXT,
      ),
    );
  }

  async resolve(): Promise<SamlConfiguration | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { id: ID },
      select: { settingsJson: true },
    });
    return this.read(row?.settingsJson);
  }

  async getAdminSettings(): Promise<SamlSettings> {
    const value = await this.resolve();
    let status: SamlSettings["status"] = "not_configured";
    if (value?.enabled) {
      try {
        this.validate(value);
        status = "configured";
      } catch {
        status = "invalid";
      }
    }
    const urls = this.urls();
    return samlSettingsSchema.parse({
      enabled: value?.enabled ?? false,
      revision: value?.revision ?? 0,
      status,
      idp_entity_id: value?.idp_entity_id ?? "",
      idp_sso_url: value?.idp_sso_url ?? "",
      idp_certificate: value?.idp_certificate ?? "",
      email_attribute:
        value?.email_attribute ??
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      name_attribute:
        value?.name_attribute ??
        "http://schemas.microsoft.com/identity/claims/displayname",
      sign_requests: value?.sign_requests ?? false,
      signing_certificate: value?.signing_certificate ?? "",
      signing_private_key_configured: Boolean(value?.signing_private_key),
      sp_entity_id: urls.entityId,
      acs_url: urls.acsUrl,
      metadata_url: urls.metadataUrl,
    });
  }

  private validate(value: SamlConfiguration): void {
    if (new URL(this.config.publicBaseUrl).protocol !== "https:")
      throw new AppError("VALIDATION_ERROR");
    validateSamlCertificates(value);
  }

  async update(
    raw: UpdateSamlSettings,
    actorId: string,
    audit: AuditContext,
  ): Promise<SamlSettings> {
    const input = updateSamlSettingsSchema.parse(raw);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('linksense-system-settings', 0))`;
      const row = await tx.systemSetting.findUnique({
        where: { id: ID },
        select: { settingsJson: true },
      });
      const current = this.read(row?.settingsJson);
      if ((current?.revision ?? 0) !== input.expected_revision)
        throw new AppError("CONFLICT");
      const { expected_revision, signing_private_key, ...fields } = input;
      const next = storedSchema.parse({
        ...fields,
        revision: expected_revision + 1,
        signing_certificate: input.sign_requests
          ? input.signing_certificate
          : "",
        signing_private_key: input.sign_requests
          ? (signing_private_key ?? current?.signing_private_key ?? "")
          : "",
      });
      if (next.enabled) this.validate(next);
      const settingsJson = {
        ...jsonObject(row?.settingsJson),
        [KEY]: encryptJson(
          next,
          this.config.credentialMasterKey,
          this.config.credentialKeyId,
          CONTEXT,
        ),
      };
      await tx.systemSetting.upsert({
        where: { id: ID },
        create: { id: ID, settingsJson, updatedBy: actorId },
        update: { settingsJson, updatedBy: actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "authentication_settings_updated",
          targetType: "authentication_provider",
          targetId: "saml",
          result: "success",
          metadataJson: {
            provider: "saml",
            enabled: next.enabled,
            revision: next.revision,
            secret_replaced: signing_private_key !== undefined,
          },
          ipAddress: audit.ipAddress ?? null,
          userAgent: audit.userAgent ?? null,
        },
      });
    });
    return this.getAdminSettings();
  }
}

export function validateSamlCertificates(value: SamlConfiguration): void {
  try {
    validCertificate(value.idp_certificate);
    if (value.sign_requests) {
      const certificate = validCertificate(value.signing_certificate);
      const key = createPrivateKey(value.signing_private_key);
      if (key.asymmetricKeyType !== "rsa" || !certificate.checkPrivateKey(key))
        throw new Error("Invalid signing key");
    }
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}
function validCertificate(pem: string): X509Certificate {
  const certificate = new X509Certificate(pem);
  const now = Date.now();
  if (
    now < certificate.validFromDate.getTime() ||
    now >= certificate.validToDate.getTime()
  )
    throw new Error("Certificate expired or not yet valid");
  return certificate;
}
function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
