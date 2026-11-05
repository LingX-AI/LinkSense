export const publicKnowledgeOutputLimit = 100_000;

/** Keep streaming and saved answers within the same valid Unicode boundary. */
export function limitPublicKnowledgeOutput(
  value: string,
  remaining = publicKnowledgeOutputLimit,
): string {
  if (
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > publicKnowledgeOutputLimit
  )
    throw new RangeError("invalid public output budget");
  return value.slice(0, remaining).replace(/[\uD800-\uDBFF]$/u, "");
}
