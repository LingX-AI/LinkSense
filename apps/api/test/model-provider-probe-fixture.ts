import type { ModelProviderProtocolMode } from "@linksense/shared"

export function probeReplyStream(
  protocolMode: ModelProviderProtocolMode,
  text = "OK",
  failAfterReply = false,
): string {
  if (protocolMode === "chat_completions_bridge") {
    const base = { id: "probe-chat", object: "chat.completion.chunk", created: 0, model: "test-model" }
    const reply = { ...base, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }
    const end = failAfterReply
      ? { error: { message: "synthetic provider failure", type: "server_error", code: "server_error" } }
      : { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }
    return [reply, end].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n"
  }
  const message = { type: "message", id: "probe-message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }
  const response = {
    id: "probe-response", object: "response", created_at: 0, model: "test-model", status: "completed",
    output: [message], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
  }
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: "probe-message", output_index: 0, content_index: 0, delta: text },
    ...(failAfterReply
      ? [{ type: "response.failed", response: { ...response, status: "failed", error: { code: "server_error", message: "synthetic provider failure" } } }]
      : [
          { type: "response.output_item.done", output_index: 0, item: message },
          { type: "response.completed", response },
        ]),
  ]
  return events.map((event, index) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join("")
}

export function probeReplyResponse(
  protocolMode: ModelProviderProtocolMode,
  text = "OK",
  failAfterReply = false,
): Response {
  return new Response(probeReplyStream(protocolMode, text, failAfterReply), {
    headers: { "content-type": "text/event-stream" },
  })
}
