import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import {
  skillCreatorConfirmRequestSchema,
  skillCreatorPreviewRequestSchema,
  skillCreatorPreviewResultSchema,
  type SkillCreatorConfirmRequest,
  type SkillCreatorInstallResult,
  type SkillCreatorPreviewRequest,
  type SkillCreatorPreviewResult,
} from "@linksense/shared";
import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { readStableRegularFile } from "../../lib/stable-regular-file.js";
import {
  resolveConversationWorkspaceEntry,
  resolveConversationWorkspaceRoot,
} from "../../lib/user-runtime-paths.js";
import {
  DEFAULT_CAPABILITY_PACKAGE_LIMITS,
  type CapabilityPackageLimits,
} from "./importer.js";
import type { CapabilityService } from "./service.js";
import type { RequestActor } from "./types.js";

const installTokenClaimsSchema = z.strictObject({
  owner_id: z.uuid(),
  conversation_id: z.uuid(),
  preview_turn_id: z.string().min(1).max(256),
  preview_token: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
});

type SkillCreatorPrisma = Pick<PrismaClient, "conversationTurn" | "conversation" | "user">;

export interface ConversationSkillCreatorServiceOptions {
  prisma: SkillCreatorPrisma;
  capabilities: Pick<
    CapabilityService,
    "previewImportCapability" | "confirmCapabilityImport"
  >;
  workspaceRoot: string;
  tokenSecret: string;
  packageLimits?: Partial<CapabilityPackageLimits>;
  now?: () => Date;
}

export class ConversationSkillCreatorService {
  readonly #prisma: SkillCreatorPrisma;
  readonly #capabilities: ConversationSkillCreatorServiceOptions["capabilities"];
  readonly #workspaceRoot: string;
  readonly #tokenSecret: string;
  readonly #archiveByteLimit: number;
  readonly #now: () => Date;

  constructor(options: ConversationSkillCreatorServiceOptions) {
    if (Buffer.byteLength(options.tokenSecret, "utf8") < 32) {
      throw new Error("skill creator token secret must contain at least 32 bytes");
    }
    this.#prisma = options.prisma;
    this.#capabilities = options.capabilities;
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#tokenSecret = options.tokenSecret;
    this.#archiveByteLimit =
      options.packageLimits?.archiveBytes ??
      DEFAULT_CAPABILITY_PACKAGE_LIMITS.archiveBytes;
    this.#now = options.now ?? (() => new Date());
  }

