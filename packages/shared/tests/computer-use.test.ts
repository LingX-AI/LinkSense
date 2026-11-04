import { expect, it } from "vitest";
import {
  computerUseReadOnly, computerUseRequestSchema, computerUseResultSchema,
  computerUseFailure, computerUsePairRequestSchema,
} from "../src/computer-use.js";
const device = "10000000-0000-4000-8000-000000000001";
it("accepts only bounded desktop actions and rejects shell, flags, NUL and privileged fields", () => {
  for (const input of [
    { action: "shell", command: "open app" },
    { action: "apps", device_id: device, owner_id: device },
    { action: "snapshot", device_id: device, app: "--force", window_id: "1" },
    { action: "snapshot", device_id: device, app: "Notes", window_id: "--headed" },
    { action: "type", device_id: device, ref: "@snap:e1", text: "\0" },
    { action: "type", device_id: device, ref: "@snap:e1", text: "中".repeat(3_000) },
    { action: "scroll", device_id: device, ref: "@snap:e1", direction: "up", amount: 11 },
    { action: "key", device_id: device, app: "Notes", window_id: "1", key: "Cmd+Q" },
  ]) expect(computerUseRequestSchema.safeParse(input).success).toBe(false);
  expect(computerUseRequestSchema.parse({ action: "type", device_id: device, ref: "@snap:e1", text: "--help" }).action).toBe("type");
});
it("keeps writes outside Plan and uncertain outcomes non-retryable", () => {
  expect(computerUseReadOnly({ action: "status" })).toBe(true);
  expect(computerUseReadOnly({ action: "snapshot", device_id: device, app: "Notes", window_id: "1" })).toBe(true);
  expect(computerUseReadOnly({ action: "click", device_id: device, ref: "@snap:e1" })).toBe(false);
  expect(computerUseReadOnly({ action: "release", device_id: device })).toBe(false);
  expect(computerUseResultSchema.parse(computerUseFailure("COMPUTER_USE_TIMEOUT", "unknown"))).toMatchObject({ retryable: false, delivery: "unknown" });
  expect(computerUsePairRequestSchema.safeParse({ code: "x", name: "Computer", platform: "darwin" }).success).toBe(false);
});
it("accepts Unicode application names without allowing flags, controls or unbounded targets", () => {
  for (const app of ["微信.exe", "工具 (64位).exe", "Éditeur.app", "com.apple.Notes"]) {
    expect(computerUseRequestSchema.safeParse({ action: "windows", device_id: device, app }).success).toBe(true);
  }
  for (const app of ["--headed", "工具\0.exe", "工具\n.exe", "中".repeat(201)]) {
    expect(computerUseRequestSchema.safeParse({ action: "windows", device_id: device, app }).success).toBe(false);
  }
});
