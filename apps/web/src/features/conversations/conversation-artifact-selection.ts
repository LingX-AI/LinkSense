import type {
  ConversationFile,
  ConversationMessage,
  ConversationTurn,
} from "@/api/contracts"
import { resolveConversationDeliveryFiles } from "@/features/conversations/conversation-delivery-references"
import { getConversationFilePreviewKind } from "@/features/conversations/conversation-file-preview"

function imageChecksum(file: ConversationFile): string | null {
  if (getConversationFilePreviewKind(file) !== "image") return null
  const checksum = file.checksum_sha256
  return checksum && /^[a-f0-9]{64}$/iu.test(checksum)
    ? checksum.toLowerCase()
    : null
}

/** Select automatic cards without removing files used by explicit links or downloads. */
export function selectConversationArtifactCards({
  files,
  turns,
  finalMessagesByTurn,
  inlineArtifactIds,
  activityImageArtifactIds,
}: Readonly<{
  files: readonly ConversationFile[]
  turns: readonly ConversationTurn[]
  finalMessagesByTurn: ReadonlyMap<string, ConversationMessage>
  inlineArtifactIds: ReadonlySet<string>
  activityImageArtifactIds: ReadonlySet<string>
}>): Map<string, Map<string, ConversationFile>> {
  const filesByTurn = new Map<string, Map<string, ConversationFile>>()
  for (const file of files) {
    if (file.kind !== "artifact" || !file.turn_id) continue
    const turnFiles = filesByTurn.get(file.turn_id) ?? new Map()
    turnFiles.set(file.id.toLowerCase(), file)
    filesByTurn.set(file.turn_id, turnFiles)
  }

  const result = new Map<string, Map<string, ConversationFile>>()
  const previousImageChecksums = new Set<string>()
  for (const turn of turns) {
    const turnFiles = [...(filesByTurn.get(turn.id)?.values() ?? [])]
    const finalMessage = finalMessagesByTurn.get(turn.id)
    const imageChecksums = turnFiles
      .map(imageChecksum)
      .filter((checksum) => checksum !== null)
    const hasDuplicateImages =
      new Set(imageChecksums).size < imageChecksums.length
    const hasActivityImages = turnFiles.some((file) =>
      activityImageArtifactIds.has(file.id.toLowerCase())
    )
    const deliveryIds = new Set(
      // An image viewed during processing becomes a deliverable only when the
      // final reply explicitly references it. A separate registration is kept.
      finalMessage && (hasDuplicateImages || hasActivityImages)
        ? resolveConversationDeliveryFiles(finalMessage.content, turnFiles).map(
            (file) => file.id.toLowerCase()
          )
        : []
    )
    const inlineChecksums = new Set(
      turnFiles
        .filter((file) => inlineArtifactIds.has(file.id.toLowerCase()))
        .map(imageChecksum)
        .filter((checksum) => checksum !== null)
    )
    const selected = new Map<string, ConversationFile>()
    for (const file of turnFiles) {
      const id = file.id.toLowerCase()
      if (
        inlineArtifactIds.has(id) ||
        (activityImageArtifactIds.has(id) && !deliveryIds.has(id))
      )
        continue
      const checksum = imageChecksum(file)
      if (
        checksum &&
        (previousImageChecksums.has(checksum) || inlineChecksums.has(checksum))
      )
        continue
      // Keep distinct files when no reliable content digest is available.
      const key = checksum ?? file.id.toLowerCase()
      const existing = selected.get(key)
      if (
        !existing ||
        (deliveryIds.has(file.id.toLowerCase()) &&
          !deliveryIds.has(existing.id.toLowerCase()))
      )
        selected.set(key, file)
    }
    result.set(
      turn.id,
      new Map([...selected.values()].map((file) => [file.id, file]))
    )
    // A collapsed process preview is not a delivered image. Its digest must
    // not suppress the download for a separately registered output later.
    for (const checksum of inlineChecksums) previousImageChecksums.add(checksum)
    for (const file of selected.values()) {
      const checksum = imageChecksum(file)
      if (checksum) previousImageChecksums.add(checksum)
    }
  }
  return result
}
