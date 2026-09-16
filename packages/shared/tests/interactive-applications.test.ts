import { describe, expect, it } from "vitest";

import {
  emitInteractiveApplicationCustomEventInputSchema,
  interactiveApplicationManifestSchema,
  interactiveApplicationEventNameSchema,
  interactiveApplicationRuntimeTokenResultSchema,
  interactiveApplicationTaskInputSchema,
  userMessageDisplaySchema,
  officeAnnotationDisplaySchema,
} from "../src/index.js";

describe("interactive application contracts", () => {
  it("validates application prompts without truncating long content and rejects empty or oversized input", () => {
    const prompt = "研究要求\n".repeat(100);
    expect(interactiveApplicationTaskInputSchema.parse({ prompt })).toEqual({
      prompt: prompt.trim(),
      capability_ids: [],
      knowledge_base_ids: [],
      file_ids: [],
    });
    for (const invalid of ["", "  ", "x".repeat(200_001)]) {
      expect(
        interactiveApplicationTaskInputSchema.safeParse({ prompt: invalid })
          .success,
      ).toBe(false);
    }
    expect(
      interactiveApplicationTaskInputSchema.safeParse({
        prompt: "研究",
        knowledge_base_ids: ["invalid"],
      }).success,
    ).toBe(false);
  });

  it("accepts explicit file selection and rejects invalid, duplicate or excessive IDs", () => {
    const id = "70000000-0000-4000-8000-000000000001";
    expect(interactiveApplicationTaskInputSchema.parse({ prompt: "Analyze", file_ids: [id] }).file_ids).toEqual([id]);
    for (const file_ids of [["bad"], [id, id], Array(101).fill(id)]) {
      expect(interactiveApplicationTaskInputSchema.safeParse({ prompt: "Analyze", file_ids }).success).toBe(false);
    }
    const oldManifest = { schema_version: 1, id: "example", name: "Example", version: "1", sdk_version: 1 };
    expect(interactiveApplicationManifestSchema.parse(oldManifest).permissions).not.toContain("files:write");
    expect(interactiveApplicationManifestSchema.parse({ ...oldManifest, permissions: ["tasks:write", "files:write"] }).permissions).toContain("files:write");
  });

  it("distinguishes persisted application message metadata from Office annotations", () => {
    const display = {
      kind: "interactive_application",
      application_id: "70000000-0000-4000-8000-000000000088",
    };
    expect(userMessageDisplaySchema.parse(display)).toEqual(display);
    expect(officeAnnotationDisplaySchema.safeParse(display).success).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        ...display,
        application_id: "invalid",
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        ...display,
        prompt: "not display metadata",
      }).success,
    ).toBe(false);
  });
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
