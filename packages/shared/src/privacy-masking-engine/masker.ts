import { createHmac } from "node:crypto";

import type {
  PrivacyMaskingAction,
  PrivacyMaskingKind,
  PrivacyMaskingRuntime,
} from "../privacy-masking.js";

import { looksLikeSecretFieldValue, privacyRules, type PrivacyRule } from "./rules.js";

export type MaskContext = "plain" | "embedded-json";

export type PrivacyMaskHit = {
  kind: PrivacyMaskingKind;
  placeholder: string;
  action: PrivacyMaskingAction;
  length: number;
};

type Span = {
  start: number;
  end: number;
  kind: PrivacyMaskingKind;
  value: string;
};

type CacheEntry = {
  text: string;
  hits: PrivacyMaskHit[];
};

const HASH_LENGTH = 16;
const MAX_HASH_LENGTH = 32;
const MAX_VALUES = 200_000;
const CACHE_MAX_ENTRIES = 512;
const CACHE_MAX_CHARS = 8_000_000;

const placeholderPattern = /\{\{([A-Z][A-Z0-9_]*)_([0-9a-f]{16,32})\}\}/gu;
const jsonTokenPattern = /("(?:[^"\\]|\\[\s\S])*")([ \t\r\n]*:[ \t\r\n]*)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu;
const wordRunePattern = /(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}_])/u;
const digitRunePattern = /\p{Nd}/u;

function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildWordPattern(
  words: readonly string[],
  anyCase: boolean,
  whole: boolean,
): RegExp | null {
  if (words.length === 0) return null;
  const alternatives = [...words]
    .sort((left, right) => right.length - left.length)
    .map((word) => {
      const literal = escapeRegExp(word);
      if (!whole) return literal;
      const runes = [...word];
      const first = runes[0] ?? "";
      const last = runes.at(-1) ?? "";
      const left = wordRunePattern.test(first) ? `(?<!${wordRunePattern.source})` : "";
      const right = wordRunePattern.test(last) ? `(?!${wordRunePattern.source})` : "";
      const decimalLeft = digitRunePattern.test(first) ? String.raw`(?<!\p{Nd}\.)` : "";
      const decimalRight = digitRunePattern.test(last) ? String.raw`(?!\.\p{Nd})` : "";
      return `${left}${decimalLeft}${literal}${right}${decimalRight}`;
    })
    .join("|");
  return new RegExp(`(?:${alternatives})`, anyCase ? "giu" : "gu");
}

