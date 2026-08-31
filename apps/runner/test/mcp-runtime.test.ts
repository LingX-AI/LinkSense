import { describe, expect, it } from "vitest"

import { mcpConfigOverrides } from "../src/process-pool.js"
import { startTurnBodySchema } from "../src/server.js"
import { decodePersonalStdioDescriptor } from "../src/mcp/personal-stdio-launcher.js"

const SERVER_ID = "01900000-0000-7000-8000-000000000088"
const SERVER_KEY = "user_01900000000070008000000000000088"
const CREDENTIAL_SOURCE =
  "LINKSENSE_MCP_CREDENTIAL_0123456789ABCDEF0123456789ABCDEF"

describe("personal MCP runner runtime", () => {
  it("projects native Codex config for Bearer and API Key servers", () => {
    const common = {
      id: SERVER_ID,
      serverKey: SERVER_KEY,
      name: "Issue tracker",
      transport: "streamable_http" as const,
      url: "https://mcp.example.test/mcp",
      revision: "a".repeat(64),
      startupTimeoutSeconds: 12,
      toolTimeoutSeconds: 90,
    }

    expect(
      mcpConfigOverrides([
        {
          ...common,
          credential: { type: "bearer", source: CREDENTIAL_SOURCE },
        },
      ])
    ).toEqual([
      `mcp_servers.${SERVER_KEY}.url="https://mcp.example.test/mcp"`,
      `mcp_servers.${SERVER_KEY}.enabled=true`,
      `mcp_servers.${SERVER_KEY}.required=false`,
      `mcp_servers.${SERVER_KEY}.startup_timeout_sec=12`,
      `mcp_servers.${SERVER_KEY}.tool_timeout_sec=90`,
      `mcp_servers.${SERVER_KEY}.bearer_token_env_var="${CREDENTIAL_SOURCE}"`,
    ])

    expect(
      mcpConfigOverrides([
        {
          ...common,
          credential: {
            type: "api_key",
            headerName: "X-API-Key",
            source: CREDENTIAL_SOURCE,
          },
        },
      ])
    ).toContain(
      `mcp_servers.${SERVER_KEY}.env_http_headers={"X-API-Key"="${CREDENTIAL_SOURCE}"}`
    )
  })

  it("projects STDIO through the managed launcher without placing secrets in argv", () => {
    const environmentSource =
      "LINKSENSE_MCP_STDIO_0123456789ABCDEF0123456789ABCDEF"
    const overrides = mcpConfigOverrides(
      [
        {
          id: SERVER_ID,
          serverKey: SERVER_KEY,
          name: "mcp-server-weread",
          transport: "stdio",
          command: "npx",
          args: ["-y", "mcp-server-weread"],
          revision: "a".repeat(64),
          startupTimeoutSeconds: 30,
          toolTimeoutSeconds: 60,
          environmentVariables: [
            { name: "CC_PASSWORD", source: environmentSource },
          ],
        },
      ],
      {
        command: "/usr/local/bin/node",
        args: ["/app/dist/mcp/personal-stdio-launcher.js"],
        cwd: "/home/linksense/workspaces/task",
      }
    )

    expect(overrides).toContain(
      `mcp_servers.${SERVER_KEY}.env_vars=["${environmentSource}"]`
    )
    expect(overrides).toContain(
      `mcp_servers.${SERVER_KEY}.cwd="/home/linksense/workspaces/task"`
    )
    const argsOverride = overrides.find((entry) =>
      entry.startsWith(`mcp_servers.${SERVER_KEY}.args=`)
    )
    if (!argsOverride) throw new Error("STDIO launcher args were not projected")
    const args = JSON.parse(argsOverride.slice(argsOverride.indexOf("=") + 1))
    expect(decodePersonalStdioDescriptor(args.at(-1))).toEqual({
      version: 1,
      command: "npx",
      args: ["-y", "mcp-server-weread"],
      environmentVariables: [
        { name: "CC_PASSWORD", source: environmentSource },
      ],
    })
    expect(JSON.stringify(overrides)).not.toContain("actual-secret")
  })

  it("accepts public HTTP metadata only when credential sources match exactly", () => {
    const body = startBody()

    expect(startTurnBodySchema.parse(body)).toMatchObject({
      mcpGeneration: "b".repeat(64),
      mcpServers: [{ url: "http://mcp.example.test:8080/mcp" }],
      environment: { [CREDENTIAL_SOURCE]: "runtime-secret" },
    })
    expect(
      startTurnBodySchema.safeParse({ ...body, environment: {} }).success
    ).toBe(false)
    expect(
      startTurnBodySchema.safeParse({
        ...body,
        environment: {
          [CREDENTIAL_SOURCE]: "runtime-secret",
          LINKSENSE_MCP_CREDENTIAL_FEDCBA9876543210FEDCBA9876543210:
            "ambient-secret",
        },
      }).success
    ).toBe(false)
  })

  it("defaults older turn-start payloads to an empty MCP runtime", () => {
    const legacy: Record<string, unknown> = { ...startBody() }
    delete legacy.mcpGeneration
    delete legacy.mcpServers
    const parsed = startTurnBodySchema.parse({ ...legacy, environment: {} })

    expect(parsed.mcpGeneration).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    expect(parsed.mcpServers).toEqual([])
  })
})

function startBody() {
  return {
    ownerId: "01900000-0000-7000-8000-000000000002",
    projectionTurnId: "01900000-0000-7000-8000-000000000099",
    expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
    capabilityGeneration: "a".repeat(64),
    mcpGeneration: "b".repeat(64),
    context: {
      userInput: "Use my issue tracker",
      attachments: [],
      priorityPlugins: [],
      prioritySkills: [],
    },
    capabilities: [],
    mcpServers: [
      {
        id: SERVER_ID,
        serverKey: SERVER_KEY,
        name: "Issue tracker",
        transport: "streamable_http" as const,
        url: "http://mcp.example.test:8080/mcp",
        revision: "c".repeat(64),
        startupTimeoutSeconds: 60,
        toolTimeoutSeconds: 600,
        credential: { type: "bearer" as const, source: CREDENTIAL_SOURCE },
      },
    ],
    environment: { [CREDENTIAL_SOURCE]: "runtime-secret" },
    model: "gpt-5.6-sol",
    reasoningEffort: "medium" as const,
    modelProvider: {
      revision: 1,
      baseUrl: "https://models.example.test/v1",
      protocolMode: "native_responses" as const,
      apiKey: "test-provider-key",
    },
  }
}
