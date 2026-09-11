import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import {
  CapabilityPackageImporter,
  assertPublicHttpUrl,
  detectSafeRasterImage,
  extractZipSecurely,
  isPublicAddress,
  stageAtomicDirectoryReplacement,
} from "../src/modules/capabilities/importer.js";

const temporaryDirectories: string[] = [];
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CapabilityPackageImporter", () => {
  it("prepares exact remote files only after path, size, and SHA-256 verification", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const skill = Buffer.from(
      "---\nname: remote-reports\ndescription: Remote reports\n---\n# Instructions",
      "utf8",
    );
    const reference = Buffer.from("Reference", "utf8");

    const prepared = await importer.prepareRemoteFiles([
      remoteFile("remote-reports/SKILL.md", skill),
      remoteFile("remote-reports/references/guide.md", reference),
    ]);

    expect(prepared).toMatchObject({
      type: "skill",
      name: "remote-reports",
      description: "Remote reports",
    });
    await expect(
      readFile(join(prepared.packageRoot, "references/guide.md"), "utf8"),
    ).resolves.toBe("Reference");
    await importer.cleanup(prepared);
  });

  it("rejects a Skill whose required Python entrypoint is missing from the package", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const skill = Buffer.from(
      [
        "---",
        "name: ui-ux-pro-max",
        "---",
        "",
        "```bash",
        'python3 skills/ui-ux-pro-max/scripts/search.py "dashboard" --design-system',
        "```",
      ].join("\n"),
      "utf8",
    );

    await expect(
      importer.prepareRemoteFiles([remoteFile("SKILL.md", skill)]),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: {
        reason_code: "skill_referenced_script_missing",
        path: "scripts/search.py",
      },
    });
  });

  it("accepts a Skill when every referenced Python entrypoint is packaged", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const skill = Buffer.from(
      [
        "---",
        "name: ui-ux-pro-max",
        "---",
        "",
        "```bash",
        'python3 skills/ui-ux-pro-max/scripts/search.py "dashboard" --design-system',
        "uv run python {baseDir}/scripts/design_system.py --help",
        "```",
      ].join("\n"),
      "utf8",
    );

    const prepared = await importer.prepareRemoteFiles([
      remoteFile("SKILL.md", skill),
      remoteFile("scripts/search.py", Buffer.from("print('ok')\n", "utf8")),
      remoteFile(
        "scripts/design_system.py",
        Buffer.from("print('ok')\n", "utf8"),
      ),
    ]);

    await expect(
      readFile(join(prepared.packageRoot, "scripts/search.py"), "utf8"),
    ).resolves.toBe("print('ok')\n");
    await importer.cleanup(prepared);
  });

  it("rejects a Skill whose frontmatter is not parseable YAML", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const skill = Buffer.from(
      [
        "---",
        "name: web-search-plus",
        'metadata: {"openclaw": {"id": "broken"}',
        "---",
        "# Instructions",
      ].join("\n"),
      "utf8",
    );

    await expect(
      importer.prepareRemoteFiles([remoteFile("SKILL.md", skill)]),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "skill_frontmatter_missing" },
    });
  });

  it.each([
    {
      name: "path traversal",
      files: [remoteFile("../escape/SKILL.md", Buffer.from("unsafe"))],
      code: "INVALID_PACKAGE",
    },
    {
      name: "backslash path",
      files: [remoteFile("skill\\SKILL.md", Buffer.from("unsafe"))],
      code: "INVALID_PACKAGE",
    },
    {
      name: "duplicate normalized path",
      files: [
        remoteFile("skill/SKILL.md", Buffer.from("one")),
        remoteFile("skill/./SKILL.md", Buffer.from("two")),
      ],
      code: "INVALID_PACKAGE",
    },
    {
      name: "hash mismatch",
      files: [
        {
          ...remoteFile("skill/SKILL.md", Buffer.from("unsafe")),
          sha256: "0".repeat(64),
        },
      ],
      code: "CLAWHUB_PACKAGE_INTEGRITY_FAILED",
    },
  ])("rejects remote files with $name", async ({ files, code }) => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });

    await expect(importer.prepareRemoteFiles(files)).rejects.toMatchObject({
      code,
    });
    await expect(readFile(join(root, "escape", "SKILL.md"))).rejects.toThrow();
  });

  it("prepares a manual Skill and only statically reports dependency commands", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });

    const prepared = await importer.prepare({
      kind: "manual_skill",
      name: "report-helper",
      description: "Creates reports",
      skillMarkdown:
        "# Instructions\n\nNever run pnpm install untrusted-package.",
    });

    expect(prepared.type).toBe("skill");
    expect(prepared.name).toBe("report-helper");
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "report-helper"),
    );
    expect(prepared.riskSummary.contains_dependency_download_commands).toBe(
      true,
    );
    expect(prepared.riskSummary.dependency_commands).toContain("pnpm install");
    expect(prepared.riskSummary.declared_environment_keys).toEqual([]);
    await expect(
      readFile(join(prepared.packageRoot, "SKILL.md"), "utf8"),
    ).resolves.toContain('name: "report-helper"');
    await importer.cleanup(prepared);
  });

  it.each([
    "Presentations",
    "presentation helper",
    "-presentation",
    "presentation-",
    "presentation--helper",
    "presentation_helper",
    "a".repeat(65),
    "linksense-docs",
    "linksense-file-service",
    "linksense-image-generation",
    "linksense-knowledge-base",
    "linksense-skill-creator",
  ])("rejects the invalid or reserved Skill name %s", async (name) => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });

    await expect(
      importer.prepare({
        kind: "manual_skill",
        name,
        skillMarkdown: "# Instructions",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
  });

  it("uses the Skill frontmatter name when the package root directory differs", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "presentation-tools/SKILL.md",
        bytes: "---\nname: presentations\n---\n# Instructions",
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "skill.zip",
    });

    expect(prepared).toMatchObject({ type: "skill", name: "presentations" });
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "presentation-tools"),
    );
    await importer.cleanup(prepared);
  });

  it("accepts GitHub source archive folder suffixes for Skills", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "guizang-ppt-skill-main/SKILL.md",
        bytes: "---\nname: guizang-ppt-skill\n---\n# Instructions",
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "skill.zip",
    });

    expect(prepared).toMatchObject({
      type: "skill",
      name: "guizang-ppt-skill",
    });
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "guizang-ppt-skill-main"),
    );
    await importer.cleanup(prepared);
  });

  it("accepts a valid Skill whose frontmatter name matches its package root", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "presentations/SKILL.md",
        bytes: "---\nname: presentations\n---\n# Instructions",
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "skill.zip",
    });

    expect(prepared).toMatchObject({ type: "skill", name: "presentations" });
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "presentations"),
    );
    await importer.cleanup(prepared);
  });

  it("fails closed for an imported non-executable script that cannot be scanned", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const token = `github_pat_${"A".repeat(30)}`;
    const archive = createStoredZip([
      {
        path: "nul-script/SKILL.md",
        bytes: "---\nname: nul-script\n---\n\nUse the bundled helper.\n",
      },
      {
        path: "nul-script/scripts/run.js",
        bytes: Buffer.from(`// ${token}\0\nconsole.log("ready");\n`, "utf8"),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "nul-script.zip",
    });

    expect((await lstat(join(prepared.packageRoot, "scripts/run.js"))).mode & 0o111).toBe(0);
    expect(prepared.riskSummary.supply_chain_review).toMatchObject({
      verdict: "blocked",
      highest_severity: "critical",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "scripts/run.js",
        }),
      ],
    });
    expect(JSON.stringify(prepared.riskSummary)).not.toContain(token);
    await importer.cleanup(prepared);
  });

  it("rejects ZIP path traversal before writing outside staging", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "staging");
    await mkdir(destination);
    const archive = createStoredZip([
      { path: "../escape.txt", bytes: "owned" },
    ]);

    await expect(
      extractZipSecurely(archive, destination),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
    });
    await expect(readFile(join(root, "escape.txt"))).rejects.toThrow();
  });

  it("rejects ZIP paths that collide after Windows separator normalization", async () => {
    const root = await temporaryDirectory();
    const destination = join(root, "staging");
    await mkdir(destination);
    const archive = createStoredZip([
      { path: "skill/SKILL.md", bytes: "one" },
      { path: "skill\\SKILL.md", bytes: "two" },
    ]);

    await expect(
      extractZipSecurely(archive, destination),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "archive_path_invalid" },
    });
  });

  it("rejects ZIP symbolic links, too many entries, and expansion limits", async () => {
    const root = await temporaryDirectory();
    const symlinkZip = createStoredZip([
      {
        path: "SKILL.md",
        bytes: "target",
        externalFileAttributes: (0o120777 << 16) >>> 0,
      },
    ]);
    await expect(
      extractZipSecurely(symlinkZip, join(root, "symlink")),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });

    const twoEntries = createStoredZip([
      { path: "one", bytes: "1" },
      { path: "two", bytes: "2" },
    ]);
    await expect(
      extractZipSecurely(twoEntries, join(root, "count"), {
        archiveBytes: 1_000,
        entryBytes: 1_000,
        totalExpandedBytes: 1_000,
        entryCount: 1,
        compressionRatio: 100,
        redirectCount: 1,
        requestTimeoutMs: 1_000,
        logoBytes: 1_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });

    const oversized = createStoredZip([{ path: "large", bytes: "12345" }]);
    await expect(
      extractZipSecurely(oversized, join(root, "large"), {
        archiveBytes: 1_000,
        entryBytes: 4,
        totalExpandedBytes: 1_000,
        entryCount: 10,
        compressionRatio: 100,
        redirectCount: 1,
        requestTimeoutMs: 1_000,
        logoBytes: 1_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
  });

  it("ignores non-native manifest environment declarations while preserving nested Skills", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      { path: "team-tools/", bytes: "" },
      { path: "team-tools/.codex-plugin/", bytes: "" },
      {
        path: "team-tools/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "team-tools",
          version: "1.0.0",
          description: "Team tools",
          skills: "./skills",
          environment_variables: { API_KEY: { required: true } },
        }),
      },
      {
        path: "team-tools/skills/report-folder/SKILL.md",
        bytes: "---\nname: report\n---\n# Report",
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "plugin.zip",
    });

    expect(prepared.type).toBe("plugin");
    expect(prepared.name).toBe("team-tools");
    expect(prepared.manifest).toMatchObject({
      version: "1.0.0",
      has_skills: true,
      skill_names: ["report"],
    });
    expect(prepared.riskSummary).toMatchObject({
      requires_environment_variables: false,
      requires_credentials: false,
      declared_environment_keys: [],
      mcp_environment_references: [],
    });
    await importer.cleanup(prepared);
  });

  it("accepts a plugin ZIP with Windows separators", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      { path: "managebac-connector\\", bytes: "" },
      {
        path: "managebac-connector\\.codex-plugin\\plugin.json",
        bytes: JSON.stringify({
          name: "managebac-connector",
          version: "0.8.0",
          description: "ManageBac connector",
          mcpServers: "./.mcp.json",
          skills: "./skills/",
        }),
      },
      {
        path: "managebac-connector\\.mcp.json",
        bytes: JSON.stringify({
          mcpServers: {
            managebac: {
              type: "stdio",
              command: "node",
              args: ["./mcp/server.mjs"],
              env_vars: ["MANAGEBAC_CLIENT_ID"],
            },
          },
        }),
      },
      {
        path: "managebac-connector\\skills\\managebac-connect\\SKILL.md",
        bytes: "---\nname: managebac-connect\n---\n# Connect",
      },
      {
        path: "managebac-connector\\mcp\\server.mjs",
        bytes: "console.log('ok')\n",
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "managebac-portable.zip",
    });

    expect(prepared.type).toBe("plugin");
    expect(prepared.name).toBe("managebac-connector");
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "managebac-connector"),
    );
    expect(prepared.manifest).toMatchObject({
      version: "0.8.0",
      has_skills: true,
      skill_names: ["managebac-connect"],
    });
    expect(prepared.riskSummary).toMatchObject({
      contains_mcp_server: true,
      declared_environment_keys: ["MANAGEBAC_CLIENT_ID"],
      mcp_environment_references: [
        {
          mcp_server: "managebac",
          env_key: "MANAGEBAC_CLIENT_ID",
          source: "local",
          usage: "stdio_env_var",
          http_header: null,
        },
      ],
    });
    await expect(
      readFile(join(prepared.packageRoot, ".mcp.json"), "utf8"),
    ).resolves.toContain("MANAGEBAC_CLIENT_ID");
    await importer.cleanup(prepared);
  });

  it.each([
    "Team-Tools",
    "team tools",
    "team_tools",
    "-team-tools",
    "team-tools-",
    "team--tools",
    "a".repeat(65),
    "linksense-browser",
    "linksense-docs",
    "linksense-skill-creator",
  ])("rejects the non-kebab-case or reserved plugin name %s", async (name) => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: `${name}/.codex-plugin/plugin.json`,
        bytes: JSON.stringify({ name }),
      },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
  });

  it("uses the plugin manifest name when the package root directory differs", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "different-plugin/.codex-plugin/plugin.json",
        bytes: JSON.stringify({ name: "expected-plugin" }),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "plugin.zip",
    });

    expect(prepared).toMatchObject({ type: "plugin", name: "expected-plugin" });
    expect(prepared.packageRoot).toBe(
      join(prepared.stagingDirectory, "different-plugin"),
    );
    await importer.cleanup(prepared);
  });

  it.each(["apps", "hooks", "appTemplates"])(
    "rejects the unsupported plugin manifest component %s",
    async (component) => {
      const root = await temporaryDirectory();
      const importer = new CapabilityPackageImporter({
        stagingRoot: join(root, "staging"),
      });
      const archive = createStoredZip([
        {
          path: "unsupported-plugin/.codex-plugin/plugin.json",
          bytes: JSON.stringify({
            name: "unsupported-plugin",
            [component]: "./unsupported-component.json",
          }),
        },
      ]);

      await expect(
        importer.prepare({
          kind: "zip",
          bytes: archive,
          filename: "plugin.zip",
        }),
      ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
    },
  );

  it("does not treat PDF command placeholders as credential declarations", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "pdf/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "pdf",
          version: "26.715.12143",
          description: "Read, create, inspect, render, and verify PDF files.",
          skills: "./skills/",
        }),
      },
      {
        path: "pdf/skills/pdf/SKILL.md",
        bytes: [
          "---",
          'name: "pdf"',
          "---",
          "",
          "## Environment",
          "",
          "No required environment variables.",
          "",
          "```bash",
          'pdftoppm -png "$INPUT_PDF" "$OUTPUT_PREFIX"',
          "```",
        ].join("\n"),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "pdf.zip",
    });

    expect(prepared.riskSummary).toMatchObject({
      requires_environment_variables: false,
      requires_credentials: false,
      declared_environment_keys: [],
    });
    await importer.cleanup(prepared);
  });

  it("keeps an MCP bearer-token environment declaration as a credential", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "github/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "github",
          mcpServers: "./.mcp.json",
        }),
      },
      {
        path: "github/.mcp.json",
        bytes: JSON.stringify({
          mcpServers: {
            github: {
              type: "http",
              url: "https://api.github.example/mcp/",
              bearer_token_env_var: "GITHUB_PAT_TOKEN",
            },
          },
        }),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "github.zip",
    });

    expect(prepared.riskSummary).toMatchObject({
      contains_mcp_server: true,
      requires_environment_variables: true,
      requires_credentials: true,
      declared_environment_keys: ["GITHUB_PAT_TOKEN"],
      mcp_environment_references: [
        {
          mcp_server: "github",
          env_key: "GITHUB_PAT_TOKEN",
          source: "local",
          usage: "bearer_token",
          http_header: null,
        },
      ],
    });
    await importer.cleanup(prepared);
  });

  it("preserves duplicate native references by MCP while grouping bindable keys", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "multi-mcp/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "multi-mcp",
          mcpServers: "./.mcp.json",
        }),
      },
      {
        path: "multi-mcp/.mcp.json",
        bytes: JSON.stringify({
          mcpServers: {
            first: {
              command: "node",
              args: ["first.mjs"],
              env_vars: [
                "SHARED_TOKEN",
                "SHARED_TOKEN",
                { name: "REMOTE_REGION", source: "remote" },
              ],
              env: { STATIC_MODE: "read-only" },
            },
            second: {
              url: "https://mcp.example.test",
              bearer_token_env_var: "SHARED_TOKEN",
              env_http_headers: {
                "X-Workspace-Key": "WORKSPACE_TOKEN",
              },
            },
          },
        }),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "multi-mcp.zip",
    });

    expect(prepared.riskSummary.declared_environment_keys).toEqual([
      "SHARED_TOKEN",
      "WORKSPACE_TOKEN",
    ]);
    expect(prepared.riskSummary.mcp_environment_references).toEqual([
      {
        mcp_server: "first",
        env_key: "SHARED_TOKEN",
        source: "local",
        usage: "stdio_env_var",
        http_header: null,
      },
      {
        mcp_server: "first",
        env_key: "SHARED_TOKEN",
        source: "local",
        usage: "stdio_env_var",
        http_header: null,
      },
      {
        mcp_server: "first",
        env_key: "REMOTE_REGION",
        source: "remote",
        usage: "stdio_env_var",
        http_header: null,
      },
      {
        mcp_server: "second",
        env_key: "SHARED_TOKEN",
        source: "local",
        usage: "bearer_token",
        http_header: null,
      },
      {
        mcp_server: "second",
        env_key: "WORKSPACE_TOKEN",
        source: "local",
        usage: "http_header",
        http_header: "X-Workspace-Key",
      },
    ]);
    await importer.cleanup(prepared);
  });

  it("extracts every native bindable key without truncating large MCP declarations", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const environmentKeys = Array.from(
      { length: 201 },
      (_, index) => `PLUGIN_KEY_${index.toString().padStart(3, "0")}`,
    );
    const archive = createStoredZip([
      {
        path: "large-mcp/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "large-mcp",
          mcpServers: {
            large: {
              command: "node",
              env_vars: environmentKeys,
            },
          },
        }),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "large-mcp.zip",
    });

    expect(prepared.riskSummary.declared_environment_keys).toEqual(
      environmentKeys,
    );
    expect(prepared.riskSummary.mcp_environment_references).toHaveLength(201);
    await importer.cleanup(prepared);
  });

  it("rejects an invalid native MCP environment source with a stable reason", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "invalid-mcp/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "invalid-mcp",
          mcpServers: {
            invalid: {
              command: "node",
              env_vars: [{ name: "API_KEY", source: "vault" }],
            },
          },
        }),
      },
    ]);

    await expect(
      importer.prepare({
        kind: "zip",
        bytes: archive,
        filename: "invalid-mcp.zip",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "plugin_mcp_configuration_invalid" },
    });
  });

  it("accepts only an in-package raster Logo and never persists an external path", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "with-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "with-logo",
          interface: { logo: "./assets/logo.png" },
        }),
      },
      {
        path: "with-logo/assets/logo.png",
        bytes: ONE_PIXEL_PNG,
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "plugin.zip",
    });

    expect(prepared.logo).toMatchObject({
      filename: "logo.png",
      contentType: "image/png",
    });
    expect(prepared.manifest).not.toHaveProperty("logo");
    await importer.cleanup(prepared);
  });

  it("rejects an in-package Logo whose extension does not match its image content", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "forged-package-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "forged-package-logo",
          interface: { logo: "./assets/logo.jpg" },
        }),
      },
      { path: "forged-package-logo/assets/logo.jpg", bytes: ONE_PIXEL_PNG },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_LOGO_UPLOAD_INVALID" });
  });

  it("rejects a manifest Logo path outside the package root", async () => {
    const root = await temporaryDirectory();
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
    });
    const archive = createStoredZip([
      {
        path: "unsafe-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "unsafe-logo",
          interface: { logo: "../outside.png" },
        }),
      },
      {
        path: "outside.png",
        bytes: ONE_PIXEL_PNG,
      },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
  });

  it("downloads an external Logo through the same SSRF controls and keeps its URL out of metadata", async () => {
    const root = await temporaryDirectory();
    const fetcher = vi.fn(
      async () =>
        new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(ONE_PIXEL_PNG.length),
          },
        }),
    ) as unknown as typeof fetch;
    const lookup = vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup;
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
      fetcher,
      lookup,
    });
    const externalUrl = "https://assets.example/team-logo.png";
    const archive = createStoredZip([
      {
        path: "remote-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "remote-logo",
          interface: { logo: externalUrl },
        }),
      },
    ]);

    const prepared = await importer.prepare({
      kind: "zip",
      bytes: archive,
      filename: "plugin.zip",
    });

    expect(prepared.logo).toMatchObject({
      filename: "team-logo.png",
      contentType: "image/png",
    });
    expect(JSON.stringify(prepared.manifest)).not.toContain(externalUrl);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await importer.cleanup(prepared);
  });

  it("rejects an external Logo redirected to a loopback address before fetching it", async () => {
    const root = await temporaryDirectory();
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private-logo.png" },
        }),
    ) as unknown as typeof fetch;
    const lookup = vi.fn(async (hostname: string): Promise<LookupAddress[]> =>
      hostname === "assets.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }],
    ) as unknown as typeof import("node:dns").promises.lookup;
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
      fetcher,
      lookup,
    });
    const archive = createStoredZip([
      {
        path: "redirected-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "redirected-logo",
          interface: { logo: "https://assets.example/logo.png" },
        }),
      },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_LOGO_UPLOAD_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an external Logo with forged MIME or extension", async () => {
    const root = await temporaryDirectory();
    const fetcher = vi.fn(
      async () =>
        new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    ) as unknown as typeof fetch;
    const lookup = vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup;
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
      fetcher,
      lookup,
    });
    const archive = createStoredZip([
      {
        path: "forged-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "forged-logo",
          interface: { logo: "https://assets.example/logo.jpg" },
        }),
      },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_LOGO_UPLOAD_INVALID" });
  });

  it("rejects an external Logo that exceeds the configured byte limit", async () => {
    const root = await temporaryDirectory();
    const fetcher = vi.fn(
      async () =>
        new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(ONE_PIXEL_PNG.length),
          },
        }),
    ) as unknown as typeof fetch;
    const lookup = vi.fn(async (): Promise<LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
    ]) as unknown as typeof import("node:dns").promises.lookup;
    const importer = new CapabilityPackageImporter({
      stagingRoot: join(root, "staging"),
      fetcher,
      lookup,
      limits: { logoBytes: ONE_PIXEL_PNG.length - 1 },
    });
    const archive = createStoredZip([
      {
        path: "oversized-logo/.codex-plugin/plugin.json",
        bytes: JSON.stringify({
          name: "oversized-logo",
          interface: { logo: "https://assets.example/logo.png" },
        }),
      },
    ]);

    await expect(
      importer.prepare({ kind: "zip", bytes: archive, filename: "plugin.zip" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_LOGO_UPLOAD_INVALID" });
  });

  it("rejects a forged image signature without a valid image header", () => {
    expect(
      detectSafeRasterImage(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      ),
    ).toBeNull();
  });

  it("blocks private, loopback, link-local and mixed DNS answers", async () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.1.2.3")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);

    const lookup = vi.fn(async () => [
      { address: "203.0.113.10", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]) as unknown as Parameters<typeof assertPublicHttpUrl>[1];
    await expect(
      assertPublicHttpUrl(
        new URL("https://packages.example/archive.zip"),
        lookup,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_FAILED" });
  });

  it("atomically replaces current and can roll back without dirty shadow directories", async () => {
    const root = await temporaryDirectory();
    const oldCurrent = join(root, "capability", "current");
    const incoming = join(root, "incoming");
    await mkdir(oldCurrent, { recursive: true });
    await mkdir(incoming);
    await writeFile(join(oldCurrent, "value.txt"), "old");
    await writeFile(join(incoming, "value.txt"), "new");

    const replacement = await stageAtomicDirectoryReplacement(
      incoming,
      join(root, "capability"),
    );
    await expect(
      readFile(join(replacement.currentDirectory, "value.txt"), "utf8"),
    ).resolves.toBe("new");
    await replacement.rollback();
    await expect(readFile(join(oldCurrent, "value.txt"), "utf8")).resolves.toBe(
      "old",
    );
  });

  it("rejects non-HTTP protocols and URL credentials before network I/O", async () => {
    const lookup = vi.fn() as unknown as Parameters<
      typeof assertPublicHttpUrl
    >[1];
    for (const value of [
      "file:///etc/passwd",
      "https://user:password@example.com/archive.zip",
      "https://example.com:8443/archive.zip",
    ]) {
      await expect(
        assertPublicHttpUrl(new URL(value), lookup),
      ).rejects.toBeInstanceOf(AppError);
    }
    expect(lookup).not.toHaveBeenCalled();
  });
});

function remoteFile(path: string, bytes: Buffer) {
  return {
    path,
    bytes,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function temporaryDirectory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "linksense-capability-test-"));
  temporaryDirectories.push(value);
  return value;
}

interface ZipEntry {
  path: string;
  bytes: string | Buffer;
  externalFileAttributes?: number;
}

function createStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const bytes = Buffer.isBuffer(entry.bytes)
      ? entry.bytes
      : Buffer.from(entry.bytes, "utf8");
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, bytes);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(
      entry.externalFileAttributes ??
        (entry.path.endsWith("/") ? (0o40755 << 16) >>> 0 : 0),
      38,
    );
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
