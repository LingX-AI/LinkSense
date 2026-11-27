import { describe, expect, it } from "vitest";

import {
  codexTurnMetadataFromClientMetadata,
  modelTransitionCompactionFromMetadata,
  modelTransitionCompactionFromTurnMetadata,
} from "../src/index.js";

const manualMetadata = JSON.stringify({
  request_kind: "compaction",
  compaction: {
    implementation: "responses",
    strategy: "memento",
    trigger: "manual",
    reason: "user_requested",
    phase: "standalone_turn",
  },
});

function autoMetadata(nonce?: string): string {
  return JSON.stringify({
    request_kind: "compaction",
    compaction: {
      implementation: "responses",
      strategy: "memento",
      trigger: "auto",
      reason: "model_downshift",
      phase: "pre_turn",
    },
    ...(nonce === undefined ? {} : { linksense_transition_nonce: nonce }),
  });
}

describe("model gateway compaction metadata", () => {
  it("accepts the native manual compaction shape", () => {
    expect(modelTransitionCompactionFromMetadata(manualMetadata)).toEqual({
      kind: "manual",
    });
  });

  it("requires a nonce for automatic transition compaction", () => {
    expect(modelTransitionCompactionFromMetadata(autoMetadata("nonce-1"))).toEqual({
      kind: "auto",
      nonce: "nonce-1",
    });
    expect(modelTransitionCompactionFromMetadata(autoMetadata())).toBeNull();
  });

  it("rejects unknown compaction implementations, strategies, reasons and phases", () => {
    for (const metadata of [
      { request_kind: "compaction", compaction: { implementation: "chat", strategy: "memento", trigger: "manual", reason: "user_requested", phase: "standalone_turn" } },
      { request_kind: "compaction", compaction: { implementation: "responses", strategy: "other", trigger: "manual", reason: "user_requested", phase: "standalone_turn" } },
      { request_kind: "compaction", compaction: { implementation: "responses", strategy: "memento", trigger: "manual", reason: "other", phase: "standalone_turn" } },
      { request_kind: "compaction", compaction: { implementation: "responses", strategy: "memento", trigger: "auto", reason: "model_downshift", phase: "post_turn" } },
      { request_kind: "other" },
      {},
    ]) {
      expect(
        modelTransitionCompactionFromMetadata(JSON.stringify(metadata)),
      ).toBeNull();
    }
    expect(modelTransitionCompactionFromMetadata("not json")).toBeNull();
    expect(modelTransitionCompactionFromMetadata(null)).toBeNull();
  });

  it("reads body metadata and rejects a conflicting header", () => {
    expect(
      modelTransitionCompactionFromTurnMetadata(
        { "x-codex-turn-metadata": manualMetadata },
        null,
      ),
    ).toEqual({ kind: "manual" });
    expect(
      modelTransitionCompactionFromTurnMetadata(
        { "x-codex-turn-metadata": manualMetadata },
        autoMetadata("nonce-1"),
      ),
    ).toBeNull();
  });

  it("can require body metadata while allowing a header-only request", () => {
    expect(
      modelTransitionCompactionFromTurnMetadata(undefined, manualMetadata),
    ).toEqual({ kind: "manual" });
    expect(
      modelTransitionCompactionFromTurnMetadata(undefined, manualMetadata, {
        requireBodyMetadata: true,
      }),
    ).toBeNull();
  });

  it("extracts only string client metadata values", () => {
    expect(
      codexTurnMetadataFromClientMetadata({
        "x-codex-turn-metadata": manualMetadata,
      }),
    ).toBe(manualMetadata);
    expect(codexTurnMetadataFromClientMetadata({})).toBeNull();
    expect(codexTurnMetadataFromClientMetadata(null)).toBeNull();
    expect(
      codexTurnMetadataFromClientMetadata({
        "x-codex-turn-metadata": 1,
      }),
    ).toBeNull();
  });
});
