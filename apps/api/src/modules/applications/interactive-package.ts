import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
  INTERACTIVE_APPLICATION_ENTRY_MAX_BYTES,
  INTERACTIVE_APPLICATION_ENTRY_MAX_COUNT,
  INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES,
  interactiveApplicationManifestSchema,
  type InteractiveApplicationManifest,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import {
  extractZipSecurely,
  type CapabilityPackageLimits,
} from "../capabilities/importer.js";

const limits: CapabilityPackageLimits = {
  archiveBytes: INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
  entryBytes: INTERACTIVE_APPLICATION_ENTRY_MAX_BYTES,
  totalExpandedBytes: INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES,
  entryCount: INTERACTIVE_APPLICATION_ENTRY_MAX_COUNT,
  compressionRatio: 100,
  redirectCount: 0,
  requestTimeoutMs: 0,
  logoBytes: 512 * 1024,
};

const allowedExtensions = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".png",
  ".svg",
  ".txt",
  ".webp",
  ".woff",
  ".woff2",
]);

export type PreparedInteractiveApplicationAsset = {
  path: string;
  bytes: Buffer;
  contentType: string;
  sha256: string;
};

export type PreparedInteractiveApplicationPackage = {
  manifest: InteractiveApplicationManifest;
  archiveSha256: string;
  expandedBytes: number;
  assets: PreparedInteractiveApplicationAsset[];
  icon: { bytes: Buffer; contentType: string } | null;
};

export async function inspectInteractiveApplicationArchive(
  archive: Buffer,
): Promise<PreparedInteractiveApplicationPackage> {
  const directory = await mkdtemp(join(tmpdir(), "linksense-interactive-app-"));
  try {
    try {
      await extractZipSecurely(archive, directory, limits);
    } catch {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    const paths = await listRegularFiles(directory, directory);
    const lowerCasePaths = paths.map((path) => path.toLocaleLowerCase("en-US"));
    if (new Set(lowerCasePaths).size !== lowerCasePaths.length) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    if (!paths.includes("manifest.json") || !paths.includes("index.html")) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    if (
      paths.some(
        (path) =>
          path === ".DS_Store" ||
          path.split("/").some((segment) => segment.startsWith(".")) ||
          !allowedExtensions.has(extname(path).toLocaleLowerCase("en-US")),
      )
    ) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }

    let manifest: InteractiveApplicationManifest;
    try {
      manifest = interactiveApplicationManifestSchema.parse(
        JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
      );
      validateCustomEventSchemas(manifest);
    } catch {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }

    const assets = await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(join(directory, ...path.split("/")));
        return {
          path,
          bytes,
          contentType: contentTypeFor(path),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    const expandedBytes = assets.reduce(
      (total, asset) => total + asset.bytes.byteLength,
      0,
    );
    if (
      expandedBytes <= 0 ||
      expandedBytes > INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES
    ) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }

    const icon = manifest.icon
      ? preparedIcon(manifest.icon, assets)
      : null;
    return {
      manifest,
      archiveSha256: createHash("sha256").update(archive).digest("hex"),
      expandedBytes,
      assets,
      icon,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validateCustomEventSchemas(manifest: InteractiveApplicationManifest) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const event of manifest.custom_events) {
    const schema = event.payload_schema;
    if (schema.type !== "object") {
      throw new Error("custom event payload schema must describe an object");
    }
    ajv.compile(schema);
  }
}

function preparedIcon(
  path: string,
  assets: PreparedInteractiveApplicationAsset[],
) {
  const normalized = path.replace(/^\.\//u, "");
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new AppError("APPLICATION_PACKAGE_INVALID");
  }
  const asset = assets.find((candidate) => candidate.path === normalized);
  const detected = asset ? detectSafeRasterImage(asset.bytes) : null;
  if (
    !asset ||
    detected === null ||
    !["image/png", "image/jpeg", "image/webp"].includes(detected) ||
    asset.bytes.byteLength > 512 * 1024
  ) {
    throw new AppError("APPLICATION_PACKAGE_INVALID");
  }
  return { bytes: asset.bytes, contentType: detected };
}

async function listRegularFiles(root: string, directory: string) {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listRegularFiles(root, absolutePath)));
      continue;
    }
    if (!entry.isFile()) throw new AppError("APPLICATION_PACKAGE_INVALID");
    const portablePath = relative(root, absolutePath).replaceAll(sep, "/");
    if (!portablePath || portablePath.startsWith("../")) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    output.push(portablePath);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLocaleLowerCase("en-US")) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "text/plain; charset=utf-8";
  }
}
