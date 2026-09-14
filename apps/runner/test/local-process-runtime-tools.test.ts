import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import { prepareLocalProcessRuntimeTools } from "../src/controller/local-process-runtime-tools.js"
import { encodePersonalStdioDescriptor } from "../src/mcp/personal-stdio-launcher.js"
import { probePersonalStdioMcp } from "../src/mcp/personal-stdio-probe.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("local-process runtime tools", () => {
  it("starts a credential-bound STDIO plugin through the host launcher", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-local-runtime-tools-"),
    )
    temporaryRoots.push(root)
    const personalStdioLauncher = fileURLToPath(
      new URL(
        "../src/mcp/personal-stdio-launcher.ts",
        import.meta.url,
      ),
    )
    const tsxCli = fileURLToPath(
      new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url),
    )
    const runtimeToolBin = await prepareLocalProcessRuntimeTools({
      root,
      launcherCommand: process.execPath,
      launcherArgs: [tsxCli, personalStdioLauncher],
    })
    const fixture = fileURLToPath(
      new URL("./fixtures/personal-stdio-server.mjs", import.meta.url),
    )
    const source =
      "LINKSENSE_CREDENTIAL_11111111111111111111111111111111"
    const descriptor = encodePersonalStdioDescriptor({
      version: 1,
      command: process.execPath,
      args: [fixture],
      environmentVariables: [
        { name: "LINKSENSE_TEST_VALUE", source },
      ],
    })

    await expect(
      probePersonalStdioMcp({
        command: "linksense-plugin-stdio",
        args: [descriptor],
        environment: { [source]: "expected" },
        runtimeEnvironment: {
          HOME: root,
          PATH: [runtimeToolBin, process.env.PATH ?? "/usr/bin:/bin"].join(
            path.delimiter,
          ),
        },
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      serverName: "linksense-personal-stdio-fixture",
      toolCount: 1,
    })
  })
})
