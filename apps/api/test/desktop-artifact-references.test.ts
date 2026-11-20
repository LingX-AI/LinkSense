import { randomUUID } from "node:crypto";

import { conversationEventSchema, desktopArtifactPathDigestInput } from "@linksense/shared";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/lib/crypto.js";
import { resolveDesktopArtifactFileChanges } from "../src/modules/files/desktop-artifact-references.js";

const ownerId = randomUUID();
const conversationId = randomUUID();
const turnId = randomUUID();
const fileId = randomUUID();
const itemId = "created-report";
const path = "$WORKSPACE/report.txt";
const sseEventId = `${conversationId}:2`;
const file = {
  id: fileId, conversationId, turnId, createdBy: ownerId,
  kind: "artifact", status: "registered", source: "agent_generated",
  storageBackend: "minio", downloadable: true, minioObjectKey: "fixture/report",
  desktopSourcePathDigest: sha256(desktopArtifactPathDigestInput(turnId, itemId, path)),
};

function fileChange(id = itemId, paths = [path], kind = "add", status = "completed") {
  return conversationEventSchema.parse({
    id: randomUUID(), conversation_id: conversationId, turn_id: turnId,
    sse_event_id: sseEventId, sequence_no: 2, created_at: "2026-11-20T00:00:00Z", visibility: "user_visible",
    event_type: "item/completed",
    payload: {
      schema_version: 2, source: "codex_app_server", method: "item/completed",
      params: {
        threadId: "native-thread", turnId: "native-turn",
        item: { id, type: "fileChange", status, changes: paths.map(path => ({ kind: { type: kind }, path })) },
      },
    },
  });
}

describe("desktop artifact file-change projection", () => {
  it("links one confirmed file to the exact native completion without mutating the event", () => {
    const event = fileChange(itemId, ["notes.txt", path]);
    const before = structuredClone(event);
    const links = resolveDesktopArtifactFileChanges(ownerId, conversationId, [event], [file]);
    expect([...links]).toEqual([[fileId, { event_id: sseEventId, change_index: 1 }]]);
    expect(event).toEqual(before);
  });

  it("leaves legacy, foreign, unavailable, and ambiguous files unlinked", () => {
    for (const files of [
      [{ ...file, desktopSourcePathDigest: null }],
      [{ ...file, conversationId: randomUUID() }],
      [{ ...file, turnId: randomUUID() }],
      [{ ...file, createdBy: randomUUID() }],
      [{ ...file, downloadable: false }],
      [{ ...file, status: "staged" }],
      [file, { ...file, id: randomUUID() }],
    ]) {
      expect(resolveDesktopArtifactFileChanges(ownerId, conversationId, [fileChange()], files).size).toBe(0);
    }
  });

  it("does not turn an unverified file change into a link", () => {
    for (const event of [
      fileChange(itemId, [`linksense-artifact:${fileId}`]),
      fileChange("other-native-item"),
      fileChange(itemId, [path, path]),
      fileChange(itemId, [path], "update"),
      fileChange(itemId, [path], "add", "declined"),
    ]) {
      expect(resolveDesktopArtifactFileChanges(ownerId, conversationId, [event], [file]).size).toBe(0);
    }
  });
});
