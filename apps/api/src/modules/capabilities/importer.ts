import { createHash, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { Open } from "unzipper";

import { AppError } from "../../lib/errors.js";
import {
  assertPublicHttpUrl,
  fetchPublicHttpResource,
  isPublicAddress,
} from "../../lib/safe-http-fetch.js";
import { detectSafeRasterImage } from "../../lib/safe-raster-image.js";
import type {
  CapabilityImportSource,
  CapabilityRiskSummary,
  CapabilityType,
  PreparedCapabilityPackage,
  PreparedLogo,
  RemoteCapabilityFile,
} from "./types.js";
import { capabilityPackageNameSchema } from "./package-name.js";
import {
  SkillManifestValidationError,
  parseSkillManifest,
} from "./skill-manifest.js";
import {
  NativePluginMcpValidationError,
  inspectNativePluginMcpConfigFile,
  inspectNativePluginMcpServers,
} from "./native-plugin-mcp.js";
import { scanCapabilitySupplyChain } from "./supply-chain-scanner.js";

export { assertPublicHttpUrl, isPublicAddress };
export { detectSafeRasterImage };

export const DEFAULT_CAPABILITY_PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 50 * 1024 * 1024,
  entryBytes: 50 * 1024 * 1024,
  totalExpandedBytes: 200 * 1024 * 1024,
  entryCount: 1_000,
  compressionRatio: 100,
  redirectCount: 5,
  requestTimeoutMs: 10_000,
  logoBytes: 2 * 1024 * 1024,
});

const CLAWHUB_FILE_BYTES_LIMIT = 10 * 1024 * 1024;

export interface CapabilityPackageLimits {
  archiveBytes: number;
  entryBytes: number;
  totalExpandedBytes: number;
  entryCount: number;
  compressionRatio: number;
  redirectCount: number;
  requestTimeoutMs: number;
  logoBytes: number;
}

export interface CapabilityImporterOptions {
  stagingRoot: string;
  fetcher?: typeof fetch;
  lookup?: typeof dns.lookup;
  limits?: Partial<CapabilityPackageLimits>;
}

export interface AtomicDirectoryReplacement {
  currentDirectory: string;
  retiredDirectory: string | null;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface DownloadedResource {
  bytes: Buffer;
  contentType: string;
  finalUrl: URL;
}

const DEPENDENCY_COMMAND_PATTERN =
  /(?:^|[\s;&|])(?:npm|npx|pnpm|yarn|bun|pip|pip3|uv|poetry|gem|cargo)\s+(?:add|install|i|sync|run|dlx|x)\b[^\r\n]*/giu;
const PYTHON_SCRIPT_COMMAND_PATTERN =
  /(?:^|[\s;&|`])(?:python(?:3(?:\.\d+)?)?|uv\s+run\s+python)\s+(?:-[a-zA-Z]+\s+)*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s"'`;&|]+\.py))/gimu;
const URL_PATTERN = /https?:\/\//iu;
const SCRIPT_EXTENSION_PATTERN =
  /\.(?:sh|bash|zsh|py|js|cjs|mjs|ts|ps1|bat|cmd)$/iu;
const INVALID_PACKAGE_REASON_CODES = {
  archiveSizeInvalid: "archive_size_invalid",
  archiveUnreadable: "archive_unreadable",
  archiveEntryCountInvalid: "archive_entry_count_invalid",
  archivePathInvalid: "archive_path_invalid",
  archiveEntrySymlink: "archive_entry_symlink",
  archiveEntryTooLarge: "archive_entry_too_large",
  archiveCompressionRatioExceeded: "archive_compression_ratio_exceeded",
  archiveExpandedSizeExceeded: "archive_expanded_size_exceeded",
  archiveEntryReadFailed: "archive_entry_read_failed",
  packageManifestCountInvalid: "package_manifest_count_invalid",
  packageMultipleRoots: "package_multiple_roots",
  packageJsonInvalid: "package_json_invalid",
  skillFrontmatterMissing: "skill_frontmatter_missing",
  skillNameInvalid: "skill_name_invalid",
  pluginUnsupportedComponent: "plugin_unsupported_component",
  pluginSkillsInvalid: "plugin_skills_invalid",
  pluginDeclaredPathInvalid: "plugin_declared_path_invalid",
  pluginMcpConfigurationInvalid: "plugin_mcp_configuration_invalid",
  skillReferencedScriptMissing: "skill_referenced_script_missing",
  logoFileInvalid: "logo_file_invalid",
  requestedTypeMismatch: "requested_type_mismatch",
} as const;

