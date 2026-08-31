import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NATIVE_PLUGIN_MARKETPLACE_NAME,
  NativePluginManager,
  NativePluginRefreshError,
  type NativePluginCommand,
} from "../src/codex/native-plugin-manager.js";

const roots: string[] = [];
const generation = "a".repeat(64);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("NativePluginManager", () => {
  it("removes only stale managed plugins and refreshes every desired plugin", async () => {
    const fixture = await createFixture();
    const responses = [
      pluginList([
        plugin("documents"),
        plugin("obsolete"),
        plugin("foreign", "another-marketplace"),
      ]),
      {},
      {},
      pluginList([plugin("documents"), plugin("foreign", "another-marketplace")]),
    ];
    const runCommand = vi.fn<NativePluginCommand>(async () => ({
      stdout: JSON.stringify(responses.shift()),
    }));
    const validatePublished = vi.fn(async () => undefined);

    await expect(
      new NativePluginManager(runCommand).reconcileBeforeStart({
        command: "/usr/local/bin/codex",
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        workspace: fixture.workspace,
        capabilityControl: fixture.capabilityControl,
        expectedGeneration: generation,
        pluginNames: ["documents"],
        validatePublished,
        processIdentity: { uid: 1001, gid: 1000 },
      }),
    ).resolves.toBeUndefined();

    expect(validatePublished).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls.map(([input]) => input.args)).toEqual([
      [
        "plugin",
        "list",
        "--marketplace",
        NATIVE_PLUGIN_MARKETPLACE_NAME,
        "--available",
        "--json",
      ],
      [
        "plugin",
        "remove",
        `obsolete@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        "--json",
      ],
      [
        "plugin",
        "add",
        `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        "--json",
      ],
      [
        "plugin",
        "list",
        "--marketplace",
        NATIVE_PLUGIN_MARKETPLACE_NAME,
        "--available",
        "--json",
      ],
    ]);
    for (const [input] of runCommand.mock.calls) {
      expect(input).toMatchObject({
        command: "/usr/local/bin/codex",
        cwd: fixture.workspace,
        processIdentity: { uid: 1001, gid: 1000 },
        environment: {
          HOME: fixture.userHome,
          CODEX_HOME: fixture.codexHome,
        },
      });
    }
  });

  it("re-runs native add when an installed plugin keeps the same name", async () => {
    const fixture = await createFixture();
    const responses = [
      pluginList([plugin("documents")]),
      {},
      pluginList([plugin("documents")]),
    ];
    const runCommand = vi.fn<NativePluginCommand>(async () => ({
      stdout: JSON.stringify(responses.shift()),
    }));

    await new NativePluginManager(runCommand).reconcileBeforeStart({
      command: "codex",
      userHome: fixture.userHome,
      codexHome: fixture.codexHome,
      workspace: fixture.workspace,
      capabilityControl: fixture.capabilityControl,
      expectedGeneration: generation,
      pluginNames: ["documents"],
    });

    expect(runCommand.mock.calls.map(([input]) => input.args)).toContainEqual([
      "plugin",
      "add",
      `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
      "--json",
    ]);
  });

  it("removes a configured managed plugin after it disappears from the marketplace", async () => {
    const fixture = await createFixture();
    const configPath = path.join(fixture.codexHome, "config.toml");
    await writeFile(
      configPath,
      `[plugins."obsolete@${NATIVE_PLUGIN_MARKETPLACE_NAME}"]\nenabled = true\n`,
    );
    const responses = [pluginList([]), {}, pluginList([])];
    const runCommand = vi.fn<NativePluginCommand>(async (input) => {
      if (input.args[1] === "remove") {
        await writeFile(configPath, "");
      }
      return { stdout: JSON.stringify(responses.shift()) };
    });

    await expect(
      new NativePluginManager(runCommand).reconcileBeforeStart({
        command: "codex",
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        workspace: fixture.workspace,
        capabilityControl: fixture.capabilityControl,
        expectedGeneration: generation,
        pluginNames: [],
      }),
    ).resolves.toBeUndefined();

    expect(runCommand.mock.calls.map(([input]) => input.args)).toEqual([
      [
        "plugin",
        "list",
        "--marketplace",
        NATIVE_PLUGIN_MARKETPLACE_NAME,
        "--available",
        "--json",
      ],
      [
        "plugin",
        "remove",
        `obsolete@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        "--json",
      ],
      [
        "plugin",
        "list",
        "--marketplace",
        NATIVE_PLUGIN_MARKETPLACE_NAME,
        "--available",
        "--json",
      ],
    ]);
  });

  it("fails closed when native remove leaves a stale managed plugin configured", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.codexHome, "config.toml"),
      `[plugins."obsolete@${NATIVE_PLUGIN_MARKETPLACE_NAME}"]\nenabled = true\n`,
    );
    const responses = [pluginList([]), {}, pluginList([])];
    const runCommand = vi.fn<NativePluginCommand>(async () => ({
      stdout: JSON.stringify(responses.shift()),
    }));

    await expect(
      new NativePluginManager(runCommand).reconcileBeforeStart({
        command: "codex",
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        workspace: fixture.workspace,
        capabilityControl: fixture.capabilityControl,
        expectedGeneration: generation,
        pluginNames: [],
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);
  });

  it("fails closed before invoking Codex when the published generation differs", async () => {
    const fixture = await createFixture("b".repeat(64));
    const runCommand = vi.fn<NativePluginCommand>();
    const validatePublished = vi.fn(async () => undefined);

    await expect(
      new NativePluginManager(runCommand).reconcileBeforeStart({
        command: "codex",
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        workspace: fixture.workspace,
        capabilityControl: fixture.capabilityControl,
        expectedGeneration: generation,
        pluginNames: [],
        validatePublished,
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);

    expect(runCommand).not.toHaveBeenCalled();
    expect(validatePublished).not.toHaveBeenCalled();
  });

  it("fails closed when Codex does not report the exact desired installed set", async () => {
    const fixture = await createFixture();
    const responses = [pluginList([]), {}, pluginList([])];
    const runCommand = vi.fn<NativePluginCommand>(async () => ({
      stdout: JSON.stringify(responses.shift()),
    }));

    await expect(
      new NativePluginManager(runCommand).reconcileBeforeStart({
        command: "codex",
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        workspace: fixture.workspace,
        capabilityControl: fixture.capabilityControl,
        expectedGeneration: generation,
        pluginNames: ["documents"],
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);
  });

  it("verifies the newly started app-server and uses Codex-reported skill paths", async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(
      fixture.userHome,
      ".agents",
      "plugin-sources",
      "documents",
    );
    await mkdir(sourcePath, { recursive: true });
    const skillPath = path.join(
      sourcePath,
      "skills",
      "documents",
      "SKILL.md",
    );
    const cacheRoot = path.join(
      fixture.codexHome,
      "plugins",
      "cache",
      NATIVE_PLUGIN_MARKETPLACE_NAME,
      "documents",
      "1.2.3",
    );
    await Promise.all([
      mkdir(path.dirname(skillPath), { recursive: true }),
      mkdir(cacheRoot, { recursive: true }),
    ]);
    await writeFile(skillPath, "skill\n");
    const summary = {
      id: `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
      localVersion: "1.2.3",
      name: "documents",
      source: { type: "local", path: sourcePath },
      installed: true,
      enabled: true,
    };
    const request = vi.fn(async (method: string): Promise<unknown> => {
      if (method === "plugin/installed") {
        return {
          marketplaces: [
            {
              name: NATIVE_PLUGIN_MARKETPLACE_NAME,
              path: fixture.marketplacePath,
              plugins: [summary],
            },
          ],
          marketplaceLoadErrors: [],
        };
      }
      if (method === "plugin/read") {
        return {
          plugin: {
            marketplaceName: NATIVE_PLUGIN_MARKETPLACE_NAME,
            marketplacePath: fixture.marketplacePath,
            summary,
            skills: [
              {
                name: "documents:documents",
                path: skillPath,
                enabled: true,
              },
            ],
            hooks: [],
            apps: [],
            appTemplates: [],
            mcpServers: ["documents-mcp"],
          },
        };
      }
      throw new Error(`unexpected request ${method}`);
    });

    await expect(
      new NativePluginManager().verifyAfterStart({
        client: { request },
        workspace: fixture.workspace,
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        pluginNames: ["documents"],
      }),
    ).resolves.toEqual([
      {
        name: "documents",
        pluginId: `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        version: "1.2.3",
        mentionPath: `plugin://documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        cacheRoot,
        skills: [
          {
            name: "documents:documents",
            sourcePath: skillPath,
            relativePath: path.join("skills", "documents", "SKILL.md"),
          },
        ],
        mcpServers: ["documents-mcp"],
      },
    ]);
  });

  it("rejects app-server plugin metadata that escapes the user Codex home", async () => {
    const fixture = await createFixture();
    const outsideSource = path.join(fixture.root, "outside-plugin");
    await mkdir(outsideSource);
    const request = vi.fn(async (method: string): Promise<unknown> => {
      const summary = {
        id: `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
        localVersion: "1.2.3",
        name: "documents",
        source: { type: "local", path: outsideSource },
        installed: true,
        enabled: true,
      };
      return method === "plugin/installed"
        ? {
            marketplaces: [
              {
                name: NATIVE_PLUGIN_MARKETPLACE_NAME,
                path: fixture.marketplacePath,
                plugins: [summary],
              },
            ],
            marketplaceLoadErrors: [],
          }
        : {
            plugin: {
              marketplaceName: NATIVE_PLUGIN_MARKETPLACE_NAME,
              marketplacePath: fixture.marketplacePath,
              summary,
              skills: [],
              hooks: [],
              apps: [],
              appTemplates: [],
              mcpServers: [],
            },
          };
    });

    await expect(
      new NativePluginManager().verifyAfterStart({
        client: { request },
        workspace: fixture.workspace,
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        pluginNames: ["documents"],
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);
  });

  it("rejects Codex-reported skill paths outside the verified plugin source", async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(
      fixture.userHome,
      ".agents",
      "plugin-sources",
      "documents",
    );
    const outsideSkillPath = path.join(
      fixture.codexHome,
      "plugins",
      "outside",
      "SKILL.md",
    );
    await Promise.all([
      mkdir(sourcePath, { recursive: true }),
      mkdir(path.dirname(outsideSkillPath), { recursive: true }),
    ]);
    await writeFile(outsideSkillPath, "skill\n");
    const summary = {
      id: `documents@${NATIVE_PLUGIN_MARKETPLACE_NAME}`,
      localVersion: "1.2.3",
      name: "documents",
      source: { type: "local", path: sourcePath },
      installed: true,
      enabled: true,
    };
    const request = vi.fn(async (method: string): Promise<unknown> =>
      method === "plugin/installed"
        ? {
            marketplaces: [
              {
                name: NATIVE_PLUGIN_MARKETPLACE_NAME,
                path: fixture.marketplacePath,
                plugins: [summary],
              },
            ],
            marketplaceLoadErrors: [],
          }
        : {
            plugin: {
              marketplaceName: NATIVE_PLUGIN_MARKETPLACE_NAME,
              marketplacePath: fixture.marketplacePath,
              summary,
              skills: [
                {
                  name: "documents:documents",
                  path: outsideSkillPath,
                  enabled: true,
                },
              ],
              hooks: [],
              apps: [],
              appTemplates: [],
              mcpServers: [],
            },
          },
    );

    await expect(
      new NativePluginManager().verifyAfterStart({
        client: { request },
        workspace: fixture.workspace,
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        pluginNames: ["documents"],
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);
  });

  it("rejects an installed enabled plugin from any other marketplace", async () => {
    const fixture = await createFixture();
    const request = vi.fn(async (): Promise<unknown> => ({
      marketplaces: [
        {
          name: "openai-curated",
          path: null,
          plugins: [
            pluginSummary("github", "openai-curated", {
              installed: true,
              enabled: true,
            }),
          ],
        },
      ],
      marketplaceLoadErrors: [],
    }));

    await expect(
      new NativePluginManager().verifyAfterStart({
        client: { request },
        workspace: fixture.workspace,
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        pluginNames: [],
      }),
    ).rejects.toBeInstanceOf(NativePluginRefreshError);
    expect(request).toHaveBeenCalledOnce();
  });

  it("ignores available but uninstalled plugins from other marketplaces", async () => {
    const fixture = await createFixture();
    const request = vi.fn(async (): Promise<unknown> => ({
      marketplaces: [
        {
          name: "openai-curated",
          path: null,
          plugins: [
            pluginSummary("github", "openai-curated", {
              installed: false,
              enabled: true,
            }),
          ],
        },
      ],
      marketplaceLoadErrors: [],
    }));

    await expect(
      new NativePluginManager().verifyAfterStart({
        client: { request },
        workspace: fixture.workspace,
        userHome: fixture.userHome,
        codexHome: fixture.codexHome,
        pluginNames: [],
      }),
    ).resolves.toEqual([]);
    expect(request).toHaveBeenCalledOnce();
  });
});

async function createFixture(publishedGeneration = generation) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-native-plugin-"));
  roots.push(root);
  const userHome = path.join(root, "home");
  const codexHome = path.join(userHome, ".codex");
  const workspace = path.join(userHome, "workspaces", "task");
  const capabilityControl = path.join(root, "control", "capabilities");
  const marketplacePath = path.join(
    userHome,
    ".agents",
    "plugins",
    "marketplace.json",
  );
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(capabilityControl, { recursive: true }),
    mkdir(path.dirname(marketplacePath), { recursive: true }),
    mkdir(path.join(userHome, ".agents", "plugin-sources"), {
      recursive: true,
    }),
    mkdir(path.join(codexHome, "plugins"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(capabilityControl, "capability-generation"),
      `${publishedGeneration}\n`,
    ),
    writeFile(marketplacePath, "{}\n"),
  ]);
  return {
    root,
    userHome,
    codexHome,
    workspace,
    capabilityControl,
    marketplacePath,
  };
}

function plugin(
  name: string,
  marketplaceName = NATIVE_PLUGIN_MARKETPLACE_NAME,
) {
  return {
    pluginId: `${name}@${marketplaceName}`,
    name,
    marketplaceName,
    version: "1.0.0",
    installed: true,
    enabled: true,
  };
}

function pluginList(installed: ReturnType<typeof plugin>[]) {
  return { installed, available: [] };
}

function pluginSummary(
  name: string,
  marketplaceName: string,
  state: { installed: boolean; enabled: boolean },
) {
  return {
    id: `${name}@${marketplaceName}`,
    localVersion: null,
    name,
    source: { type: "remote" },
    ...state,
  };
}
