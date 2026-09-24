import * as oidc from "openid-client";
import { z } from "zod";
import type { ConnectionProvider } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { SocialConfiguration } from "../social-auth/settings.js";

export const microsoftTokenSchema = z.strictObject({
  clientId: z.string().min(1).max(512),
  accountId: z.string().min(1).max(255),
  tenantId: z.uuid(),
  accessToken: z.string().min(1).max(64_000),
  refreshToken: z.string().min(1).max(64_000),
  expiresAt: z.number().int().positive(),
  scopes: z.array(z.string().min(1).max(256)).max(100),
});
export const connectionTokenSchema = z.union([
  microsoftTokenSchema,
  microsoftTokenSchema.omit({ tenantId: true }),
]);
export type ConnectionToken = z.infer<typeof connectionTokenSchema>;
export type MicrosoftToken = z.infer<typeof microsoftTokenSchema>;
export type ConnectionChecks = {
  state: string;
  nonce: string;
  verifier: string;
};
export interface ConnectionProtocol {
  start(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    checks: ConnectionChecks,
  ): Promise<string>;
  complete(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    parameters: Record<string, string>,
    checks: ConnectionChecks,
  ): Promise<{ token: ConnectionToken; accountName: string }>;
  refresh(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    token: ConnectionToken,
  ): Promise<ConnectionToken>;
}
export const personalMicrosoftTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const connectionScopes = {
  onedrive: [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Files.ReadWrite",
  ],
  sharepoint: [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Sites.Read.All",
    "Files.ReadWrite.All",
  ],
  outlook: [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
  ],
  google_docs: [
    "openid",
    "email",
    // Docs handles creation/editing; Drive is only used for search and export.
    // drive.file is redundant and must not be required for a complete grant.
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  gmail: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
} satisfies Record<ConnectionProvider, string[]>;
export function connectionIdentityProvider(
  provider: ConnectionProvider,
): "google" | "microsoft" {
  return provider === "google_docs" || provider === "gmail"
    ? "google"
    : "microsoft";
}
export function parseConnectionToken(
  provider: ConnectionProvider,
  value: unknown,
): ConnectionToken {
  return connectionIdentityProvider(provider) === "google"
    ? microsoftTokenSchema.omit({ tenantId: true }).parse(value)
    : microsoftTokenSchema.parse(value);
}
export function hasConnectionWriteAccess(
  provider: ConnectionProvider,
  scopes: readonly string[],
): boolean {
  if (provider === "google_docs")
    return connectionScopes.google_docs
      .filter((s) => s.startsWith("https:"))
      .every((s) => scopes.includes(s));
  if (provider === "gmail")
    return scopes.includes("https://www.googleapis.com/auth/gmail.modify");
  return hasMicrosoftWriteAccess(provider, scopes);
}

export function hasMicrosoftWriteAccess(
  provider: ConnectionProvider,
  scopes: readonly string[],
): boolean {
  const granted = new Set(
    scopes.map((scope) =>
      scope.replace(/^https:\/\/graph.microsoft.com\//iu, "").toLowerCase(),
    ),
  );
  if (provider === "outlook")
    return granted.has("mail.readwrite") && granted.has("mail.send");
  return (
    granted.has("files.readwrite.all") ||
    granted.has("sites.readwrite.all") ||
    (provider === "onedrive" && granted.has("files.readwrite"))
  );
}

export class MicrosoftConnectionProtocol implements ConnectionProtocol {
  constructor(
    private readonly publicBaseUrl: string,
    private readonly now: () => number = Date.now,
  ) {}
  redirectUri(provider: ConnectionProvider): string {
    return new URL(
      `/api/v1/connectors/${provider}/callback`,
      this.publicBaseUrl,
    ).toString();
  }
  private configuration(
    provider: ConnectionProvider,
    settings: SocialConfiguration,
  ): Promise<oidc.Configuration> {
    // openid-client's Entra discovery support validates the tenant-specific
    // issuer, audience, nonce and signature, including common/organizations.
    return oidc.discovery(
      new URL(
        `https://login.microsoftonline.com/${provider === "sharepoint" ? "organizations" : "common"}/v2.0`,
      ),
      settings.client_id,
      settings.client_secret,
      oidc.ClientSecretPost(settings.client_secret),
      { timeout: 8, execute: [oidc.enableNonRepudiationChecks] },
    );
  }
  async start(
    provider: ConnectionProvider,
    settings: SocialConfiguration,
    checks: ConnectionChecks,
  ): Promise<string> {
    const config = await this.configuration(provider, settings);
    return oidc
      .buildAuthorizationUrl(config, {
        response_type: "code",
        response_mode: "query",
        redirect_uri: this.redirectUri(provider),
        scope: connectionScopes[provider].join(" "),
        state: checks.state,
        nonce: checks.nonce,
        prompt: "select_account",
        code_challenge: await oidc.calculatePKCECodeChallenge(checks.verifier),
        code_challenge_method: "S256",
      })
      .toString();
  }
  async complete(
    provider: ConnectionProvider,
    settings: SocialConfiguration,
    parameters: Record<string, string>,
    checks: ConnectionChecks,
  ): Promise<{ token: ConnectionToken; accountName: string }> {
    const config = await this.configuration(provider, settings);
    const callback = new URL(this.redirectUri(provider));
    callback.search = new URLSearchParams(parameters).toString();
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.verifier,
      idTokenExpected: true,
    });
    const claims = z
      .object({
        sub: z.string(),
        tid: z.uuid(),
        name: z.string().optional(),
        preferred_username: z.string().optional(),
      })
      .parse(tokens.claims());
    if (provider === "sharepoint" && claims.tid === personalMicrosoftTenant)
      throw new AppError("CONNECTION_AUTH_FAILED");
    const scopes = grantedScopes(provider, tokens.scope);
    const token = microsoftTokenSchema.parse({
      clientId: settings.client_id,
      accountId: claims.sub,
      tenantId: claims.tid,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:
        this.now() +
        z.number().positive().max(172_800).parse(tokens.expires_in) * 1000,
      scopes,
    });
    return {
      token,
      accountName: (
        claims.preferred_username ||
        claims.name ||
        "Microsoft"
      ).slice(0, 320),
    };
  }
  async refresh(
    provider: ConnectionProvider,
    settings: SocialConfiguration,
    value: ConnectionToken,
  ): Promise<MicrosoftToken> {
    const current = microsoftTokenSchema.parse(value);
    try {
      const config = await this.configuration(provider, settings);
      const tokens = await oidc.refreshTokenGrant(
        config,
        current.refreshToken,
        {
          // Refresh preserves consent. New write permissions require interactive authorization.
          scope: [...new Set([...current.scopes, "offline_access"])].join(" "),
        },
      );
      return microsoftTokenSchema.parse({
        ...current,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? current.refreshToken,
        expiresAt:
          this.now() +
          z.number().positive().max(172_800).parse(tokens.expires_in) * 1000,
        scopes: tokens.scope
          ? grantedScopes(provider, tokens.scope, false)
          : current.scopes,
      });
    } catch (error) {
      if (
        error instanceof oidc.ResponseBodyError &&
        error.error === "invalid_grant"
      )
        throw new AppError("CONNECTION_REQUIRED");
      if (error instanceof AppError) throw error;
      throw new AppError("CONNECTION_UNAVAILABLE");
    }
  }
}

function grantedScopes(
  provider: ConnectionProvider,
  value: string | undefined,
  requireWrite = true,
): string[] {
  const scopes = (value ?? "").split(/\s+/u).filter(Boolean);
  const expected =
    provider === "outlook"
      ? "Mail.ReadWrite"
      : provider === "sharepoint"
        ? "Sites.Read.All"
        : "Files.Read";
  if (
    (requireWrite && !hasMicrosoftWriteAccess(provider, scopes)) ||
    (!scopes.some(
      (scope) =>
        scope.toLowerCase() === expected.toLowerCase() ||
        scope.toLowerCase() ===
          `https://graph.microsoft.com/${expected}`.toLowerCase(),
    ) &&
      !(provider === "onedrive" && hasMicrosoftWriteAccess(provider, scopes)))
  )
    throw new AppError("CONNECTION_AUTH_FAILED");
  return scopes;
}