type InvalidPackageReasonName = keyof typeof INVALID_PACKAGE_REASON_CODES;
type InvalidPackageParams = Record<string, string | number | boolean>;

function invalidPackage(
  reasonName: InvalidPackageReasonName,
  params: InvalidPackageParams = {},
): AppError {
  return new AppError("INVALID_PACKAGE", {
    reason_code: INVALID_PACKAGE_REASON_CODES[reasonName],
    ...params,
  });
}

export class CapabilityPackageImporter {
  readonly #stagingRoot: string;
  readonly #fetcher: typeof fetch | undefined;
  readonly #lookup: typeof dns.lookup;
  readonly #limits: CapabilityPackageLimits;

  constructor(options: CapabilityImporterOptions) {
    this.#stagingRoot = resolve(options.stagingRoot);
    this.#fetcher = options.fetcher;
    this.#lookup = options.lookup ?? dns.lookup;
    this.#limits = { ...DEFAULT_CAPABILITY_PACKAGE_LIMITS, ...options.limits };
  }

  async prepare(
    source: CapabilityImportSource,
  ): Promise<PreparedCapabilityPackage> {
    await mkdir(this.#stagingRoot, { recursive: true, mode: 0o700 });
    const stagingDirectory = await this.#createStagingDirectory();

    try {
      if (source.kind === "manual_skill") {
        await this.#writeManualSkill(stagingDirectory, source);
      } else {
        await extractZipSecurely(source.bytes, stagingDirectory, this.#limits);
      }

      const prepared = await inspectCapabilityPackage(
        stagingDirectory,
        stagingDirectory,
        this.#limits,
      );
      if (prepared.type === "plugin" && prepared.logo === null) {
        const externalLogo = await this.#downloadDeclaredExternalLogo(
          prepared.packageRoot,
        );
        if (externalLogo !== null) return { ...prepared, logo: externalLogo };
      }
      return prepared;
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      throw new AppError("IMPORT_FAILED");
    }
  }

  async prepareRemoteFiles(
    files: readonly RemoteCapabilityFile[],
  ): Promise<PreparedCapabilityPackage> {
    await mkdir(this.#stagingRoot, { recursive: true, mode: 0o700 });
    const stagingDirectory = await this.#createStagingDirectory();

    try {
      if (files.length === 0 || files.length > this.#limits.entryCount) {
        throw invalidPackage("archiveEntryCountInvalid", {
          entry_count: files.length,
          limit_count: this.#limits.entryCount,
        });
      }

      const normalizedPaths = new Set<string>();
      let totalBytes = 0;
      for (const file of files) {
        if (file.path.endsWith("/")) {
          throw invalidPackage("archivePathInvalid", { path: file.path });
        }
        const safeRelativePath = validateArchivePath(file.path);
        const portablePath = safeRelativePath.replaceAll(sep, "/");
        if (normalizedPaths.has(portablePath)) {
          throw invalidPackage("archivePathInvalid", { path: file.path });
        }
        normalizedPaths.add(portablePath);

        if (
          !Number.isSafeInteger(file.size) ||
          file.size < 0 ||
          file.size !== file.bytes.byteLength ||
          file.bytes.byteLength > CLAWHUB_FILE_BYTES_LIMIT
        ) {
          throw invalidPackage("archiveEntryTooLarge", {
            path: file.path,
            size_bytes: file.bytes.byteLength,
            limit_bytes: CLAWHUB_FILE_BYTES_LIMIT,
          });
        }
        if (
          !/^[0-9a-f]{64}$/u.test(file.sha256) ||
          createHash("sha256").update(file.bytes).digest("hex") !== file.sha256
        ) {
          throw new AppError("CLAWHUB_PACKAGE_INTEGRITY_FAILED");
        }

        totalBytes += file.bytes.byteLength;
        if (totalBytes > this.#limits.totalExpandedBytes) {
          throw invalidPackage("archiveExpandedSizeExceeded", {
            size_bytes: totalBytes,
            limit_bytes: this.#limits.totalExpandedBytes,
          });
        }

        const target = resolve(stagingDirectory, safeRelativePath);
        assertPathWithin(stagingDirectory, target);
        await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
        await writeFile(target, file.bytes, { mode: 0o600, flag: "wx" });
      }

      return await inspectCapabilityPackage(
        stagingDirectory,
        stagingDirectory,
        this.#limits,
      );
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      throw new AppError("IMPORT_FAILED");
    }
  }

  async cleanup(prepared: Pick<PreparedCapabilityPackage, "stagingDirectory">) {
    await rm(prepared.stagingDirectory, { recursive: true, force: true });
  }

  async #createStagingDirectory(): Promise<string> {
    const directory = join(this.#stagingRoot, "import-" + randomUUID());
    await mkdir(directory, { recursive: false, mode: 0o700 });
    return directory;
  }

  async #writeManualSkill(
    stagingDirectory: string,
    source: Extract<CapabilityImportSource, { kind: "manual_skill" }>,
  ): Promise<void> {
    const name = validateSkillName(source.name);
    if (
      source.skillMarkdown.length === 0 ||
      source.skillMarkdown.length > 1_000_000
    ) {
      throw invalidPackage("skillFrontmatterMissing");
    }
    const markdown = source.skillMarkdown.startsWith("---\n")
      ? source.skillMarkdown
      : [
          "---",
          "name: " + JSON.stringify(name),
          ...(source.description
            ? ["description: " + JSON.stringify(source.description)]
            : []),
          "---",
          "",
          source.skillMarkdown,
        ].join("\n");
    const skillDirectory = join(stagingDirectory, name);
    await mkdir(skillDirectory, { recursive: false, mode: 0o700 });
    await writeFile(join(skillDirectory, "SKILL.md"), markdown, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }

  async #downloadDeclaredExternalLogo(
    packageRoot: string,
  ): Promise<PreparedLogo | null> {
    const manifest = await readJsonObject(
      join(packageRoot, ".codex-plugin", "plugin.json"),
    );
    const interfaceValue =
      typeof manifest.interface === "object" &&
      manifest.interface !== null &&
      !Array.isArray(manifest.interface)
        ? (manifest.interface as Record<string, unknown>)
        : null;
    const logoUrl = interfaceValue?.logo ?? manifest.logo;
    if (typeof logoUrl !== "string" || !/^https?:\/\//iu.test(logoUrl)) {
      return null;
    }
    let downloaded: DownloadedResource;
    try {
      downloaded = await this.#downloadRemoteResource(
        logoUrl,
        this.#limits.logoBytes,
        "image/png, image/jpeg, image/gif, image/webp",
      );
    } catch {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const detectedType = detectSafeRasterImage(downloaded.bytes);
    const responseType = downloaded.contentType
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      detectedType === null ||
      responseType !== detectedType ||
      !extensionMatchesImageType(downloaded.finalUrl.pathname, detectedType)
    ) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    let filename = downloaded.finalUrl.pathname.split("/").at(-1) ?? "logo";
    try {
      filename = decodeURIComponent(filename);
    } catch {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    return {
      bytes: downloaded.bytes,
      filename,
      contentType: detectedType,
    };
  }

  async #downloadRemoteResource(
    sourceUrl: string,
    byteLimit: number,
    accept: string,
  ): Promise<DownloadedResource> {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new AppError("IMPORT_FAILED");
    }
    return fetchPublicHttpResource(url, {
      byteLimit,
      redirectCount: this.#limits.redirectCount,
      requestTimeoutMs: this.#limits.requestTimeoutMs,
      accept,
      userAgent: "LinkSense-Capability-Importer/1.0",
      errorCode: "IMPORT_FAILED",
      lookup: this.#lookup,
      ...(this.#fetcher === undefined ? {} : { fetcher: this.#fetcher }),
    });
  }
}

