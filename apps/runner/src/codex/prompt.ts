/**
 * Codex desktop serializes composer mentions as Markdown links. Keep the
 * native escaping (including literal paths) instead of URL-encoding Skill
 * locators or emitting a second structured skill/mention input.
 */
export function serializePromptLink(label: string, path: string): string {
  if (/\p{Cc}/u.test(label) || /\p{Cc}/u.test(path)) {
    throw new Error("prompt references must not contain control characters");
  }
  const escapedLabel = label
    .replaceAll("\\", "\\\\")
    .replaceAll("](", "]\\(")
    .replaceAll("]", "\\]");
  const escapedPath = path.replaceAll("\\", "\\\\").replaceAll(")", "\\)");
  return `[${escapedLabel}](${escapedPath})`;
}
