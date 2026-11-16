import { createHmac } from "node:crypto";

import type {
  PrivacyMaskingAction,
  PrivacyMaskingKind,
  PrivacyMaskingRuntime,
} from "@linksense/shared";

import { privacyRules, type PrivacyRule } from "./rules.js";

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

function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** Values inside a tool call's arguments are JSON text, not decoded text. */
function unescapeJsonFragment(value: string): string {
  try {
    const parsed: unknown = JSON.parse(`"${value}"`);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
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
    .map(escapeRegExp)
    .join("|");
  const body = whole
    ? String.raw`(?<![\p{L}\p{N}_])(?:${alternatives})(?![\p{L}\p{N}_])`
    : `(?:${alternatives})`;
  return new RegExp(body, anyCase ? "giu" : "gu");
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

function boundEmbeddedJsonSpans(text: string, spans: Span[]): Span[] {
  // Header rules must not consume a tool argument's closing JSON syntax.
  const strings = text.matchAll(/"(?:\\[\s\S]|[^"\\])*"/gu);
  let current = strings.next().value;
  return [...spans]
    .sort((left, right) => left.start - right.start)
    .map((span) => {
      while (
        current &&
        current.index + current[0].length <= span.start
      ) {
        current = strings.next().value;
      }
      if (!current || span.start <= current.index) return span;
      const stringEnd = current.index + current[0].length - 1;
      if (span.start >= stringEnd || span.end <= stringEnd) return span;
      return {
        ...span,
        end: stringEnd,
        value: text.slice(span.start, stringEnd),
      };
    });
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
  private readonly words: readonly string[];
  private readonly wordPattern: RegExp | null;
  private readonly allow: ReadonlySet<string>;
  private readonly actions: Readonly<Record<string, PrivacyMaskingAction>>;

  constructor(private readonly config: PrivacyMaskingRuntime) {
    this.words = [...new Set(config.words.map((word) => word.trim()))].filter(
      (word) => word.length > 0,
    );
    this.wordPattern = buildWordPattern(
      this.words,
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

    const spans: Span[] = [];
    if (this.config.secrets) {
      const lower = text.toLowerCase();
      for (const rule of privacyRules) {
        collectRuleSpans(text, lower, rule, spans);
      }
    }
    if (this.wordPattern && this.hasWordMarker(text)) {
      for (const match of text.matchAll(this.wordPattern)) {
        const value = match[0];
        if (value.length === 0) continue;
        spans.push({
          start: match.index,
          end: match.index + value.length,
          kind: "TERM",
          value,
        });
      }
    }

    const hits: PrivacyMaskHit[] = [];
    let masked = text;
    const bounded = context === "embedded-json"
      ? boundEmbeddedJsonSpans(text, spans)
      : spans;
    for (const span of resolveOverlaps(bounded).reverse()) {
      const raw =
        context === "embedded-json"
          ? unescapeJsonFragment(span.value)
          : span.value;
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
      masked =
        masked.slice(0, span.start) + placeholder + masked.slice(span.end);
      hits.push({
        kind: span.kind,
        placeholder,
        action,
        length: raw.length,
      });
    }

    hits.reverse();
    const result = { text: masked, hits };
    this.remember(cacheKey, result);
    return result;
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

  private hasWordMarker(text: string): boolean {
    if (this.words.length === 0) return false;
    const lower = this.config.words_any_case ? text.toLowerCase() : text;
    return this.words.some((word) => {
      const needle = this.config.words_any_case
        ? word.toLowerCase()
        : word;
      return lower.includes(needle);
    });
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
