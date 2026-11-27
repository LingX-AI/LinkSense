import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

export async function createHistoricalSiteTask(
  db: PrismaClient, ownerId: string, title: string, codexThreadId?: string,
): Promise<{ id: string; title: string; workspaceRelPath: string }> {
  const task = { id: randomUUID(), title, workspaceRelPath: `${ownerId}/home/workspace` };
  await db.$executeRaw`INSERT INTO conversations
    (id, owner_id, title, title_source, archive_status, workspace_rel_path, codex_thread_id, runtime_generation, updated_at)
    VALUES (${task.id}::uuid, ${ownerId}::uuid, ${title}, 'manual', 'active', ${task.workspaceRelPath},
      ${codexThreadId ?? null}, ${randomUUID()}::uuid, CURRENT_TIMESTAMP)`;
  return task;
}

export async function createHistoricalSiteFile(
  db: PrismaClient, taskId: string, filename: string, size: number,
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO conversation_files
    (id, conversation_id, kind, source, status, filename, mime_type, size_bytes, storage_backend,
      minio_object_key, downloadable, download_card_event_id, updated_at)
    VALUES (${id}::uuid, ${taskId}::uuid, 'artifact', 'agent_generated', 'registered', ${filename}, 'text/html',
      ${BigInt(size)}, 'minio', 'legacy/index.html', true, ${randomUUID()}::uuid, CURRENT_TIMESTAMP)`;
  return { id };
}
