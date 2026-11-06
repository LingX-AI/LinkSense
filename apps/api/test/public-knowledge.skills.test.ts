import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { PublicKnowledgeSkills } from "../src/modules/public-knowledge/skills.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "linksense-public-skills-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const ownerId = randomUUID(),
    id = randomUUID(),
    versionId = randomUUID();
  const markdown =
    "---\nname: answer-guide\ndescription: Website response guide\n---\nUse clear paragraphs and cite the website.\n";
  const source = {
    id,
    ownerId,
    type: "skill",
    status: "active",
    name: "answer-guide",
    description: "Answer guide",
    sourceType: "local",
    storagePath: id,
    marketplaceListingId: null,
    marketplaceReleaseId: null,
    manifestJson: { name: "answer-guide" },
    riskSummaryJson: null,
    updatedAt: new Date("2026-11-05T00:00:00Z"),
  };
  await mkdir(join(root, id));
  await writeFile(join(root, id, "SKILL.md"), markdown);
  await writeFile(
    join(root, id, "script.sh"),
    "echo package-resource-not-transported",
  );
  const findMany = vi.fn(async () => [source]),
    count = vi.fn(async () => 0);
  const db = {
    capability: { findMany },
    capabilityUserPreference: { count },
  } as unknown as PrismaClient;
  const skills = new PublicKnowledgeSkills(db, root);
  return {
    ownerId,
    id,
    versionId,
    source,
    markdown,
    findMany,
    count,
    db,
    skills,
  };
}
describe("public knowledge Skill releases", () => {
  it("freezes selected Skill content and returns only its instruction text after the source changes", async () => {
    const f = await fixture();
    const captured = await f.skills.capture(f.ownerId, [f.id], f.versionId);
    await captured.assertCurrent(f.db as unknown as Prisma.TransactionClient);
    await captured.commit();
    expect(
      await readdir(join(root, captured.snapshots[0]!.storagePath)),
    ).toEqual(["SKILL.md"]);
    await writeFile(join(root, f.id, "SKILL.md"), "new source content");
    expect(await f.skills.resolve(f.ownerId, captured.snapshots)).toEqual([
      { id: f.id, name: "answer-guide", markdown: f.markdown },
    ]);
    expect(f.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [f.id] },
        ownerId: f.ownerId,
        type: "skill",
        status: "active",
      },
    });
    expect(f.count).toHaveBeenCalledWith({
      where: {
        userId: f.ownerId,
        capabilityId: { in: [f.id] },
        status: "disabled",
      },
    });
  });
  it("requires no capability queries or packages for applications without selected Skills", async () => {
    const f = await fixture(),
      captured = await f.skills.capture(f.ownerId, [], f.versionId);
    await captured.assertCurrent(f.db as unknown as Prisma.TransactionClient);
    expect(captured.snapshots).toEqual([]);
    expect(await f.skills.resolve(f.ownerId, [])).toEqual([]);
    expect(f.findMany).not.toHaveBeenCalled();
    expect(f.count).not.toHaveBeenCalled();
  });
  it.each(["missing", "disabled"])(
    "rejects %s selections before making a snapshot",
    async (reason) => {
      const f = await fixture();
      if (reason === "missing") f.findMany.mockResolvedValue([]);
      else f.count.mockResolvedValue(1);
      await expect(
        f.skills.capture(f.ownerId, [f.id], f.versionId),
      ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    },
  );
  it("detects concurrent source edits and removes snapshots on transaction rollback", async () => {
    const f = await fixture(),
      captured = await f.skills.capture(f.ownerId, [f.id], f.versionId);
    f.findMany.mockResolvedValue([
      { ...f.source, updatedAt: new Date("2026-11-06T00:00:00Z") },
    ]);
    await expect(
      captured.assertCurrent(f.db as unknown as Prisma.TransactionClient),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await captured.rollback();
    await expect(
      readFile(join(root, captured.snapshots[0]!.storagePath, "SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, f.id, "SKILL.md"), "utf8")).toBe(
      f.markdown,
    );
  });
  it("rejects tampered published instruction content", async () => {
    const f = await fixture(),
      captured = await f.skills.capture(f.ownerId, [f.id], f.versionId);
    await captured.commit();
    await writeFile(
      join(root, captured.snapshots[0]!.storagePath, "SKILL.md"),
      "tampered",
    );
    await expect(
      f.skills.resolve(f.ownerId, captured.snapshots),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("rechecks revocation before resolving a previously published Skill", async () => {
    const f = await fixture(),
      captured = await f.skills.capture(f.ownerId, [f.id], f.versionId);
    await captured.commit();
    f.count.mockResolvedValue(1);
    await expect(
      f.skills.resolve(f.ownerId, captured.snapshots),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("rejects a symlink instruction file without exposing its target", async () => {
    const f = await fixture();
    await writeFile(join(root, "external.md"), f.markdown);
    await rm(join(root, f.id, "SKILL.md"));
    await symlink(join(root, "external.md"), join(root, f.id, "SKILL.md"));
    await expect(
      f.skills.capture(f.ownerId, [f.id], f.versionId),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("rejects instruction metadata that does not match the selected Skill", async () => {
    const f = await fixture();
    await writeFile(
      join(root, f.id, "SKILL.md"),
      f.markdown.replace("name: answer-guide", "name: another-guide"),
    );
    await expect(
      f.skills.capture(f.ownerId, [f.id], f.versionId),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it("rejects a Skill without the description required by native discovery before publication", async () => {
    const f = await fixture();
    await writeFile(
      join(root, f.id, "SKILL.md"),
      "---\nname: answer-guide\n---\nInstructions without a description\n",
    );
    await expect(
      f.skills.capture(f.ownerId, [f.id], f.versionId),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });
  it.each(["invalid metadata", "oversized instructions"])(
    "rejects %s at publication",
    async (reason) => {
      const f = await fixture();
      await writeFile(
        join(root, f.id, "SKILL.md"),
        reason === "invalid metadata"
          ? "missing frontmatter"
          : f.markdown + "a".repeat(128_001),
      );
      await expect(
        f.skills.capture(f.ownerId, [f.id], f.versionId),
      ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    },
  );
});
