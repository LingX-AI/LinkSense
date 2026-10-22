import { describe, expect, it } from "vitest";
import { applicationSetupBindingInputSchema, applicationSetupModelInputSchema, applicationSetupRevisionSchema } from "./application-setup.js";

const revision = { installed_version_id: "10000000-0000-4000-8000-000000000001", updated_at: "2026-10-22T00:00:00.000Z" };

describe("application setup contracts", () => {
  it("requires the installation version and exact saved revision when completing setup", () => {
    expect(applicationSetupRevisionSchema.parse(revision)).toEqual(revision);
    for (const input of [{}, { ...revision, can_complete: true }, { ...revision, updated_at: "yesterday" }, { ...revision, installed_version_id: "other" }]) {
      expect(applicationSetupRevisionSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts an explicit resource selection or clearing, without accepting secrets or an owner override", () => {
    const input = { ...revision, type: "knowledge_base", position: 1, resource_id: null };
    expect(applicationSetupBindingInputSchema.parse(input)).toEqual(input);
    for (const patch of [{ position: -1 }, { position: 100 }, { type: "model" }, { resource_id: "invalid" }, { owner_id: revision.installed_version_id }, { credentials: {} }]) {
      expect(applicationSetupBindingInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });

  it("requires a model and reasoning effort together, or an explicit personal preference", () => {
    expect(applicationSetupModelInputSchema.parse({ ...revision, model: null, reasoning_effort: null }).model).toBeNull();
    expect(applicationSetupModelInputSchema.parse({ ...revision, model: "report-model", reasoning_effort: "high" }).model).toBe("report-model");
    for (const input of [{ model: null, reasoning_effort: "high" }, { model: "report-model", reasoning_effort: null }, { model: "report-model" }]) {
      expect(applicationSetupModelInputSchema.safeParse({ ...revision, ...input }).success).toBe(false);
    }
  });
});
