import type { PrivacyMaskingKind } from "@linksense/shared";

export type PrivacyRule = {
  kind: PrivacyMaskingKind;
  /** Global and hasIndices patterns; `group` is the value inside a match. */
  pattern: RegExp;
  group?: number;
  /** Lower-case markers; a rule runs only when one is present. */
  markers: readonly string[];
  validate?: (value: string, match: RegExpExecArray) => boolean;
};

const tokenBoundaryStart = String.raw`(?<![A-Za-z0-9_-])`;
const tokenBoundaryEnd = String.raw`(?![A-Za-z0-9_-])`;

function tokenPattern(body: string): RegExp {
  return new RegExp(`${tokenBoundaryStart}(?:${body})${tokenBoundaryEnd}`, "gd");
}

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u;

/**
 * A value assigned to a secret-looking name is only masked when it looks
 * like a value rather than a reference to one. This keeps `API_KEY =
 * process.env.API_KEY` and `token = requestToken` out of the masker.
 */
function looksLikeAssignedSecret(value: string, field: string): boolean {
  const trimmed = value.replace(/[).;]+$/u, "");
  if (trimmed.length < 4) return false;
  if (/^(?:\[REDACTED[^\]]*\]|\{\{[A-Z0-9_]+\}\})$/u.test(trimmed)) {
    return false;
  }
  if (/^(?:https?|ftp|file):\/\//iu.test(trimmed)) return false;
  if (/^(?:true|false|null|undefined|none|nil)$/iu.test(trimmed)) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*$/u.test(trimmed) && !/\d/u.test(trimmed)) {
    // A bare identifier: a variable, a sort key, a cache key.
    if (/\b(?:password|passwd|pwd)\b/iu.test(field)) {
      return trimmed.length >= 8;
    }
    return trimmed.length >= 24;
  }
  if (/^[/\\]/u.test(trimmed) && !/\d/u.test(trimmed)) return false;
  const passwordField = /\b(?:password|passwd|pwd|secret)\b/iu.test(field);
  if (passwordField) return trimmed.length >= 4;
  return trimmed.length >= 8 &&
    (trimmed.length >= 20 || /\d/u.test(trimmed) ||
      /[^A-Za-z0-9]/u.test(trimmed));
}

function looksLikeHeaderValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  if (/^(?:bearer|basic|digest|token|apikey)\s+\S+/iu.test(trimmed)) {
    return true;
  }
  // Cookie jars carry `name=value` pairs.
  if (/\S+=\S+/u.test(trimmed) && /[;]/u.test(trimmed)) return true;
  // Opaque session values are long and have no spaces.
  return trimmed.length >= 16 && !/\s/u.test(trimmed);
}

function isNotAQuantity(value: string): boolean {
  if (!/\d/u.test(value)) return true;
  return !/^(?:\d+(?:\.\d+)?)\s*(?:位|比特|字节|字節|个|個|次|秒|毫秒|分钟|分鐘|小时|小時|天|年|bit|byte|ms|sec|min|kb|mb|gb|tb)$/iu.test(
    value,
  );
}

export const privacyRules: readonly PrivacyRule[] = [
  {
    kind: "PRIVATE_KEY",
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]+?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/gd,
    markers: ["private key"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(
      String.raw`sk-(?:ant-|proj-|or-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}`,
    ),
    markers: ["sk-"],
    validate: (value) => !/^sk-[a-z0-9-]+$/u.test(value) || value.length >= 28,
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`[a-z]{2,4}_sk_[A-Za-z0-9_-]{20,}`),
    markers: ["_sk_"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`ark-[A-Za-z0-9][A-Za-z0-9_-]{15,}`),
    markers: ["ark-"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(
      String.raw`(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|glpat-[A-Za-z0-9_-]{20,})`,
    ),
    markers: ["gh", "github_pat_", "glpat-"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`AIza[0-9A-Za-z_-]{35}`),
    markers: ["aiza"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`xox[abposr]-[0-9A-Za-z-]{10,}`),
    markers: ["xox"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`(?:sk|rk)_live_[0-9A-Za-z]{20,}`),
    markers: ["_live_"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}`),
    markers: ["akia", "asia"],
  },
  {
    kind: "API_KEY",
    pattern: tokenPattern(
      String.raw`(?:hf_[A-Za-z0-9]{30,}|gsk_[A-Za-z0-9]{40,}|xai-[A-Za-z0-9]{40,}|npm_[A-Za-z0-9]{36}|pypi-[A-Za-z0-9_-]{50,}|dop_v1_[a-f0-9]{64}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})`,
    ),
    markers: ["hf_", "gsk_", "xai-", "npm_", "pypi-", "dop_v1_", "sg."],
  },
  {
    kind: "TOKEN",
    pattern: tokenPattern(
      String.raw`eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
    ),
    markers: ["eyj"],
  },
  {
    kind: "PASSWORD",
    pattern:
      /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/?#"'<>]*:([^\s@/?#"'<>]{3,})@/gd,
    group: 1,
    markers: ["://"],
    validate: (value) => !/^(?:\{\{|\$|<|%)/u.test(value),
  },
  {
    kind: "SECRET",
    pattern:
      /(?<![A-Za-z])(?:authorization|cookie)[ \t]*:[ \t]*([^\r\n]{8,})/gid,
    group: 1,
    markers: ["authorization", "cookie"],
    validate: looksLikeHeaderValue,
  },
  {
    kind: "SECRET",
    pattern:
      /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|password|passwd|pwd|secret|token))["']?[ \t]*[:=][ \t]*["']?((?:\\.|[^\s"',;}{\\]){8,})/gid,
    group: 2,
    markers: ["key", "secret", "token", "password", "passwd", "pwd", "authorization", "cookie"],
    validate: (value, match) =>
      looksLikeAssignedSecret(value, match[1] ?? "secret"),
  },
  {
    kind: "SECRET",
    pattern:
      /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|authorization|cookie|set[_-]?cookie|password|passwd|pwd|secret|token))["']?[ \t]*[:=][ \t]*["']([^"'\r\n]{4,})["']/gid,
    group: 2,
    markers: ["key", "secret", "token", "password", "passwd", "pwd", "authorization", "cookie"],
    validate: (value, match) =>
      looksLikeAssignedSecret(value, match[1] ?? "secret"),
  },
  {
    kind: "PASSWORD",
    pattern:
      /(?:密码|密碼|口令|パスワード|暗証番号|비밀번호|비번)[ \t]*(?:为|為|是|[:：=])[ \t]*["'“「]?([^\s"'“”」,，。；;]{3,})/gid,
    group: 1,
    markers: ["密码", "密碼", "口令", "パスワード", "暗証番号", "비밀번호", "비번"],
    validate: (value) => isNotAQuantity(value),
  },
  {
    kind: "SECRET",
    pattern:
      /(?:密钥|密鑰|金鑰|令牌|api[ ]?key|apikey|token|secret)[ \t]*(?:为|為|是|[:：=])[ \t]*["'“「]?([^\s"'“”」,，。；;]{3,})/gid,
    group: 1,
    markers: ["密钥", "密鑰", "金鑰", "令牌", "api key", "apikey", "token", "secret"],
    validate: (value) => isNotAQuantity(value) && !identifierPattern.test(value),
  },
];
