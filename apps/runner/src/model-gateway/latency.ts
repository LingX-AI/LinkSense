import { createParser } from "eventsource-parser";
import { MAX_SSE_EVENT_CHARACTERS } from "./sse.js";

type LatencyStage = "upstream_headers" | "upstream_first_byte" | "upstream_first_text" | "upstream_end";
type LatencySample = { stage: LatencyStage; elapsedMs: number };

/** Observes bytes in the existing backpressure chain; never buffers a second stream. */
export class UpstreamLatency {
  private readonly startedAt: number;
  private readonly recorded = new Set<LatencyStage>();

  constructor(
    private readonly emit: (sample: LatencySample) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.startedAt = now();
  }

  mark(stage: LatencyStage): void {
    if (this.recorded.has(stage)) return;
    this.recorded.add(stage);
    this.emit({ stage, elapsedMs: Math.max(0, this.now() - this.startedAt) });
  }

  event(value: unknown): void {
    this.mark("upstream_first_byte");
    if (!isObject(value)) return;
    const delta = value.type === "response.output_text.delta" ? value.delta : null;
    const choices = Array.isArray(value.choices) ? value.choices : [];
    if (hasText(delta) || choices.some(choice =>
      isObject(choice) && isObject(choice.delta) && hasText(choice.delta.content))) {
      this.mark("upstream_first_text");
    }
  }

  stream(body: ReadableStream<Uint8Array>, eventStream: boolean): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder();
    let observing = eventStream;
    const parser = createParser({
      maxBufferSize: MAX_SSE_EVENT_CHARACTERS,
      onEvent: event => {
        try { this.event(JSON.parse(event.data)); } catch { /* Metrics cannot alter transport semantics. */ }
      },
    });
    return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        if (chunk.byteLength) this.mark("upstream_first_byte");
        if (observing) {
          try { parser.feed(decoder.decode(chunk, { stream: true })); }
          catch { observing = false; parser.reset(); }
          if (this.recorded.has("upstream_first_text")) { observing = false; parser.reset(); }
        }
        controller.enqueue(chunk);
      },
      flush: () => { this.mark("upstream_end"); },
    }));
  }
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