export async function extractZipSecurely(
  archive: Buffer,
  destination: string,
  limits: CapabilityPackageLimits = DEFAULT_CAPABILITY_PACKAGE_LIMITS,
): Promise<void> {
  if (archive.byteLength === 0 || archive.byteLength > limits.archiveBytes) {
    throw invalidPackage("archiveSizeInvalid", {
      size_bytes: archive.byteLength,
      limit_bytes: limits.archiveBytes,
    });
  }
  let opened: Awaited<ReturnType<typeof Open.buffer>>;
  try {
    opened = await Open.buffer(archive);
  } catch {
    throw invalidPackage("archiveUnreadable");
  }
  if (opened.files.length === 0 || opened.files.length > limits.entryCount) {
    throw invalidPackage("archiveEntryCountInvalid", {
      entry_count: opened.files.length,
      limit_count: limits.entryCount,
    });
  }

  let expandedBytes = 0;
  const root = resolve(destination);
  const normalizedPaths = new Set<string>();
  for (const entry of opened.files) {
    const safeRelativePath = validateArchivePath(entry.path, {
      allowBackslash: true,
    });
    const portablePath = safeRelativePath.replaceAll(sep, "/");
    if (normalizedPaths.has(portablePath)) {
      throw invalidPackage("archivePathInvalid", { path: entry.path });
    }
    normalizedPaths.add(portablePath);
    if (
      (entry.flags & 0x1) !== 0 ||
      isZipSymlink(entry.externalFileAttributes)
    ) {
      throw invalidPackage("archiveEntrySymlink", { path: entry.path });
    }
    if (entry.uncompressedSize > limits.entryBytes) {
      throw invalidPackage("archiveEntryTooLarge", {
        path: entry.path,
        size_bytes: entry.uncompressedSize,
        limit_bytes: limits.entryBytes,
      });
    }
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > limits.compressionRatio)
    ) {
      throw invalidPackage("archiveCompressionRatioExceeded", {
        path: entry.path,
      });
    }
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > limits.totalExpandedBytes) {
      throw invalidPackage("archiveExpandedSizeExceeded", {
        size_bytes: expandedBytes,
        limit_bytes: limits.totalExpandedBytes,
      });
    }

    const target = resolve(root, safeRelativePath);
    assertPathWithin(root, target);
    if (
      entry.type === "Directory" ||
      isArchiveDirectoryPath(entry.path, { allowBackslash: true })
    ) {
      if (entry.uncompressedSize !== 0) {
        throw invalidPackage("archivePathInvalid", { path: entry.path });
      }
      await mkdir(target, { recursive: true, mode: 0o700 });
      continue;
    }

    const bytes = await entry.buffer();
    if (bytes.byteLength !== entry.uncompressedSize) {
      throw invalidPackage("archiveEntryReadFailed", { path: entry.path });
    }
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
  }
}

