import { lstat, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  publicKnowledgeSkillsSchema,
  type PublicKnowledgeSkill,
} from "@linksense/shared";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory } from "../../lib/package-directory-integrity.js";
import { verifiedApplicationPackagePath } from "../applications/publication-service.js";
import {
  publishedCapabilitySchema,
  type PublishedCapability,
} from "../applications/published-definition.js";
import { stageAtomicDirectoryReplacement } from "../capabilities/importer.js";
import { parseSkillManifest } from "../capabilities/skill-manifest.js";

type Reader = Pick<
  Prisma.TransactionClient,
  "capability" | "capabilityUserPreference"
>;
export interface PublicKnowledgeSkillCapture {
  snapshots: PublishedCapability[];
  assertCurrent(tx: Prisma.TransactionClient): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Instruction-only releases avoid copying or hashing unused package assets per question. */
export class PublicKnowledgeSkills {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly root: string,
  ) {}

  private async usable(reader: Reader, ownerId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const [sources, disabled] = await Promise.all([
      reader.capability.findMany({
        where: { id: { in: ids }, ownerId, type: "skill", status: "active" },
      }),
      reader.capabilityUserPreference.count({
        where: {
          userId: ownerId,
          capabilityId: { in: ids },
          status: "disabled",
        },
      }),
    ]);
    if (sources.length !== ids.length || disabled)
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    return ids.map((id) => {
      const source = sources.find((item) => item.id === id);
      if (!source) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      return source;
    });
  }

  async capture(
    ownerId: string,
    ids: string[],
    versionId: string,
  ): Promise<PublicKnowledgeSkillCapture> {
    const sources = await this.usable(this.prisma, ownerId, ids);
    const replacements: Awaited<
      ReturnType<typeof stageAtomicDirectoryReplacement>
    >[] = [];
    const snapshots: PublishedCapability[] = [];
    const rollback = async () => {
      for (const replacement of [...replacements].reverse())
        await replacement.rollback();
    };
    try {
      for (const source of sources) {
        const sourcePath = await verifiedApplicationPackagePath(
          this.root,
          source.storagePath,
        );
        const { markdown } = await readGuidance(sourcePath, source.name);
        const staging = await mkdtemp(
          join(this.root, ".public-knowledge-skill-"),
        );
        let replacement: Awaited<
          ReturnType<typeof stageAtomicDirectoryReplacement>
        >;
        try {
          await writeFile(join(staging, "SKILL.md"), markdown, { mode: 0o600 });
          replacement = await stageAtomicDirectoryReplacement(
            staging,
            join(this.root, "application-versions", versionId, source.id),
          );
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
        replacements.push(replacement);
        snapshots.push(
          publishedCapabilitySchema.parse({
            id: source.id,
            type: "skill",
            name: source.name,
            description: source.description,
            sourceType: source.sourceType,
            marketplaceListingId: source.marketplaceListingId,
            marketplaceReleaseId: source.marketplaceReleaseId,
            storagePath: relative(this.root, replacement.currentDirectory)
              .split(sep)
              .join("/"),
            revision: source.updatedAt.toISOString(),
            contentSha256: await hashPackageDirectory(
              replacement.currentDirectory,
            ),
            manifestJson: source.manifestJson,
            riskSummaryJson: source.riskSummaryJson,
          }),
        );
      }
      // Validate instruction content and size before publishing, not on a visitor's first question.
      await this.read(snapshots);
      return {
        snapshots,
        assertCurrent: async (tx) => {
          const current = await this.usable(tx, ownerId, ids);
          if (
            sources.some(
              (source, index) =>
                source.updatedAt.getTime() !==
                current[index]?.updatedAt.getTime(),
            )
          )
            throw new AppError("CONFLICT");
        },
        commit: async () => {
          for (const replacement of replacements) await replacement.commit();
        },
        rollback,
      };
    } catch (error) {
      await rollback();
      if (error instanceof AppError) throw error;
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
  }

  async resolve(
    ownerId: string,
    snapshots: PublishedCapability[],
  ): Promise<PublicKnowledgeSkill[]> {
    await this.usable(
      this.prisma,
      ownerId,
      snapshots.map((skill) => skill.id),
    );
    return this.read(snapshots);
  }

  private async read(
    snapshots: PublishedCapability[],
  ): Promise<PublicKnowledgeSkill[]> {
    try {
      const skills: PublicKnowledgeSkill[] = [];
      for (const snapshot of snapshots) {
        if (snapshot.type !== "skill")
          throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        const root = await verifiedApplicationPackagePath(
          this.root,
          snapshot.storagePath,
        );
        if ((await hashPackageDirectory(root)) !== snapshot.contentSha256)
          throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        skills.push({
          id: snapshot.id,
          ...(await readGuidance(root, snapshot.name)),
        });
      }
      return publicKnowledgeSkillsSchema.parse(skills);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
  }
}

async function readGuidance(
  root: string,
  expectedName: string,
): Promise<Pick<PublicKnowledgeSkill, "name" | "markdown">> {
  const filename = join(root, "SKILL.md"),
    info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512_000)
    throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  const markdown = await readFile(filename, "utf8"),
    metadata = parseSkillManifest(markdown);
  if (metadata.name !== expectedName || !metadata.description)
    throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  return { name: metadata.name, markdown };
}
