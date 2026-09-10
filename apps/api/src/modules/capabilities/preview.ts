import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";
import { capabilityRiskSummarySchema } from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory } from "../../lib/package-directory-integrity.js";
import type {
  ClawHubCapabilityOrigin,
  CapabilityImportSource,
  CapabilityRiskSummary,
  CapabilityType,
  PreparedCapabilityPackage,
  PreparedLogo,
} from "./types.js";
import { assertCapabilitySupplyChainReviewCurrent } from "./supply-chain-scanner.js";

const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_CONTENT_PREVIEW_CHARACTERS = 100_000;

const riskSummarySchema = capabilityRiskSummarySchema;

const localPreviewSourceSchema = z.strictObject({
  source_type: z.literal("local"),
  import_kind: z.enum(["manual_skill", "zip"]),
  source_url: z.null(),
  filename: z.string().min(1).max(512).nullable(),
});

const clawHubPreviewSourceSchema = z.strictObject({
  source_type: z.literal("clawhub"),
  import_kind: z.literal("remote_files"),
  skill_id: z.string().uuid(),
  owner_handle: z.string().trim().min(1).max(240),
  slug: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(240),
  security_status: z.enum([
    "clean",
    "suspicious",
    "malicious",
    "unverified",
  ]),
  security_has_warnings: z.boolean(),
  canonical_url: z.string().url().max(2_000),
});

const previewStateSchema = z.strictObject({
  version: z.literal(2),
  token: z.string().uuid(),
  actor_id: z.string().uuid(),
  operation: z.enum(["install", "update"]),
  capability_id: z.string().uuid().nullable(),
  requested_type: z.enum(["plugin", "skill"]).nullable(),
  source: z.discriminatedUnion("source_type", [
    localPreviewSourceSchema,
    clawHubPreviewSourceSchema,
  ]),
  expires_at: z.string().datetime({ offset: true }),
  package_root_relative: z.string(),
  package_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  logo_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  prepared: z.strictObject({
    type: z.enum(["plugin", "skill"]),
    name: z.string().min(1).max(160),
    description: z.string().max(4_000).nullable(),
    manifest: z.record(z.string(), z.unknown()),
    risk_summary: riskSummarySchema,
    logo: z
      .strictObject({
        filename: z.string().min(1).max(512),
        content_type: z.enum([
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ]),
      })
      .nullable(),
  }),
});

type PreviewState = z.infer<typeof previewStateSchema>;

export interface CapabilityImportPreview {
  preview_token: string;
  expires_at: string;
  operation: "install" | "update";
  capability_id: string | null;
  source:
    | z.infer<typeof localPreviewSourceSchema>
    | z.infer<typeof clawHubPreviewSourceSchema>;
  type: CapabilityType;
  name: string;
  description: string | null;
  manifest: Record<string, unknown>;
  declared_capabilities: string[];
  declared_environment_keys: string[];
  risk_summary: CapabilityRiskSummary;
  has_logo: boolean;
  skill_content_preview: string | null;
  skill_content_truncated: boolean;
}

export interface ClawHubPreviewSource extends ClawHubCapabilityOrigin {
  kind: "clawhub";
}

type CapabilityPreviewSource = CapabilityImportSource | ClawHubPreviewSource;

export interface StageCapabilityPreviewInput {
  actorId: string;
  operation: "install" | "update";
  capabilityId: string | null;
  requestedType?: CapabilityType;
  source: CapabilityPreviewSource;
  prepared: PreparedCapabilityPackage;
}

