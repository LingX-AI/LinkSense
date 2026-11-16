import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexModelCatalogCacheWriter } from "../src/codex/model-catalog-cache.js";

const roots: string[] = [];

const template = {
  models: [
    {
      slug: "gpt-6-astra",
      display_name: "GPT-6 Astra",
      description: "template",
      model_messages: {
        instructions_template: "template instructions",
      },
      supported_reasoning_levels: [
        { effort: "low", description: "" },
        { effort: "medium", description: "" },
        { effort: "high", description: "" },
      ],
      shell_type: "unified_exec",
      visibility: "list",
      supported_in_api: true,
      priority: 1,
      availability_nux: null,
      upgrade: null,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: "tokens", limit: 10_000 },
      experimental_supported_tools: [],
      input_modalities: ["text", "image"],
    },
  ],
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      import("node:fs/promises").then(({ rm }) =>
        rm(root, { recursive: true, force: true })
      )
    )
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "linksense-model-cache-"));
  roots.push(root);
  const codexHome = join(root, "codex");
  await mkdir(codexHome, { recursive: true });
  return { root, codexHome };
}

async function writeSession(
  codexHome: string,
  modelProvider: string,
  instructions: string,
  name: string
) {
  const directory = join(codexHome, "sessions", "2026", "11", "16");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-${name}.jsonl`);
  await writeFile(
    path,
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        model_provider: modelProvider,
        base_instructions: { text: instructions },
      },
    })}\n`
  );
  return path;
}

async function readCache(codexHome: string) {
  return JSON.parse(await readFile(join(codexHome, "models_cache.json"), "utf8"));
}

describe("Codex model catalog cache", () => {
  it("seeds the configured model window with LinkSense's synthetic instructions", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "linksense instructions", "a");
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify(template),
    }));
    const writer = createCodexModelCatalogCacheWriter({ runCommand });

    await writer.ensure({
      command: "/managed/codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "workbuddy-ai/glm-5.3-flash",
      modelContextWindow: 1_000_000,
    });

    const cache = await readCache(codexHome);
    expect(cache).toMatchObject({
      client_version: "0.154.0",
      identity: "linksense",
      models: [
        {
          slug: "workbuddy-ai/glm-5.3-flash",
          display_name: "workbuddy-ai/glm-5.3-flash",
          context_window: 1_000_000,
          max_context_window: 1_000_000,
          effective_context_window_percent: 100,
          auto_compact_token_limit: null,
          model_messages: {
            instructions_template: "linksense instructions",
          },
        },
      ],
    });
    expect(runCommand).toHaveBeenCalledWith(
      "/managed/codex",
      ["debug", "models"],
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_HOME: expect.any(String),
          HOME: expect.any(String),
        }),
      })
    );
  });

  it("makes the temporary catalog probe accessible to the task identity", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "a");
    let modes: { root: number; codexHome: number; home: number } | null = null;
    const writer = createCodexModelCatalogCacheWriter({
      runCommand: async (_command, _args, options) => {
        const probeCodexHome = options.env?.CODEX_HOME ?? "";
        const probeHome = options.env?.HOME ?? "";
        const [root, codex, home] = await Promise.all([
          stat(dirname(probeCodexHome)),
          stat(probeCodexHome),
          stat(probeHome),
        ]);
        modes = {
          root: root.mode & 0o777,
          codexHome: codex.mode & 0o777,
          home: home.mode & 0o777,
        };
        return { stdout: JSON.stringify(template) };
      },
    });

    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.168.0",
      model: "model-a",
      modelContextWindow: 1_000_000,
      processIdentity: { uid: 1001, gid: 1000 },
    });

    expect(modes).toEqual({ root: 0o770, codexHome: 0o770, home: 0o770 });
  });

  it("merges models and replaces stale caches from another Codex version", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "a");
    const writer = createCodexModelCatalogCacheWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "model-a",
      modelContextWindow: 500_000,
    });
    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "model-b",
      modelContextWindow: 200_000,
    });
    expect((await readCache(codexHome)).models.map((model: { slug: string }) => model.slug)).toEqual([
      "model-a",
      "model-b",
    ]);

    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.155.0",
      model: "model-c",
      modelContextWindow: 1_000_000,
    });
    const cache = await readCache(codexHome);
    expect(cache.client_version).toBe("0.155.0");
    expect(cache.models.map((model: { slug: string }) => model.slug)).toEqual([
      "model-c",
    ]);
  });

  it("uses the newest LinkSense session and ignores other providers", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "openai", "openai instructions", "old");
    await writeSession(codexHome, "link-sense", "older link-sense", "newer");
    const writer = createCodexModelCatalogCacheWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "model-a",
      modelContextWindow: 1_000_000,
    });

    expect((await readCache(codexHome)).models[0].model_messages.instructions_template).toBe(
      "older link-sense"
    );
  });

  it("does not write a cache without a window, a LinkSense session, or a template", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "a");
    const writer = createCodexModelCatalogCacheWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    await writer.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "model-a",
    });
    await expect(readCache(codexHome)).rejects.toThrow();

    const noSession = await fixture();
    await writer.ensure({
      command: "codex",
      codexHome: noSession.codexHome,
      codexVersion: "0.154.0",
      model: "model-a",
      modelContextWindow: 1_000_000,
    });
    await expect(readCache(noSession.codexHome)).rejects.toThrow();

    const failing = createCodexModelCatalogCacheWriter({
      runCommand: async () => {
        throw new Error("debug models failed");
      },
    });
    await failing.ensure({
      command: "codex",
      codexHome,
      codexVersion: "0.154.0",
      model: "model-a",
      modelContextWindow: 1_000_000,
    });
    await expect(readCache(codexHome)).rejects.toThrow();
  });
});
