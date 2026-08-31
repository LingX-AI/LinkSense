import type { ServerResponse } from "node:http";

import type { EventSourceMessage } from "eventsource-parser";
import { EventSourceParserStream } from "eventsource-parser/stream";

export const MAX_SSE_EVENT_CHARACTERS = 16 * 1024 * 1024;

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EventSourceMessage> {
  const decoder = new TextDecoder();
  const events = body
    .pipeThrough(
      new TransformStream<Uint8Array, string>({
        transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true });
          if (text !== "") controller.enqueue(text);
        },
        flush(controller) {
          const text = decoder.decode();
          if (text !== "") controller.enqueue(text);
        },
      }),
    )
    .pipeThrough(
      new EventSourceParserStream({
        maxBufferSize: MAX_SSE_EVENT_CHARACTERS,
        onError: "terminate",
      }),
    );
  for await (const event of events) yield event;
}

export async function writeSseEvent(
  response: ServerResponse,
  event: string,
  data: unknown,
): Promise<void> {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await writeResponseChunk(response, payload);
}

export function beginSseResponse(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders();
}

export async function writeResponseChunk(
  response: ServerResponse,
  chunk: string | Uint8Array,
): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    throw new Error("model gateway client disconnected");
  }
  if (response.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", onDrain);
      response.off("close", onClose);
      response.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("model gateway client disconnected"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
  });
}
