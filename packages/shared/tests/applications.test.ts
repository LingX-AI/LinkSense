import { describe, expect, it } from "vitest";

import {
  applicationIconPresets,
  applicationSchema,
  applicationDetailsSchema,
  conversationSchema,
  createApplicationGrantInputSchema,
  createApplicationInputSchema,
  errorCatalog,
  updateApplicationInputSchema,
  editAndPublishApplicationInputSchema,
} from "../src/index.js";

const ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "10000000-0000-4000-8000-000000000002";

describe("internal application contracts", () => {
  it("requires valid changes and a numeric release version for edit and publication", () => {
    const input = { changes: { name: "Review", model: null, reasoning_effort: null }, release: { version_number: "0.0.1" } };
    expect(editAndPublishApplicationInputSchema.parse(input)).toEqual({ ...input, release: { ...input.release, usage_instructions: "" } });
    for (const invalid of [{ ...input, changes: {} }, { ...input, release: { version_number: "v0.0.1" } }, { ...input, release: { version_number: "1.0.0-beta" } }, { ...input, changes: { model: "fixed-model" } }, { ...input, owner_id: OWNER_ID }]) {
      expect(editAndPublishApplicationInputSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("accepts safe read-only resource summaries and rejects private configuration fields", () => {
    const input = {
      id: ID, name: "App", icon: { type: "preset", preset: "bot" }, description: null,
      kind: "interactive", model: null, status: "active", creator_name: "Creator", view: "configuration",
      version_number: "1.0.0", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z",
      resources: [{ id: OWNER_ID, type: "skill", name: "Research", configured_name: null, status: "unconfigured" }],
    };
    expect(applicationDetailsSchema.safeParse(input).success).toBe(true);
    expect(applicationDetailsSchema.safeParse({ ...input, instructions: "private" }).success).toBe(false);
    expect(applicationDetailsSchema.safeParse({ ...input, resources: [{ ...input.resources[0], credentials: "private" }] }).success).toBe(false);
    expect(applicationDetailsSchema.safeParse({ ...input, resources: [{ ...input.resources[0], status: "ready" }] }).success).toBe(false);
  });
  it.each([null, "APPLICATION_NOT_FOUND", "APPLICATION_DELETED", "APPLICATION_DISABLED", "APPLICATION_DEPENDENCY_UNAVAILABLE"] as const)("carries application icons and unavailable reason %s in conversation summaries", (reason) => {
    const available = reason === null;
    const parsed = conversationSchema.parse({
      id: ID,
      owner_id: OWNER_ID,
      title: "AISG学校政策问答助手",
      title_source: "manual",
      archive_status: "active",
      archived_at: null,
      pinned_at: null,
      project_id: null,
      sort_order: null,
      codex_thread_id: null,
      agents_template_version: null,
      collaboration_mode: "default",
      last_turn_status: null,
      execution_status: "idle",
      last_run_at: null,
      selected_knowledge_base_ids: [],
      application: {
        id: "20000000-0000-4000-8000-000000000001",
        name: "AISG学校政策问答助手",
        kind: "standard",
        icon: { type: "preset", preset: "graduation-cap" },
        available,
        unavailable_reason: reason,
      },
      created_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:00:00.000Z",
    });

    expect(parsed.application?.icon).toEqual({
      type: "preset",
      preset: "graduation-cap",
    });
    expect(parsed.has_automation).toBe(false);
    expect(parsed.application?.available).toBe(available);
    expect(parsed.application?.unavailable_reason).toBe(reason);
  });

  it("accepts a fixed model, capabilities, and knowledge bases without a public-access mode", () => {
    const input = createApplicationInputSchema.parse({
      name: "Finance assistant",
      instructions: "Use only the configured resources.",
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      capability_ids: [ID],
      knowledge_base_ids: [OWNER_ID],
      icon: { type: "preset", preset: "graduation-cap" },
      status: "disabled",
    });

    expect(input).toMatchObject({
      model: "gpt-5.6-terra",
      capability_ids: [ID],
      knowledge_base_ids: [OWNER_ID],
      icon: { type: "preset", preset: "graduation-cap" },
      status: "disabled",
    });
    expect(
      createApplicationInputSchema.safeParse({
        ...input,
        public_access: true,
      }).success,
    ).toBe(false);
  });

  it("allows an application to delegate model selection to the user", () => {
    const input = createApplicationInputSchema.parse({
      name: "Finance assistant",
      instructions: "Use only the configured resources.",
    });
    expect(input).toMatchObject({
      model: null,
      reasoning_effort: null,
      capability_ids: [],
      knowledge_base_ids: [],
    });
    expect(
      updateApplicationInputSchema.parse({
        model: null,
        reasoning_effort: null,
      }),
    ).toEqual({ model: null, reasoning_effort: null });
  });

  it("keeps application model and reasoning effort as an atomic pair", () => {
    expect(
      createApplicationInputSchema.safeParse({
        name: "Finance assistant",
        instructions: "Use only the configured resources.",
        model: "gpt-5.6-terra",
      }).success,
    ).toBe(false);
    expect(
      updateApplicationInputSchema.safeParse({ model: null }).success,
    ).toBe(false);
    expect(
      updateApplicationInputSchema.safeParse({
        model: "gpt-5.6-terra",
        reasoning_effort: null,
      }).success,
    ).toBe(false);
  });

  it("only accepts a named internal user or user group as a share target", () => {
    expect(
      createApplicationGrantInputSchema.parse({
        grantee_type: "user",
        user_id: ID,
        usage_modes: ["service"],
      }),
    ).toEqual({ grantee_type: "user", user_id: ID, usage_modes: ["service"] });
    expect(
      createApplicationGrantInputSchema.safeParse({
        grantee_type: "all_users",
      }).success,
    ).toBe(false);
  });

  it("keeps omitted dependency bindings unchanged in a partial update", () => {
    expect(
      updateApplicationInputSchema.parse({ name: "Renamed assistant" }),
    ).toEqual({ name: "Renamed assistant" });
  });

  it("accepts built-in icons and bounded raster upload payloads", () => {
    expect(applicationIconPresets).toHaveLength(20);
    expect(new Set(applicationIconPresets).size).toBe(20);
    for (const preset of applicationIconPresets) {
      expect(
        createApplicationInputSchema.safeParse({
          name: "Preset coverage",
          instructions: "Use the selected built-in icon.",
          icon: { type: "preset", preset },
        }).success,
      ).toBe(true);
    }

    expect(
      createApplicationInputSchema.parse({
        name: "Finance assistant",
        instructions: "Use approved sources.",
        model: "gpt-5.6-terra",
        reasoning_effort: "medium",
        capability_ids: [],
        knowledge_base_ids: [],
        icon: { type: "preset", preset: "book-open" },
      }).icon,
    ).toEqual({ type: "preset", preset: "book-open" });

    expect(
      updateApplicationInputSchema.safeParse({
        icon: {
          type: "upload",
          filename: "icon.svg",
          mime_type: "image/svg+xml",
          data_base64: "PHN2Zz48L3N2Zz4=",
        },
      }).success,
    ).toBe(false);
  });

  it("hides application instructions from a recipient projection", () => {
    const application = applicationSchema.parse({
      id: ID,
      owner: { id: OWNER_ID, name: "Owner" },
      name: "Finance assistant",
      icon: { type: "preset", preset: "bot" },
      description: null,
      kind: "standard",
      instructions: null,
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      status: "active",
      is_owner: false,
      can_manage: false,
      access_source: "direct",
      capability_count: 0,
      mcp_server_count: 0,
      knowledge_base_count: 0,
      dependencies_available: true,
      capabilities: [],
      mcp_servers: [],
      knowledge_bases: [],
      interactive_package: null,
      created_at: "2026-07-27T00:00:00.000Z",
      updated_at: "2026-07-27T00:00:00.000Z",
    });

    expect(application.instructions).toBeNull();
    expect(errorCatalog.APPLICATION_NOT_FOUND.http_status).toBe(404);
  });
});
