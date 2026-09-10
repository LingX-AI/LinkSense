import { describe, expect, it } from "vitest";
import {
  credentialConfigurationStatusSchema,
  credentialPluginConfigurationSchema,
} from "../src/credentials.js";

describe("redacted plugin credential configuration", () => {
  it.each(credentialConfigurationStatusSchema.options)(
    "accepts the explicit %s status",
    (status) => {
      expect(
        credentialPluginConfigurationSchema.parse({
          capability_id: "20000000-0000-4000-8000-000000000001",
          available: true,
          fields: [{ env_key: "CLIENT_ID", status }],
        }).fields[0]?.status,
      ).toBe(status);
    },
  );
  it("rejects secret material and unsupported states", () => {
    const base = {
      capability_id: "20000000-0000-4000-8000-000000000001",
      available: true,
    };
    expect(
      credentialPluginConfigurationSchema.safeParse({
        ...base,
        fields: [{ env_key: "API_KEY", status: "connected" }],
      }).success,
    ).toBe(false);
    expect(
      credentialPluginConfigurationSchema.safeParse({
        ...base,
        fields: [{ env_key: "API_KEY", status: "configured", value: "secret" }],
      }).success,
    ).toBe(false);
    expect(
      credentialPluginConfigurationSchema.safeParse({
        ...base,
        fields: [],
        encrypted_payload: "ciphertext",
      }).success,
    ).toBe(false);
  });
});