export async function inspectCapabilityPackage(
  stagingDirectory: string,
  searchRoot: string,
  limits: CapabilityPackageLimits = DEFAULT_CAPABILITY_PACKAGE_LIMITS,
): Promise<PreparedCapabilityPackage> {
  const files = await listRegularFiles(
    searchRoot,
    searchRoot,
    limits.entryCount,
  );
  const pluginManifests = files.filter((file) =>
    file.replaceAll(sep, "/").endsWith("/.codex-plugin/plugin.json"),
  );
  const skillManifests = files.filter(
    (file) => file.replaceAll(sep, "/").split("/").at(-1) === "SKILL.md",
  );
  if (
    pluginManifests.length > 1 ||
    (pluginManifests.length === 0 && skillManifests.length !== 1)
  ) {
    throw invalidPackage("packageManifestCountInvalid", {
      plugin_manifests: pluginManifests.length,
      skill_manifests: skillManifests.length,
    });
  }

  if (pluginManifests.length === 1) {
    const manifestPath = pluginManifests[0];
    if (!manifestPath) throw invalidPackage("packageManifestCountInvalid");
    const packageRoot = resolve(manifestPath, "../..");
    assertPackageContainsOnlyRoot(files, searchRoot, packageRoot);
    const manifest = await readJsonObject(manifestPath);
    const name = validatePluginName(valueAsString(manifest.name));
    const inspection = await validatePluginManifest(
      packageRoot,
      manifest,
      name,
      files,
    );
    const description = nullableDescription(manifest.description);
    const summary = normalizePluginManifest(
      manifest,
      name,
      description,
      inspection.skillNames,
    );
    return {
      stagingDirectory,
      packageRoot,
      type: "plugin",
      name,
      description,
      manifest: summary,
      riskSummary: await scanRiskSummary(
        packageRoot,
        inspection.mcpEnvironmentReferences,
      ),
      logo: await findPackageLogo(packageRoot, manifest, limits.logoBytes),
    };
  }

  const skillPath = skillManifests[0];
  if (!skillPath) throw invalidPackage("packageManifestCountInvalid");
  const packageRoot = resolve(skillPath, "..");
  assertPackageContainsOnlyRoot(files, searchRoot, packageRoot);
  const markdown = await readFile(skillPath, "utf8");
  const metadata = parseSkillMetadata(markdown);
  const name = validateSkillName(metadata.name ?? "");
  await assertSkillReferencedScriptsExist(packageRoot, name, markdown);
  const description = nullableDescription(metadata.description);
  return {
    stagingDirectory,
    packageRoot,
    type: "skill",
    name,
    description,
    manifest: {
      name,
      ...(description === null ? {} : { description }),
      format: "SKILL.md",
    },
    riskSummary: await scanRiskSummary(packageRoot),
    logo: null,
  };
}

