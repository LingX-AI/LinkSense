import { downloadApiFile } from "@/api/client"
import { downloadBlob } from "@/lib/download-blob"

import type { TaskArtifact } from "./task-artifact-api"

function artifactContentPath(
  file: Pick<TaskArtifact, "id" | "conversation_id">
) {
  return `/conversations/${file.conversation_id}/files/${file.id}/content`
}

/** Loads the bytes a browser preview holds. */
export async function loadTaskArtifactContent(
  file: Pick<TaskArtifact, "id" | "conversation_id">,
  signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const blob = await downloadApiFile(
    artifactContentPath(file),
    undefined,
    signal
  )
  signal?.throwIfAborted()
  return new Uint8Array(await blob.arrayBuffer())
}

/** Saves bytes a preview already holds. */
export async function saveTaskArtifactBlob(
  blob: Blob,
  filename: string
): Promise<void> {
  downloadBlob(blob, filename)
}

/** Saves one authenticated task artifact through the blob pipeline. */
export async function downloadTaskArtifact(
  file: TaskArtifact,
  signal?: AbortSignal
): Promise<void> {
  const blob = await downloadApiFile(
    `/conversations/${file.conversation_id}/files/${file.id}/download`,
    undefined,
    signal
  )
  signal?.throwIfAborted()
  downloadBlob(blob, file.name)
}
