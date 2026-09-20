import { randomBytes } from "node:crypto";

import { parseSseStream } from "./sse.js";

type JsonObject = Record<string, unknown>;

export type ResponsesStreamEvent = {
  event: string;
  data: JsonObject;
};

type CompletedOutput = {
  outputIndex: number;
  item: JsonObject;
};

type ToolStreamState = {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  emittedArguments: number;
  added: boolean;
};

export function buildChatCompletionRequest(
  source: JsonObject,
  stream: boolean,
): JsonObject {
  const tools = Array.isArray(source.tools)
    ? source.tools.flatMap((tool) => {
        if (
          !isRecord(tool) ||
          tool.type !== "function" ||
          typeof tool.name !== "string"
        ) {
          return [];
        }
        return [
          {
            type: "function",
            function: {
              name: tool.name,
              description: stringValue(tool.description),
              parameters: isRecord(tool.parameters)
                ? tool.parameters
                : { type: "object", properties: {} },
              ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
            },
          },
        ];
      })
    : [];
  const result: JsonObject = {
    model: source.model,
    messages: responsesInputToChatMessages(source),
    stream,
  };
  if (tools.length > 0) {
    result.tools = tools;
    const toolChoice = chatToolChoice(source.tool_choice);
    if (toolChoice !== undefined) result.tool_choice = toolChoice;
  }
  for (const key of [
    "temperature",
    "top_p",
    "seed",
    "presence_penalty",
    "frequency_penalty",
    "parallel_tool_calls",
  ]) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  if (typeof source.max_output_tokens === "number") {
    result.max_tokens = source.max_output_tokens;
  }
  if (isRecord(source.reasoning) && typeof source.reasoning.effort === "string") {
    result.reasoning_effort = source.reasoning.effort;
  }
  if (isRecord(source.text) && isRecord(source.text.format)) {
    const { type, ...format } = source.text.format;
    result.response_format = type === "json_schema"
      ? { type, json_schema: format }
      : { type, ...format };
  }
  return result;
}

export function chatCompletionToResponse(
  source: JsonObject,
  fallbackModel: string,
): JsonObject {
  const choices = Array.isArray(source.choices) ? source.choices : [];
  const firstChoice = choices.find(isRecord);
  const message = isRecord(firstChoice?.message) ? firstChoice.message : {};
  const output: JsonObject[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecord(call)) continue;
      output.push(chatToolCallToResponseItem(call));
    }
  }
  const text = chatContentText(message.content);
  if (text !== "" || output.length === 0) {
    output.push(responseMessageItem(text));
  }
  return {
    id: responseId(),
    object: "response",
    created_at:
      typeof source.created === "number"
        ? source.created
        : Math.floor(Date.now() / 1_000),
    status: "completed",
    model: stringValue(source.model) || fallbackModel,
    output,
    output_text: text,
    usage: normalizeUsage(source.usage),
  };
}