export interface ClaimedCapabilityPreview {
  operation: "install" | "update";
  capabilityId: string | null;
  requestedType: CapabilityType | null;
  sourceType: "local" | "clawhub";
  clawHubOrigin: ClawHubCapabilityOrigin | null;
  packageSha256: string;
  prepared: PreparedCapabilityPackage;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export class CapabilityPreviewRepository {
  readonly #root: string;
  readonly #now: () => Date;

  constructor(capabilityRoot: string, now: () => Date) {
    this.#root = join(resolve(capabilityRoot), ".previews");
    this.#now = now;
  }

  async stage(
    input: StageCapabilityPreviewInput,
  ): Promise<CapabilityImportPreview> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    const directory = this.#directory(token);
    const packageDirectory = join(directory, "package");
    const packageRootRelative = relative(
      resolve(input.prepared.stagingDirectory),
      resolve(input.prepared.packageRoot),
    );
    assertSafeRelativePath(packageRootRelative);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    try {
      assertCapabilitySupplyChainReviewCurrent(
        input.prepared.riskSummary.supply_chain_review,
        await hashPackageDirectory(input.prepared.packageRoot),
      );
      const skillContentPreview = await readSkillContentPreview(input.prepared);
      await rename(input.prepared.stagingDirectory, packageDirectory);
      if (input.prepared.logo !== null) {
        await writeFile(
          join(directory, "logo.bin"),
          input.prepared.logo.bytes,
          {
            flag: "wx",
            mode: 0o600,
          },
        );
      }
      const packageSha256 = await hashDirectory(packageDirectory);
      const state = previewStateSchema.parse({
        version: 2,
        token,
        actor_id: input.actorId,
        operation: input.operation,
        capability_id: input.capabilityId,
        requested_type: input.requestedType ?? null,
        source: sourceView(input.source),
        expires_at: new Date(
          this.#now().getTime() + PREVIEW_TTL_MS,
        ).toISOString(),
        package_root_relative: packageRootRelative,
        package_sha256: packageSha256,
        logo_sha256:
          input.prepared.logo === null
            ? null
            : sha256(input.prepared.logo.bytes),
        prepared: {
          type: input.prepared.type,
          name: input.prepared.name,
          description: input.prepared.description,
          manifest: input.prepared.manifest,
          risk_summary: input.prepared.riskSummary,
          logo:
            input.prepared.logo === null
              ? null
              : {
                  filename: input.prepared.logo.filename,
                  content_type: input.prepared.logo.contentType,
                },
        },
      });
      const temporaryStatePath = join(directory, ".ready.json.tmp");
      await writeFile(temporaryStatePath, JSON.stringify(state), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryStatePath, join(directory, "ready.json"));
      return previewView(state, skillContentPreview);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async claim(
    token: string,
    actorId: string,
  ): Promise<ClaimedCapabilityPreview> {
    if (!z.string().uuid().safeParse(token).success) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    const directory = this.#directory(token);
    const readyPath = join(directory, "ready.json");
    const claimedPath = join(directory, "claimed.json");
    try {
      await rename(readyPath, claimedPath);
    } catch {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }

    let state: PreviewState;
    try {
      state = previewStateSchema.parse(
        JSON.parse(await readFile(claimedPath, "utf8")),
      );
      if (state.token !== token || state.actor_id !== actorId) {
        throw new AppError("CAPABILITY_NOT_FOUND");
      }
      if (new Date(state.expires_at).getTime() <= this.#now().getTime()) {
        await rm(directory, { recursive: true, force: true });
        throw new AppError("CAPABILITY_NOT_FOUND");
      }
    } catch (error) {
      if (error instanceof AppError) {
        if (await pathExists(claimedPath)) {
          await rename(claimedPath, readyPath).catch(() => undefined);
        }
        throw error;
      }
      await rm(directory, { recursive: true, force: true });
      throw new AppError("CAPABILITY_NOT_FOUND");
    }

    const packageDirectory = join(directory, "package");
    const packageRoot = resolve(packageDirectory, state.package_root_relative);
    assertPathWithin(packageDirectory, packageRoot);
    const packageStat = await lstat(packageRoot).catch(() => null);
    if (
      packageStat === null ||
      !packageStat.isDirectory() ||
      packageStat.isSymbolicLink()
    ) {
      await rm(directory, { recursive: true, force: true });
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    if (
      !safeHashEqual(
        await hashDirectory(packageDirectory),
        state.package_sha256,
      )
    ) {
      await rm(directory, { recursive: true, force: true });
      throw new AppError("INVALID_PACKAGE");
    }

    assertCapabilitySupplyChainReviewCurrent(
      state.prepared.risk_summary.supply_chain_review,
      await hashPackageDirectory(packageRoot),
    );

    let logo: PreparedLogo | null = null;
    if (state.prepared.logo !== null) {
      const bytes = await readFile(join(directory, "logo.bin")).catch(
        () => null,
      );
      if (
        bytes === null ||
        bytes.length === 0 ||
        bytes.length > MAX_LOGO_BYTES
      ) {
        await rm(directory, { recursive: true, force: true });
        throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
      }
      if (
        state.logo_sha256 === null ||
        !safeHashEqual(sha256(bytes), state.logo_sha256)
      ) {
        await rm(directory, { recursive: true, force: true });
        throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
      }
      logo = {
        bytes,
        filename: state.prepared.logo.filename,
        contentType: state.prepared.logo.content_type,
      };
    }

    let settled = false;
    return {
      operation: state.operation,
      capabilityId: state.capability_id,
      requestedType: state.requested_type,
      sourceType: state.source.source_type,
      clawHubOrigin:
        state.source.source_type === "clawhub"
          ? {
              skillId: state.source.skill_id,
              ownerHandle: state.source.owner_handle,
              slug: state.source.slug,
              version: state.source.version,
              securityStatus: state.source.security_status,
              securityHasWarnings: state.source.security_has_warnings,
              canonicalUrl: state.source.canonical_url,
            }
          : null,
      packageSha256: state.package_sha256,
      prepared: {
        stagingDirectory: directory,
        packageRoot,
        type: state.prepared.type,
        name: state.prepared.name,
        description: state.prepared.description,
        manifest: state.prepared.manifest,
        riskSummary: state.prepared.risk_summary,
        logo,
      },
      async commit() {
        if (settled) return;
        settled = true;
        await rm(directory, { recursive: true, force: true });
      },
      async rollback() {
        if (settled) return;
        settled = true;
        await rename(claimedPath, readyPath).catch(() => undefined);
      },
    };
  }

  #directory(token: string): string {
    const directory = join(this.#root, token);
    assertPathWithin(this.#root, directory);
    return directory;
  }
}

export async function pruneExpiredCapabilityPreviews(input: {
  capabilityRoot: string;
  cursor?: string;
  limit: number;
  now?: Date;
}): Promise<{ removed: number; nextCursor: string | null }> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new Error("capability preview cleanup limit is invalid");
  }
  const root = join(resolve(input.capabilityRoot), ".previews");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((entry) => !input.cursor || entry.name > input.cursor);
  const page = entries.slice(0, input.limit);
  const now = (input.now ?? new Date()).getTime();
  let removed = 0;

  for (const entry of page) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(root, entry.name);
    assertPathWithin(root, directory);
    let expired = false;
    let foundState = false;
    for (const filename of ["ready.json", "claimed.json"]) {
      const state = await readPreviewStateForCleanup(join(directory, filename));
      if (state?.success) {
        foundState = true;
        expired = new Date(state.data.expires_at).getTime() <= now;
        break;
      }
    }
    if (!foundState) {
      const directoryStat = await lstat(directory).catch((error: unknown) => {
        if (isMissingFileError(error)) return null;
        throw error;
      });
      if (!directoryStat) continue;
      expired = directoryStat.mtimeMs + PREVIEW_TTL_MS <= now;
    }
    if (!expired) continue;
    assertPathWithin(root, directory);
    await rm(directory, { recursive: true, force: true });
    removed += 1;
  }

  return {
    removed,
    nextCursor:
      entries.length > page.length && page.length > 0
        ? page[page.length - 1]!.name
        : null,
  };
}

async function readPreviewStateForCleanup(path: string) {
  try {
    return previewStateSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch (error) {
    if (isMissingFileError(error)) return null;
    if (error instanceof SyntaxError) {
      return previewStateSchema.safeParse(null);
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function sourceView(source: CapabilityPreviewSource): PreviewState["source"] {
  if (source.kind === "clawhub") {
    return {
      source_type: "clawhub",
      import_kind: "remote_files",
      skill_id: source.skillId,
      owner_handle: source.ownerHandle,
      slug: source.slug,
      version: source.version,
      security_status: source.securityStatus,
      security_has_warnings: source.securityHasWarnings,
      canonical_url: source.canonicalUrl,
    };
  }
  if (source.kind === "zip") {
    return {
      source_type: "local",
      import_kind: "zip",
      source_url: null,
      filename: source.filename,
    };
  }
  return {
    source_type: "local",
    import_kind: "manual_skill",
    source_url: null,
    filename: null,
  };
}

function previewView(
  state: PreviewState,
  skillContentPreview: {
    content: string | null;
    truncated: boolean;
  },
): CapabilityImportPreview {
  const declaredCapabilities = [
    ["mcp_server", state.prepared.risk_summary.contains_mcp_server],
    ["scripts", state.prepared.risk_summary.contains_scripts],
    [
      "external_connections",
      state.prepared.risk_summary.contains_external_connections,
    ],
    [
      "environment_variables",
      state.prepared.risk_summary.requires_environment_variables,
    ],
    ["credentials", state.prepared.risk_summary.requires_credentials],
    [
      "dependency_download_commands",
      state.prepared.risk_summary.contains_dependency_download_commands,
    ],
  ]
    .filter((entry) => entry[1] === true)
    .map((entry) => entry[0] as string);
  return {
    preview_token: state.token,
    expires_at: state.expires_at,
    operation: state.operation,
    capability_id: state.capability_id,
    source: state.source,
    type: state.prepared.type,
    name: state.prepared.name,
    description: state.prepared.description,
    manifest: state.prepared.manifest,
    declared_capabilities: declaredCapabilities,
    declared_environment_keys:
      state.prepared.risk_summary.declared_environment_keys,
    risk_summary: state.prepared.risk_summary,
    has_logo: state.prepared.logo !== null,
    skill_content_preview: skillContentPreview.content,
    skill_content_truncated: skillContentPreview.truncated,
  };
}

async function readSkillContentPreview(
  prepared: PreparedCapabilityPackage,
): Promise<{ content: string | null; truncated: boolean }> {
  if (prepared.type === "plugin") {
    return { content: null, truncated: false };
  }
  const markdown = await readFile(
    join(prepared.packageRoot, "SKILL.md"),
    "utf8",
  );
  const content = stripSkillFrontmatter(markdown);
  let end = 0;
  let characterCount = 0;
  for (const character of content) {
    if (characterCount === MAX_SKILL_CONTENT_PREVIEW_CHARACTERS) {
      return { content: content.slice(0, end), truncated: true };
    }
    end += character.length;
    characterCount += 1;
  }
  return { content, truncated: false };
}

export function stripSkillFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) throw new AppError("INVALID_PACKAGE");
  const frontmatterEnd = markdown.indexOf("\n---", 4);
  if (frontmatterEnd < 0 || frontmatterEnd > 32_000) {
    throw new AppError("INVALID_PACKAGE");
  }
  const bodyStart = frontmatterEnd + "\n---".length;
  const content =
    markdown[bodyStart] === "\n"
      ? markdown.slice(bodyStart + 1)
      : markdown.slice(bodyStart);
  return content.replace(/^(?:[\t ]*\n)+/u, "");
}

function assertSafeRelativePath(value: string): void {
  if (value === ".." || value.startsWith(".." + sep) || isAbsolute(value)) {
    throw new AppError("IMPORT_FAILED");
  }
}

function assertPathWithin(root: string, target: string): void {
  const fromRoot = relative(resolve(root), resolve(target));
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(".." + sep) ||
    isAbsolute(fromRoot)
  ) {
    throw new AppError("IMPORT_FAILED");
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

async function hashDirectory(root: string): Promise<string> {
  const files = await listFilesForHash(resolve(root), resolve(root));
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const bytes = await readFile(join(root, file));
    hash.update(file, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(bytes.length), "utf8");
    hash.update("\0", "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

async function listFilesForHash(
  directory: string,
  root: string,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertPathWithin(root, path);
    if (entry.isSymbolicLink()) throw new AppError("INVALID_PACKAGE");
    if (entry.isDirectory()) {
      result.push(...(await listFilesForHash(path, root)));
    } else if (entry.isFile()) {
      result.push(relative(root, path));
    } else {
      throw new AppError("INVALID_PACKAGE");
    }
  }
  return result;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
