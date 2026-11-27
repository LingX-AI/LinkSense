import { privacyMaskingKindValues } from "@linksense/shared";

import type {
  MaskContext,
  PrivacyMasker,
} from "@linksense/shared/privacy-masking-engine";

import { MAX_SSE_EVENT_CHARACTERS } from "../model-gateway/sse.js";

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
  slot: QueuedEvent;
};

type QueuedEvent = {
  output: RestoredEvent;
  waiting: boolean;
  characters: number;
};

const maxQueuedEvents = 256;
const jsonArgumentDeltaEvents = new Set([
  "response.function_call_arguments.delta",
  "response.mcp_call_arguments.delta",
]);

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
  if (key === "delta" && jsonArgumentDeltaEvents.has(eventName)) {
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
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    restorePayload(childValue, masker, eventName, childKey),
  ]));
}

export function restoreJsonValue(
  value: unknown,
  masker: PrivacyMasker,
): unknown {
  return restorePayload(value, masker, "");
}

function streamingField(
  eventName: string,
  payload: JsonObject,
): { key: string; text: string } | null {
  if (
    eventName.endsWith(".delta") &&
    typeof payload.delta === "string"
  ) {
    return { key: "delta", text: payload.delta };
  }
  if (typeof payload.partial_json === "string") {
    return { key: "partial_json", text: payload.partial_json };
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
 * arrives. Interleaved events stay in the order sent by the provider.
 */
export class PrivacyRestorer {
  private readonly pending = new Map<string, PendingEvent>();
  private readonly queue: QueuedEvent[] = [];
  private queuedCharacters = 0;

  constructor(private readonly masker: PrivacyMasker) {}

  restoreEvent(
    eventName: string,
    payload: JsonObject,
  ): RestoredEvent[] {
    const field = streamingField(eventName, payload);
    if (!field) {
      for (const [context, pending] of this.pending) {
        if (
          terminalEvents.has(eventName) ||
          (eventName === "response.output_item.done" &&
            pending.itemKey === itemKey(payload)) ||
          (eventName.endsWith(".done") &&
            pending.streamKey === eventKey(payload))
        ) {
          pending.slot.output.payload = pending.full;
          pending.slot.waiting = false;
          this.pending.delete(context);
        }
      }
      this.enqueue({
        event: eventName,
        payload: restorePayload(
          payload,
          this.masker,
          eventName,
        ) as JsonObject,
      });
      return this.drainReady();
    }

    const context = `${eventName}|${eventKey(payload)}|${field.key}`;
    const pending = this.pending.get(context);
    if (pending) {
      pending.slot.waiting = false;
      this.pending.delete(context);
    }

    const combined = (pending?.tail ?? "") + field.text;
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
      const full = withText(combined);
      const slot = this.enqueue({ event: eventName, payload: withText(head) }, full);
      this.pending.set(context, {
        itemKey: itemKey(payload),
        streamKey: eventKey(payload),
        tail,
        full,
        slot,
      });
    } else {
      this.enqueue({ event: eventName, payload: withText(combined) });
    }
    return this.drainReady();
  }

  flush(): RestoredEvent[] {
    for (const pending of this.pending.values()) {
      pending.slot.output.payload = pending.full;
      pending.slot.waiting = false;
    }
    this.pending.clear();
    return this.drainReady();
  }

  private enqueue(output: RestoredEvent, full?: JsonObject): QueuedEvent {
    const characters = full || this.queue.length > 0
      ? JSON.stringify(full ?? output.payload).length
      : 0;
    const slot = { output, waiting: full !== undefined, characters };
    this.queue.push(slot);
    this.queuedCharacters += characters;
    return slot;
  }

  private drainReady(): RestoredEvent[] {
    let ready = 0;
    for (const slot of this.queue) {
      if (slot.waiting) break;
      ready++;
      this.queuedCharacters -= slot.characters;
    }
    const output = this.queue.splice(0, ready).map((slot) => slot.output);
    if (this.queue.length > maxQueuedEvents || this.queuedCharacters > MAX_SSE_EVENT_CHARACTERS) {
      throw new Error("Privacy masking stream buffer limit exceeded");
    }
    return output;
  }
}
