import { describe, expect, it } from "vitest";
import {
  connectionProviderSchema,
  connectionProviderSettingsSchema,
  connectionSettingsEnvelopeSchema,
  updateConnectionSettingsSchema,
} from "../src/index.js";

describe("connector administration contracts", () => {
  it.each(connectionProviderSchema.options)("accepts separate settings for %s without a sign-in switch", (provider) => {
    expect(connectionSettingsEnvelopeSchema.parse({
      [provider]: { revision: 1, client_id: "app", client_secret: "private" },
    })[provider]?.client_id).toBe("app");
    expect(connectionProviderSettingsSchema.safeParse({
      provider, revision: 1, client_id: "app", secret_configured: true,
      redirect_uri: `https://app.example.test/api/v1/connectors/${provider}/callback`,
      required_scopes: ["openid"], connected_account_count: 0, client_secret: "private",
    }).success).toBe(false);
  });

  it("normalizes app IDs, retains an omitted secret and requires explicit acknowledgement", () => {
    expect(updateConnectionSettingsSchema.parse({ expected_revision: 0, client_id: " app " })).toEqual({
      expected_revision: 0, client_id: "app", acknowledge_reauthorization: false,
    });
    for (const input of [
      { expected_revision: 0, client_id: " " },
      { expected_revision: -1, client_id: "app" },
      { expected_revision: 0, client_id: "app", client_secret: " " },
      { expected_revision: 0, client_id: "app", enabled: true },
      { expected_revision: 0, client_id: "app", acknowledge_reauthorization: "true" },
    ]) expect(updateConnectionSettingsSchema.safeParse(input).success).toBe(false);
  });
});
