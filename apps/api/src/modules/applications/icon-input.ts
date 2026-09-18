import { lstat, realpath } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import {
  APPLICATION_ICON_MAX_BYTES, APPLICATION_ICON_MAX_DIMENSION,
  applicationIconInputSchema, type ApplicationIconInput,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import { readStableRegularFile } from "../../lib/stable-regular-file.js";

export function decodeApplicationIcon(input: Extract<ApplicationIconInput, { type: "upload" }>): {
  bytes: Buffer; contentType: "image/png" | "image/jpeg" | "image/webp"; extension: string;
} {
  const parsed = applicationIconInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.type !== "upload") throw invalidIcon();
  const bytes = Buffer.from(parsed.data.data_base64, "base64");
  const contentType = detectSafeRasterImage(bytes, APPLICATION_ICON_MAX_DIMENSION);
  if (!bytes.length || bytes.length > APPLICATION_ICON_MAX_BYTES || !contentType || contentType === "image/gif" || contentType !== parsed.data.mime_type) throw invalidIcon();
  return { bytes, contentType, extension: contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp" };
}

/** Read only an explicit, regular image inside this development task's workspace. */
export async function readWorkspaceApplicationIcon(workspaceRoot: string, path: string): Promise<ApplicationIconInput> {
  if (path.includes("\\") || path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) throw invalidIcon();
  try {
    const workspace = await realpath(workspaceRoot);
    const absolute = resolve(workspace, path);
    if (!absolute.startsWith(`${workspace}${sep}`) || await realpath(absolute) !== absolute) throw invalidIcon();
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw invalidIcon();
    const bytes = await readStableRegularFile(absolute, info, { maximumBytes: APPLICATION_ICON_MAX_BYTES, invalidFileError: invalidIcon, fileTooLargeError: invalidIcon });
    if (await realpath(absolute) !== absolute) throw invalidIcon();
    const contentType = detectSafeRasterImage(bytes, APPLICATION_ICON_MAX_DIMENSION);
    if (!contentType || contentType === "image/gif") throw invalidIcon();
    const input = { type: "upload" as const, filename: basename(path), mime_type: contentType, data_base64: bytes.toString("base64") };
    decodeApplicationIcon(input);
    return input;
  } catch { throw invalidIcon(); }
}

function invalidIcon(): AppError { return new AppError("APPLICATION_ICON_UPLOAD_INVALID"); }