export async function stageAtomicDirectoryReplacement(
  packageRoot: string,
  capabilityDirectory: string,
): Promise<AtomicDirectoryReplacement> {
  const parent = resolve(capabilityDirectory);
  const currentDirectory = join(parent, "current");
  const nextDirectory = join(parent, ".next-" + randomUUID());
  const previousDirectory = join(parent, ".previous-" + randomUUID());
  await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    await copyDirectory(packageRoot, nextDirectory);
  } catch (error) {
    await rm(nextDirectory, { recursive: true, force: true });
    throw error;
  }

  let hadPrevious = false;
  try {
    const currentStat = await lstat(currentDirectory).catch(() => null);
    if (currentStat !== null) {
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
        throw new AppError("IMPORT_FAILED");
      }
      await rename(currentDirectory, previousDirectory);
      hadPrevious = true;
    }
    await rename(nextDirectory, currentDirectory);
  } catch (error) {
    await rm(nextDirectory, { recursive: true, force: true });
    if (hadPrevious) await rename(previousDirectory, currentDirectory);
    throw error;
  }

  let settled = false;
  return {
    currentDirectory,
    retiredDirectory: hadPrevious ? previousDirectory : null,
    async commit() {
      if (settled) return;
      settled = true;
    },
    async rollback() {
      if (settled) return;
      settled = true;
      await rm(currentDirectory, { recursive: true, force: true });
      if (hadPrevious) await rename(previousDirectory, currentDirectory);
      await rm(nextDirectory, { recursive: true, force: true });
    },
  };
}

function validateArchivePath(
  input: string,
  options: { allowBackslash?: boolean } = {},
): string {
  const normalizedInput = normalizeArchivePathSeparators(input, options);
  const withoutTrailingSlash = normalizedInput.endsWith("/")
    ? normalizedInput.slice(0, -1)
    : normalizedInput;
  if (
    withoutTrailingSlash.length === 0 ||
    withoutTrailingSlash.includes("\0") ||
    withoutTrailingSlash.startsWith("/") ||
    /^[A-Za-z]:/u.test(withoutTrailingSlash)
  ) {
    throw invalidPackage("archivePathInvalid", { path: input });
  }
  const segments = withoutTrailingSlash.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw invalidPackage("archivePathInvalid", { path: input });
  }
  return segments.filter((segment) => segment !== ".").join(sep);
}

function normalizeArchivePathSeparators(
  input: string,
  options: { allowBackslash?: boolean },
): string {
  if (input.includes("\\") && options.allowBackslash !== true) {
    throw invalidPackage("archivePathInvalid", { path: input });
  }
  return options.allowBackslash === true ? input.replaceAll("\\", "/") : input;
}

function isArchiveDirectoryPath(
  input: string,
  options: { allowBackslash?: boolean } = {},
): boolean {
  return normalizeArchivePathSeparators(input, options).endsWith("/");
}

