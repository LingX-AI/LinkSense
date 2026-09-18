import { describe, expect, it } from "vitest";
import { applicationPublicationReadinessSchema } from "../src/application-version.js";

describe("publication readiness response", () => {
  it.each([true, false])("accepts an explicit active-task status: %s", has_active_tasks => {
    expect(applicationPublicationReadinessSchema.parse({ has_active_tasks })).toEqual({ has_active_tasks });
  });
  it.each([{}, { has_active_tasks: null }, { has_active_tasks: "false" }, { has_active_tasks: false, task_contents: "private" }])("rejects missing, invalid or extra fields", value => {
    expect(applicationPublicationReadinessSchema.safeParse(value).success).toBe(false);
  });
});
