import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import {
  CodexTemplateFeatureConfigError,
  loadCodexTemplateFeatureOverrides,
} from "../src/codex/template-features.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("Codex template feature policy", () => {
  it("keeps the production template traversable and readable regardless of the deploy host umask", async () => {
    const dockerfile = await readFile(
      fileURLToPath(new URL("../../../Dockerfile.runner", import.meta.url)),
      "utf8",
    )

    expect(dockerfile).toContain(
      "RUN install -d -o root -g root -m 0755 /opt/linksense/codex-home-template",
    )
    expect(dockerfile).toContain(
      "COPY --chown=root:root --chmod=0444 deploy/codex-home-template/config.toml /opt/linksense/codex-home-template/config.toml",
    )
    expect(dockerfile).toContain(
      "RUN setpriv --reuid=1000 --regid=1000 --clear-groups \\\n  test -r /opt/linksense/codex-home-template/config.toml",
    )
    expect(dockerfile).toContain(
      "COPY --chown=root:root --chmod=0444 deploy/codex-system/requirements.toml /etc/codex/requirements.toml",
    )
    expect(dockerfile).toContain(
      "node --check /opt/linksense/runtime/node/plan-stop-hook.mjs",
    )
  })

  it("loads only the immutable LinkSense managed hook policy", async () => {
    const requirements = await readFile(
      fileURLToPath(
        new URL(
          "../../../deploy/codex-system/requirements.toml",
          import.meta.url,
        ),
      ),
      "utf8",
    )

    expect(requirements).toContain("allow_managed_hooks_only = true")
    expect(requirements).not.toContain("[features]")
    expect(requirements).not.toContain("hooks = true")
    expect(requirements).toContain(
      'managed_dir = "/opt/linksense/runtime/node"',
    )
    expect(requirements).toContain("[[hooks.Stop]]")
    expect(requirements).toContain(
      'command = "/usr/local/bin/node /opt/linksense/runtime/node/plan-stop-hook.mjs"',
    )
    expect(requirements).not.toContain("dangerously-bypass-hook-trust")
  })

  it("loads every boolean from the deployment template", async () => {
    const template = fileURLToPath(
      new URL("../../../deploy/codex-home-template", import.meta.url),
    )

    const overrides = await loadCodexTemplateFeatureOverrides(template)

    expect(overrides.length).toBeGreaterThan(0)
    expect(
      overrides.every((value) =>
        /^features\.[A-Za-z0-9_-]+=(?:true|false)$/u.test(value),
      ),
    ).toBe(true)
  })

  it("converts every enabled and disabled feature into deterministic CLI overrides", async () => {
    const template = await createTemplate(`
model = "test-model"

[features]
plugins = true
apps = false
multi_agent = true

[projects."/persisted-user-project"]
trust_level = "trusted"
`)

    await expect(loadCodexTemplateFeatureOverrides(template)).resolves.toEqual([
      "features.apps=false",
      "features.multi_agent=true",
      "features.plugins=true",
    ])
  })

  it("does not force feature defaults when no template is configured or the table is absent", async () => {
    const template = await createTemplate('model = "test-model"\n')

    await expect(loadCodexTemplateFeatureOverrides(undefined)).resolves.toEqual(
      [],
    )
    await expect(loadCodexTemplateFeatureOverrides(template)).resolves.toEqual(
      [],
    )
  })

  it.each([
    {
      name: "a non-table features value",
      source: "features = true\n",
      expected: "[features]",
    },
    {
      name: "a non-boolean feature value",
      source: '[features]\nplugins = "true"\n',
      expected: "features.plugins",
    },
    {
      name: "a nested feature table",
      source: "[features.plugins]\nenabled = true\n",
      expected: "features.plugins",
    },
    {
      name: "an invalid feature name",
      source: '[features]\n"plugin.feature" = true\n',
      expected: "plugin.feature",
    },
  ])("rejects $name instead of silently weakening policy", async (scenario) => {
    const template = await createTemplate(scenario.source)

    await expect(
      loadCodexTemplateFeatureOverrides(template),
    ).rejects.toMatchObject({
      name: "CodexTemplateFeatureConfigError",
      message: expect.stringContaining(scenario.expected),
    })
  })

  it("fails fast when the configured template is missing or invalid TOML", async () => {
    const missing = await mkdtemp(path.join(tmpdir(), "linksense-template-"))
    roots.push(missing)
    const invalid = await createTemplate("[features\nplugins = true\n")

    await expect(
      loadCodexTemplateFeatureOverrides(missing),
    ).rejects.toBeInstanceOf(CodexTemplateFeatureConfigError)
    await expect(
      loadCodexTemplateFeatureOverrides(invalid),
    ).rejects.toMatchObject({
      name: "CodexTemplateFeatureConfigError",
      message: expect.stringContaining("failed to parse"),
    })
  })
})

async function createTemplate(source: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-template-"))
  roots.push(root)
  await writeFile(path.join(root, "config.toml"), source, "utf8")
  return root
}
