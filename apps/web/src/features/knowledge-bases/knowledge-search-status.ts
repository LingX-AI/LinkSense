import type { KnowledgeSearchCapability } from "@/features/knowledge-bases/knowledge-base-contracts"

export function getKnowledgeSearchUnavailableDescriptionKey(
  capability: KnowledgeSearchCapability
) {
  if (capability.status === "not_installed") {
    return "knowledge.searchCapability.notInstalledDescription" as const
  }
  return capability.reason_code === "EMBEDDING_DIMENSION_MISMATCH"
    ? ("knowledge.searchCapability.dimensionMismatch" as const)
    : ("knowledge.searchCapability.unavailableDescription" as const)
}