export async function* chatCompletionStreamToResponses(
  upstream: Response,
  model: string,
): AsyncGenerator<ResponsesStreamEvent> {
  if (!upstream.body) throw new Error("model provider returned an empty stream");
  const id = responseId();
  const createdAt = Math.floor(Date.now() / 1_000);
  let sequence = 0;
  let nextOutputIndex = 0;
  let textState:
    | {
        outputIndex: number;
        itemId: string;
        text: string;
      }
    | undefined;
  const toolStates = new Map<number, ToolStreamState>();
  let usage: unknown;

  yield {
    event: "response.created",
    data: {
      type: "response.created",
      sequence_number: sequence++,
      response: inProgressResponse(id, createdAt, model),
    },
  };
  yield {
    event: "response.in_progress",
    data: {
      type: "response.in_progress",
      sequence_number: sequence++,
      response: inProgressResponse(id, createdAt, model),
    },
  };

  for await (const event of parseSseStream(upstream.body)) {
    if (event.data.trim() === "[DONE]") break;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      throw new Error("model provider returned malformed SSE JSON");
    }
    if (!isRecord(payload) || isRecord(payload.error)) {
      throw new Error("model provider returned an invalid stream event");
    }
    if (payload.usage !== undefined) usage = payload.usage;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice)) continue;
      const delta = isRecord(choice.delta)
        ? choice.delta
        : isRecord(choice.message)
          ? choice.message
          : {};
      const content = chatContentText(delta.content);
      if (content !== "") {
        if (!textState) {
          textState = {
            outputIndex: nextOutputIndex++,
            itemId: itemId("msg"),
            text: "",
          };
          yield {
            event: "response.output_item.added",
            data: {
              type: "response.output_item.added",
              output_index: textState.outputIndex,
              sequence_number: sequence++,
              item: {
                id: textState.itemId,
                type: "message",
                status: "in_progress",
                role: "assistant",
                content: [],
              },
            },
          };
          yield {
            event: "response.content_part.added",
            data: {
              type: "response.content_part.added",
              item_id: textState.itemId,
              output_index: textState.outputIndex,
              content_index: 0,
              sequence_number: sequence++,
              part: { type: "output_text", text: "", annotations: [] },
            },
          };
        }
        textState.text += content;
        yield {
          event: "response.output_text.delta",
          data: {
            type: "response.output_text.delta",
            item_id: textState.itemId,
            output_index: textState.outputIndex,
            content_index: 0,
            sequence_number: sequence++,
            delta: content,
          },
        };
      }

      const toolCalls = Array.isArray(delta.tool_calls)
        ? delta.tool_calls
        : [];
      for (const rawCall of toolCalls) {
        if (!isRecord(rawCall)) continue;
        const index =
          typeof rawCall.index === "number" && Number.isInteger(rawCall.index)
            ? rawCall.index
            : 0;
        let state = toolStates.get(index);
        if (!state) {
          state = {
            outputIndex: nextOutputIndex++,
            itemId: itemId("fc"),
            callId:
              typeof rawCall.id === "string"
                ? rawCall.id
                : itemId("call"),
            name: "",
            arguments: "",
            emittedArguments: 0,
            added: false,
          };
          toolStates.set(index, state);
        }
        if (typeof rawCall.id === "string") state.callId = rawCall.id;
        const fn = isRecord(rawCall.function) ? rawCall.function : {};
        if (typeof fn.name === "string") state.name += fn.name;
        if (typeof fn.arguments === "string") {
          state.arguments += fn.arguments;
        } else if (isRecord(fn.arguments)) {
          state.arguments += JSON.stringify(fn.arguments);
        }
        if (
          !state.added &&
          state.name !== "" &&
          state.arguments !== ""
        ) {
          state.added = true;
          yield {
            event: "response.output_item.added",
            data: {
              type: "response.output_item.added",
              output_index: state.outputIndex,
              sequence_number: sequence++,
              item: {
                id: state.itemId,
                type: "function_call",
                status: "in_progress",
                call_id: state.callId,
                name: state.name,
                arguments: "",
              },
            },
          };
        }
        if (
          state.added &&
          state.arguments.length > state.emittedArguments
        ) {
          const argumentDelta = state.arguments.slice(
            state.emittedArguments,
          );
          state.emittedArguments = state.arguments.length;
          yield {
            event: "response.function_call_arguments.delta",
            data: {
              type: "response.function_call_arguments.delta",
              item_id: state.itemId,
              output_index: state.outputIndex,
              sequence_number: sequence++,
              delta: argumentDelta,
            },
          };
        }
      }
    }
  }

  const completedOutput: CompletedOutput[] = [];
  for (const state of toolStates.values()) {
    if (!state.added) {
      state.added = true;
      yield {
        event: "response.output_item.added",
        data: {
          type: "response.output_item.added",
          output_index: state.outputIndex,
          sequence_number: sequence++,
          item: {
            id: state.itemId,
            type: "function_call",
            status: "in_progress",
            call_id: state.callId,
            name: state.name || "unknown_tool",
            arguments: "",
          },
        },
      };
    }
    const item = {
      id: state.itemId,
      type: "function_call",
      status: "completed",
      call_id: state.callId,
      name: state.name || "unknown_tool",
      arguments: state.arguments || "{}",
    };
    yield {
      event: "response.function_call_arguments.done",
      data: {
        type: "response.function_call_arguments.done",
        item_id: state.itemId,
        output_index: state.outputIndex,
        sequence_number: sequence++,
        arguments: item.arguments,
      },
    };
    yield {
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: state.outputIndex,
        sequence_number: sequence++,
        item,
      },
    };
    completedOutput.push({ outputIndex: state.outputIndex, item });
  }

  if (textState) {
    const content = {
      type: "output_text",
      text: textState.text,
      annotations: [],
    };
    const item = {
      id: textState.itemId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [content],
    };
    yield {
      event: "response.output_text.done",
      data: {
        type: "response.output_text.done",
        item_id: textState.itemId,
        output_index: textState.outputIndex,
        content_index: 0,
        sequence_number: sequence++,
        text: textState.text,
      },
    };
    yield {
      event: "response.content_part.done",
      data: {
        type: "response.content_part.done",
        item_id: textState.itemId,
        output_index: textState.outputIndex,
        content_index: 0,
        sequence_number: sequence++,
        part: content,
      },
    };
    yield {
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: textState.outputIndex,
        sequence_number: sequence++,
        item,
      },
    };
    completedOutput.push({ outputIndex: textState.outputIndex, item });
  }

  if (completedOutput.length === 0) {
    const item = responseMessageItem("");
    const outputIndex = nextOutputIndex;
    yield {
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: outputIndex,
        sequence_number: sequence++,
        item: { ...item, status: "in_progress", content: [] },
      },
    };
    yield {
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: outputIndex,
        sequence_number: sequence++,
        item,
      },
    };
    completedOutput.push({ outputIndex, item });
  }

  const output = completedOutput
    .sort((left, right) => left.outputIndex - right.outputIndex)
    .map(({ item }) => item);
  yield {
    event: "response.completed",
    data: {
      type: "response.completed",
      sequence_number: sequence,
      response: {
        id,
        object: "response",
        created_at: createdAt,
        status: "completed",
        model,
        output,
        output_text: textState?.text ?? "",
        usage: normalizeUsage(usage),
      },
    },
  };
}