function isZipSymlink(externalFileAttributes: number): boolean {
  const unixMode = (externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function assertPathWithin(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(".." + sep) ||
    isAbsolute(pathFromRoot)
  ) {
    throw invalidPackage("archivePathInvalid", { path: pathFromRoot });
  }
}

export function extensionMatchesImageType(
  pathname: string,
  contentType: string,
): boolean {
  const extension = extname(pathname).toLocaleLowerCase("en-US");
  const allowed: Record<string, string[]> = {
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/gif": [".gif"],
    "image/webp": [".webp"],
  };
  return allowed[contentType]?.includes(extension) === true;
}

async function listRegularFiles(
  directory: string,
  root: string,
  maxCount: number,
  result: string[] = [],
): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertPathWithin(root, path);
    if (entry.isSymbolicLink()) {
      throw invalidPackage("archiveEntrySymlink", {
        path: relative(root, path).replaceAll(sep, "/"),
      });
    }
    if (entry.isDirectory()) {
      await listRegularFiles(path, root, maxCount, result);
    } else if (entry.isFile()) {
      result.push(path);
      if (result.length > maxCount) {
        throw invalidPackage("archiveEntryCountInvalid", {
          entry_count: result.length,
          limit_count: maxCount,
        });
      }
    } else {
      throw invalidPackage("archivePathInvalid", {
        path: relative(root, path).replaceAll(sep, "/"),
      });
    }
  }
  return result;
}

function assertPackageContainsOnlyRoot(
  files: string[],
  searchRoot: string,
  packageRoot: string,
): void {
  for (const file of files) {
    const fromPackage = relative(packageRoot, file);
    if (
      fromPackage === ".." ||
      fromPackage.startsWith(".." + sep) ||
      isAbsolute(fromPackage)
    ) {
      const fromSearch = relative(searchRoot, file).replaceAll(sep, "/");
      if (!fromSearch.startsWith("__MACOSX/") && fromSearch !== ".DS_Store") {
        throw invalidPackage("packageMultipleRoots", {
          path: fromSearch.slice(0, 240),
        });
      }
    }
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 1_000_000) throw invalidPackage("packageJsonInvalid");
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw invalidPackage("packageJsonInvalid");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidPackage("packageJsonInvalid");
  }
}

function normalizePluginManifest(
  manifest: Record<string, unknown>,
  name: string,
  description: string | null,
  skillNames: string[],
): Record<string, unknown> {
  return {
    name,
    ...(description === null ? {} : { description }),
    ...(typeof manifest.version === "string"
      ? { version: manifest.version.slice(0, 120) }
      : {}),
    ...(typeof manifest.license === "string"
      ? { license: manifest.license.slice(0, 120) }
      : {}),
    ...(typeof manifest.skills === "string" ? { has_skills: true } : {}),
    ...(manifest.mcpServers === undefined ? {} : { has_mcp_servers: true }),
    ...(skillNames.length > 0 ? { skill_names: skillNames } : {}),
  };
}

async function validatePluginManifest(
  packageRoot: string,
  manifest: Record<string, unknown>,
  name: string,
  packageFiles: string[],
): Promise<{
  skillNames: string[];
  mcpEnvironmentReferences: CapabilityRiskSummary["mcp_environment_references"];
}> {
  if (
    manifest.apps !== undefined ||
    manifest.hooks !== undefined ||
    manifest.appTemplates !== undefined
  ) {
    // LinkSense currently has no connector OAuth or hook approval control
    // plane. Reject these components explicitly instead of claiming a
    // partially loaded native plugin.
    throw invalidPackage("pluginUnsupportedComponent");
  }

  const skillManifestPaths = packageFiles.filter(
    (file) => basename(file) === "SKILL.md",
  );
  const skillNames: string[] = [];
  if (manifest.skills === undefined) {
    if (skillManifestPaths.length > 0)
      throw invalidPackage("pluginSkillsInvalid");
  } else {
    if (typeof manifest.skills !== "string") {
      throw invalidPackage("pluginSkillsInvalid");
    }
    const skillsRoot = await resolveDeclaredPluginPath(
      packageRoot,
      manifest.skills,
      "directory",
    );
    for (const skillPath of skillManifestPaths) {
      assertPathWithin(skillsRoot, skillPath);
      const markdown = await readFile(skillPath, "utf8");
      const metadata = parseSkillMetadata(markdown);
      const skillName = validateSkillName(metadata.name ?? "");
      await assertSkillReferencedScriptsExist(
        resolve(skillPath, ".."),
        skillName,
        markdown,
      );
      skillNames.push(skillName);
    }
    if (
      skillNames.length === 0 ||
      new Set(skillNames).size !== skillNames.length
    ) {
      throw invalidPackage("pluginSkillsInvalid");
    }
  }

  let mcpEnvironmentReferences: CapabilityRiskSummary["mcp_environment_references"] =
    [];
  if (manifest.mcpServers !== undefined) {
    try {
      if (typeof manifest.mcpServers === "string") {
        const mcpConfigPath = await resolveDeclaredPluginPath(
          packageRoot,
          manifest.mcpServers,
          "file",
        );
        mcpEnvironmentReferences = inspectNativePluginMcpConfigFile(
          await readJsonObject(mcpConfigPath),
        ).environmentReferences;
      } else {
        mcpEnvironmentReferences = inspectNativePluginMcpServers(
          manifest.mcpServers,
        ).environmentReferences;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof NativePluginMcpValidationError) {
        throw invalidPackage("pluginMcpConfigurationInvalid");
      }
      throw error;
    }
  }

  return {
    skillNames: skillNames.sort(),
    mcpEnvironmentReferences,
  };
}

