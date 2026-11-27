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
      supports_image_detail_original: true,
      use_responses_lite: true,
      tool_mode: "code_mode_only",
      comp_hash: "3000",
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

const readDefaultInstructions = async () => "native generic instructions";
const readBundledCatalog = async () => ({ stdout: JSON.stringify(template) });

describe("Codex model catalog", () => {
  it("seeds a generic model on first use without copying bundled tool or compaction flags", async () => {
    const { codexHome } = await fixture();
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions,
    });
    const catalogPath = await writer.ensure({
      command: "codex",
      codexHome,
      model: "new-generic-model",
      modelContextWindow: 1_000_000,
      supportsImageInput: true,
    });
    if (!catalogPath) throw new Error("expected a catalog before the first turn");
    const catalog = await readCatalog(catalogPath);
    expect(catalog.models[0]).toEqual(template.models[0]);
    const model = catalog.models.find(({ slug }) => slug === "new-generic-model");
    expect(model).toMatchObject({
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      input_modalities: ["text", "image"],
      supports_image_detail_original: false,
      supported_reasoning_levels: [],
      use_responses_lite: false,
      model_messages: { instructions_template: "native generic instructions" },
    });
    expect(model).not.toHaveProperty("tool_mode");
    expect(model).not.toHaveProperty("comp_hash");
  });

  it("preserves an exact bundled model's tool and prompt settings without probing generic instructions", async () => {
    const { codexHome } = await fixture();
    const readInstructions = vi.fn(readDefaultInstructions);
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions: readInstructions,
    });
    const catalogPath = await writer.ensure({
      command: "codex",
      codexHome,
      model: "gpt-6-astra",
      modelContextWindow: 1_000_000,
      supportsImageInput: false,
    });
    if (!catalogPath) throw new Error("expected a catalog before the first turn");
    expect((await readCatalog(catalogPath)).models).toEqual([
      {
        ...template.models[0],
        context_window: 1_000_000,
        max_context_window: 1_000_000,
        effective_context_window_percent: 100,
        auto_compact_token_limit: null,
        input_modalities: ["text"],
        supports_image_detail_original: false,
      },
    ]);
    expect(readInstructions).not.toHaveBeenCalled();
  });

  it("loads the bundled catalog in a separate HOME without reading existing session instructions", async () => {
    const { codexHome } = await fixture();
    await writeSession(codexHome, "link-sense", "Previous task's instructions", "a");
    const runCommand = vi.fn(readBundledCatalog);
    const writer = createCodexModelCatalogWriter({ runCommand, readDefaultInstructions });

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
      input_modalities: ["text"],
      supports_image_detail_original: false,
      model_messages: {
        instructions_template: "native generic instructions",
      },
    });
    expect(runCommand).toHaveBeenCalledWith(
      "/managed/codex",
      ["debug", "models", "--bundled"],
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_HOME: expect.not.stringContaining(codexHome),
          HOME: expect.any(String),
        }),
      })
    );
  });

  it("declares image input only for models whose provider settings allow it", async () => {
    const { codexHome } = await fixture();
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions,
    });

    const catalogPath = await writer.ensure({
      command: "codex",
      codexHome,
      model: "vision-model",
      modelContextWindow: 128_000,
      supportsImageInput: true,
    });
    if (!catalogPath) throw new Error("expected a catalog path");
    const catalog = await readCatalog(catalogPath);
    expect(
      catalog.models.find((model) => model.slug === "vision-model")
    ).toMatchObject({
      input_modalities: ["text", "image"],
    });
  });

  it("makes the temporary catalog probe accessible to the task identity", async () => {
    const { codexHome } = await fixture();
    let modes: { codexHome: number; home: number } | null = null;
    const writer = createCodexModelCatalogWriter({
      readDefaultInstructions,
      runCommand: async (_command, _args, options) => {
        const probeCodexHome = options.env?.CODEX_HOME ?? "";
        const probeHome = options.env?.HOME ?? "";
        const [codex, home] = await Promise.all([
          stat(probeCodexHome),
          stat(probeHome),
        ]);
        modes = {
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

    expect(modes).toEqual({ codexHome: 0o770, home: 0o770 });
  });

  it("replaces the seeded model when the window changes", async () => {
    const { codexHome } = await fixture();
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions,
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

  it("retries a failed native instructions probe without using a previous task's instructions", async () => {
    const { codexHome } = await fixture();
    const readInstructions = vi.fn(readDefaultInstructions)
      .mockRejectedValueOnce(new Error("temporary native probe failure"));
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions: readInstructions,
    });
    const input = {
      command: "codex",
      codexHome,
      model: "model-a",
      modelContextWindow: 1_000_000,
    };

    expect(await writer.ensure(input)).toBeNull();
    await writeSession(codexHome, "link-sense", "Prior task instructions", "first");

    const catalogPath = await writer.ensure(input);
    if (!catalogPath) throw new Error("expected a catalog path");
    expect(dirname(catalogPath)).toBe(codexHome);
    const seeded = (await readCatalog(catalogPath)).models.find(
      (model) => model.slug === input.model
    );
    expect(seeded).toMatchObject({
      model_messages: { instructions_template: "native generic instructions" },
    });
    expect(readInstructions).toHaveBeenCalledTimes(2);
  });

  it("retries the model probe after a transient failure", async () => {
    const { codexHome } = await fixture();
    const runCommand = vi.fn()
      .mockRejectedValueOnce(new Error("temporary probe failure"))
      .mockResolvedValue({ stdout: JSON.stringify(template) });
    const writer = createCodexModelCatalogWriter({ runCommand, readDefaultInstructions });
    const input = {
      command: "codex", codexHome, model: "model-a", modelContextWindow: 1_000_000,
    };

    expect(await writer.ensure(input)).toBeNull();
    expect(await writer.ensure(input)).not.toBeNull();
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent models, context windows, and image capabilities isolated", async () => {
    const { codexHome } = await fixture();
    const readInstructions = vi.fn(readDefaultInstructions);
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions: readInstructions,
    });
    const requests = [
      { model: "model-a", modelContextWindow: 1_000_000 },
      { model: "model-b", modelContextWindow: 500_000 },
      { model: "model-a", modelContextWindow: 250_000 },
      { model: "model-a", modelContextWindow: 1_000_000, supportsImageInput: true },
    ];
    const paths = await Promise.all(requests.map((request) =>
      writer.ensure({ command: "codex", codexHome, ...request })
    ));

    expect(new Set(paths).size).toBe(requests.length);
    expect(readInstructions).toHaveBeenCalledOnce();
    for (const [index, catalogPath] of paths.entries()) {
      if (!catalogPath) throw new Error("expected a catalog path");
      const request = requests[index]!;
      const catalog = await readCatalog(catalogPath);
      expect(catalog.models.find((model) => model.slug === request.model)).toMatchObject({
        context_window: request.modelContextWindow,
        max_context_window: request.modelContextWindow,
        input_modalities: request.supportsImageInput ? ["text", "image"] : ["text"],
      });
    }
  });

  it("does not write a catalog without a configured window or a valid bundled template", async () => {
    const { codexHome } = await fixture();
    const writer = createCodexModelCatalogWriter({
      runCommand: readBundledCatalog,
      readDefaultInstructions,
    });

    expect(
      await writer.ensure({
        command: "codex",
        codexHome,
        model: "model-a",
      })
    ).toBeNull();
    expect((await readdir(codexHome)).filter((name) => name.endsWith(".json"))).toEqual([]);

    const failing = createCodexModelCatalogWriter({
      runCommand: async () => {
        throw new Error("debug models failed");
      },
      readDefaultInstructions,
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
