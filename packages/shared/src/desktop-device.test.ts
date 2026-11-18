import { describe, expect, it } from "vitest";
import {
  desktopDeviceClientFrameSchema,
  desktopDevicePairInputSchema,
  desktopDeviceRegistrationSchema,
  desktopDeviceSchema,
  desktopRunCredentialsSchema,
} from "./desktop-device.js";

const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };

describe("desktop device trust boundaries", () => {
  it("accepts only purpose-scoped model access and rejects cloud credentials even when nested", () => {
    const model = {
      purpose: "primary",
      model: "fixture-model",
      revision: 1,
      protocol_mode: "native_responses",
      token: `lsdm_${"a".repeat(43)}`,
    };
    const credentials = {
      turn_id: "10000000-0000-4000-8000-000000000001",
      expires_at: "2026-11-18T00:10:00Z",
      run_token: `lsdr_${"b".repeat(43)}`,
      primary: model,
      memory_extraction: { ...model, purpose: "memory_extraction", reasoning_effort: "low" },
      transition_source: { ...model, purpose: "transition_source" },
    };
    expect(desktopRunCredentialsSchema.parse(credentials)).toEqual(credentials);
    for (const input of [
      { ...credentials, environment: { RUNNER_SECRET: "fixture-only" } },
      { ...credentials, run_token: model.token },
      { ...credentials, primary: { ...model, apiKey: "fixture-only" } },
      { ...credentials, primary: { ...model, baseUrl: "https://upstream.example.test" } },
      { ...credentials, memory_extraction: { ...credentials.memory_extraction, apiKey: "fixture-only" } },
      { ...credentials, transition_source: { ...credentials.transition_source, provider: { apiKey: "fixture-only" } } },
      { ...credentials, transition_source: { ...credentials.transition_source, purpose: "primary" } },
    ]) {
      expect(desktopRunCredentialsSchema.safeParse(input).success).toBe(false);
    }
  });

  it("does not advertise local execution or GUI capabilities by default", () => {
    expect(desktopDeviceRegistrationSchema.parse(registration).capabilities).toEqual({
      local_execution: false, browser_extension: false, computer_use: false,
    });
  });

  it("rejects caller-supplied ownership, credentials and unknown nested capabilities", () => {
    const base = { ...registration, code: "a".repeat(32) };
    for (const input of [
      { ...base, owner_id: "10000000-0000-4000-8000-000000000001" },
      { ...base, modelProvider: { apiKey: "test-only-key" } },
      { ...base, capabilities: { local_execution: true, shared_secret: "test-only-secret" } },
      { ...base, platform: "linux" },
      { ...base, name: "name\ninjected" },
    ]) {
      expect(desktopDevicePairInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts only authentication and heartbeat frames before execution is implemented", () => {
    expect(desktopDeviceClientFrameSchema.parse({
      type: "hello", token: "a".repeat(64), protocol_version: 1,
    }).type).toBe("hello");
    for (const frame of [
      { type: "ping", ownerId: "other" },
      { type: "hello", token: "a".repeat(64), protocol_version: 2 },
      { type: "execute", command: "echo hello" },
      { type: "event", event: { type: "turn.completed" } },
    ]) expect(desktopDeviceClientFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("rejects exposing internal device credential hashes in a public device record", () => {
    expect(desktopDeviceSchema.safeParse({
      ...registration, id: "10000000-0000-4000-8000-000000000001",
      online: false, last_seen_at: null, revoked_at: null,
      created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z",
      tokenHash: "a".repeat(64),
    }).success).toBe(false);
  });
});
