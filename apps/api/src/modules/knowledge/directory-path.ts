import { AppError } from "../../lib/errors.js";

export const KNOWLEDGE_DIRECTORY_MAX_DEPTH = 64;
export const KNOWLEDGE_DIRECTORY_MAX_PATH_LENGTH = 16_384;
const MAX_SEGMENT_CODE_POINTS = 260;

export type KnowledgeDirectoryPath = {
  segments: string[];
  normalizedSegments: string[];
};

export function normalizeKnowledgeDirectoryPath(
  relativePath: string,
  filename: string,
): KnowledgeDirectoryPath {
  if (
    relativePath.length === 0 ||
    relativePath.length > KNOWLEDGE_DIRECTORY_MAX_PATH_LENGTH ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\")
  ) {
    throw new AppError("VALIDATION_ERROR");
  }

  const rawSegments = relativePath.split("/");
  if (
    rawSegments.length === 0 ||
    rawSegments.length > KNOWLEDGE_DIRECTORY_MAX_DEPTH
  ) {
    throw new AppError("VALIDATION_ERROR");
  }

  const segments = rawSegments.map(normalizeKnowledgeDirectorySegment);
  if (segments.join("/").length > KNOWLEDGE_DIRECTORY_MAX_PATH_LENGTH) {
    throw new AppError("VALIDATION_ERROR");
  }
  const normalizedFilename = normalizeKnowledgeDirectorySegment(filename);
  if (segments.at(-1) !== normalizedFilename) {
    throw new AppError("VALIDATION_ERROR");
  }

  return {
    segments,
    normalizedSegments: segments.map(normalizeKnowledgeEntryName),
  };
}

export function normalizeKnowledgeDirectorySegment(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const characters = Array.from(normalized);
  if (
    characters.length === 0 ||
    characters.length > MAX_SEGMENT_CODE_POINTS ||
    normalized === "." ||
    normalized === ".." ||
    characters.some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint < 32 ||
        codePoint === 127 ||
        character === "/" ||
        character === "\\"
      );
    })
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  return normalized;
}

export function normalizeKnowledgeEntryName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und");
}
