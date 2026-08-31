import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES,
  normalizePersonalStdioCommand,
  personalStdioChildEnvironment,
  personalStdioInvocationEnvironment,
} from "../src/mcp/personal-stdio-launcher.js"
import { probePersonalStdioMcp } from "../src/mcp/personal-stdio-probe.js"

describe("personal STDIO MCP runtime", () => {
  it("normalizes Codex npx syntax to the managed pnpm wrapper", () => {
    expect(
      normalizePersonalStdioCommand("npx", ["-y", "mcp-server-weread"])
    ).toEqual({
      command: "linksense-pnpm",
      args: ["dlx", "mcp-server-weread"],
    })
  })

  it("maps opaque sources to requested child names without retaining sources", () => {
    const source = "LINKSENSE_MCP_STDIO_0123456789ABCDEF0123456789ABCDEF"
    const pluginSource =
      "LINKSENSE_CREDENTIAL_11111111111111111111111111111111"
    const unrelatedPluginSource =
      "LINKSENSE_CREDENTIAL_22222222222222222222222222222222"
    const environment = personalStdioChildEnvironment(
      {
        version: 1,
        command: "node",
        args: ["server.js"],
        environmentVariables: [
          { name: "CC_PASSWORD", source },
          { name: "PLUGIN_TOKEN", source: pluginSource },
        ],
      },
      {
        PATH: "/usr/bin",
        [source]: "secret-value",
        [pluginSource]: "plugin-secret",
        [unrelatedPluginSource]: "must-not-leak",
      }
    )
    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      CC_PASSWORD: "secret-value",
      PLUGIN_TOKEN: "plugin-secret",
    })
    expect(environment[source]).toBeUndefined()
    expect(environment[pluginSource]).toBeUndefined()
    expect(environment[unrelatedPluginSource]).toBeUndefined()

    const invocation = normalizePersonalStdioCommand("npx", [
      "-y",
      "mcp-server-weread",
    ])
    expect(
      personalStdioInvocationEnvironment(
        invocation,
        {
          ...environment,
          [PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES]: "UNTRUSTED_NAME",
        },
        ["CC_PASSWORD"]
      )
    ).toMatchObject({
      CC_PASSWORD: "secret-value",
      [PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES]: "CC_PASSWORD",
    })
  })

  it("performs a real initialize and tools/list exchange over STDIO", async () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/personal-stdio-server.mjs", import.meta.url)
    )
    await expect(
      probePersonalStdioMcp({
        command: process.execPath,
        args: [fixture],
        environment: { LINKSENSE_TEST_VALUE: "expected" },
        runtimeEnvironment: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? path.dirname(fixture),
        },
        timeoutMs: 5_000,
      })
    ).resolves.toMatchObject({
      serverName: "linksense-personal-stdio-fixture",
      protocolVersion: expect.stringMatching(/^20|^DRAFT/u),
      toolCount: 1,
    })
  })
})
