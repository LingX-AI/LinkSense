export function inlineContentDisposition(filename: string): string {
  return contentDisposition("inline", filename);
}

export function attachmentContentDisposition(filename: string): string {
  return contentDisposition("attachment", filename);
}

export function contentDisposition(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  const normalized = filename.normalize("NFC");
  const fallback =
    Array.from(normalized)
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 &&
          codePoint <= 126 &&
          character !== '"' &&
          character !== "\\"
          ? character
          : "_";
      })
      .join("")
      .slice(0, 260) || "file";
  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