async function resolveDeclaredPluginPath(
  packageRoot: string,
  declaration: string,
  expectedType: "directory" | "file",
): Promise<string> {
  if (!declaration.startsWith("./") || isAbsolute(declaration)) {
    throw invalidPackage("pluginDeclaredPathInvalid", { path: declaration });
  }
  const target = resolve(packageRoot, declaration);
  assertPathWithin(packageRoot, target);
  const info = await lstat(target).catch(() => null);
  if (
    !info ||
    info.isSymbolicLink() ||
    (expectedType === "directory" ? !info.isDirectory() : !info.isFile())
  ) {
    throw invalidPackage("pluginDeclaredPathInvalid", { path: declaration });
  }
  return target;
}

function parseSkillMetadata(
  markdown: string,
): ReturnType<typeof parseSkillManifest> {
  try {
    return parseSkillManifest(markdown);
  } catch (error) {
    if (error instanceof SkillManifestValidationError) {
      throw invalidPackage("skillFrontmatterMissing");
    }
    throw error;
  }
}

async function assertSkillReferencedScriptsExist(
  packageRoot: string,
  skillName: string,
  markdown: string,
): Promise<void> {
  const checked = new Set<string>();
  for (const match of markdown.matchAll(PYTHON_SCRIPT_COMMAND_PATTERN)) {
    const commandPath = match[1] ?? match[2] ?? match[3];
    if (!commandPath) continue;
    const relativeScript = resolveBundledSkillScript(commandPath, skillName);
    if (relativeScript === null || checked.has(relativeScript)) continue;
    checked.add(relativeScript);

    const target = resolve(packageRoot, relativeScript);
    assertPathWithin(packageRoot, target);
    const info = await lstat(target).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) continue;
    throw invalidPackage("skillReferencedScriptMissing", {
      path: relativeScript,
    });
  }
}

function resolveBundledSkillScript(
  commandPath: string,
  skillName: string,
): string | null {
  let portablePath = commandPath.replaceAll("\\", "/");
  const prefixes = [
    `skills/${skillName}/`,
    `$HOME/.agents/skills/${skillName}/`,
    `\${HOME}/.agents/skills/${skillName}/`,
    `{baseDir}/`,
    `{base_dir}/`,
    `<skill_dir>/`,
    `<skill-dir>/`,
  ];
  if (portablePath.startsWith("./")) portablePath = portablePath.slice(2);
  const prefix = prefixes.find((value) => portablePath.startsWith(value));
  if (prefix !== undefined) portablePath = portablePath.slice(prefix.length);

  if (!portablePath.startsWith("scripts/")) return null;
  return validateArchivePath(portablePath).replaceAll(sep, "/");
}

