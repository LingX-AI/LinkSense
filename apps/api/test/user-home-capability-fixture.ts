import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { type UserHomeCapabilityInput } from "../src/modules/capabilities/user-home-materializer.js"

const OWNER_ID = "11111111-1111-4111-8111-111111111111"
const PLUGIN_ID = "22222222-2222-4222-8222-222222222222"
const SKILL_ID = "33333333-3333-4333-8333-333333333333"
const CREDENTIAL_SOURCE =
  "LINKSENSE_CREDENTIAL_0123456789ABCDEF0123456789ABCDEF"
const SECOND_CREDENTIAL_SOURCE =
  "LINKSENSE_CREDENTIAL_FEDCBA9876543210FEDCBA9876543210"

async function createPluginSource(
  parent: string,
  name: string,
  body: string,
): Promise<string> {
  const root = join(parent, name)
  await mkdir(join(root, ".codex-plugin"), { recursive: true })
  await writeFile(
    join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      mcpServers: {
        calendar: {
          command: "node",
          args: ["server.js"],
          env_vars: ["API_KEY"],
          env: {
            API_KEY: "static-default",
            UNRELATED: "kept",
          },
        },
      },
    }),
  )
  await writeFile(join(root, "README.md"), body)
  return root
}

async function createSkillSource(
  parent: string,
  name: string,
  body: string,
): Promise<string> {
  const root = join(parent, name)
  await mkdir(root, { recursive: true })
  await writeFile(
    join(root, "SKILL.md"),
    `---\nname: ${name}\n---\n\n${body}\n`,
  )
  return root
}

function pluginCapability(
  sourcePath: string,
  credentialEnvironment?: Record<string, string>,
): UserHomeCapabilityInput {
  return {
    id: PLUGIN_ID,
    name: "calendar-tools",
    type: "plugin",
    sourcePath,
    revision: "same-revision",
    ...(credentialEnvironment ? { credentialEnvironment } : {}),
  }
}

function skillCapability(sourcePath: string): UserHomeCapabilityInput {
  return {
    id: SKILL_ID,
    name: "report-writer",
    type: "skill",
    sourcePath,
    revision: "skill-revision",
  }
}

async function pathMode(target: string): Promise<number> {
  return (await lstat(target)).mode & 0o7777
}

function useCapabilityFilesystem(): { temporaryDirectory: () => Promise<string> } {
  const directories: string[] = []
  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })
  return {
    temporaryDirectory: async (): Promise<string> => {
      const directory = await mkdtemp(
        join(tmpdir(), "linksense-user-capabilities-"),
      )
      directories.push(directory)
      return directory
    },
  }
}

export {
  CREDENTIAL_SOURCE,
  OWNER_ID,
  PLUGIN_ID,
  SECOND_CREDENTIAL_SOURCE,
  SKILL_ID,
  createPluginSource,
  createSkillSource,
  pathMode,
  pluginCapability,
  skillCapability,
  useCapabilityFilesystem,
}
