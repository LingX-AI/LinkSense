import { lstat, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import {
  capabilitySupplyChainContentDigestAlgorithm,
  capabilitySupplyChainRulesetVersion,
  capabilitySupplyChainScannerVersion,
  type CapabilitySupplyChainFinding,
  type CapabilitySupplyChainReview,
} from "@linksense/shared";

import {
  hashPackageDirectory,
  listPackageDirectoryFiles,
  packageDigestMatches,
} from "../../lib/package-directory-integrity.js";
import { AppError } from "../../lib/errors.js";

const MAX_SCANNABLE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 200;
const SCANNABLE_EXTENSIONS = new Set([
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".conf",
  ".env",
  ".fish",
  ".go",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".lua",
  ".md",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const SCANNABLE_FILENAMES = new Set([
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
]);
const EXECUTABLE_SOURCE_EXTENSIONS = new Set([
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".fish",
  ".js",
  ".jsx",
  ".lua",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".tsx",
  ".zsh",
]);

type FindingRule = {
  ruleId: CapabilitySupplyChainFinding["rule_id"];
  severity: CapabilitySupplyChainFinding["severity"];
  pattern: RegExp;
};

const FINDING_RULES: readonly FindingRule[] = [
  {
    ruleId: "embedded_private_key",
    severity: "critical",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/u,
  },
  {
    ruleId: "embedded_access_token",
    severity: "critical",
    pattern:
      /\b(?:github_pat_[A-Za-z0-9_]{22,255}|gh[opusr]_[A-Za-z0-9]{36,255}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/u,
  },
  {
    ruleId: "dynamic_code_execution",
    severity: "high",
    pattern:
      /(?:\b(?:eval|exec)\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(|\bvm\.(?:runIn|compileFunction))/u,
  },
  {
    ruleId: "shell_command_execution",
    severity: "medium",
    pattern:
      /(?:node:child_process|require\s*\(\s*["']child_process["']\s*\)|\b(?:execSync|spawnSync)\s*\(|\bsubprocess\.(?:run|Popen|call)\s*\(|\bos\.system\s*\(|\bshell\s*=\s*True\b)/u,
  },
  {
    ruleId: "download_and_execute",
    severity: "high",
    pattern:
      /\b(?:curl|wget)\b[^\r\n]{0,500}(?:\||&&)\s*(?:sudo\s+)?(?:ba|z|fi)?sh\b/u,
  },
  {
    ruleId: "sensitive_data_exfiltration",
    severity: "critical",
    pattern:
      /(?:(?:\.ssh|\.aws|\.env|\/etc\/(?:passwd|shadow)|id_(?:rsa|ed25519)|credentials)[^\r\n]{0,300}(?:curl|wget|fetch\s*\(|axios|requests\.|httpx\.)|(?:curl|wget|fetch\s*\(|axios|requests\.|httpx\.)[^\r\n]{0,300}(?:\.ssh|\.aws|\.env|\/etc\/(?:passwd|shadow)|id_(?:rsa|ed25519)|credentials))/iu,
  },
  {
    ruleId: "cloud_metadata_access",
    severity: "high",
    pattern:
      /(?:169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)/u,
  },
  {
    ruleId: "reverse_shell",
    severity: "critical",
    pattern:
      /(?:\/dev\/(?:tcp|udp)\/|\bnc\s+(?:-[^\s]+\s+)*-e\b|\bbash\s+-i\s+>&|\bsocat\b[^\r\n]{0,300}\bexec:)/iu,
  },
  {
    ruleId: "destructive_system_command",
    severity: "high",
    pattern:
      /(?:\brm\s+-rf\s+(?:\/|--no-preserve-root)|\bmkfs(?:\.[a-z0-9]+)?\b|\bdd\s+[^\r\n]*\bof=\/dev\/)/iu,
  },
  {
    ruleId: "startup_persistence",
    severity: "high",
    pattern:
      /(?:\/etc\/(?:cron\.|systemd\/system)|Library\/LaunchAgents|\bcrontab\s+(?:-[a-z]+\s+)*-?e\b|\bsystemctl\s+enable\b)/iu,
  },
];

const SEVERITY_ORDER: Record<CapabilitySupplyChainFinding["severity"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export async function scanCapabilitySupplyChain(
  packageRoot: string,
): Promise<CapabilitySupplyChainReview> {
  const absoluteRoot = resolve(packageRoot);
  const files = await listPackageDirectoryFiles(absoluteRoot);
  const contentSha256 = await hashPackageDirectory(absoluteRoot);
  const findings: CapabilitySupplyChainFinding[] = [];
  let scannedFileCount = 0;
  let skippedFileCount = 0;

  for (const relativePath of files) {
    if (!isScannablePath(relativePath)) {
      skippedFileCount += 1;
      continue;
    }
    const absolutePath = join(absoluteRoot, relativePath);
    const info = await lstat(absolutePath);
    if (info.size > MAX_SCANNABLE_FILE_BYTES) {
      findings.push({
        rule_id: "oversized_scannable_file",
        severity: isExecutableSource(relativePath) ? "critical" : "high",
        path: relativePath,
        line: null,
      });
      skippedFileCount += 1;
      continue;
    }
    const bytes = await readFile(absolutePath);
    if (looksBinary(bytes)) {
      skippedFileCount += 1;
      continue;
    }
    scannedFileCount += 1;
    const content = bytes.toString("utf8");
    for (const rule of FINDING_RULES) {
      const match = rule.pattern.exec(content);
      if (match?.index === undefined) continue;
      findings.push({
        rule_id: rule.ruleId,
        severity: rule.severity,
        path: relativePath,
        line: lineNumberAt(content, match.index),
      });
    }
  }

  findings.sort(compareFindings);
  const highestSeverity = highestFindingSeverity(findings);
  return {
    scanner_version: capabilitySupplyChainScannerVersion,
    ruleset_version: capabilitySupplyChainRulesetVersion,
    content_digest_algorithm: capabilitySupplyChainContentDigestAlgorithm,
    content_sha256: contentSha256,
    verdict:
      highestSeverity === "critical"
        ? "blocked"
        : highestSeverity === null
          ? "passed"
          : "warnings",
    highest_severity: highestSeverity,
    finding_count: findings.length,
    findings: findings.slice(0, MAX_FINDINGS),
    findings_truncated: findings.length > MAX_FINDINGS,
    scanned_file_count: scannedFileCount,
    skipped_file_count: skippedFileCount,
  };
}

export function assertCapabilitySupplyChainApproval(
  review: CapabilitySupplyChainReview | undefined,
  expectedContentSha256?: string,
): void {
  assertCapabilitySupplyChainReviewCurrent(review, expectedContentSha256);
  if (review.verdict === "blocked") {
    throw new AppError("INVALID_PACKAGE", {
      reason_code: "security_review_blocked",
      finding_count: review.finding_count,
    });
  }
}

export function assertCapabilitySupplyChainReviewCurrent(
  review: CapabilitySupplyChainReview | undefined,
  expectedContentSha256?: string,
): asserts review is CapabilitySupplyChainReview {
  if (
    review === undefined ||
    review.scanner_version !== capabilitySupplyChainScannerVersion ||
    review.ruleset_version !== capabilitySupplyChainRulesetVersion ||
    review.content_digest_algorithm !==
      capabilitySupplyChainContentDigestAlgorithm ||
    (expectedContentSha256 !== undefined &&
      !packageDigestMatches(review.content_sha256, expectedContentSha256))
  ) {
    throw new AppError("INVALID_PACKAGE", {
      reason_code: "security_review_stale",
    });
  }
}

function isScannablePath(path: string): boolean {
  const filename = basename(path).toLocaleLowerCase("en-US");
  return (
    SCANNABLE_FILENAMES.has(filename) ||
    SCANNABLE_EXTENSIONS.has(extname(filename))
  );
}

function isExecutableSource(path: string): boolean {
  return EXECUTABLE_SOURCE_EXTENSIONS.has(
    extname(path).toLocaleLowerCase("en-US"),
  );
}

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (content.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function compareFindings(
  left: CapabilitySupplyChainFinding,
  right: CapabilitySupplyChainFinding,
): number {
  return (
    left.path.localeCompare(right.path) ||
    (left.line ?? Number.MAX_SAFE_INTEGER) -
      (right.line ?? Number.MAX_SAFE_INTEGER) ||
    left.rule_id.localeCompare(right.rule_id)
  );
}

function highestFindingSeverity(
  findings: readonly CapabilitySupplyChainFinding[],
): CapabilitySupplyChainFinding["severity"] | null {
  let highest: CapabilitySupplyChainFinding["severity"] | null = null;
  for (const finding of findings) {
    if (
      highest === null ||
      SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[highest]
    ) {
      highest = finding.severity;
    }
  }
  return highest;
}