async function scanRiskSummary(
  packageRoot: string,
  mcpEnvironmentReferences: CapabilityRiskSummary["mcp_environment_references"] =
    [],
): Promise<CapabilityRiskSummary> {
  const files = await listRegularFiles(packageRoot, packageRoot, 1_000);
  const supplyChainReview = await scanCapabilitySupplyChain(packageRoot);
  let containsMcp = false;
  let containsScripts = false;
  let containsExternal = false;
  const dependencyCommands = new Set<string>();
  for (const file of files) {
    const extension = extname(file);
    if (SCRIPT_EXTENSION_PATTERN.test(extension)) containsScripts = true;
    const fileStat = await stat(file);
    if (fileStat.size > 2 * 1024 * 1024) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    if (
      /mcpServers|mcp_servers|\.mcp\.json/iu.test(content) ||
      file.endsWith(".mcp.json")
    ) {
      containsMcp = true;
    }
    if (URL_PATTERN.test(content)) containsExternal = true;
    for (const match of content.matchAll(DEPENDENCY_COMMAND_PATTERN)) {
      if (match[0]) dependencyCommands.add(sanitizeDependencyCommand(match[0]));
    }
  }
  const declaredEnvironmentKeys = [
    ...new Set(
      mcpEnvironmentReferences
        .filter((reference) => reference.source === "local")
        .map((reference) => reference.env_key),
    ),
  ]
    .sort();
  const commands = [...dependencyCommands].sort().slice(0, 100);
  return {
    contains_mcp_server: containsMcp,
    contains_scripts: containsScripts,
    contains_external_connections: containsExternal,
    requires_environment_variables: mcpEnvironmentReferences.length > 0,
    requires_credentials: declaredEnvironmentKeys.length > 0,
    contains_dependency_download_commands: commands.length > 0,
    declared_environment_keys: declaredEnvironmentKeys,
    mcp_environment_references: mcpEnvironmentReferences,
    dependency_commands: commands,
    supply_chain_review: supplyChainReview,
  };
}

function sanitizeDependencyCommand(command: string): string {
  const words = command.trim().split(/\s+/u);
  return words.slice(0, 2).join(" ").slice(0, 80);
}


async function findPackageLogo(
  packageRoot: string,
  manifest: Record<string, unknown>,
  byteLimit: number,
): Promise<PreparedLogo | null> {
  const interfaceValue =
    typeof manifest.interface === "object" &&
    manifest.interface !== null &&
    !Array.isArray(manifest.interface)
      ? (manifest.interface as Record<string, unknown>)
      : null;
  const logoValue = interfaceValue?.logo ?? manifest.logo;
  if (typeof logoValue !== "string" || logoValue.length === 0) return null;
  if (/^https?:\/\//iu.test(logoValue)) return null;
  const logoPath = resolve(packageRoot, logoValue);
  assertPathWithin(packageRoot, logoPath);
  const fileStat = await lstat(logoPath).catch(() => null);
  if (
    fileStat === null ||
    !fileStat.isFile() ||
    fileStat.isSymbolicLink() ||
    fileStat.size > byteLimit
  ) {
    throw invalidPackage("logoFileInvalid");
  }
  const bytes = await readFile(logoPath);
  const contentType = detectSafeRasterImage(bytes);
  if (
    contentType === null ||
    !extensionMatchesImageType(logoValue, contentType)
  ) {
    throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
  }
  return {
    bytes,
    filename: logoValue.split(/[\\/]/u).at(-1) ?? "logo",
    contentType,
  };
}

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new AppError("IMPORT_FAILED");
  }
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new AppError("IMPORT_FAILED");
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new AppError("IMPORT_FAILED");
    }
  }
}

function valueAsString(value: unknown): string {
  if (typeof value !== "string") throw invalidPackage("packageJsonInvalid");
  return value;
}

export function validateSkillName(value: string): string {
  const name = value.trim();
  const parsed = capabilityPackageNameSchema.safeParse(name);
  if (!parsed.success) {
    throw invalidPackage("skillNameInvalid", {
      name: name.slice(0, 120),
    });
  }
  return parsed.data;
}

export function validatePluginName(value: string): string {
  const name = value.trim();
  const parsed = capabilityPackageNameSchema.safeParse(name);
  if (!parsed.success) {
    throw invalidPackage("skillNameInvalid", {
      name: name.slice(0, 120),
    });
  }
  return parsed.data;
}

function nullableDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalidPackage("packageJsonInvalid");
  const description = value.trim();
  if (description.length > 4_000) throw invalidPackage("packageJsonInvalid");
  return description === "" ? null : description;
}

export function slugifyCapabilityName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
  return slug === "" ? "capability-" + randomUUID().slice(0, 8) : slug;
}

export function capabilityDirectory(root: string, id: string): string {
  return join(resolve(root), id);
}

export function validateRequestedType(
  preparedType: CapabilityType,
  requestedType?: CapabilityType,
): void {
  if (requestedType !== undefined && requestedType !== preparedType) {
    throw invalidPackage("requestedTypeMismatch", {
      expected: requestedType,
      actual: preparedType,
    });
  }
}
