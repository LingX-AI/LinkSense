import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexModelCatalogWriter } from "../src/codex/model-catalog.js";

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
  const root = await mkdtemp(join(tmpdir(), "linksense-model-catalog-"));
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

async function readCatalog(catalogPath: string) {
  return JSON.parse(await readFile(catalogPath, "utf8")) as {
    models: Array<Record<string, unknown>>;
  };
}

describe("Codex model catalog", () => {
  it("writes the configured model window with LinkSense's synthetic instructions", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "linksense instructions", "a");
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify(template),
    }));
    const writer = createCodexModelCatalogWriter({ runCommand });

    const catalogPath = await writer.ensure({
      command: "/managed/codex",
      codexHome,
      model: "workbuddy-ai/glm-5.3-flash",
      modelContextWindow: 1_000_000,
    });

    if (!catalogPath) throw new Error("expected a catalog path");
    expect(dirname(catalogPath)).toBe(codexHome);
    const catalog = await readCatalog(catalogPath);
    expect(catalog.models.map((model) => model.slug)).toEqual([
      "gpt-6-astra",
      "workbuddy-ai/glm-5.3-flash",
    ]);
    expect(
      catalog.models.find(
        (model) => model.slug === "workbuddy-ai/glm-5.3-flash"
      )
    ).toMatchObject({
      display_name: "workbuddy-ai/glm-5.3-flash",
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      effective_context_window_percent: 100,
      auto_compact_token_limit: null,
      model_messages: {
        instructions_template: "linksense instructions",
      },
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
    const writer = createCodexModelCatalogWriter({
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
      model: "model-a",
      modelContextWindow: 1_000_000,
      processIdentity: { uid: 1001, gid: 1000 },
    });

    expect(modes).toEqual({ root: 0o770, codexHome: 0o770, home: 0o770 });
  });

  it("replaces the seeded model when the window changes", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "a");
    const writer = createCodexModelCatalogWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    await writer.ensure({
      command: "codex",
      codexHome,
      model: "model-a",
      modelContextWindow: 500_000,
    });
    const catalogPath = await writer.ensure({
      command: "codex",
      codexHome,
      model: "model-a",
      modelContextWindow: 1_000_000,
    });
    if (!catalogPath) throw new Error("expected a catalog path");
    const seeded = (await readCatalog(catalogPath)).models.filter(
      (model) => model.slug === "model-a"
    );
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({
      context_window: 1_000_000,
      max_context_window: 1_000_000,
    });
  });

  it("uses the newest LinkSense session and ignores other providers", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "openai", "openai instructions", "old");
    await writeSession(codexHome, "link-sense", "older link-sense", "newer");
    const writer = createCodexModelCatalogWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    const catalogPath = await writer.ensure({
      command: "codex",
      codexHome,
      model: "model-a",
      modelContextWindow: 1_000_000,
    });
    if (!catalogPath) throw new Error("expected a catalog path");
    const seeded = (await readCatalog(catalogPath)).models.find(
      (model) => model.slug === "model-a"
    );
    expect(
      (seeded?.model_messages as { instructions_template: string })
        .instructions_template
    ).toBe("older link-sense");
  });

  it("retries reading instructions after the first LinkSense session is created", async () => {
    const { codexHome } = await fixture();
    const writer = createCodexModelCatalogWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });
    const input = {
      command: "codex",
      codexHome,
      model: "model-a",
      modelContextWindow: 1_000_000,
    };

    expect(await writer.ensure(input)).toBeNull();
    await writeSession(codexHome, "link-sense", "first session instructions", "first");

    const catalogPath = await writer.ensure(input);
    if (!catalogPath) throw new Error("expected a catalog path");
    expect(dirname(catalogPath)).toBe(codexHome);
    const seeded = (await readCatalog(catalogPath)).models.find(
      (model) => model.slug === input.model
    );
    expect(seeded).toMatchObject({
      model_messages: { instructions_template: "first session instructions" },
    });
  });

  it("retries the model probe after a transient failure", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "first");
    const runCommand = vi.fn()
      .mockRejectedValueOnce(new Error("temporary probe failure"))
      .mockResolvedValue({ stdout: JSON.stringify(template) });
    const writer = createCodexModelCatalogWriter({ runCommand });
    const input = {
      command: "codex", codexHome, model: "model-a", modelContextWindow: 1_000_000,
    };

    expect(await writer.ensure(input)).toBeNull();
    expect(await writer.ensure(input)).not.toBeNull();
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("keeps catalogs for concurrent models and context windows isolated", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "first");
    const writer = createCodexModelCatalogWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });
    const requests = [
      { model: "model-a", modelContextWindow: 1_000_000 },
      { model: "model-b", modelContextWindow: 500_000 },
      { model: "model-a", modelContextWindow: 250_000 },
    ];
    const paths = await Promise.all(requests.map((request) =>
      writer.ensure({ command: "codex", codexHome, ...request })
    ));

    expect(new Set(paths).size).toBe(requests.length);
    for (const [index, catalogPath] of paths.entries()) {
      if (!catalogPath) throw new Error("expected a catalog path");
      const request = requests[index]!;
      const catalog = await readCatalog(catalogPath);
      expect(catalog.models.find((model) => model.slug === request.model)).toMatchObject({
        context_window: request.modelContextWindow,
        max_context_window: request.modelContextWindow,
      });
    }
  });

  it("does not write a catalog without a window, a LinkSense session, or a template", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "instructions", "a");
    const writer = createCodexModelCatalogWriter({
      runCommand: async () => ({ stdout: JSON.stringify(template) }),
    });

    expect(
      await writer.ensure({
        command: "codex",
        codexHome,
        model: "model-a",
      })
    ).toBeNull();
    expect((await readdir(codexHome)).filter((name) => name.endsWith(".json"))).toEqual([]);

    const noSession = await fixture();
    expect(
      await writer.ensure({
        command: "codex",
        codexHome: noSession.codexHome,
        model: "model-a",
        modelContextWindow: 1_000_000,
      })
    ).toBeNull();
    expect((await readdir(noSession.codexHome)).filter((name) => name.endsWith(".json"))).toEqual([]);

    const failing = createCodexModelCatalogWriter({
      runCommand: async () => {
        throw new Error("debug models failed");
      },
    });
    expect(
      await failing.ensure({
        command: "codex",
        codexHome,
        model: "model-a",
        modelContextWindow: 1_000_000,
      })
    ).toBeNull();
    expect((await readdir(codexHome)).filter((name) => name.endsWith(".json"))).toEqual([]);
  });
});
