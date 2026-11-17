import { privacyMaskingKindValues } from "@linksense/shared";

import type {
  MaskContext,
  PrivacyMasker,
} from "@linksense/shared/privacy-masking-engine";

type JsonObject = Record<string, unknown>;

export type RestoredEvent = {
  event: string;
  payload: JsonObject;
};

type PendingEvent = {
  itemKey: string;
  streamKey: string;
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

const terminalEvents = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
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
    if (sealedKeys.has(key)) return value;
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
  const braceTail = text.endsWith("{") ? 1 : 0;
  const start = text.lastIndexOf("{{");
  if (start < 0) return braceTail;
  const tail = text.slice(start);
  if (tail.includes("}}")) return braceTail;
  const body = tail.slice(2);
  if (body.length === 0) return tail.length;
  for (const kind of knownKinds) {
    if (body.startsWith(`${kind}_`)) {
      const hash = body.slice(kind.length + 1);
      if (/^[0-9a-f]{0,32}\}?$/u.test(hash)) return tail.length;
    }
    if (kind.startsWith(body)) return tail.length;
  }
  return braceTail;
}

function itemKey(payload: JsonObject): string {
  const item = isObject(payload.item) ? payload.item.id : undefined;
  return String(payload.item_id ?? item ?? payload.output_index ?? "");
}

function eventKey(payload: JsonObject): string {
  return `${itemKey(payload)}|${String(payload.content_index ?? "")}|${String(payload.summary_index ?? "")}`;
}

/**
 * Puts masked values back in a Responses stream event by event. A
 * placeholder the vendor split between two deltas is held until the rest
 * arrives; an event that says nothing of the answer (a keepalive) goes on
 * ahead of the held tail.
 */
export class PrivacyRestorer {
  private readonly pending = new Map<string, PendingEvent>();

  constructor(private readonly masker: PrivacyMasker) {}

  restoreEvent(
    eventName: string,
    payload: JsonObject,
  ): RestoredEvent[] {
    const field = streamingField(eventName, payload);
    const output: RestoredEvent[] = [];

    if (!field) {
      for (const [context, pending] of this.pending) {
        if (
          terminalEvents.has(eventName) ||
          (eventName === "response.output_item.done" &&
            pending.itemKey === itemKey(payload)) ||
          (eventName.endsWith(".done") &&
            pending.streamKey === eventKey(payload))
        ) {
          output.push({ event: pending.event, payload: pending.full });
          this.pending.delete(context);
        }
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
    const pending = this.pending.get(context);
    if (pending) {
      output.push({ event: pending.event, payload: pending.cut });
      carry = pending.tail;
      this.pending.delete(context);
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
      this.pending.set(context, {
        itemKey: itemKey(payload),
        streamKey: eventKey(payload),
        tail,
        full: withText(combined),
        cut: withText(head),
        event: eventName,
      });
      return output;
    }

    output.push({ event: eventName, payload: withText(combined) });
    return output;
  }

  flush(): RestoredEvent[] {
    const events = [...this.pending.values()].map((pending) => ({
      event: pending.event,
      payload: pending.full,
    }));
    this.pending.clear();
    return events;
  }
}