  async preview(
    ownerId: string,
    rawInput: SkillCreatorPreviewRequest,
  ): Promise<SkillCreatorPreviewResult> {
    const input = skillCreatorPreviewRequestSchema.parse(rawInput);
    const actor = await this.#activeActor(ownerId);
    await this.#assertRunningTurn(actor.id, input.conversationId, input.turnId);

    const conversation = await this.#prisma.conversation.findFirst({
      where: { id: input.conversationId, ownerId: actor.id },
      select: { workspaceRelPath: true },
    });
    if (!conversation) throw new AppError("FORBIDDEN");

    const archivePath = resolveConversationWorkspaceEntry(
      this.#workspaceRoot,
      actor.id,
      conversation.workspaceRelPath,
      input.workspaceRelativePath,
    );
    const archiveStats = await lstat(archivePath).catch(() => {
      throw invalidArchive("archive_not_found");
    });
    if (!archiveStats.isFile() || archiveStats.isSymbolicLink()) {
      throw invalidArchive("archive_not_regular_file");
    }
    const canonicalPath = await realpath(archivePath).catch(() => {
      throw invalidArchive("archive_not_found");
    });
    const canonicalWorkspaceRoot = await realpath(
      resolveConversationWorkspaceRoot(
        this.#workspaceRoot,
        actor.id,
        conversation.workspaceRelPath,
      ),
    ).catch(() => {
      throw invalidArchive("archive_outside_workspace");
    });
    const canonicalRelativePath = relative(
      canonicalWorkspaceRoot,
      canonicalPath,
    );
    if (
      canonicalRelativePath === "" ||
      canonicalRelativePath === ".." ||
      canonicalRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(canonicalRelativePath)
    ) {
      throw invalidArchive("archive_outside_workspace");
    }
    if (
      canonicalPath !==
      resolve(canonicalWorkspaceRoot, input.workspaceRelativePath)
    ) {
      throw invalidArchive("archive_path_not_canonical");
    }
    const bytes = await readStableRegularFile(canonicalPath, archiveStats, {
      maximumBytes: this.#archiveByteLimit,
      invalidFileError: () => invalidArchive("archive_changed_while_reading"),
      fileTooLargeError: (sizeBytes) =>
        invalidArchive("archive_size_invalid", {
          size_bytes: sizeBytes,
          limit_bytes: this.#archiveByteLimit,
        }),
    });
    const preview = await this.#capabilities.previewImportCapability(actor, {
      source: {
        kind: "zip",
        bytes,
        filename: basename(canonicalPath),
      },
      requestedType: "skill",
    });
    if (
      preview.type !== "skill" ||
      preview.source.source_type !== "local" ||
      preview.source.import_kind !== "zip"
    ) {
      throw invalidArchive("requested_type_mismatch");
    }
    return skillCreatorPreviewResultSchema.parse({
      success: true,
      install_token: this.#signInstallToken({
        owner_id: actor.id,
        conversation_id: input.conversationId,
        preview_turn_id: input.turnId,
        preview_token: preview.preview_token,
        expires_at: preview.expires_at,
      }),
      expires_at: preview.expires_at,
      name: preview.name,
      description: preview.description,
      manifest: preview.manifest,
      declared_capabilities: preview.declared_capabilities,
      risk_summary: preview.risk_summary,
      skill_content_preview: preview.skill_content_preview,
      skill_content_truncated: preview.skill_content_truncated,
    });
  }

  async confirm(
    ownerId: string,
    rawInput: SkillCreatorConfirmRequest,
  ): Promise<SkillCreatorInstallResult> {
    const input = skillCreatorConfirmRequestSchema.parse(rawInput);
    const actor = await this.#activeActor(ownerId);
    await this.#assertRunningTurn(actor.id, input.conversationId, input.turnId);
    const claims = this.#verifyInstallToken(input.installToken);
    if (
      claims.owner_id !== actor.id ||
      claims.conversation_id !== input.conversationId ||
      Date.parse(claims.expires_at) <= this.#now().getTime()
    ) {
      throw new AppError("SKILL_CREATOR_PREVIEW_INVALID");
    }
    if (claims.preview_turn_id === input.turnId) {
      throw new AppError("SKILL_CREATOR_CONFIRMATION_REQUIRED");
    }

    const capability = await this.#capabilities.confirmCapabilityImport(
      actor,
      claims.preview_token,
    );
    if (capability.type !== "skill" || capability.source_type !== "local") {
      throw new AppError("INTERNAL_ERROR");
    }
    return {
      success: true,
      capability_id: capability.id,
      name: capability.name,
      source_type: "local",
      status: capability.status,
      preference_status: capability.preference_status,
    };
  }

  async #activeActor(ownerId: string): Promise<RequestActor> {
    const user = await this.#prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, role: true, status: true },
    });
    const parsed = z
      .strictObject({
        id: z.uuid(),
        role: z.enum(["admin", "user"]),
        status: z.literal("active"),
      })
      .safeParse(user);
    if (!parsed.success) throw new AppError("FORBIDDEN");
    return parsed.data;
  }

  async #assertRunningTurn(
    ownerId: string,
    conversationId: string,
    turnId: string,
  ): Promise<void> {
    const turn = await this.#prisma.conversationTurn.findFirst({
      where: {
        conversationId,
        codexTurnId: turnId,
        submittedBy: ownerId,
        status: "running",
      },
      select: { id: true },
    });
    if (turn === null) throw new AppError("FORBIDDEN");
  }

  #signInstallToken(
    claims: z.infer<typeof installTokenClaimsSchema>,
  ): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${this.#signature(payload)}`;
  }

  #verifyInstallToken(token: string): z.infer<typeof installTokenClaimsSchema> {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw new AppError("SKILL_CREATOR_PREVIEW_INVALID");
    }
    const expected = Buffer.from(this.#signature(payload));
    const actual = Buffer.from(signature);
    if (
      expected.byteLength !== actual.byteLength ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new AppError("SKILL_CREATOR_PREVIEW_INVALID");
    }
    try {
      return installTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch {
      throw new AppError("SKILL_CREATOR_PREVIEW_INVALID");
    }
  }

  #signature(payload: string): string {
    return createHmac("sha256", this.#tokenSecret)
      .update(`linksense-skill-creator:${payload}`)
      .digest("base64url");
  }
}

function invalidArchive(
  reasonCode: string,
  params: Record<string, string | number | boolean> = {},
): AppError {
  return new AppError("INVALID_PACKAGE", {
    reason_code: reasonCode,
    ...params,
  });
}
