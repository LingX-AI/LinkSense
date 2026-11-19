/**
 * Codex turn metadata shared by the runner model gateway and the desktop
 * model proxy. Keep the accepted compaction shapes in one place so the two
 * authorization paths cannot drift.
 */

export const codexTurnMetadataKey = "x-codex-turn-metadata";
export const modelTransitionNonceMetadataKey = "linksense_transition_nonce";

export type ModelTransitionCompactionAuthorization =
  | { kind: "manual" }
  | { kind: "auto"; nonce: string };

export function codexTurnMetadataFromClientMetadata(
  value: unknown,
): string | null {
  if (!isRecord(value)) return null;
  const metadata = value[codexTurnMetadataKey];
  return typeof metadata === "string" && metadata !== "" ? metadata : null;
}

export function modelTransitionCompactionFromTurnMetadata(
  clientMetadata: unknown,
  requestMetadata: string | null | undefined,
  options: { requireBodyMetadata?: boolean } = {},
): ModelTransitionCompactionAuthorization | null {
  const bodyMetadata = codexTurnMetadataFromClientMetadata(clientMetadata);
  const headerMetadata = requestMetadata ?? null;
  if (
    bodyMetadata !== null &&
    headerMetadata !== null &&
    bodyMetadata !== headerMetadata
  ) {
    return null;
  }
  if (options.requireBodyMetadata === true && bodyMetadata === null) {
    return null;
  }
  return modelTransitionCompactionFromMetadata(
    bodyMetadata ?? headerMetadata,
  );
}

export function modelTransitionCompactionFromMetadata(
  value: string | null | undefined,
): ModelTransitionCompactionAuthorization | null {
  if (!value) return null;
  try {
    const metadata: unknown = JSON.parse(value);
    if (
      !isRecord(metadata) ||
      metadata.request_kind !== "compaction" ||
      !isRecord(metadata.compaction)
    ) {
      return null;
    }
    const compaction = metadata.compaction;
    if (
      compaction.implementation !== "responses" ||
      compaction.strategy !== "memento"
    ) {
      return null;
    }
    if (
      compaction.trigger === "manual" &&
      compaction.reason === "user_requested" &&
      compaction.phase === "standalone_turn"
    ) {
      return { kind: "manual" };
    }
    if (
      compaction.trigger === "auto" &&
      (compaction.reason === "comp_hash_changed" ||
        compaction.reason === "model_downshift") &&
      compaction.phase === "pre_turn"
    ) {
      const nonce = metadata[modelTransitionNonceMetadataKey];
      return typeof nonce === "string" && nonce !== ""
        ? { kind: "auto", nonce }
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
