import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  builtInSkillNames,
  capabilitySupplyChainRulesetVersion,
  capabilitySupplyChainScannerVersion,
} from "@linksense/shared";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { CapabilityPackageImporter } from "../src/modules/capabilities/importer.js";
import { capabilityRoutes } from "../src/modules/capabilities/routes.js";
import { CapabilityService } from "../src/modules/capabilities/service.js";
import { scanCapabilitySupplyChain } from "../src/modules/capabilities/supply-chain-scanner.js";
import type {
  CapabilityAuditInput,
  CapabilityPreferenceRecord,
  CapabilityRecord,
  CapabilityStore,
  CreateClawHubInstallationInput,
  CreateCapabilityRecordInput,
  PreparedCapabilityPackage,
  RequestActor,
  UpdateCapabilityRecordInput,
} from "../src/modules/capabilities/types.js";

type MaterializeUserHomes = NonNullable<
  ConstructorParameters<typeof CapabilityService>[0]["materializeUserHomes"]
>;

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const RECIPIENT_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_ID = "10000000-0000-4000-8000-000000000003";
const ADMIN_ID = "10000000-0000-4000-8000-000000000004";
const CAPABILITY_ID = "20000000-0000-4000-8000-000000000001";
const FIXED_DATE = new Date("2026-07-11T00:00:00.000Z");
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CapabilityService owner-only visibility", () => {
  it("stages and atomically records an owner-qualified ClawHub Skill install", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const validateClawHubInstall = vi.fn(async () => undefined);
    const service = createService(
      store,
      root,
      undefined,
      validateClawHubInstall,
    );
    const bytes = Buffer.from(
      "---\nname: remote-skill\ndescription: Remote skill\n---\n# Instructions",
      "utf8",
    );

    const preview = await service.previewClawHubInstall(ownerActor(), {
      skillId: "30000000-0000-4000-8000-000000000001",
      ownerHandle: "publisher",
      slug: "remote-skill",
      version: "1.2.3",
      securityStatus: "suspicious",
      securityHasWarnings: true,
      canonicalUrl: "https://clawhub.ai/publisher/skills/remote-skill",
      files: [
        {
          path: "SKILL.md",
          bytes,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });

    expect(preview.source).toEqual({
      source_type: "clawhub",
      import_kind: "remote_files",
      skill_id: "30000000-0000-4000-8000-000000000001",
      owner_handle: "publisher",
      slug: "remote-skill",
      version: "1.2.3",
      security_status: "suspicious",
      security_has_warnings: true,
      canonical_url: "https://clawhub.ai/publisher/skills/remote-skill",
    });

    const installed = await service.confirmCapabilityImport(
      ownerActor(),
      preview.preview_token,
    );

    expect(validateClawHubInstall).toHaveBeenCalledWith(ownerActor(), {
      skillId: "30000000-0000-4000-8000-000000000001",
      ownerHandle: "publisher",
      slug: "remote-skill",
      version: "1.2.3",
      securityStatus: "suspicious",
      securityHasWarnings: true,
      canonicalUrl: "https://clawhub.ai/publisher/skills/remote-skill",
    });

    expect(installed).toMatchObject({
      name: "remote-skill",
      source_type: "clawhub",
      is_owner: true,
    });
    expect(store.clawHubInstallations).toEqual([
      expect.objectContaining({
        userId: OWNER_ID,
        clawHubSkillId: "30000000-0000-4000-8000-000000000001",
        capabilityId: installed.id,
        installedVersion: "1.2.3",
        sourceSecurityStatus: "suspicious",
        sourceSecurityHasWarnings: true,
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
    await expect(
      service.previewUpdatePackage(ownerActor(), installed.id, {
        source: {
          kind: "manual_skill",
          name: "remote-skill",
          skillMarkdown: "# replacement",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await service.delete(ownerActor(), installed.id);
    expect(store.clawHubInstallations).toEqual([]);
  });

  it("rejects an unverified ClawHub Skill at the capability boundary", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const bytes = Buffer.from(
      "---\nname: remote-skill\n---\n# Instructions",
      "utf8",
    );

    await expect(
      service.previewClawHubInstall(ownerActor(), {
        skillId: "30000000-0000-4000-8000-000000000001",
        ownerHandle: "publisher",
        slug: "remote-skill",
        version: "1.2.3",
        securityStatus: "unverified",
        securityHasWarnings: false,
        canonicalUrl: "https://clawhub.ai/publisher/skills/remote-skill",
        files: [
          {
            path: "SKILL.md",
            bytes,
            size: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
    expect(store.capabilities).toEqual([]);
    expect(store.clawHubInstallations).toEqual([]);
  });

  it("rolls back confirmation when fresh ClawHub validation rejects the preview", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const validateClawHubInstall = vi.fn(async () => {
      throw new AppError("CLAWHUB_SKILL_NOT_INSTALLABLE");
    });
    const service = createService(
      store,
      root,
      undefined,
      validateClawHubInstall,
    );
    const bytes = Buffer.from(
      "---\nname: remote-skill\n---\n# Instructions",
      "utf8",
    );
    const preview = await service.previewClawHubInstall(ownerActor(), {
      skillId: "30000000-0000-4000-8000-000000000001",
      ownerHandle: "publisher",
      slug: "remote-skill",
      version: "1.2.3",
      securityStatus: "clean",
      securityHasWarnings: false,
      canonicalUrl: "https://clawhub.ai/publisher/skills/remote-skill",
      files: [
        {
          path: "SKILL.md",
          bytes,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });

    await expect(
      service.confirmCapabilityImport(ownerActor(), preview.preview_token),
    ).rejects.toMatchObject({ code: "CLAWHUB_SKILL_NOT_INSTALLABLE" });
    expect(validateClawHubInstall).toHaveBeenCalledTimes(1);
    expect(store.capabilities).toEqual([]);
    expect(store.clawHubInstallations).toEqual([]);
  });

  it("keeps capability visibility owner-scoped for users and administrators", async () => {
    const recipientCapabilityId = "20000000-0000-4000-8000-000000000020";
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability(),
      capability({
        id: recipientCapabilityId,
        ownerId: RECIPIENT_ID,
        installedBy: RECIPIENT_ID,
        name: "recipient-tool",
        slug: "recipient-tool",
      }),
    );
    const service = createService(store, await tempRoot());

    const ownerItems = await service.listAvailable(ownerActor());
    expect(ownerItems.filter((item) => item.is_builtin)).toEqual(
      builtInSkillNames.map((key) =>
        expect.objectContaining({
          builtin_key: key,
          source_type: "builtin",
          can_manage: false,
          can_select: false,
          can_delete: false,
        }),
      ),
    );
    const ownerCapabilities = ownerItems.filter((item) => !item.is_builtin);
    expect(ownerCapabilities).toEqual([
      expect.objectContaining({ id: CAPABILITY_ID, is_owner: true }),
    ]);
    const recipientCapabilities = (
      await service.listAvailable(recipientActor())
    ).filter((item) => !item.is_builtin);
    expect(recipientCapabilities).toEqual([
      expect.objectContaining({ id: recipientCapabilityId, is_owner: true }),
    ]);
    await expect(
      service.get(recipientActor(), CAPABILITY_ID),
    ).rejects.toMatchObject({
      code: "CAPABILITY_NOT_FOUND",
    });
    const administratorCapabilities = (
      await service.listManaged(adminActor())
    ).filter((item) => !item.is_builtin);
    expect(administratorCapabilities).toEqual([]);
    await expect(
      service.get(adminActor(), CAPABILITY_ID),
    ).rejects.toMatchObject({
      code: "CAPABILITY_NOT_FOUND",
    });
  });

  it("omits the managed browser Skill when its runtime is disabled", async () => {
    const service = createService(
      new MemoryCapabilityStore(),
      await tempRoot(),
      undefined,
      async () => undefined,
      false,
    );

    const available = await service.listAvailable(ownerActor());
    const managed = await service.listManaged(adminActor());

    for (const capabilities of [available, managed]) {
      expect(
        capabilities.map((capability) => capability.builtin_key),
      ).not.toContain("linksense-browser");
      expect(capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ builtin_key: "linksense-file-service" }),
        ]),
      );
    }
  });

  it("treats administrator personal capability management like a user-scoped library", async () => {
    const adminCapabilityId = "20000000-0000-4000-8000-000000000028";
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({
        id: adminCapabilityId,
        ownerId: ADMIN_ID,
        installedBy: ADMIN_ID,
        name: "admin-notes",
        slug: "admin-notes",
      }),
    );
    const service = createService(store, await tempRoot());

    const managedCapabilities = (
      await service.listManaged(adminActor())
    ).filter((item) => !item.is_builtin);
    expect(managedCapabilities).toEqual([
      expect.objectContaining({
        id: adminCapabilityId,
        can_manage: true,
        can_govern: false,
        is_owner: true,
      }),
    ]);
  });

  it("updates package content atomically without renaming the capability", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability({ type: "skill" }));
    const service = createService(store, root);

    const preview = await service.previewUpdatePackage(
      ownerActor(),
      CAPABILITY_ID,
      {
        source: {
          kind: "manual_skill",
          name: "reports",
          skillMarkdown: "# Updated instructions",
        },
        requestedType: "skill",
      },
    );

    expect(store.capabilities[0]?.name).toBe("reports");
    await service.confirmCapabilityImport(ownerActor(), preview.preview_token);

    expect(store.capabilities[0]).toMatchObject({
      name: "reports",
      slug: "reports",
    });
  });

  it("serializes concurrent updates across API service instances through HOME materialization", async () => {
    const root = await tempRoot();
    const capabilityPath = join(root, "capabilities", CAPABILITY_ID);
    const currentPath = join(capabilityPath, "current");
    await mkdir(currentPath, { recursive: true });
    await writeFile(join(currentPath, "SKILL.md"), "# Initial instructions");
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({
        type: "skill",
        storagePath: currentPath,
        description: "Initial",
      }),
    );
    let enterFirstDatabaseLock: (() => void) | undefined;
    const firstDatabaseLockEntered = new Promise<void>((resolve) => {
      enterFirstDatabaseLock = resolve;
    });
    let releaseFirstDatabaseLock: (() => void) | undefined;
    const firstDatabaseLockRelease = new Promise<void>((resolve) => {
      releaseFirstDatabaseLock = resolve;
    });
    let databaseLockCalls = 0;
    const databaseLock = vi
      .spyOn(store, "lockCapability")
      .mockImplementation(async () => {
        databaseLockCalls += 1;
        if (databaseLockCalls === 1) {
          enterFirstDatabaseLock?.();
          await firstDatabaseLockRelease;
        }
      });

    let enterFirstMaterialization: (() => void) | undefined;
    const firstMaterializationEntered = new Promise<void>((resolve) => {
      enterFirstMaterialization = resolve;
    });
    let releaseFirstMaterialization: (() => void) | undefined;
    const firstMaterializationRelease = new Promise<void>((resolve) => {
      releaseFirstMaterialization = resolve;
    });
    let materializationCalls = 0;
    const materializeUserHomes = vi.fn<MaterializeUserHomes>(async () => {
      materializationCalls += 1;
      if (materializationCalls === 1) {
        enterFirstMaterialization?.();
        await firstMaterializationRelease;
      }
    });
    const firstService = createService(store, root, materializeUserHomes);
    const secondService = createService(store, root, materializeUserHomes);
    const firstPreview = await firstService.previewUpdatePackage(
      ownerActor(),
      CAPABILITY_ID,
      {
        source: {
          kind: "manual_skill",
          name: "reports",
          description: "First",
          skillMarkdown: "# First instructions",
        },
        requestedType: "skill",
      },
    );
    const secondPreview = await secondService.previewUpdatePackage(
      ownerActor(),
      CAPABILITY_ID,
      {
        source: {
          kind: "manual_skill",
          name: "reports",
          description: "Second",
          skillMarkdown: "# Second instructions",
        },
        requestedType: "skill",
      },
    );

    const firstConfirmation = firstService.confirmCapabilityImport(
      ownerActor(),
      firstPreview.preview_token,
    );
    await firstDatabaseLockEntered;
    const secondConfirmation = secondService.confirmCapabilityImport(
      ownerActor(),
      secondPreview.preview_token,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(databaseLock).toHaveBeenCalledTimes(1);

    releaseFirstDatabaseLock?.();
    await firstMaterializationEntered;
    expect(databaseLock).toHaveBeenCalledTimes(1);
    expect(store.capabilities[0]?.description).toBe("First");
    expect(await readFile(join(currentPath, "SKILL.md"), "utf8")).toContain(
      "# First instructions",
    );

    releaseFirstMaterialization?.();
    await Promise.all([firstConfirmation, secondConfirmation]);

    expect(databaseLock).toHaveBeenCalledTimes(2);
    expect(store.capabilities[0]?.description).toBe("Second");
    expect(await readFile(join(currentPath, "SKILL.md"), "utf8")).toContain(
      "# Second instructions",
    );
  });

  it("keeps delete behind an update's HOME materialization and removes the committed current tree", async () => {
    const root = await tempRoot();
    const capabilityPath = join(root, "capabilities", CAPABILITY_ID);
    const currentPath = join(capabilityPath, "current");
    await mkdir(currentPath, { recursive: true });
    await writeFile(join(currentPath, "SKILL.md"), "# Initial instructions");
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({ type: "skill", storagePath: currentPath }),
    );
    let enterMaterialization: (() => void) | undefined;
    const materializationEntered = new Promise<void>((resolve) => {
      enterMaterialization = resolve;
    });
    let releaseMaterialization: (() => void) | undefined;
    const materializationRelease = new Promise<void>((resolve) => {
      releaseMaterialization = resolve;
    });
    let materializationCalls = 0;
    const materializeUserHomes = vi.fn<MaterializeUserHomes>(async () => {
      materializationCalls += 1;
      if (materializationCalls === 1) {
        enterMaterialization?.();
        await materializationRelease;
      }
    });
    const updateService = createService(store, root, materializeUserHomes);
    const deleteService = createService(store, root, materializeUserHomes);
    const preview = await updateService.previewUpdatePackage(
      ownerActor(),
      CAPABILITY_ID,
      {
        source: {
          kind: "manual_skill",
          name: "reports",
          skillMarkdown: "# Updated before delete",
        },
        requestedType: "skill",
      },
    );

    const update = updateService.confirmCapabilityImport(
      ownerActor(),
      preview.preview_token,
    );
    await materializationEntered;
    const deletion = deleteService.delete(ownerActor(), CAPABILITY_ID);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(store.capabilities).toHaveLength(1);
    expect(await readFile(join(currentPath, "SKILL.md"), "utf8")).toContain(
      "# Updated before delete",
    );

    releaseMaterialization?.();
    await update;
    await deletion;

    expect(store.capabilities).toEqual([]);
    await expect(
      readFile(join(currentPath, "SKILL.md"), "utf8"),
    ).rejects.toBeDefined();
    expect(materializeUserHomes).toHaveBeenCalledTimes(2);
  });

  it("does not recreate an empty capability directory when concurrent deletes serialize", async () => {
    const root = await tempRoot();
    const capabilityPath = join(root, "capabilities", CAPABILITY_ID);
    const currentPath = join(capabilityPath, "current");
    await mkdir(currentPath, { recursive: true });
    await writeFile(join(currentPath, "SKILL.md"), "# Initial instructions");
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({ type: "skill", storagePath: currentPath }),
    );

    let enterFirstDatabaseLock: (() => void) | undefined;
    const firstDatabaseLockEntered = new Promise<void>((resolve) => {
      enterFirstDatabaseLock = resolve;
    });
    let releaseFirstDatabaseLock: (() => void) | undefined;
    const firstDatabaseLockRelease = new Promise<void>((resolve) => {
      releaseFirstDatabaseLock = resolve;
    });
    let databaseLockCalls = 0;
    const databaseLock = vi
      .spyOn(store, "lockCapability")
      .mockImplementation(async () => {
        databaseLockCalls += 1;
        if (databaseLockCalls === 1) {
          enterFirstDatabaseLock?.();
          await firstDatabaseLockRelease;
        }
      });
    const firstService = createService(store, root);
    const secondService = createService(store, root);

    const firstDeletion = firstService.delete(ownerActor(), CAPABILITY_ID);
    await firstDatabaseLockEntered;
    const secondDeletion = expect(
      secondService.delete(ownerActor(), CAPABILITY_ID),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(databaseLock).toHaveBeenCalledTimes(1);

    releaseFirstDatabaseLock?.();
    await Promise.all([firstDeletion, secondDeletion]);

    expect(databaseLock).toHaveBeenCalledTimes(2);
    await expect(lstat(capabilityPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("materializes the user's HOME after confirmed install, update, and uninstall", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const materializeUserHomes = vi.fn<MaterializeUserHomes>(
      async () => undefined,
    );
    const service = createService(store, root, materializeUserHomes);

    const installPreview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "home-sync",
        skillMarkdown: "# First instructions",
      },
      requestedType: "skill",
    });
    await service.confirmCapabilityImport(
      ownerActor(),
      installPreview.preview_token,
    );
    const capabilityId = store.capabilities[0]?.id;
    if (capabilityId === undefined)
      throw new Error("capability was not installed");

    const updatePreview = await service.previewUpdatePackage(
      ownerActor(),
      capabilityId,
      {
        source: {
          kind: "manual_skill",
          name: "home-sync",
          skillMarkdown: "# Updated instructions",
        },
        requestedType: "skill",
      },
    );
    await service.confirmCapabilityImport(
      ownerActor(),
      updatePreview.preview_token,
    );
    await service.delete(ownerActor(), capabilityId);

    expect(materializeUserHomes).toHaveBeenCalledTimes(3);
    for (const call of materializeUserHomes.mock.calls) {
      expect(call[0]).toEqual({
        userIds: [OWNER_ID],
      });
    }
  });

  it("keeps marketplace install counts cumulative across updates and uninstalls", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const listingId = "30000000-0000-4000-8000-000000000001";
    const installPackage = async (directoryName: string, releaseId: string) => {
      const packageRoot = join(root, directoryName);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "plugin.json"), "{}");
      return {
        listingId,
        releaseId,
        packageRoot,
        type: "plugin" as const,
        name: "cumulative-installs",
        description: "Cumulative marketplace installs",
        manifest: { name: "cumulative-installs" },
        riskSummary: {
          contains_mcp_server: false,
          contains_scripts: false,
          contains_external_connections: false,
          requires_environment_variables: false,
          requires_credentials: false,
          contains_dependency_download_commands: false,
          declared_environment_keys: [],
          mcp_environment_references: [],
          dependency_commands: [],
        },
        logo: null,
      };
    };

    const installed = await service.installMarketplaceRelease(
      ownerActor(),
      await installPackage(
        "marketplace-install-1",
        "40000000-0000-4000-8000-000000000001",
      ),
    );
    expect(store.marketplaceInstallCounts.get(listingId)).toBe(1);

    await service.updateMarketplaceRelease(
      ownerActor(),
      installed.id,
      await installPackage(
        "marketplace-update",
        "40000000-0000-4000-8000-000000000002",
      ),
    );
    expect(store.marketplaceInstallCounts.get(listingId)).toBe(1);

    await service.delete(ownerActor(), installed.id);
    expect(store.marketplaceInstallCounts.get(listingId)).toBe(1);

    await service.installMarketplaceRelease(
      ownerActor(),
      await installPackage(
        "marketplace-install-2",
        "40000000-0000-4000-8000-000000000002",
      ),
    );
    expect(store.marketplaceInstallCounts.get(listingId)).toBe(2);
  });

  it("returns a stable partial-commit error and audit when install or update HOME synchronization fails", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const materializeUserHomes = vi.fn<MaterializeUserHomes>(async () => {
      throw new Error("user HOME is unavailable");
    });
    const service = createService(store, root, materializeUserHomes);
    const installPreview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "partial-home-sync",
        description: "Installed",
        skillMarkdown: "# Installed source",
      },
      requestedType: "skill",
    });

    await expect(
      service.confirmCapabilityImport(
        ownerActor(),
        installPreview.preview_token,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_HOME_SYNC_FAILED" });

    const installed = store.capabilities[0];
    if (installed === undefined)
      throw new Error("missing committed capability");
    expect(installed.description).toBe("Installed");
    expect(
      await readFile(join(installed.storagePath, "SKILL.md"), "utf8"),
    ).toContain("# Installed source");

    const updatePreview = await service.previewUpdatePackage(
      ownerActor(),
      installed.id,
      {
        source: {
          kind: "manual_skill",
          name: "partial-home-sync",
          description: "Updated",
          skillMarkdown: "# Updated source",
        },
        requestedType: "skill",
      },
    );
    await expect(
      service.confirmCapabilityImport(
        ownerActor(),
        updatePreview.preview_token,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_HOME_SYNC_FAILED" });

    expect(store.capabilities[0]?.description).toBe("Updated");
    expect(
      await readFile(join(installed.storagePath, "SKILL.md"), "utf8"),
    ).toContain("# Updated source");
    expect(
      store.audits.filter(
        (entry) => entry.action === "capability_home_sync_failed",
      ),
    ).toEqual([
      expect.objectContaining({
        targetId: installed.id,
        result: "failure",
        metadata: expect.objectContaining({
          operation: "install",
          error_code: "CAPABILITY_HOME_SYNC_FAILED",
          recovery: "next_turn_preflight",
        }),
      }),
      expect.objectContaining({
        targetId: installed.id,
        result: "failure",
        metadata: expect.objectContaining({
          operation: "update",
          error_code: "CAPABILITY_HOME_SYNC_FAILED",
          recovery: "next_turn_preflight",
        }),
      }),
    ]);
    expect(
      store.audits.some((entry) =>
        ["capability_install_failed", "capability_update_failed"].includes(
          entry.action,
        ),
      ),
    ).toBe(false);
  });

  it("materializes only the owner after preference and status changes", async () => {
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability());
    const materializeUserHomes = vi.fn<MaterializeUserHomes>(
      async () => undefined,
    );
    const service = createService(
      store,
      await tempRoot(),
      materializeUserHomes,
    );

    await service.setPreference(ownerActor(), CAPABILITY_ID, "disabled");
    await service.patch(ownerActor(), CAPABILITY_ID, { status: "disabled" });

    expect(materializeUserHomes.mock.calls.map(([targets]) => targets)).toEqual(
      [{ userIds: [OWNER_ID] }, { userIds: [OWNER_ID] }],
    );
  });

  it("rejects a personal Skill name that duplicates the owner's Skill", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({
        id: "20000000-0000-4000-8000-000000000021",
        type: "skill",
        name: "personal-reports",
        slug: "personal-reports",
        status: "disabled",
      }),
    );
    const service = createService(store, root);

    await expect(
      service.previewImportCapability(ownerActor(), {
        source: {
          kind: "manual_skill",
          name: "personal-reports",
          skillMarkdown: "# Duplicate",
        },
        requestedType: "skill",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("permits the same personal Skill name for different owners", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({
        id: "20000000-0000-4000-8000-000000000024",
        type: "skill",
        ownerId: OTHER_ID,
        installedBy: OTHER_ID,
        name: "private-presentations",
        slug: "private-presentations",
      }),
    );
    const service = createService(store, root);

    await expect(
      service.previewImportCapability(adminActor(), {
        source: {
          kind: "manual_skill",
          name: "private-presentations",
          skillMarkdown: "# Administrator-owned Skill",
        },
        requestedType: "skill",
      }),
    ).resolves.toMatchObject({ name: "private-presentations" });

    await expect(
      service.previewImportCapability(ownerActor(), {
        source: {
          kind: "manual_skill",
          name: "private-presentations",
          skillMarkdown: "# Owner-specific Skill",
        },
        requestedType: "skill",
      }),
    ).resolves.toMatchObject({ name: "private-presentations" });
  });

  it("rechecks Skill name uniqueness during confirmation", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const preview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "late-conflict",
        skillMarkdown: "# Initially available",
      },
      requestedType: "skill",
    });
    store.capabilities.push(
      capability({
        id: "20000000-0000-4000-8000-000000000025",
        type: "skill",
        name: "late-conflict",
        slug: "late-conflict",
      }),
    );

    await expect(
      service.confirmCapabilityImport(ownerActor(), preview.preview_token),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.capabilities).toHaveLength(1);
  });

  it("reports a failed Skill registry lock as an import failure instead of a name conflict", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    vi.spyOn(store, "lockSkillNameRegistry").mockRejectedValue(
      new Error("advisory lock execution failed"),
    );
    const service = createService(store, root);
    const preview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "lock-failure",
        skillMarkdown: "# Registry lock failure",
      },
      requestedType: "skill",
    });

    await expect(
      service.confirmCapabilityImport(ownerActor(), preview.preview_token),
    ).rejects.toMatchObject({ code: "IMPORT_FAILED" });
    expect(store.capabilities).toEqual([]);
  });

  it("rejects package updates that rename a Skill", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({ type: "skill", name: "reports", slug: "reports" }),
      capability({
        id: "20000000-0000-4000-8000-000000000026",
        type: "skill",
        name: "occupied-name",
        slug: "occupied-name",
      }),
    );
    const service = createService(store, root);

    await expect(
      service.previewUpdatePackage(ownerActor(), CAPABILITY_ID, {
        source: {
          kind: "manual_skill",
          name: "occupied-name",
          skillMarkdown: "# Replacement",
        },
        requestedType: "skill",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires Skill renames to arrive through a validated package update", async () => {
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({ type: "skill", name: "reports", slug: "reports" }),
    );
    const service = createService(store, await tempRoot());

    await expect(
      service.patch(ownerActor(), CAPABILITY_ID, { name: "renamed-reports" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.patch(ownerActor(), CAPABILITY_ID, { description: "Updated" }),
    ).resolves.toMatchObject({ name: "reports", description: "Updated" });
  });

  it("hard-deletes dependent preferences and bindings while preserving permanent audit", async () => {
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability());
    store.preferences.push(preference());
    store.bindingCapabilityIds.push(CAPABILITY_ID);
    const service = createService(store, await tempRoot());

    await service.delete(ownerActor(), CAPABILITY_ID);

    expect(store.capabilities).toEqual([]);
    expect(store.preferences).toEqual([]);
    expect(store.bindingCapabilityIds).toEqual([]);
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        action: "capability_deleted",
        targetId: CAPABILITY_ID,
      }),
    );
  });

  it("replaces and deletes Logos through object-storage cleanup without exposing object keys", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({ logoObjectKey: "capabilities/old.png" }),
    );
    const uploaded: string[] = [];
    const queuedForRemoval: string[] = [];
    const service = new CapabilityService({
      store,
      importer: new CapabilityPackageImporter({
        stagingRoot: join(root, "staging"),
      }),
      capabilityRoot: join(root, "capabilities"),
      logoStore: {
        async put(objectKey) {
          uploaded.push(objectKey);
        },
        async remove(objectKey) {
          queuedForRemoval.push(objectKey);
        },
        async presignGet(objectKey) {
          return "https://objects.example/" + encodeURIComponent(objectKey);
        },
        async enqueueRemoval(objectKey) {
          queuedForRemoval.push(objectKey);
        },
      },
    });

    const view = await service.replaceLogo(
      ownerActor(),
      CAPABILITY_ID,
      ONE_PIXEL_PNG,
      "new.png",
    );

    expect(uploaded).toHaveLength(1);
    expect(queuedForRemoval).toContain("capabilities/old.png");
    expect(view.has_logo).toBe(true);
    expect(view.logo_url).toMatch(/^https:\/\/objects\.example\//u);
    expect(JSON.stringify(view)).not.toContain(uploaded[0]);

    await service.delete(ownerActor(), CAPABILITY_ID);
    expect(queuedForRemoval).toContain(uploaded[0]);
  });

  it("keeps a validated imported Logo staged until confirmation and then stores it in object storage", async () => {
    const root = await tempRoot();
    const stagingDirectory = join(root, "import-source");
    const packageRoot = join(stagingDirectory, "remote-tools");
    await mkdir(join(packageRoot, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(packageRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "remote-tools" }),
    );
    const prepared: PreparedCapabilityPackage = {
      stagingDirectory,
      packageRoot,
      type: "plugin",
      name: "remote-tools",
      description: "Remote organization tools",
      manifest: { name: "remote-tools", version: "1.0.0" },
      riskSummary: {
        contains_mcp_server: true,
        contains_scripts: false,
        contains_external_connections: true,
        requires_environment_variables: true,
        requires_credentials: true,
        contains_dependency_download_commands: false,
        declared_environment_keys: ["SERVICE_API_KEY"],
        mcp_environment_references: [
          {
            mcp_server: "service",
            env_key: "SERVICE_API_KEY",
            source: "local",
            usage: "stdio_env_var",
            http_header: null,
          },
        ],
        dependency_commands: [],
        supply_chain_review: await scanCapabilitySupplyChain(packageRoot),
      },
      logo: {
        bytes: ONE_PIXEL_PNG,
        filename: "team-logo.png",
        contentType: "image/png",
      },
    };
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    vi.spyOn(importer, "prepare").mockResolvedValue(prepared);
    const store = new MemoryCapabilityStore();
    const uploaded: string[] = [];
    const service = new CapabilityService({
      store,
      importer,
      capabilityRoot: join(root, "capabilities"),
      logoStore: {
        async put(objectKey) {
          uploaded.push(objectKey);
        },
        async remove() {},
        async presignGet(objectKey) {
          return "https://objects.example/" + encodeURIComponent(objectKey);
        },
      },
      now: () => FIXED_DATE,
    });
    const sourceFilename = "remote-tools.zip";

    const preview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "zip",
        bytes: Buffer.from("validated archive"),
        filename: sourceFilename,
      },
      requestedType: "plugin",
    });

    expect(preview).toMatchObject({
      source: {
        source_type: "local",
        import_kind: "zip",
        source_url: null,
        filename: sourceFilename,
      },
      manifest: { name: "remote-tools", version: "1.0.0" },
      declared_capabilities: [
        "mcp_server",
        "external_connections",
        "environment_variables",
        "credentials",
      ],
      declared_environment_keys: ["SERVICE_API_KEY"],
      has_logo: true,
    });
    expect(store.capabilities).toEqual([]);
    expect(uploaded).toEqual([]);

    const installed = await service.confirmCapabilityImport(
      ownerActor(),
      preview.preview_token,
    );

    expect(installed.has_logo).toBe(true);
    expect(installed.logo_url).toMatch(/^https:\/\/objects\.example\//u);
    expect(uploaded).toHaveLength(1);
    expect(store.capabilities[0]?.logoObjectKey).toBe(uploaded[0]);
    expect(store.capabilities[0]?.logoObjectKey).not.toContain(sourceFilename);
  });

  it("returns a ZIP Skill body without persisting it in preview metadata or the manifest", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const skillBody = [
      "# PPTX Skill",
      "",
      "Create and edit presentations from the supplied files.",
      "",
      "",
    ].join("\n");
    const archive = createStoredZip([
      {
        path: "pptx/SKILL.md",
        bytes: [
          "---",
          "name: pptx",
          "description: Presentation tools",
          "---",
          "",
          skillBody,
        ].join("\n"),
      },
    ]);

    const preview = await service.previewImportCapability(ownerActor(), {
      source: { kind: "zip", bytes: archive, filename: "pptx.zip" },
      requestedType: "skill",
    });

    expect(preview.skill_content_preview).toBe(skillBody);
    expect(preview.skill_content_preview?.startsWith("# PPTX Skill")).toBe(
      true,
    );
    expect(preview.skill_content_preview).toContain("Skill\n\nCreate");
    expect(preview.skill_content_preview?.endsWith("\n\n")).toBe(true);
    expect(preview.skill_content_truncated).toBe(false);
    const readyState = await readFile(
      join(
        root,
        "capabilities",
        ".previews",
        preview.preview_token,
        "ready.json",
      ),
      "utf8",
    );
    expect(readyState).not.toContain("skill_content_preview");
    expect(readyState).not.toContain(skillBody);

    await service.confirmCapabilityImport(ownerActor(), preview.preview_token);
    expect(store.capabilities[0]?.manifestJson).not.toHaveProperty(
      "skill_content_preview",
    );
    expect(JSON.stringify(store.capabilities[0]?.manifestJson)).not.toContain(
      skillBody,
    );
  });

  it("truncates a Skill body at 100000 Unicode code points without splitting a surrogate pair", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const retainedBody = "a".repeat(99_999) + "😀";
    const archive = createStoredZip([
      {
        path: "unicode-preview/SKILL.md",
        bytes: ["---", "name: unicode-preview", "---", retainedBody + "Z"].join(
          "\n",
        ),
      },
    ]);

    const preview = await service.previewImportCapability(ownerActor(), {
      source: { kind: "zip", bytes: archive, filename: "unicode.zip" },
      requestedType: "skill",
    });

    expect(preview.skill_content_truncated).toBe(true);
    expect(preview.skill_content_preview).toBe(retainedBody);
    expect(Array.from(preview.skill_content_preview ?? "")).toHaveLength(
      100_000,
    );
    expect(preview.skill_content_preview?.endsWith("😀")).toBe(true);
  });

  it("does not return Skill content for a Plugin package", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const archive = createStoredZip([
      {
        path: "presentation-plugin/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "presentation-plugin",
          skills: "./skills",
        }),
      },
      {
        path: "presentation-plugin/skills/pptx/SKILL.md",
        bytes: "---\nname: pptx\n---\n# Nested Skill instructions",
      },
    ]);

    const preview = await service.previewImportCapability(ownerActor(), {
      source: { kind: "zip", bytes: archive, filename: "plugin.zip" },
      requestedType: "plugin",
    });

    expect(preview.skill_content_preview).toBeNull();
    expect(preview.skill_content_truncated).toBe(false);
  });

  it("refuses confirmation when staged content no longer matches the reviewed preview", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const preview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "reviewed-skill",
        skillMarkdown: "# Reviewed instructions",
      },
      requestedType: "skill",
    });
    await writeFile(
      join(
        root,
        "capabilities",
        ".previews",
        preview.preview_token,
        "package",
        "SKILL.md",
      ),
      "---\nname: tampered\n---\n# Different instructions",
    );

    await expect(
      service.confirmCapabilityImport(ownerActor(), preview.preview_token),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
    expect(store.capabilities).toEqual([]);
  });

  it("binds a preview token to its creator without consuming it on another user's attempt", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const preview = await service.previewImportCapability(ownerActor(), {
      source: {
        kind: "manual_skill",
        name: "owner-only-preview",
        skillMarkdown: "# Owner instructions",
      },
      requestedType: "skill",
    });

    await expect(
      service.confirmCapabilityImport(recipientActor(), preview.preview_token),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(store.capabilities).toEqual([]);

    await expect(
      service.confirmCapabilityImport(ownerActor(), preview.preview_token),
    ).resolves.toMatchObject({ name: "owner-only-preview" });
  });
});

