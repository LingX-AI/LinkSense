import { MAX_CONVERSATION_TITLE_CHARACTERS } from "../../lib/conversation-title.js";

export function forkedConversationTitle(
  baseTitle: string,
  sequence: number,
): string {
  const suffix = `(${sequence})`;
  const suffixLength = Array.from(suffix).length;
  const availableBaseLength =
    MAX_CONVERSATION_TITLE_CHARACTERS - suffixLength;
  const baseCharacters = Array.from(baseTitle);
  if (baseCharacters.length <= availableBaseLength) {
    return `${baseTitle}${suffix}`;
  }
  const truncatedBase = `${baseCharacters
    .slice(0, Math.max(0, availableBaseLength - 1))
    .join("")}…`;
  return `${truncatedBase}${suffix}`;
}

export function forkBaseTitle(title: string, sequence: number | null): string {
  if (sequence === null) return title;
  const suffix = `(${sequence})`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

export function remapForkedJson(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((entry) => remapForkedJson(entry, replacements));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      remapForkedJson(entry, replacements),
    ]),
  );
}

export function isValidForkedThreadHistory(
  nativeTurnIds: readonly string[],
  persistedTurnIds: readonly string[],
): boolean {
  const targetTurnId = persistedTurnIds.at(-1);
  if (!targetTurnId || nativeTurnIds.at(-1) !== targetTurnId) return false;

  let persistedIndex = 0;
  for (const nativeTurnId of nativeTurnIds) {
    if (nativeTurnId === persistedTurnIds[persistedIndex]) {
      persistedIndex += 1;
    }
  }
  return persistedIndex === persistedTurnIds.length;
}
