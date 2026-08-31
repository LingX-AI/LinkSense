import { describe, expect, it, vi } from "vitest"

import {
  ConfigurableOpenIdClientFlow,
  OpenIdClientFlow,
  type OidcStateStore,
} from "../src/modules/auth/oidc.js"
import { ConfigurableMicrosoftTeamsTokenVerifier } from "../src/modules/auth/teams.js"
import type {
  OidcFlow,
  TeamsTokenVerifier,
} from "../src/modules/auth/types.js"
import type { ResolvedAuthenticationSettings } from "../src/modules/system/authentication-settings.js"

describe("runtime authentication settings", () => {
  it("rejects an OIDC callback started under an older configuration revision", async () => {
    const flow = new OpenIdClientFlow(
      {
        issuerUrl: "https://identity.example.com",
        clientId: "linksense",
        clientSecret: "new-secret",
        redirectUri:
          "https://linksense.example.test/api/v1/auth/oidc/callback",
        revision: 2,
      },
      {
        save: vi.fn(async () => undefined),
        consume: vi.fn(async () => ({
          codeVerifier: "v".repeat(43),
          nonce: "n".repeat(16),
          configurationRevision: 1,
        })),
      },
    )

    await expect(
      flow.complete(
        new URL(
          "https://linksense.example.test/api/v1/auth/oidc/callback?state=old-state&code=old-code",
        ),
      ),
    ).rejects.toThrow("OIDC configuration changed")
  })

  it("rebuilds the OIDC client when the provider revision changes", async () => {
    let oidc = configuredOidc("secret-one", 1)
    const first = oidcFlow("https://identity-one.example/authorize")
    const second = oidcFlow("https://identity-two.example/authorize")
    const createFlow = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const flow = new ConfigurableOpenIdClientFlow(
      { resolveOidc: vi.fn(async () => oidc) },
      {} as OidcStateStore,
      { createFlow },
    )

    await expect(flow.start()).resolves.toEqual({
      authorizationUrl: "https://identity-one.example/authorize",
    })
    oidc = configuredOidc("secret-two", 2)
    await expect(flow.start()).resolves.toEqual({
      authorizationUrl: "https://identity-two.example/authorize",
    })

    expect(createFlow).toHaveBeenCalledTimes(2)
    expect(createFlow.mock.calls[1]?.[0]).toMatchObject({
      clientSecret: "secret-two",
      revision: 2,
    })
  })

  it("rebuilds the Teams verifier when tenant or client settings change", async () => {
    let teams = configuredTeams(
      "00000000-0000-4000-8000-000000000111",
      "00000000-0000-4000-8000-000000000222",
      1,
    )
    const first = teamsVerifier("first@example.com")
    const second = teamsVerifier("second@example.com")
    const createVerifier = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const verifier = new ConfigurableMicrosoftTeamsTokenVerifier(
      { resolveTeams: vi.fn(async () => teams) },
      "https://linksense.example.test",
      { createVerifier },
    )

    await expect(verifier.verify("token-one")).resolves.toEqual({
      email: "first@example.com",
    })
    teams = configuredTeams(
      "00000000-0000-4000-8000-000000000333",
      "00000000-0000-4000-8000-000000000444",
      2,
    )
    await expect(verifier.verify("token-two")).resolves.toEqual({
      email: "second@example.com",
    })

    expect(createVerifier).toHaveBeenCalledTimes(2)
    expect(createVerifier).toHaveBeenLastCalledWith({
      tenantId: "00000000-0000-4000-8000-000000000333",
      clientId: "00000000-0000-4000-8000-000000000444",
      applicationIdUri:
        "api://linksense.example.test/00000000-0000-4000-8000-000000000444",
    })
  })

  it("keeps OIDC and Teams unavailable when the public URL uses HTTP", async () => {
    const createFlow = vi.fn(() => oidcFlow("https://identity.example/authorize"))
    const oidc = new ConfigurableOpenIdClientFlow(
      { resolveOidc: vi.fn(async () => configuredOidc("secret", 1)) },
      {} as OidcStateStore,
      { securePublicUrl: false, createFlow },
    )
    const createVerifier = vi.fn(() => teamsVerifier("person@example.com"))
    const teams = new ConfigurableMicrosoftTeamsTokenVerifier(
      {
        resolveTeams: vi.fn(async () =>
          configuredTeams(
            "00000000-0000-4000-8000-000000000111",
            "00000000-0000-4000-8000-000000000222",
            1,
          ),
        ),
      },
      "http://linksense.example.test",
      { securePublicUrl: false, createVerifier },
    )

    await expect(oidc.status()).resolves.toBe("invalid")
    await expect(oidc.start()).rejects.toThrow("secure public URL")
    await expect(teams.status()).resolves.toBe("invalid")
    await expect(teams.verify("token")).rejects.toThrow("secure public URL")
    expect(createFlow).not.toHaveBeenCalled()
    expect(createVerifier).not.toHaveBeenCalled()
  })
})

function configuredOidc(
  clientSecret: string,
  revision: number,
): ResolvedAuthenticationSettings["oidc"] {
  return {
    mode: "managed",
    status: "configured",
    source: "system",
    revision,
    configuration: {
      issuerUrl: "https://identity.example.com",
      clientId: "linksense",
      clientSecret,
      redirectUri: "https://linksense.example.test/api/v1/auth/oidc/callback",
    },
  }
}

function configuredTeams(
  tenantId: string,
  clientId: string,
  revision: number,
): ResolvedAuthenticationSettings["teams"] {
  return {
    mode: "managed",
    status: "configured",
    source: "system",
    revision,
    configuration: { tenantId, clientId },
  }
}

function oidcFlow(authorizationUrl: string): OidcFlow {
  return {
    status: vi.fn(async () => "configured" as const),
    start: vi.fn(async () => ({ authorizationUrl })),
    complete: vi.fn(async () => ({ email: "member@example.com" })),
  }
}

function teamsVerifier(email: string): TeamsTokenVerifier {
  return {
    status: vi.fn(async () => "configured" as const),
    verify: vi.fn(async () => ({ email })),
  }
}