describe("capabilityRoutes", () => {
  it("rejects built-in list identifiers before any capability mutation", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability());
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => ownerActor(),
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/capabilities/builtin:capability:linksense-browser",
    });

    expect(response.statusCode).toBe(400);
    expect(store.capabilities).toHaveLength(1);
    await app.close();
  });

  it("previews a manual Skill and activates it only after explicit confirmation", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => ownerActor(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities",
      payload: {
        source_type: "local",
        type: "skill",
        name: "lesson-planner",
        skill_markdown: "# Plan lessons",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        type: "skill",
        name: "lesson-planner",
        operation: "install",
        source: {
          source_type: "local",
          import_kind: "manual_skill",
        },
        manifest: {
          name: "lesson-planner",
          format: "SKILL.md",
        },
        declared_capabilities: [],
        declared_environment_keys: [],
        risk_summary: {
          contains_mcp_server: false,
          contains_scripts: false,
          supply_chain_review: {
            scanner_version: capabilitySupplyChainScannerVersion,
            ruleset_version: capabilitySupplyChainRulesetVersion,
            verdict: "passed",
            finding_count: 0,
            findings: [],
          },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("storage");
    expect(JSON.stringify(body)).not.toContain("object_key");
    expect(store.capabilities).toEqual([]);

    const confirmResponse = await app.inject({
      method: "POST",
      url:
        "/api/v1/capabilities/imports/" +
        String(body.data.preview_token) +
        "/confirm",
    });

    expect(confirmResponse.statusCode).toBe(201);
    expect(confirmResponse.json()).toMatchObject({
      success: true,
      data: {
        type: "skill",
        name: "lesson-planner",
        can_manage: true,
        can_govern: false,
      },
    });
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        action: "capability_installed",
        metadata: expect.objectContaining({
          security_scanner_version: capabilitySupplyChainScannerVersion,
          security_ruleset_version: capabilitySupplyChainRulesetVersion,
          security_content_sha256:
            body.data.risk_summary.supply_chain_review.content_sha256,
          security_verdict: "passed",
        }),
      }),
    );

    const installed = confirmResponse.json().data as { id: string };
    const contentResponse = await app.inject({
      method: "GET",
      url: `/api/v1/capabilities/${installed.id}/skill-content`,
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.json()).toMatchObject({
      success: true,
      data: { content: "# Plan lessons" },
    });

    const repeatedConfirm = await app.inject({
      method: "POST",
      url:
        "/api/v1/capabilities/imports/" +
        String(body.data.preview_token) +
        "/confirm",
    });
    expect(repeatedConfirm.statusCode).toBe(404);
    await app.close();
  });

  it("returns deterministic findings and blocks confirmation for critical content", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => ownerActor(),
    });

    const token = `github_pat_${"A".repeat(30)}`;
    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities",
      payload: {
        source_type: "local",
        type: "skill",
        name: "unsafe-skill",
        skill_markdown: `# Instructions\n\nUse ${token}`,
      },
    });

    expect(previewResponse.statusCode).toBe(202);
    const previewBody = previewResponse.json();
    expect(previewBody.data.risk_summary.supply_chain_review).toMatchObject({
      scanner_version: capabilitySupplyChainScannerVersion,
      ruleset_version: capabilitySupplyChainRulesetVersion,
      verdict: "blocked",
      highest_severity: "critical",
      finding_count: 1,
      findings: [
        {
          rule_id: "embedded_access_token",
          severity: "critical",
          path: "SKILL.md",
        },
      ],
    });
    expect(
      JSON.stringify(previewBody.data.risk_summary.supply_chain_review),
    ).not.toContain(token);

    const confirmResponse = await app.inject({
      method: "POST",
      url:
        "/api/v1/capabilities/imports/" +
        String(previewBody.data.preview_token) +
        "/confirm",
    });

    expect(confirmResponse.statusCode).toBe(400);
    expect(confirmResponse.json()).toMatchObject({
      success: false,
      error_code: "INVALID_PACKAGE",
      params: {
        reason_code: "security_review_blocked",
        finding_count: 1,
      },
    });
    expect(store.capabilities).toEqual([]);
    await app.close();
  });

  it("rejects URL package imports for both creation and updates", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability());
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => ownerActor(),
    });
    const payload = {
      source_type: "url",
      source_url: "https://packages.example/remote-tools.zip",
      type: "plugin",
    };

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities",
      payload,
    });
    const updateResponse = await app.inject({
      method: "POST",
      url: `/api/v1/capabilities/${CAPABILITY_ID}/import`,
      payload,
    });

    expect(createResponse.statusCode).toBe(400);
    expect(updateResponse.statusCode).toBe(400);
    expect(store.capabilities).toHaveLength(1);
    await app.close();
  });

  it("does not expose capability sharing routes or received views", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(capability());
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => ownerActor(),
    });

    const share = await app.inject({
      method: "POST",
      url: `/api/v1/capabilities/${CAPABILITY_ID}/share`,
      payload: { target_type: "user", user_id: RECIPIENT_ID },
    });
    const directGrants = await app.inject({
      method: "GET",
      url: `/api/v1/capabilities/${CAPABILITY_ID}/direct-grants`,
    });
    const received = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities?view=received",
    });

    expect(share.statusCode).toBe(404);
    expect(directGrants.statusCode).toBe(404);
    expect(received.statusCode).toBe(400);
    await app.close();
  });

  it("keeps the personal capability route user-scoped for administrators", async () => {
    const root = await tempRoot();
    const store = new MemoryCapabilityStore();
    store.capabilities.push(
      capability({
        ownerId: ADMIN_ID,
        installedBy: ADMIN_ID,
      }),
    );
    const service = createService(store, root);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(capabilityRoutes, {
      prefix: "/api/v1/capabilities",
      service,
      resolveActor: () => adminActor(),
    });

    const managed = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities?view=managed",
    });
    expect(managed.statusCode).toBe(200);
    const managedBody = managed.json<{
      success: boolean;
      data: {
        items: Array<{ id: string; is_owner: boolean; is_builtin: boolean }>;
      };
    }>();
    expect(managedBody.success).toBe(true);
    expect(managedBody.data.items.filter((item) => !item.is_builtin)).toEqual([
      expect.objectContaining({ id: CAPABILITY_ID, is_owner: true }),
    ]);

    const adminScope = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities?view=managed&management_scope=admin",
    });
    expect(adminScope.statusCode).toBe(400);

    const assignable = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities?view=assignable",
    });
    expect(assignable.statusCode).toBe(400);

    const disable = await app.inject({
      method: "PATCH",
      url: "/api/v1/capabilities/" + CAPABILITY_ID,
      payload: { status: "disabled" },
    });
    expect(disable.statusCode).toBe(200);
    expect(store.capabilities[0]?.status).toBe("disabled");

    const removedScopeInstall = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities",
      payload: {
        source_type: "local",
        type: "skill",
        name: "admin-store-skill",
        skill_markdown: "# Instructions",
        scope: "global",
      },
    });
    expect(removedScopeInstall.statusCode).toBe(400);
    expect(store.capabilities).toHaveLength(1);
    await app.close();
  });
});

