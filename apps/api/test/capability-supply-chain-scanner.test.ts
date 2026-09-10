import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  capabilitySupplyChainRulesetVersion,
  capabilitySupplyChainScannerVersion,
} from "@linksense/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCapabilitySupplyChainApproval,
  assertCapabilitySupplyChainReviewCurrent,
  scanCapabilitySupplyChain,
} from "../src/modules/capabilities/supply-chain-scanner.js";

const temporaryDirectories: string[] = [];

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

    const first = await scanCapabilitySupplyChain(root);
    const second = await scanCapabilitySupplyChain(root);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      scanner_version: capabilitySupplyChainScannerVersion,
      ruleset_version: capabilitySupplyChainRulesetVersion,
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

    const review = await scanCapabilitySupplyChain(root);

    expect(review.verdict).toBe("warnings");
    expect(review.highest_severity).toBe("medium");
    expect(review.findings).toContainEqual({
      rule_id: "shell_command_execution",
      severity: "medium",
      path: "scripts/run.js",
      line: 1,
    });
    expect(() => assertCapabilitySupplyChainApproval(review)).not.toThrow();
  });

  it("blocks embedded credentials without returning the secret as evidence", async () => {
    const token = `github_pat_${"A".repeat(30)}`;
    const root = await packageDirectory({
      "SKILL.md": `---\nname: leaked-secret\n---\n\nToken: ${token}\n`,
    });

    const review = await scanCapabilitySupplyChain(root);

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
    const review = await scanCapabilitySupplyChain(root);
    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: changed-skill\n---\n\nChanged\n",
    );
    const changed = await scanCapabilitySupplyChain(root);

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
});

async function packageDirectory(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-supply-chain-"));
  temporaryDirectories.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}
