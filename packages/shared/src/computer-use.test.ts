import { describe, expect, it } from "vitest";
import {
  computerActInputSchema,
  computerActResultSchema,
  computerObservationSchema,
  computerScreenshotMaxBytes,
  computerScreenshotMaxDimension,
  computerScreenshotMaxEncodedBytes,
  computerScreenshotMaxResultBytes,
  computerScreenshotSchema,
  type ComputerScreenshot,
} from "./computer-use.js";
import { desktopExecutionMaxFrameBytes } from "./desktop-execution.js";

const click = { action: "click", observation_id: "obs-1", ref: "e1" };
/** Synthetic 2x3 PNG; 74 decoded bytes. */
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII=";
/** Synthetic 1x1 JPEG. */
const jpeg =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";
function screenshot(overrides: Partial<ComputerScreenshot> = {}): ComputerScreenshot {
  return { mime_type: "image/png", data_base64: png, width: 2, height: 3, ...overrides };
}

describe("local computer tool contracts", () => {
  it("does not accept host selectors, coordinates, paths or commands from the model", () => {
    for (const extra of [
      { bundle_id: "com.example.Other" },
      { window_id: 1 },
      { pid: 42 },
      { x: 1, y: 2 },
      { path: "/tmp/file" },
      { command: "open -a Calculator" },
      { grant_id: "10000000-0000-4000-8000-000000000001" },
    ]) {
      expect(computerActInputSchema.safeParse({ ...click, ...extra }).success).toBe(false);
    }
  });

  it("defaults and bounds the effect wait", () => {
    expect(computerActInputSchema.parse(click)).toMatchObject({ timeout_ms: 8_000 });
    expect(computerActInputSchema.safeParse({ ...click, timeout_ms: 99 }).success).toBe(false);
    expect(computerActInputSchema.safeParse({ ...click, timeout_ms: 20_001 }).success).toBe(false);
  });

  it("accepts UTF-8 text up to the byte bound and rejects more", () => {
    const atLimit = "👋".repeat(2_048);
    const overLimit = `${atLimit}👋`;
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(8_192);
    expect(computerActInputSchema.safeParse({ ...click, action: "type", text: atLimit }).success).toBe(true);
    expect(computerActInputSchema.safeParse({ ...click, action: "type", text: overLimit }).success).toBe(false);
  });

  it("bounds observation size and keeps refs opaque", () => {
    const nodes = Array.from({ length: 401 }, (_, index) => ({
      ref: `e${index}`,
      role: "button",
    }));
    expect(computerObservationSchema.safeParse({
      observation_id: "obs-1", tree_quality: "good", truncated: false, nodes,
    }).success).toBe(false);
    expect(computerObservationSchema.safeParse({
      observation_id: "obs-1", tree_quality: "good", truncated: false, nodes: nodes.slice(0, 400),
    }).success).toBe(true);
  });

  it("never accepts a success result without an effect or a failure without an error", () => {
    expect(computerActResultSchema.safeParse({ ok: true, waited_ms: 1 }).success).toBe(false);
    expect(computerActResultSchema.safeParse({ ok: false, waited_ms: 1 }).success).toBe(false);
    expect(computerActResultSchema.safeParse({ ok: true, effect: "done", waited_ms: 1 }).success).toBe(true);
    expect(computerActResultSchema.safeParse({
      ok: false, error: "COMPUTER_STALE_REF", waited_ms: 0,
    }).success).toBe(true);
  });
});

describe("computer screenshot transport schema", () => {
  it("accepts bounded PNG and JPEG metadata", () => {
    expect(computerScreenshotSchema.safeParse(screenshot()).success).toBe(true);
    expect(computerScreenshotSchema.safeParse({
      mime_type: "image/jpeg", data_base64: jpeg, width: 1, height: 1,
    }).success).toBe(true);
  });

  it("carries no target, coordinate, path, command or permission claim", () => {
    for (const extra of [
      { bundle_id: "com.example.Other" },
      { window_id: 1 },
      { screen: 0 },
      { x: 1, y: 2 },
      { path: "/tmp/shot.png" },
      { command: "screencapture" },
      { capture: { user_opt_in: true, screen_recording: "granted" } },
      { user_opt_in: true },
      { screen_recording: "granted" },
    ]) {
      expect(computerScreenshotSchema.safeParse({ ...screenshot(), ...extra }).success).toBe(false);
    }
  });

  it("bounds type, dimensions and encoded size", () => {
    expect(computerScreenshotSchema.safeParse({
      ...screenshot(), mime_type: "image/webp",
    }).success).toBe(false);
    expect(computerScreenshotSchema.safeParse({ ...screenshot(), width: 0 }).success).toBe(false);
    expect(computerScreenshotSchema.safeParse({
      ...screenshot(), width: computerScreenshotMaxDimension + 1,
    }).success).toBe(false);
    expect(computerScreenshotSchema.safeParse({
      ...screenshot(), data_base64: "A".repeat(computerScreenshotMaxEncodedBytes + 4),
    }).success).toBe(false);
    expect(computerScreenshotSchema.safeParse({
      ...screenshot(), data_base64: "not base64",
    }).success).toBe(false);
  });

  it("keeps the fallback result budget well below the desktop frame", () => {
    expect(computerScreenshotMaxResultBytes).toBeLessThanOrEqual(
      desktopExecutionMaxFrameBytes / 2,
    );
    expect(computerScreenshotMaxBytes).toBeLessThan(computerScreenshotMaxEncodedBytes);
    expect(computerScreenshotMaxEncodedBytes).toBeLessThan(computerScreenshotMaxResultBytes);
  });

  it("keeps the screenshot optional and rejects extra observation fields", () => {
    const observation = {
      observation_id: "obs-1", tree_quality: "unusable", truncated: false, nodes: [],
    };
    expect(computerObservationSchema.safeParse(observation).success).toBe(true);
    expect(computerObservationSchema.safeParse({
      ...observation, screenshot: screenshot(),
    }).success).toBe(true);
    expect(computerObservationSchema.safeParse({
      ...observation, bundle_id: "com.example.Other",
    }).success).toBe(false);
    expect(computerObservationSchema.safeParse({ ...observation, screenshot: null }).success).toBe(false);
  });
});