function createService(
  store: MemoryCapabilityStore,
  root: string,
  materializeUserHomes?: ConstructorParameters<
    typeof CapabilityService
  >[0]["materializeUserHomes"],
  validateClawHubInstall: NonNullable<
    ConstructorParameters<
      typeof CapabilityService
    >[0]["validateClawHubInstall"]
  > = async () => undefined,
  managedBrowserEnabled = true,
) {
  return new CapabilityService({
    store,
    importer: new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    }),
    capabilityRoot: join(root, "capabilities"),
    ...(materializeUserHomes ? { materializeUserHomes } : {}),
    validateClawHubInstall,
    managedBrowserEnabled,
    now: () => FIXED_DATE,
  });
}

async function tempRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "linksense-capability-service-"));
  temporaryDirectories.push(value);
  return value;
}

function ownerActor(): RequestActor {
  return { id: OWNER_ID, role: "user", status: "active" };
}

function recipientActor(): RequestActor {
  return { id: RECIPIENT_ID, role: "user", status: "active" };
}

function adminActor(): RequestActor {
  return { id: ADMIN_ID, role: "admin", status: "active" };
}

function capability(
  overrides: Partial<CapabilityRecord> = {},
): CapabilityRecord {
  return {
    id: CAPABILITY_ID,
    type: "plugin",
    ownerId: OWNER_ID,
    name: "reports",
    slug: "reports",
    description: null,
    sourceType: "local",
    marketplaceListingId: null,
    marketplaceReleaseId: null,
    logoObjectKey: null,
    storagePath: "/private/capabilities/reports/current",
    manifestJson: { name: "reports" },
    riskSummaryJson: { declared_environment_keys: [] },
    status: "active",
    installedBy: OWNER_ID,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function preference(): CapabilityPreferenceRecord {
  return {
    id: "preference-1",
    userId: OWNER_ID,
    capabilityId: CAPABILITY_ID,
    status: "disabled",
    disabledAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
}

class MemoryCapabilityStore implements CapabilityStore {
  capabilities: CapabilityRecord[] = [];
  preferences: CapabilityPreferenceRecord[] = [];
  audits: CapabilityAuditInput[] = [];
  bindingCapabilityIds: string[] = [];
  marketplaceInstallCounts = new Map<string, number>();
  clawHubInstallations: CreateClawHubInstallationInput[] = [];
  next = 1;

  transaction<T>(work: (store: CapabilityStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lockCapability(): Promise<void> {
    // In-memory tests execute transactions serially.
  }

  async lockSkillNameRegistry(): Promise<void> {
    // In-memory tests execute transactions serially.
  }

  async findCapability(id: string) {
    return this.capabilities.find((item) => item.id === id) ?? null;
  }

  async listCapabilities() {
    return [...this.capabilities];
  }

  async createCapability(input: CreateCapabilityRecordInput) {
    const record: CapabilityRecord = {
      ...input,
      riskSummaryJson: { ...input.riskSummaryJson },
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    };
    this.capabilities.push(record);
    return record;
  }

  async updateCapability(id: string, input: UpdateCapabilityRecordInput) {
    const record = await this.findCapability(id);
    if (!record) throw new Error("missing capability");
    Object.assign(record, input, { updatedAt: FIXED_DATE });
    return record;
  }

  async recordMarketplaceInstall(listingId: string) {
    this.marketplaceInstallCounts.set(
      listingId,
      (this.marketplaceInstallCounts.get(listingId) ?? 0) + 1,
    );
  }

  async createClawHubInstallation(input: CreateClawHubInstallationInput) {
    this.clawHubInstallations.push(input);
  }

  async deleteCapabilityGraph(id: string) {
    this.capabilities = this.capabilities.filter((item) => item.id !== id);
    this.preferences = this.preferences.filter(
      (item) => item.capabilityId !== id,
    );
    this.bindingCapabilityIds = this.bindingCapabilityIds.filter(
      (item) => item !== id,
    );
    this.clawHubInstallations = this.clawHubInstallations.filter(
      (item) => item.capabilityId !== id,
    );
  }

  async listPreferences(userId: string) {
    return this.preferences.filter((item) => item.userId === userId);
  }

  async upsertPreference(
    userId: string,
    capabilityId: string,
    status: CapabilityPreferenceRecord["status"],
    disabledAt: Date | null,
  ) {
    let record = this.preferences.find(
      (item) => item.userId === userId && item.capabilityId === capabilityId,
    );
    if (!record) {
      record = {
        id: "preference-" + this.next++,
        userId,
        capabilityId,
        status,
        disabledAt,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      };
      this.preferences.push(record);
    } else {
      record.status = status;
      record.disabledAt = disabledAt;
      record.updatedAt = FIXED_DATE;
    }
    return record;
  }

  async writeAudit(input: CapabilityAuditInput) {
    this.audits.push(input);
  }
}

interface ZipEntry {
  path: string;
  bytes: string | Buffer;
}

function createStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const bytes = Buffer.isBuffer(entry.bytes)
      ? entry.bytes
      : Buffer.from(entry.bytes, "utf8");
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, bytes);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
