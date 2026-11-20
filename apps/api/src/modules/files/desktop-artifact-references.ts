import {
  desktopArtifactPathDigestInput,
  type ConversationEvent,
  type DesktopArtifactFileChange,
} from "@linksense/shared";

import { sha256 } from "../../lib/crypto.js";
import type { ConversationFile } from "../../generated/prisma/client.js";

type ArtifactRow = Pick<ConversationFile,
  "id" | "conversationId" | "turnId" | "kind" | "status" | "source" |
  "storageBackend" | "downloadable" | "minioObjectKey" | "createdBy" | "desktopSourcePathDigest"
>;

/** Resolve links for the current detail page without changing durable events or SSE. */
export function resolveDesktopArtifactFileChanges(
  ownerId: string,
  conversationId: string,
  events: readonly ConversationEvent[],
  files: readonly ArtifactRow[],
): Map<string, DesktopArtifactFileChange> {
  const candidates = new Map<string, string | null>();
  for (const file of files) {
    if (file.createdBy !== ownerId || file.conversationId !== conversationId ||
        !file.turnId || !file.desktopSourcePathDigest || file.kind !== "artifact" ||
        file.status !== "registered" || file.source !== "agent_generated" ||
        file.storageBackend !== "minio" || !file.downloadable || !file.minioObjectKey) continue;
    const key = `${file.turnId}:${file.desktopSourcePathDigest}`;
    candidates.set(key, candidates.has(key) ? null : file.id);
  }
  if (candidates.size === 0) return new Map();
  const links = new Map<string, DesktopArtifactFileChange | null>();

  for (const event of events) {
    if (event.conversation_id !== conversationId ||
        event.event_type !== "item/completed" || !event.turn_id) continue;
    const item = event.payload.params.item;
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const [changeIndex, change] of item.changes.entries()) {
      if (change.kind.type !== "add" || !change.path) continue;
      const digest = sha256(desktopArtifactPathDigestInput(event.turn_id, item.id, change.path));
      const fileId = candidates.get(`${event.turn_id}:${digest}`);
      if (fileId) {
        links.set(fileId, links.has(fileId) ? null : {
          event_id: event.sse_event_id,
          change_index: changeIndex,
        });
      }
    }
  }
  return new Map([...links].filter((entry): entry is [string, DesktopArtifactFileChange] => entry[1] !== null));
}
