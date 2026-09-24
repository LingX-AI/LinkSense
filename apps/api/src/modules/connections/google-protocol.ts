import * as oidc from "openid-client";
import { z } from "zod";
import type { ConnectionProvider } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { SocialConfiguration } from "../social-auth/settings.js";
import {
  connectionIdentityProvider,
  connectionScopes,
  hasConnectionWriteAccess,
  parseConnectionToken,
  MicrosoftConnectionProtocol,
  type ConnectionProtocol,
  type ConnectionChecks,
  type ConnectionToken,
} from "./protocol.js";

export class GoogleConnectionProtocol implements ConnectionProtocol {
  constructor(
    private readonly publicBaseUrl: string,
    private readonly now: () => number = Date.now,
  ) {}
  private redirect(provider: ConnectionProvider): string {
    return new URL(
      `/api/v1/connectors/${provider}/callback`,
      this.publicBaseUrl,
    ).toString();
  }
  private configuration(
    settings: SocialConfiguration,
  ): Promise<oidc.Configuration> {
    return oidc.discovery(
      new URL("https://accounts.google.com"),
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
    return oidc
      .buildAuthorizationUrl(await this.configuration(settings), {
        response_type: "code",
        redirect_uri: this.redirect(provider),
        scope: connectionScopes[provider].join(" "),
        state: checks.state,
        nonce: checks.nonce,
        access_type: "offline",
        prompt: "consent select_account",
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
    const url = new URL(this.redirect(provider));
    url.search = new URLSearchParams(parameters).toString();
    const result = await oidc.authorizationCodeGrant(
      await this.configuration(settings),
      url,
      {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.verifier,
        idTokenExpected: true,
      },
    );
    const claims = z
      .object({
        sub: z.string(),
        email: z.email(),
        email_verified: z.literal(true),
      })
      .parse(result.claims());
    const scopes = (result.scope ?? "").split(/\s+/u);
    if (!hasConnectionWriteAccess(provider, scopes))
      throw new AppError("CONNECTION_AUTH_FAILED");
    return {
      accountName: claims.email,
      token: parseConnectionToken(provider, {
        clientId: settings.client_id,
        accountId: claims.sub,
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt:
          this.now() +
          z.number().positive().max(172800).parse(result.expires_in) * 1000,
        scopes,
      }),
    };
  }
  async refresh(
    provider: ConnectionProvider,
    settings: SocialConfiguration,
    current: ConnectionToken,
  ): Promise<ConnectionToken> {
    try {
      const result = await oidc.refreshTokenGrant(
        await this.configuration(settings),
        current.refreshToken,
      );
      const scopes = result.scope ? result.scope.split(/\s+/u) : current.scopes;
      if (!hasConnectionWriteAccess(provider, scopes))
        throw new AppError("CONNECTION_REQUIRED");
      return parseConnectionToken(provider, {
        ...current,
        accessToken: result.access_token,
        refreshToken: result.refresh_token ?? current.refreshToken,
        expiresAt:
          this.now() +
          z.number().positive().max(172800).parse(result.expires_in) * 1000,
        scopes,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof oidc.ResponseBodyError &&
        error.error === "invalid_grant"
      )
        throw new AppError("CONNECTION_REQUIRED");
      throw new AppError("CONNECTION_UNAVAILABLE");
    }
  }
}
export class ProviderConnectionProtocol implements ConnectionProtocol {
  private readonly google: GoogleConnectionProtocol;
  private readonly microsoft: MicrosoftConnectionProtocol;
  constructor(publicBaseUrl: string) {
    this.google = new GoogleConnectionProtocol(publicBaseUrl);
    this.microsoft = new MicrosoftConnectionProtocol(publicBaseUrl);
  }
  private for(provider: ConnectionProvider): ConnectionProtocol {
    return connectionIdentityProvider(provider) === "google"
      ? this.google
      : this.microsoft;
  }
  start(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    checks: ConnectionChecks,
  ): Promise<string> {
    return this.for(provider).start(provider, config, checks);
  }
  complete(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    parameters: Record<string, string>,
    checks: ConnectionChecks,
  ): Promise<{ token: ConnectionToken; accountName: string }> {
    return this.for(provider).complete(provider, config, parameters, checks);
  }
  refresh(
    provider: ConnectionProvider,
    config: SocialConfiguration,
    token: ConnectionToken,
  ): Promise<ConnectionToken> {
    return this.for(provider).refresh(provider, config, token);
  }
}
