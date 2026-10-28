import { ClientSecretCredential, type ClientSecretCredentialOptions } from "@azure/identity";
import { describe, expect, it } from "vitest";

const tenantId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const authority = `https://login.microsoftonline.com/${tenantId}`;
type HttpClient = NonNullable<ClientSecretCredentialOptions["httpClient"]>;

function credentialFixture(rejectToken = false) {
  const grants: URLSearchParams[] = [];
  const sendRequest: HttpClient["sendRequest"] = async request => {
    const url = new URL(request.url);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    let body: object;
    let status = 200;
    if (url.pathname === "/common/discovery/instance") {
      body = {
        tenant_discovery_endpoint: `${authority}/v2.0/.well-known/openid-configuration`,
        metadata: [{
          preferred_network: "login.microsoftonline.com",
          preferred_cache: "login.microsoftonline.com",
          aliases: ["login.microsoftonline.com"],
        }],
      };
    } else if (url.pathname === `/${tenantId}/v2.0/.well-known/openid-configuration`) {
      body = {
        authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
        token_endpoint: `${authority}/oauth2/v2.0/token`,
        issuer: `${authority}/v2.0`,
        jwks_uri: `${authority}/discovery/v2.0/keys`,
      };
    } else if (url.pathname === `/${tenantId}/oauth2/v2.0/token` && request.method === "POST") {
      expect(typeof request.body).toBe("string");
      grants.push(new URLSearchParams(String(request.body)));
      status = rejectToken ? 400 : 200;
      body = rejectToken
        ? { error: "invalid_client", error_description: "Test client credential rejected" }
        : { access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 };
    } else {
      throw new Error(`Unexpected credential request: ${request.method} ${request.url}`);
    }
    request.headers.set("content-type", "application/json");
    return { request, status, headers: request.headers, bodyAsText: JSON.stringify(body) };
  };
  const credential = new ClientSecretCredential(tenantId, clientId, "test-client-secret", {
    httpClient: { sendRequest },
    retryOptions: { maxRetries: 0 },
  });
  return { credential, grants };
}

describe("patched Azure Identity dependency compatibility", () => {
  it.each(["https://graph.microsoft.com/.default", "https://api.botframework.com/.default"])(
    "preserves existing client credentials and token caching for %s",
    async scope => {
      const { credential, grants } = credentialFixture();
      const token = await credential.getToken(scope);
      expect(token.token).toBe("test-access-token");
      expect(await credential.getToken(scope)).toMatchObject({ token: token.token });
      expect(grants).toHaveLength(1);
      expect(grants[0]?.get("grant_type")).toBe("client_credentials");
      expect(grants[0]?.get("client_id")).toBe(clientId);
      expect(grants[0]?.get("client_secret")).toBe("test-client-secret");
      expect(grants[0]?.get("scope")).toBe(scope);
    },
  );

  it("rejects invalid credentials without returning a token", async () => {
    const { credential, grants } = credentialFixture(true);
    await expect(credential.getToken("https://graph.microsoft.com/.default")).rejects.toThrow("invalid_client");
    expect(grants).toHaveLength(1);
  });
});
