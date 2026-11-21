import { describe, expect, it } from "vitest";
import {
  computerActInputSchema,
  computerActResultSchema,
  computerObservationSchema,
} from "./computer-use.js";

const click = { action: "click", observation_id: "obs-1", ref: "e1" };

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