function responsesInputToChatMessages(source: JsonObject): JsonObject[] {
  const messages: JsonObject[] = [];
  if (typeof source.instructions === "string" && source.instructions !== "") {
    messages.push({ role: "system", content: source.instructions });
  }
  if (typeof source.input === "string") {
    messages.push({ role: "user", content: source.input });
    return messages;
  }
  if (!Array.isArray(source.input)) {
    return messages.length > 0
      ? messages
      : [{ role: "user", content: "" }];
  }
  let pendingToolCalls: JsonObject[] = [];
  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: pendingToolCalls,
    });
    pendingToolCalls = [];
  };
  for (const item of source.input) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call") {
      pendingToolCalls.push({
        id:
          typeof item.call_id === "string"
            ? item.call_id
            : typeof item.id === "string"
              ? item.id
              : itemId("call"),
        type: "function",
        function: {
          name: stringValue(item.name) || "unknown_tool",
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}),
        },
      });
      continue;
    }
    flushToolCalls();
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id:
          typeof item.call_id === "string"
            ? item.call_id
            : typeof item.id === "string"
              ? item.id
              : itemId("call"),
        content: contentText(item.output),
      });
      continue;
    }
    if (item.type === "reasoning") continue;
    const role = stringValue(item.role);
    if (role === "developer" || role === "system") {
      messages.push({ role: "system", content: contentText(item.content) });
    } else if (role === "user" || role === "assistant") {
      messages.push({
        role,
        content:
          role === "user"
            ? userContentForChat(item.content)
            : contentText(item.content),
      });
    }
  }
  flushToolCalls();
  return messages.length > 0
    ? messages
    : [{ role: "user", content: "" }];
}

function userContentForChat(value: unknown): unknown {
  if (!Array.isArray(value)) return contentText(value);
  const parts: JsonObject[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      parts.push({ type: "text", text: part });
      continue;
    }
    if (!isRecord(part)) continue;
    if (
      part.type === "input_text" ||
      part.type === "output_text" ||
      part.type === "text"
    ) {
      parts.push({ type: "text", text: stringValue(part.text) });
      continue;
    }
    if (part.type === "input_image") {
      const url =
        stringValue(part.image_url) ||
        stringValue(part.url) ||
        stringValue(part.image);
      if (url !== "") {
        parts.push({ type: "image_url", image_url: { url } });
      }
    }
  }
  return parts.length > 0 ? parts : "";
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    if (value === undefined || value === null) return "";
    return JSON.stringify(value) ?? "";
  }
  return value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (
        isRecord(part) &&
        (part.type === "input_text" ||
          part.type === "output_text" ||
          part.type === "text") &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }
      return [];
    })
    .join("\n");
}

function chatToolChoice(value: unknown): unknown {
  if (
    value === "auto" ||
    value === "none" ||
    value === "required"
  ) {
    return value;
  }
  if (
    isRecord(value) &&
    value.type === "function" &&
    typeof value.name === "string"
  ) {
    return {
      type: "function",
      function: { name: value.name },
    };
  }
  return undefined;
}

function chatToolCallToResponseItem(source: JsonObject): JsonObject {
  const fn = isRecord(source.function) ? source.function : {};
  return {
    id: itemId("fc"),
    type: "function_call",
    status: "completed",
    call_id:
      typeof source.id === "string" ? source.id : itemId("call"),
    name: stringValue(fn.name) || "unknown_tool",
    arguments:
      typeof fn.arguments === "string"
        ? fn.arguments
        : JSON.stringify(fn.arguments ?? {}),
  };
}

function responseMessageItem(text: string): JsonObject {
  return {
    id: itemId("msg"),
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function inProgressResponse(
  id: string,
  createdAt: number,
  model: string,
): JsonObject {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    model,
    output: [],
    output_text: "",
  };
}

function normalizeUsage(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  const inputTokens =
    numberValue(value.input_tokens) ?? numberValue(value.prompt_tokens) ?? 0;
  const outputTokens =
    numberValue(value.output_tokens) ??
    numberValue(value.completion_tokens) ??
    0;
  const inputDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : isRecord(value.prompt_tokens_details)
      ? value.prompt_tokens_details
      : {};
  const outputDetails = isRecord(value.output_tokens_details)
    ? value.output_tokens_details
    : isRecord(value.completion_tokens_details)
      ? value.completion_tokens_details
      : {};
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens:
      numberValue(value.total_tokens) ?? inputTokens + outputTokens,
    input_tokens_details: {
      cached_tokens: numberValue(inputDetails.cached_tokens) ?? 0,
    },
    output_tokens_details: {
      reasoning_tokens: numberValue(outputDetails.reasoning_tokens) ?? 0,
    },
  };
}

function chatContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) =>
      isRecord(part) && typeof part.text === "string" ? [part.text] : [],
    )
    .join("");
}

function responseId(): string {
  return itemId("resp");
}

function itemId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is JsonObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
