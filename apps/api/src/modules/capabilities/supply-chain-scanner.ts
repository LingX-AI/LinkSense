import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, extname, join, posix, resolve } from "node:path";

import {
  capabilitySupplyChainContentDigestAlgorithm,
  capabilitySupplyChainReviewSchema,
  capabilitySupplyChainRulesetVersion,
  capabilitySupplyChainScannerVersion,
  type CapabilitySupplyChainFinding,
  type CapabilitySupplyChainReview,
} from "@linksense/shared";
import dayjs from "dayjs";

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
const EXECUTABLE_INTENT_DIRECTORIES = new Set(["bin", "hooks", "scripts"]);
const EXPLICIT_INTERPRETER_INVOCATION =
  /(?:^|[\s`;&|()])(?:\/usr\/bin\/env\s+)?(?:node(?:js)?|python(?:3(?:\.\d+)*)?|bash|sh|zsh|fish|ruby|perl|php|lua|tsx|ts-node)\s+(?:--?[A-Za-z0-9][A-Za-z0-9-]*(?:=[^\s]+)?\s+)*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z0-9_./-]+))/gmu;

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
  {
    ruleId: "fork_bomb",
    severity: "critical",
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/u,
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
  options: { now?: () => Date } = {},
): Promise<CapabilitySupplyChainReview> {
  const absoluteRoot = resolve(packageRoot);
  const files = await listPackageDirectoryFiles(absoluteRoot);
  const contentSha256 = await hashPackageDirectory(absoluteRoot);
  const explicitInterpreterTargets = await findExplicitInterpreterTargets(
    absoluteRoot,
    files,
  );
  const findings: CapabilitySupplyChainFinding[] = [];
  let scannedFileCount = 0;
  let skippedFileCount = 0;

  for (const relativePath of files) {
    const absolutePath = join(absoluteRoot, relativePath);
    const info = await lstat(absolutePath);
    const executable = (info.mode & 0o111) !== 0;
    if (info.size > MAX_SCANNABLE_FILE_BYTES) {
      if (
        isScannablePath(relativePath) ||
        executable ||
        explicitInterpreterTargets.has(relativePath) ||
        hasExecutablePathIntent(relativePath)
      ) {
        findings.push(
          createFinding({
            ruleId: "oversized_scannable_file",
            severity:
              executable ||
              isExecutableSource(relativePath) ||
              explicitInterpreterTargets.has(relativePath) ||
              hasExecutablePathIntent(relativePath)
                ? "critical"
                : "high",
            path: relativePath,
            line: null,
            evidence: `size:${info.size}`,
          }),
        );
      }
      skippedFileCount += 1;
      continue;
    }
    const bytes = await readFile(absolutePath);
    if (looksBinary(bytes)) {
      if (executable) {
        findings.push(
          createFinding({
            ruleId: "unscannable_executable",
            severity: "critical",
            path: relativePath,
            line: null,
            evidence: bytes,
          }),
        );
      } else if (
        isScannablePath(relativePath) ||
        explicitInterpreterTargets.has(relativePath) ||
        hasExecutablePathIntent(relativePath) ||
        hasInterpreterShebang(bytes)
      ) {
        findings.push(
          createFinding({
            ruleId: "unscannable_interpretable_file",
            severity: "critical",
            path: relativePath,
            line: null,
            evidence: bytes,
          }),
        );
      }
      skippedFileCount += 1;
      continue;
    }
    scannedFileCount += 1;
    const content = bytes.toString("utf8");
    for (const rule of FINDING_RULES) {
      const match = rule.pattern.exec(content);
      if (match?.index === undefined) continue;
      findings.push(
        createFinding({
          ruleId: rule.ruleId,
          severity: rule.severity,
          path: relativePath,
          line: lineNumberAt(content, match.index),
          evidence: match[0],
        }),
      );
    }
  }

  findings.sort(compareFindings);
  const highestSeverity = highestFindingSeverity(findings);
  return {
    scanner_version: capabilitySupplyChainScannerVersion,
    ruleset_version: capabilitySupplyChainRulesetVersion,
    scanned_at: dayjs(options.now?.() ?? new Date()).toISOString(),
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

function createFinding(input: {
  ruleId: CapabilitySupplyChainFinding["rule_id"];
  severity: CapabilitySupplyChainFinding["severity"];
  path: string;
  line: number | null;
  evidence: string | Buffer;
}): CapabilitySupplyChainFinding {
  return {
    scanner_version: capabilitySupplyChainScannerVersion,
    rule_id: input.ruleId,
    severity: input.severity,
    path: input.path,
    line: input.line,
    evidence: `sha256:${createHash("sha256").update(input.evidence).digest("hex")}`,
    remediation: `review_or_remove:${input.ruleId}`,
  };
}

export function assertCapabilitySupplyChainApproval(
  review: CapabilitySupplyChainReview | undefined,
  expectedContentSha256?: string,
): asserts review is CapabilitySupplyChainReview {
  assertCapabilitySupplyChainReviewCurrent(review, expectedContentSha256);
  if (review.verdict === "blocked") {
    throw new AppError("INVALID_PACKAGE", {
      reason_code: "security_review_blocked",
      finding_count: review.finding_count,
    });
  }
}

export async function assertCapabilitySupplyChainExecutionAdmission(
  packageRoot: string,
  approvedReview: CapabilitySupplyChainReview | undefined,
): Promise<void> {
  const currentReview = await scanCapabilitySupplyChain(packageRoot);

  // The approval is only advisory until the current scanner has inspected the
  // exact bytes that are about to cross the materialization boundary.
  assertCapabilitySupplyChainApproval(currentReview);
  assertCapabilitySupplyChainApproval(
    approvedReview,
    currentReview.content_sha256,
  );
  if (!sameDeterministicReview(approvedReview, currentReview)) {
    throw staleSupplyChainReviewError();
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
    throw staleSupplyChainReviewError();
  }
}

export function capabilitySupplyChainReviewFromRiskSummary(
  value: unknown,
): CapabilitySupplyChainReview | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const review = (value as Record<string, unknown>).supply_chain_review;
  if (review === undefined) return undefined;
  const parsed = capabilitySupplyChainReviewSchema.safeParse(review);
  if (!parsed.success) {
    throw staleSupplyChainReviewError();
  }
  return parsed.data;
}

function sameDeterministicReview(
  approved: CapabilitySupplyChainReview,
  current: CapabilitySupplyChainReview,
): boolean {
  return (
    approved.verdict === current.verdict &&
    approved.highest_severity === current.highest_severity &&
    approved.finding_count === current.finding_count &&
    approved.findings_truncated === current.findings_truncated &&
    approved.scanned_file_count === current.scanned_file_count &&
    approved.skipped_file_count === current.skipped_file_count &&
    approved.findings.length === current.findings.length &&
    approved.findings.every((finding, index) => {
      const currentFinding = current.findings[index];
      return (
        currentFinding !== undefined &&
        finding.scanner_version === currentFinding.scanner_version &&
        finding.rule_id === currentFinding.rule_id &&
        finding.severity === currentFinding.severity &&
        finding.path === currentFinding.path &&
        finding.line === currentFinding.line &&
        finding.evidence === currentFinding.evidence &&
        finding.remediation === currentFinding.remediation
      );
    })
  );
}

function staleSupplyChainReviewError(): AppError {
  return new AppError("INVALID_PACKAGE", {
    reason_code: "security_review_stale",
  });
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

function hasExecutablePathIntent(path: string): boolean {
  return (
    extname(path) === "" &&
    path
      .split("/")
      .some((segment) => EXECUTABLE_INTENT_DIRECTORIES.has(segment))
  );
}

function hasInterpreterShebang(bytes: Buffer): boolean {
  const firstLine = bytes
    .subarray(0, Math.min(bytes.length, 256))
    .toString("utf8");
  return /^#![^\r\n]*(?:node(?:js)?|python|bash|sh|zsh|fish|ruby|perl|php|lua|tsx|ts-node)\b/u.test(
    firstLine,
  );
}

async function findExplicitInterpreterTargets(
  packageRoot: string,
  files: readonly string[],
): Promise<ReadonlySet<string>> {
  const availableFiles = new Set(files);
  const targets = new Set<string>();
  for (const sourcePath of files) {
    if (!isScannablePath(sourcePath)) continue;
    const absolutePath = join(packageRoot, sourcePath);
    const info = await lstat(absolutePath);
    if (info.size > MAX_SCANNABLE_FILE_BYTES) continue;
    const bytes = await readFile(absolutePath);
    if (looksBinary(bytes)) continue;
    const content = bytes.toString("utf8");
    for (const match of content.matchAll(EXPLICIT_INTERPRETER_INVOCATION)) {
      const candidate = match[1] ?? match[2] ?? match[3];
      if (
        !candidate ||
        candidate.startsWith("/") ||
        candidate.includes("\0")
      ) {
        continue;
      }
      const normalizedFromRoot = normalizePackageRelativePath(candidate);
      const normalizedFromSource = normalizePackageRelativePath(
        posix.join(posix.dirname(sourcePath), candidate),
      );
      for (const normalized of [normalizedFromRoot, normalizedFromSource]) {
        if (normalized && availableFiles.has(normalized)) {
          targets.add(normalized);
        }
      }
    }
  }
  return targets;
}

function normalizePackageRelativePath(value: string): string | null {
  const normalized = posix.normalize(value.replace(/^\.\//u, ""));
  return normalized === ".." || normalized.startsWith("../")
    ? null
    : normalized;
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
