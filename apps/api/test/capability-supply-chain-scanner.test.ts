import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  capabilitySupplyChainRulesetVersion,
  capabilitySupplyChainScannerVersion,
} from "@linksense/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCapabilitySupplyChainExecutionAdmission,
  assertCapabilitySupplyChainApproval,
  assertCapabilitySupplyChainReviewCurrent,
  scanCapabilitySupplyChain,
} from "../src/modules/capabilities/supply-chain-scanner.js";

const temporaryDirectories: string[] = [];
const scanTime = new Date("2026-09-11T08:00:00.000Z");
const scanOptions = { now: () => scanTime };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("capability supply-chain scanner", () => {
  it("produces a versioned content-bound pass for a clean package", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: safe-skill\n---\n\nSummarize the input file.\n",
      "references/guide.md": "Use the provided source material.\n",
    });

    const first = await scanCapabilitySupplyChain(root, scanOptions);
    const second = await scanCapabilitySupplyChain(root, scanOptions);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      scanner_version: capabilitySupplyChainScannerVersion,
      ruleset_version: capabilitySupplyChainRulesetVersion,
      scanned_at: scanTime.toISOString(),
      verdict: "passed",
      highest_severity: null,
      finding_count: 0,
      findings: [],
      findings_truncated: false,
      scanned_file_count: 2,
      skipped_file_count: 0,
      content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(() => assertCapabilitySupplyChainApproval(first)).not.toThrow();
  });

  it("reports warning-level execution behavior with file and line evidence", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: script-skill\n---\n\nRun the bundled helper.\n",
      "scripts/run.js": [
        'import { execSync } from "node:child_process";',
        'execSync("pnpm --version");',
      ].join("\n"),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review.verdict).toBe("warnings");
    expect(review.highest_severity).toBe("medium");
    expect(review.findings).toContainEqual(expect.objectContaining({
      scanner_version: capabilitySupplyChainScannerVersion,
      rule_id: "shell_command_execution",
      severity: "medium",
      path: "scripts/run.js",
      line: 1,
      evidence: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      remediation: "review_or_remove:shell_command_execution",
    }));
    expect(() => assertCapabilitySupplyChainApproval(review)).not.toThrow();
  });

  it("blocks embedded credentials without returning the secret as evidence", async () => {
    const token = `github_pat_${"A".repeat(30)}`;
    const root = await packageDirectory({
      "SKILL.md": `---\nname: leaked-secret\n---\n\nToken: ${token}\n`,
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      highest_severity: "critical",
      finding_count: 1,
      findings: [
        {
          rule_id: "embedded_access_token",
          severity: "critical",
          path: "SKILL.md",
          line: 5,
        },
      ],
    });
    expect(JSON.stringify(review)).not.toContain(token);
    expect(() => assertCapabilitySupplyChainApproval(review)).toThrowError(
      expect.objectContaining({
        code: "INVALID_PACKAGE",
        params: {
          reason_code: "security_review_blocked",
          finding_count: 1,
        },
      }),
    );
  });

  it("invalidates a reviewed package after its content changes", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: changed-skill\n---\n\nOriginal\n",
    });
    const review = await scanCapabilitySupplyChain(root, scanOptions);
    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: changed-skill\n---\n\nChanged\n",
    );
    const changed = await scanCapabilitySupplyChain(root, scanOptions);

    expect(changed.content_sha256).not.toBe(review.content_sha256);
    expect(() =>
      assertCapabilitySupplyChainReviewCurrent(
        review,
        changed.content_sha256,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_PACKAGE",
        params: { reason_code: "security_review_stale" },
      }),
    );
  });

  it("blocks a fork bomb even when it is stored in an extensionless file", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: unsafe-skill\n---\n",
      payload: ":(){ :|:& };:\n",
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      highest_severity: "critical",
      findings: [
        expect.objectContaining({
          rule_id: "fork_bomb",
          severity: "critical",
          path: "payload",
          line: 1,
        }),
      ],
    });
  });

  it("fails closed for executable binary payloads that cannot be scanned", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: binary-skill\n---\n",
      "bin/tool": "binary\0payload",
    });
    await chmod(join(root, "bin/tool"), 0o700);

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      highest_severity: "critical",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_executable",
          severity: "critical",
          path: "bin/tool",
          line: null,
        }),
      ],
    });
    expect(review.skipped_file_count).toBe(1);
  });

  it("fails closed for an extensionless interpreter target containing a NUL", async () => {
    const token = `github_pat_${"A".repeat(30)}`;
    const root = await packageDirectory({
      "SKILL.md": [
        "---",
        "name: interpreter-target",
        "---",
        "",
        "Run `node scripts/helper`.",
      ].join("\n"),
      "scripts/helper": Buffer.from(
        `/* binary marker \0 */\nconst token = "${token}";\n`,
      ),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      highest_severity: "critical",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          severity: "critical",
          path: "scripts/helper",
          line: null,
        }),
      ],
      skipped_file_count: 1,
    });
    expect(JSON.stringify(review)).not.toContain(token);
  });

  it("fails closed when a bare option separator precedes an extensionless interpreter target", async () => {
    const root = await packageDirectory({
      "SKILL.md": [
        "---",
        "name: separated-interpreter-target",
        "---",
        "",
        "Run `node -- assets/helper`.",
      ].join("\n"),
      "assets/helper": Buffer.from(
        "/* binary marker \0 */\nconsole.log('ready');\n",
      ),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "assets/helper",
        }),
      ],
    });
  });

  it("fails closed when an absolute interpreter path targets an extensionless file", async () => {
    const root = await packageDirectory({
      "SKILL.md": [
        "---",
        "name: absolute-interpreter-target",
        "---",
        "",
        "Run `/opt/linksense/bin/node -- assets/helper`.",
      ].join("\n"),
      "assets/helper": Buffer.from(
        "/* binary marker \0 */\nconsole.log('ready');\n",
      ),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "assets/helper",
        }),
      ],
    });
  });

  it("rejects execution admission for a structured native MCP interpreter target containing a NUL", async () => {
    const root = await packageDirectory({
      ".codex-plugin/plugin.json": JSON.stringify({
        name: "structured-interpreter-target",
        mcpServers: "./.mcp.json",
      }),
      ".mcp.json": JSON.stringify({
        mcpServers: {
          helper: {
            command: "node",
            args: ["--", "./assets/helper"],
          },
        },
      }),
      "assets/helper": Buffer.from(
        "/* binary marker \0 */\nconsole.log('ready');\n",
      ),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "assets/helper",
        }),
      ],
    });
    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, review),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_blocked" },
    });
  });

  it("fails closed for a binary-looking file with an interpreter shebang", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: shebang-skill\n---\n",
      "helpers/run": Buffer.from("#!/usr/bin/env node\n/* marker \0 */\n"),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "helpers/run",
        }),
      ],
    });
  });

  it("allows passive non-executable binary assets outside executable paths", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: asset-skill\n---\n",
      "assets/reference.pdf": Buffer.from("%PDF-1.7\n\0binary asset"),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "passed",
      highest_severity: null,
      finding_count: 0,
      findings: [],
      scanned_file_count: 1,
      skipped_file_count: 1,
    });
  });

  it("fails closed when a recognized binary path is passed to an interpreter", async () => {
    const root = await packageDirectory({
      "SKILL.md": [
        "---",
        "name: polyglot-skill",
        "---",
        "",
        "Run `node assets/payload.gif`.",
      ].join("\n"),
      "assets/payload.gif": Buffer.from("GIF89a=0;/*\0*/\n"),
    });

    const review = await scanCapabilitySupplyChain(root, scanOptions);

    expect(review).toMatchObject({
      verdict: "blocked",
      findings: [
        expect.objectContaining({
          rule_id: "unscannable_interpretable_file",
          path: "assets/payload.gif",
        }),
      ],
    });
  });

  it("rescans actual content and rejects a current blocked payload despite a forged pass", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: forged-review\n---\n",
      payload: ":(){ :|:& };:\n",
    });
    const actualReview = await scanCapabilitySupplyChain(root, scanOptions);
    const forgedApproval = {
      ...actualReview,
      verdict: "passed" as const,
      highest_severity: null,
      finding_count: 0,
      findings: [],
    };

    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, forgedApproval),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_blocked" },
    });
  });

  it("rejects an approval verdict that disagrees with the current scan", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: warning-review\n---\n",
      "scripts/run.js": 'import "node:child_process";\n',
    });
    const currentReview = await scanCapabilitySupplyChain(root, scanOptions);

    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, {
        ...currentReview,
        verdict: "passed",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_stale" },
    });
  });

  it("fails closed when execution admission has no stored approval", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: missing-review\n---\n",
    });

    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, undefined),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_stale" },
    });
  });

  it("rejects approvals from an older scanner or ruleset", async () => {
    const root = await packageDirectory({
      "SKILL.md": "---\nname: stale-review\n---\n",
    });
    const review = await scanCapabilitySupplyChain(root, scanOptions);

    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, {
        ...review,
        scanner_version: "0.0.0",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_stale" },
    });
    await expect(
      assertCapabilitySupplyChainExecutionAdmission(root, {
        ...review,
        ruleset_version: "previous-ruleset",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_stale" },
    });
  });
});

async function packageDirectory(
  files: Record<string, string | Buffer>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-supply-chain-"));
  temporaryDirectories.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}
