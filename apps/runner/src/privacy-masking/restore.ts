import { privacyMaskingKindValues } from "@linksense/shared";

import type { MaskContext, PrivacyMasker } from "./masker.js";

type JsonObject = Record<string, unknown>;

export type RestoredEvent = {
  event: string;
  payload: JsonObject;
};

type PendingEvent = {
  context: string;
  tail: string;
  full: JsonObject;
  cut: JsonObject;
  event: string;
};

const sealedKeys = new Set([
  "signature",
  "encrypted_content",
  "thought_signature",
  "obfuscation",
]);

const waitEvents = new Set([
  "ping",
  "keepalive",
  "response.in_progress",
  "response.queued",
]);

const knownKinds = new Set<string>(privacyMaskingKindValues);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextFor(
  key: string,
  eventName: string,
): MaskContext {
  if (key === "arguments" || key === "partial_json") return "embedded-json";
  if (
    key === "delta" &&
    eventName.includes("function_call_arguments")
  ) {
    return "embedded-json";
  }
  return "plain";
}

function restorePayload(
  value: unknown,
  masker: PrivacyMasker,
  eventName: string,
  key = "",
): unknown {
  if (typeof value === "string") {
    if (sealedKeys.has(key) || value.startsWith("data:")) return value;
    return masker.restoreText(value, contextFor(key, eventName));
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      restorePayload(item, masker, eventName, key),
    );
  }
  if (!isObject(value)) return value;
  const next: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    next[childKey] = restorePayload(
      childValue,
      masker,
      eventName,
      childKey,
    );
  }
  return next;
}

export function restoreJsonValue(
  value: unknown,
  masker: PrivacyMasker,
): unknown {
  return restorePayload(value, masker, "");
}

type StreamingField = {
  key: string;
  context: MaskContext;
};

function streamingField(
  eventName: string,
  payload: JsonObject,
): StreamingField | null {
  if (
    eventName === "response.function_call_arguments.delta" &&
    typeof payload.delta === "string"
  ) {
    return { key: "delta", context: "embedded-json" };
  }
  if (
    eventName === "response.custom_tool_call_input.delta" &&
    typeof payload.delta === "string"
  ) {
    return { key: "delta", context: "plain" };
  }
  if (
    eventName.endsWith(".delta") &&
    typeof payload.delta === "string"
  ) {
    return { key: "delta", context: "plain" };
  }
  if (typeof payload.partial_json === "string") {
    return { key: "partial_json", context: "embedded-json" };
  }
  return null;
}

/**
 * How many trailing characters are the beginning of a placeholder. The
 * next event may carry the rest, so it is held rather than restored alone.
 * A kind may itself contain underscores (API_KEY), so every known kind is
 * checked rather than splitting at the first one.
 */
export function partialPlaceholderTail(text: string): number {
  const start = text.lastIndexOf("{{");
  if (start < 0) return 0;
  const tail = text.slice(start);
  if (tail.includes("}}")) return 0;
  const body = tail.slice(2);
  if (body.length === 0) return tail.length;
  for (const kind of knownKinds) {
    if (body.startsWith(`${kind}_`)) {
      const hash = body.slice(kind.length + 1);
      if (/^[0-9a-f]{0,32}$/u.test(hash)) return tail.length;
    }
    if (kind.startsWith(body)) return tail.length;
  }
  return 0;
}

function eventKey(payload: JsonObject): string {
  const item = payload.item_id ?? payload.output_index ?? "";
  const content = payload.content_index ?? "";
  return `${String(item)}|${String(content)}`;
}

/**
 * Puts masked values back in a Responses stream event by event. A
 * placeholder the vendor split between two deltas is held until the rest
 * arrives; an event that says nothing of the answer (a keepalive) goes on
 * ahead of the held tail.
 */
export class PrivacyRestorer {
  private pending: PendingEvent | null = null;

  constructor(private readonly masker: PrivacyMasker) {}

  restoreEvent(
    eventName: string,
    payload: JsonObject,
  ): RestoredEvent[] {
    const field = streamingField(eventName, payload);
    const output: RestoredEvent[] = [];

    if (!field) {
      if (this.pending && !waitEvents.has(eventName)) {
        output.push({
          event: this.pending.event,
          payload: this.pending.full,
        });
        this.pending = null;
      }
      output.push({
        event: eventName,
        payload: restorePayload(
          payload,
          this.masker,
          eventName,
        ) as JsonObject,
      });
      return output;
    }

    const context = `${eventName}|${eventKey(payload)}|${field.key}`;
    let carry = "";
    if (this.pending) {
      if (this.pending.context === context) {
        output.push({
          event: this.pending.event,
          payload: this.pending.cut,
        });
        carry = this.pending.tail;
      } else {
        output.push({
          event: this.pending.event,
          payload: this.pending.full,
        });
      }
      this.pending = null;
    }

    const original = payload[field.key];
    if (typeof original !== "string") {
      output.push({
        event: eventName,
        payload: restorePayload(
          payload,
          this.masker,
          eventName,
        ) as JsonObject,
      });
      return output;
    }

    const combined = carry + original;
    const tailLength = partialPlaceholderTail(combined);
    const head = tailLength > 0
      ? combined.slice(0, combined.length - tailLength)
      : combined;
    const tail = tailLength > 0
      ? combined.slice(combined.length - tailLength)
      : "";

    const withText = (text: string): JsonObject => {
      const next: JsonObject = { ...payload, [field.key]: text };
      return restorePayload(next, this.masker, eventName) as JsonObject;
    };

    if (tail.length > 0) {
      this.pending = {
        context,
        tail,
        full: withText(combined),
        cut: withText(head),
        event: eventName,
      };
      return output;
    }

    output.push({ event: eventName, payload: withText(combined) });
    return output;
  }

  flush(): RestoredEvent[] {
    if (!this.pending) return [];
    const pending = this.pending;
    this.pending = null;
    return [{ event: pending.event, payload: pending.full }];
  }
}
