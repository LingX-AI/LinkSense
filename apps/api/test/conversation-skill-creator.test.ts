import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { ConversationSkillCreatorService } from "../src/modules/capabilities/conversation-skill-creator.js"
import type { CapabilityService } from "../src/modules/capabilities/service.js"

const OWNER_ID = "10000000-0000-4000-8000-000000000001"
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const PREVIEW_TOKEN = "30000000-0000-4000-8000-000000000001"
const CAPABILITY_ID = "40000000-0000-4000-8000-000000000001"
const TURN_ID = "codex-turn-1"
const NOW = new Date("2026-07-27T10:00:00.000Z")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("ConversationSkillCreatorService", () => {
  it("previews a task artifact and installs only the signed unchanged preview", async () => {
    const fixture = await createFixture()
    const result = await fixture.service.preview(OWNER_ID, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      workspaceRelativePath: "artifacts/meeting-follow-up.zip",
    })

    expect(result).toMatchObject({
      success: true,
      name: "meeting-follow-up",
      description: "Create structured meeting follow-ups.",
      expires_at: "2026-07-27T10:15:00.000Z",
      risk_summary: { contains_scripts: true },
    })
    expect(result.install_token).not.toContain(PREVIEW_TOKEN)
    expect(fixture.previewImportCapability).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID, status: "active" }),
      {
        source: {
          kind: "zip",
          bytes: Buffer.from("skill-zip"),
          filename: "meeting-follow-up.zip",
        },
        requestedType: "skill",
      },
    )

    await expect(
      fixture.service.confirm(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        installToken: result.install_token,
      }),
    ).rejects.toMatchObject({
      code: "SKILL_CREATOR_CONFIRMATION_REQUIRED",
    })
    expect(fixture.confirmCapabilityImport).not.toHaveBeenCalled()

    await expect(
      fixture.service.confirm(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: "codex-turn-2",
        installToken: result.install_token,
      }),
    ).resolves.toEqual({
      success: true,
      capability_id: CAPABILITY_ID,
      name: "meeting-follow-up",
      source_type: "local",
      status: "active",
      preference_status: "enabled",
    })
    expect(fixture.confirmCapabilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID }),
      PREVIEW_TOKEN,
    )
  })

  it("rejects tampered, cross-owner, and expired install tokens", async () => {
    const fixture = await createFixture()
    const preview = await fixture.service.preview(OWNER_ID, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      workspaceRelativePath: "artifacts/meeting-follow-up.zip",
    })

    await expect(
      fixture.service.confirm(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        installToken: `${preview.install_token.slice(0, -1)}x`,
      }),
    ).rejects.toMatchObject({ code: "SKILL_CREATOR_PREVIEW_INVALID" })
    await expect(
      fixture.service.confirm(OTHER_OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        installToken: preview.install_token,
      }),
    ).rejects.toMatchObject({ code: "SKILL_CREATOR_PREVIEW_INVALID" })

    fixture.now.mockReturnValue(new Date("2026-07-27T10:15:00.001Z"))
    await expect(
      fixture.service.confirm(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        installToken: preview.install_token,
      }),
    ).rejects.toMatchObject({ code: "SKILL_CREATOR_PREVIEW_INVALID" })
    expect(fixture.confirmCapabilityImport).not.toHaveBeenCalled()
  })

  it("accepts only a stable regular ZIP below artifacts for the active turn", async () => {
    const fixture = await createFixture()
    const outside = join(fixture.root, "outside.zip")
    await writeFile(outside, "outside")
    await symlink(outside, join(fixture.artifactsRoot, "linked.zip"))

    await expect(
      fixture.service.preview(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workspaceRelativePath: "artifacts/linked.zip",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: expect.objectContaining({ reason_code: "archive_not_regular_file" }),
    })
    await expect(
      fixture.service.preview(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workspaceRelativePath: "artifacts/../outside.zip",
      }),
    ).rejects.toBeInstanceOf(Error)

    fixture.findTurn.mockResolvedValueOnce(null)
    await expect(
      fixture.service.preview(OWNER_ID, {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workspaceRelativePath: "artifacts/meeting-follow-up.zip",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-conversation-skill-"))
  temporaryDirectories.push(root)
  const artifactsRoot = join(
    root,
    OWNER_ID,
    "home",
    "workspaces",
    CONVERSATION_ID,
    "artifacts",
  )
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(join(artifactsRoot, "meeting-follow-up.zip"), "skill-zip")

  const findUser = vi.fn(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    role: "user" as const,
    status: "active" as const,
  }))
  const findTurn = vi.fn(
    async (): Promise<{ id: string } | null> => ({ id: "turn-row" }),
  )
  const previewImportCapability = vi.fn(async () => previewResult())
  const confirmCapabilityImport = vi.fn(async () => capabilityResult())
  const now = vi.fn(() => NOW)
  const service = new ConversationSkillCreatorService({
    prisma: {
      user: { findUnique: findUser },
      conversationTurn: { findFirst: findTurn },
    } as never,
    capabilities: {
      previewImportCapability,
      confirmCapabilityImport,
    } as unknown as Pick<
      CapabilityService,
      "previewImportCapability" | "confirmCapabilityImport"
    >,
    workspaceRoot: root,
    tokenSecret: "test-skill-creator-secret-material-1234567890",
    now,
  })
  return {
    root,
    artifactsRoot,
    service,
    previewImportCapability,
    confirmCapabilityImport,
    findTurn,
    now,
  }
}

function previewResult() {
  return {
    preview_token: PREVIEW_TOKEN,
    expires_at: "2026-07-27T10:15:00.000Z",
    operation: "install" as const,
    capability_id: null,
    source: {
      source_type: "local" as const,
      import_kind: "zip" as const,
      source_url: null,
      filename: "meeting-follow-up.zip",
    },
    type: "skill" as const,
    name: "meeting-follow-up",
    description: "Create structured meeting follow-ups.",
    manifest: { format: "SKILL.md" },
    declared_capabilities: ["scripts"],
    declared_environment_keys: [],
    risk_summary: {
      contains_mcp_server: false,
      contains_scripts: true,
      contains_external_connections: false,
      requires_environment_variables: false,
      requires_credentials: false,
      contains_dependency_download_commands: false,
      declared_environment_keys: [],
      dependency_commands: [],
    },
    has_logo: false,
    skill_content_preview: "# Meeting Follow-up",
    skill_content_truncated: false,
  }
}

function capabilityResult() {
  return {
    id: CAPABILITY_ID,
    type: "skill" as const,
    name: "meeting-follow-up",
    slug: "meeting-follow-up",
    description: "Create structured meeting follow-ups.",
    source_type: "local" as const,
    marketplace_listing_id: null,
    marketplace_release_id: null,
    status: "active" as const,
    has_logo: false,
    logo_url: null,
    manifest: { format: "SKILL.md" },
    risk_summary: null,
    preference_status: "enabled" as const,
    can_manage: true,
    can_govern: false,
    is_owner: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }
}
