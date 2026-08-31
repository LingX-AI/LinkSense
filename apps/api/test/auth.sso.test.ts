import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose"
import { beforeAll, describe, expect, it } from "vitest"

import { extractOidcIdentity } from "../src/modules/auth/oidc.js"
import { MicrosoftTeamsTokenVerifier } from "../src/modules/auth/teams.js"

const TENANT_ID = "00000000-0000-4000-8000-000000000111"
const CLIENT_ID = "00000000-0000-4000-8000-000000000222"
const APPLICATION_ID_URI = `api://linksense.example.test/${CLIENT_ID}`
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"]
let localJwks: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair("RS256")
  privateKey = pair.privateKey
  const publicJwk = await exportJWK(pair.publicKey)
  publicJwk.kid = "test-key"
  publicJwk.alg = "RS256"
  localJwks = createLocalJWKSet({ keys: [publicJwk] })
})

describe("OIDC identity claims", () => {
  it("normalizes the Azure email and keeps a bounded display name", () => {
    expect(
      extractOidcIdentity({
        preferred_username: " Member@Example.com ",
        name: " Member Name ",
      }),
    ).toEqual({ email: "member@example.com", name: "Member Name" })
  })

  it("ignores an invalid display name without losing a valid email", () => {
    expect(
      extractOidcIdentity({
        email: "member@example.com",
        name: "x".repeat(121),
      }),
    ).toEqual({ email: "member@example.com" })
  })
})

describe("MicrosoftTeamsTokenVerifier", () => {
  it("validates signature, issuer, audience, tenant and extracts only an email identity", async () => {
    const verifier = new MicrosoftTeamsTokenVerifier(
      {
        tenantId: TENANT_ID,
        clientId: CLIENT_ID,
        applicationIdUri: APPLICATION_ID_URI,
      },
      localJwks,
    )
    const token = await teamsToken()
    await expect(verifier.verify(token)).resolves.toEqual({
      email: "member@example.com",
    })
  })

  it("rejects an otherwise signed token for another audience", async () => {
    const verifier = new MicrosoftTeamsTokenVerifier(
      {
        tenantId: TENANT_ID,
        clientId: CLIENT_ID,
        applicationIdUri: APPLICATION_ID_URI,
      },
      localJwks,
    )
    const token = await teamsToken({
      audience: `api://another.example.test/${CLIENT_ID}`,
    })
    await expect(verifier.verify(token)).rejects.toBeDefined()
  })

  it("rejects a mismatched tenant claim even under an accepted issuer", async () => {
    const verifier = new MicrosoftTeamsTokenVerifier(
      {
        tenantId: TENANT_ID,
        clientId: CLIENT_ID,
        applicationIdUri: APPLICATION_ID_URI,
      },
      localJwks,
    )
    const token = await teamsToken({
      tenantClaim: "00000000-0000-4000-8000-000000000999",
    })
    await expect(verifier.verify(token)).rejects.toThrow("Teams tenant mismatch")
  })

  it("does not treat an oid-only identity as an email match", async () => {
    const verifier = new MicrosoftTeamsTokenVerifier(
      {
        tenantId: TENANT_ID,
        clientId: CLIENT_ID,
        applicationIdUri: APPLICATION_ID_URI,
      },
      localJwks,
    )
    const token = await new SignJWT({
      tid: TENANT_ID,
      oid: "00000000-0000-4000-8000-000000000444",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`)
      .setAudience(APPLICATION_ID_URI)
      .setSubject("subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey)
    await expect(verifier.verify(token)).rejects.toThrow("Teams email missing")
  })
})

async function teamsToken(
  options: { audience?: string; tenantClaim?: string } = {},
) {
  return new SignJWT({
    tid: options.tenantClaim ?? TENANT_ID,
    preferred_username: "Member@Example.com",
    oid: "00000000-0000-4000-8000-000000000444",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`)
    .setAudience(options.audience ?? APPLICATION_ID_URI)
    .setSubject("subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey)
}
