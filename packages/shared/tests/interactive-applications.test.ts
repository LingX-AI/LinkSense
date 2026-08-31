import { describe, expect, it } from "vitest";

import {
  emitInteractiveApplicationCustomEventInputSchema,
  interactiveApplicationManifestSchema,
  interactiveApplicationEventNameSchema,
  interactiveApplicationRuntimeTokenResultSchema,
} from "../src/index.js";

describe("interactive application contracts", () => {
  it("accepts a versioned package with a strict custom event contract", () => {
    const manifest = interactiveApplicationManifestSchema.parse({
      schema_version: 1,
      id: "research-workbench",
      name: "Research workbench",
      version: "1.0.0",
      sdk_version: 1,
      custom_events: [
        {
          name: "research.section_ready",
          description: "Emitted when one section is ready.",
          payload_schema: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: { title: { type: "string" } },
          },
        },
      ],
    });

    expect(manifest.entry).toBe("index.html");
    expect(manifest.custom_events[0]?.schema_version).toBe(1);
    expect(manifest.permissions).toContain("tasks:write");
  });

  it("rejects reserved and duplicate event names", () => {
    expect(
      interactiveApplicationEventNameSchema.safeParse(
        "linksense.message.delta",
      ).success,
    ).toBe(false);
    expect(
      interactiveApplicationManifestSchema.safeParse({
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
        custom_events: [
          {
            name: "research.ready",
            description: "First declaration.",
            payload_schema: { type: "object" },
          },
          {
            name: "research.ready",
            description: "Duplicate declaration.",
            payload_schema: { type: "object" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds the runtime URL to the exact package manifest", () => {
    const result = interactiveApplicationRuntimeTokenResultSchema.parse({
      runtime_url:
        "/api/v1/interactive-app-runtime/runtime-token/index.html",
      expires_at: "2026-08-25T01:00:00.000Z",
      manifest: {
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
      },
    });

    expect(result.manifest.version).toBe("1.0.0");
    expect(result.manifest.permissions).toContain("tasks:write");
  });

  it("requires a structured object as a custom event payload", () => {
    expect(
      emitInteractiveApplicationCustomEventInputSchema.safeParse({
        name: "research.section_ready",
        payload: { title: "Market overview" },
      }).success,
    ).toBe(true);
    expect(
      emitInteractiveApplicationCustomEventInputSchema.safeParse({
        name: "research.section_ready",
        payload: JSON.stringify({ title: "Market overview" }),
      }).success,
    ).toBe(false);
  });
});