function hasMarker(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

function resolveOverlaps(spans: Span[]): Span[] {
  if (spans.length <= 1) return spans;
  const sorted = [...spans].sort(
    (left, right) =>
      left.start - right.start || right.end - left.end,
  );
  const selected: Span[] = [];
  let lastEnd = -1;
  for (const span of sorted) {
    if (span.start < lastEnd) continue;
    selected.push(span);
    lastEnd = span.end;
  }
  return selected;
}

function collectRuleSpans(
  text: string,
  lower: string,
  rule: PrivacyRule,
  spans: Span[],
): void {
  if (!hasMarker(lower, rule.markers)) return;
  const group = rule.group ?? 0;
  for (const match of text.matchAll(rule.pattern)) {
    const indices = match.indices?.[group];
    if (!indices) continue;
    const [start, end] = indices;
    const value = text.slice(start, end);
    if (rule.validate && !rule.validate(value, match)) continue;
    spans.push({ start, end, kind: rule.kind, value });
  }
}

export class PrivacyMasker {
  private readonly values = new Map<string, string>();
  private readonly cache = new Map<string, CacheEntry>();
  private cacheChars = 0;
  private readonly wordPattern: RegExp | null;
  private readonly allow: ReadonlySet<string>;
  private readonly actions: Readonly<Record<string, PrivacyMaskingAction>>;

  constructor(private readonly config: PrivacyMaskingRuntime) {
    const words = [...new Set(config.words.map((word) => word.trim()))].filter(
      (word) => word.length > 0,
    );
    this.wordPattern = buildWordPattern(
      words,
      config.words_any_case,
      config.words_whole,
    );
    this.allow = new Set(
      config.allow.map((value) => value.trim().toLowerCase()),
    );
    this.actions = config.actions;
  }

  maskText(
    text: string,
    context: MaskContext = "plain",
  ): { text: string; hits: PrivacyMaskHit[] } {
    if (text.length === 0) return { text, hits: [] };
    const cacheKey = `${context}\u0000${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = context === "embedded-json" ? this.maskJson(text) : this.maskPlainText(text);
    this.remember(cacheKey, result);
    return result;
  }

  private maskJson(text: string): CacheEntry {
    if (!text.trim()) return { text, hits: [] };
    JSON.parse(text);

    const hits: PrivacyMaskHit[] = [];
    let property: { valueOffset: number; name: string } | undefined;
    const masked = text.replace(
      jsonTokenPattern,
      (
        token: string,
        quoted: string | undefined,
        separator: string | undefined,
        offset: number,
      ) => {
        const decoded: unknown = quoted === undefined ? token : JSON.parse(quoted);
        if (typeof decoded !== "string") throw new Error("Invalid JSON string");
        const field = property?.valueOffset === offset ? property.name : undefined;
        property = separator === undefined
          ? undefined
          : { name: decoded, valueOffset: offset + token.length };
        const replaceable = quoted !== undefined && separator === undefined;
        const result = this.maskPlainText(decoded, field);
        for (const hit of result.hits) {
          hits.push(!replaceable && hit.action === "mask" ? { ...hit, action: "block" } : hit);
        }
        return replaceable && result.text !== decoded ? JSON.stringify(result.text) : token;
      },
    );
    return { text: masked, hits };
  }

  private maskPlainText(text: string, field?: string): CacheEntry {
    const spans: Span[] = [];
    if (this.config.secrets) {
      const lower = text.toLowerCase();
      for (const rule of privacyRules) {
        collectRuleSpans(text, lower, rule, spans);
      }
      if (field !== undefined && looksLikeSecretFieldValue(field, text)) {
        spans.push({ start: 0, end: text.length, kind: "SECRET", value: text });
      }
    }
    if (this.wordPattern) {
      for (const match of text.matchAll(this.wordPattern)) {
        const value = match[0];
        const start = match.index;
        spans.push({ start, end: start + value.length, kind: "TERM", value });
      }
    }

    const hits: PrivacyMaskHit[] = [];
    const chunks: string[] = [];
    let lastEnd = 0;
    for (const span of resolveOverlaps(spans)) {
      const raw = span.value;
      if (this.allow.has(raw.toLowerCase())) continue;
      const action = this.actions[span.kind] ?? "mask";
      if (action === "warn") {
        hits.push({
          kind: span.kind,
          placeholder: this.tag(span.kind, raw, HASH_LENGTH),
          action,
          length: raw.length,
        });
        continue;
      }
      const placeholder = this.placeholder(span.kind, raw);
      chunks.push(text.slice(lastEnd, span.start), placeholder);
      lastEnd = span.end;
      hits.push({
        kind: span.kind,
        placeholder,
        action,
        length: raw.length,
      });
    }

    return {
      text: lastEnd === 0 ? text : chunks.concat(text.slice(lastEnd)).join(""),
      hits,
    };
  }

  restoreText(
    text: string,
    context: MaskContext = "plain",
  ): string {
    if (text.length === 0 || !text.includes("{{")) return text;
    return text.replace(placeholderPattern, (placeholder) => {
      const value = this.values.get(placeholder);
      if (value === undefined) return placeholder;
      return context === "embedded-json"
        ? escapeJsonString(value)
        : value;
    });
  }

  /** The placeholders this run knows; restore leaves anything else alone. */
  knows(placeholder: string): boolean {
    return this.values.has(placeholder);
  }

  private tag(
    kind: PrivacyMaskingKind,
    value: string,
    length: number,
  ): string {
    const hash = createHmac("sha256", this.config.placeholder_key)
      .update(`${kind}\u0000${value}`)
      .digest("hex")
      .slice(0, length);
    return `{{${kind}_${hash}}}`;
  }

  private placeholder(kind: PrivacyMaskingKind, value: string): string {
    let length = HASH_LENGTH;
    let placeholder = this.tag(kind, value, length);
    while (
      length < MAX_HASH_LENGTH &&
      this.values.get(placeholder) !== undefined &&
      this.values.get(placeholder) !== value
    ) {
      length += 8;
      placeholder = this.tag(kind, value, length);
    }
    const existing = this.values.get(placeholder);
    if (existing === value) {
      // Keep recently used values away from eviction.
      this.values.delete(placeholder);
      this.values.set(placeholder, value);
      return placeholder;
    }
    if (this.values.size >= MAX_VALUES) {
      const remove = Math.max(1, Math.floor(this.values.size / 10));
      let removed = 0;
      for (const key of this.values.keys()) {
        this.values.delete(key);
        if (++removed >= remove) break;
      }
    }
    this.values.set(placeholder, value);
    return placeholder;
  }

  private remember(key: string, entry: CacheEntry): void {
    if (entry.text.length > CACHE_MAX_CHARS) return;
    const previous = this.cache.get(key);
    if (previous) {
      this.cacheChars -= previous.text.length;
      this.cache.delete(key);
    }
    while (
      this.cache.size >= CACHE_MAX_ENTRIES ||
      this.cacheChars + entry.text.length > CACHE_MAX_CHARS
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.cache.get(oldest);
      if (removed) this.cacheChars -= removed.text.length;
      this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
    this.cacheChars += entry.text.length;
  }
}
