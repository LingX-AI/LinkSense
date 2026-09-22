import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SamlProtocol } from "../src/modules/saml/protocol.js";
import {
  memorySamlStates,
  requestDetails,
  samlCertificate,
  samlConfiguration,
  samlUrls,
  SAML_NOW,
  signedResponse,
} from "./saml-fixture.js";

let certificate: Awaited<ReturnType<typeof samlCertificate>>;
let attacker: Awaited<ReturnType<typeof samlCertificate>>;
beforeAll(async () => {
  certificate = await samlCertificate();
  attacker = await samlCertificate();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SAML_NOW);
});
afterEach(() => vi.useRealTimers());
async function fixture() {
  const config = samlConfiguration(certificate.cert);
  const settings = { resolve: async () => config, urls: () => samlUrls };
  const states = memorySamlStates();
  const protocol = new SamlProtocol(settings, states);
  const request = requestDetails(
    await protocol.start("original-browser", "192.0.2.1"),
  );
  const input = {
    RelayState: request.relay,
    SAMLResponse: signedResponse(request.id, certificate.private),
  };
  return { config, settings, states, protocol, request, input };
}
describe("SAML protocol with real assertion signatures", () => {
  it("starts an SP request and accepts a signed, correlated assertion exactly once across workers", async () => {
    const f = await fixture();
    expect(f.request.xml).toContain(samlUrls.acsUrl);
    expect(f.request.xml).toContain(samlUrls.entityId);
    const otherWorker = new SamlProtocol(f.settings, f.states);
    expect(await otherWorker.complete(f.input, "original-browser")).toEqual({
      email: "member@example.test",
      name: "Member",
    });
    await expect(
      f.protocol.complete(f.input, "original-browser"),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  });
  it.each([
    ["unsigned", { unsigned: true }],
    ["wrong issuer", { issuer: "https://attacker.example.test" }],
    ["wrong audience", { audience: "https://other-app.example.test" }],
    ["wrong recipient", { recipient: "https://other-app.example.test/acs" }],
    [
      "wrong destination",
      { destination: "https://other-app.example.test/acs" },
    ],
    ["wrong request", { requestId: "_unrequested" }],
    ["expired", { expires: "2026-09-22T07:55:00Z" }],
    ["not yet valid", { notBefore: "2026-09-22T09:00:00Z" }],
    ["too old", { issued: "2026-09-22T07:00:00Z" }],
    ["invalid email", { email: "not-an-email" }],
    ["missing authentication statement", { missingAuthnStatement: true }],
    ["missing expiry", { missingExpiry: true }],
  ] as const)("rejects %s assertions", async (_name, overrides) => {
    const f = await fixture();
    await expect(
      f.protocol.complete(
        {
          ...f.input,
          SAMLResponse: signedResponse(
            f.request.id,
            certificate.private,
            overrides,
          ),
        },
        "original-browser",
      ),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  });
  it("rejects forged and tampered signatures", async () => {
    for (const tamper of [false, true]) {
      const f = await fixture();
      const response = tamper
        ? Buffer.from(
            Buffer.from(f.input.SAMLResponse, "base64")
              .toString()
              .replace("MEMBER@example.test", "ADMIN@example.test"),
          ).toString("base64")
        : signedResponse(f.request.id, attacker.private);
      await expect(
        f.protocol.complete(
          { ...f.input, SAMLResponse: response },
          "original-browser",
        ),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }
  });
  it.each(["status", "version", "missing status"])(
    "rejects an invalid response envelope: %s",
    async (scenario) => {
      const f = await fixture();
      let xml = Buffer.from(f.input.SAMLResponse, "base64").toString();
      if (scenario === "status")
        xml = xml.replace("status:Success", "status:Responder");
      if (scenario === "version")
        xml = xml.replace('Version="2.0"', 'Version="1.1"');
      if (scenario === "missing status")
        xml = xml.replace(/<samlp:Status>.*?<\/samlp:Status>/u, "");
      await expect(
        f.protocol.complete(
          { ...f.input, SAMLResponse: Buffer.from(xml).toString("base64") },
          "original-browser",
        ),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    },
  );
  it("rejects starts exceeding the shared IP limit without creating a flow", async () => {
    const f = await fixture();
    const put = vi.spyOn(f.states, "put");
    vi.spyOn(f.states, "throttle").mockResolvedValue(false);
    await expect(
      f.protocol.start("browser", "192.0.2.1"),
    ).rejects.toMatchObject({ code: "AUTH_LOGIN_RATE_LIMITED" });
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects missing, expired, changed and cross-browser flows", async () => {
    for (const scenario of [
      "unknown",
      "expired",
      "changed",
      "browser",
      "disabled",
    ]) {
      vi.setSystemTime(SAML_NOW);
      const f = await fixture();
      if (scenario === "unknown") f.input.RelayState = "x".repeat(43);
      if (scenario === "expired")
        vi.setSystemTime(SAML_NOW.getTime() + 301_000);
      if (scenario === "changed") f.config.revision += 1;
      if (scenario === "disabled") f.config.enabled = false;
      await expect(
        f.protocol.complete(
          f.input,
          scenario === "browser" ? "other-browser" : "original-browser",
        ),
      ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    }
  });
  it("allows only one concurrent completion and supports explicit NameID email mapping", async () => {
    const f = await fixture();
    f.config.email_attribute = "NameID";
    f.input.SAMLResponse = signedResponse(f.request.id, certificate.private, {
      nameId: "member@example.test",
    });
    const results = await Promise.allSettled([
      f.protocol.complete(f.input, "original-browser"),
      f.protocol.complete(f.input, "original-browser"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });
  it("publishes metadata and signs outgoing requests without exposing the private key", async () => {
    const f = await fixture();
    f.config.sign_requests = true;
    f.config.signing_certificate = certificate.cert;
    f.config.signing_private_key = certificate.private;
    const url = new URL(await f.protocol.start("second-browser", "192.0.2.1"));
    expect(url.searchParams.get("SigAlg")).toBe(
      "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    );
    expect(url.searchParams.get("Signature")).toBeTruthy();
    const metadata = await f.protocol.metadata();
    expect(metadata).toContain(samlUrls.entityId);
    expect(metadata).toContain(samlUrls.acsUrl);
    expect(metadata).toContain('WantAssertionsSigned="true"');
    expect(metadata).not.toContain("PRIVATE KEY");
  });
  it("fails closed for HTTP, invalid certificates, DTDs and disabled providers", async () => {
    const f = await fixture();
    const dtd = Buffer.from(
      '<!DOCTYPE Response [<!ENTITY test "bad">]><Response/>',
    ).toString("base64");
    await expect(
      f.protocol.complete(
        { ...f.input, SAMLResponse: dtd },
        "original-browser",
      ),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    f.config.idp_certificate = "invalid certificate";
    expect(await f.protocol.available()).toBe(false);
    const http = new SamlProtocol(
      {
        ...f.settings,
        urls: () => ({ ...samlUrls, acsUrl: "http://localhost/acs" }),
      },
      f.states,
    );
    expect(await http.available()).toBe(false);
  });
});
