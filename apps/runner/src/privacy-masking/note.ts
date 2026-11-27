type JsonObject = Record<string, unknown>;

/**
 * Tells the model what a placeholder is, so it writes one instead of
 * working around what looks like content it was given: mirroring
 * magpie's placeholder note. The example's hash is shorter than any
 * placeholder masking writes, so it is never restored or masked.
 */
export const placeholderNote =
  "Values written like {{NAME_ab12cd34}} are placeholders for real values. " +
  "Use them exactly as written, in replies and in tool calls alike: they are filled in with the real values before anything runs. " +
  "Don't ask to verify them, and don't replace them with examples.";

const placeholderPattern = /\{\{[A-Z][A-Z0-9_]*_[0-9a-f]{16,32}\}\}/u;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasPlaceholder(value: unknown): boolean {
  if (value === undefined) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text !== undefined && placeholderPattern.test(text);
}

function isSystemRole(message: JsonObject): boolean {
  return message.role === "system" || message.role === "developer";
}

function isCallOutput(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.type === "string" &&
    item.type.endsWith("_call_output")
  );
}

function developerNote(): JsonObject {
  return {
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: placeholderNote }],
  };
}

/**
 * Returns a Responses request with a developer message saying where the
 * placeholders first appear, so everything before that point goes as the
 * client wrote it (mirrors magpie's note placement). A request with no
 * placeholder, or one continuing from a stored response, is unchanged.
 */
export function withPlaceholderNote(body: JsonObject): JsonObject {
  if (
    typeof body.previous_response_id === "string" &&
    body.previous_response_id !== ""
  ) {
    return body;
  }
  const input = body.input;
  if (typeof input === "string") {
    if (!hasPlaceholder(input)) return body;
    return {
      ...body,
      input: [
        developerNote(),
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: input }],
        },
      ],
    };
  }
  if (!Array.isArray(input)) return body;
  if (hasPlaceholder(body.instructions) || hasPlaceholder(body.tools)) {
    return { ...body, input: [developerNote(), ...input] };
  }
  let index = input.findIndex((item) => hasPlaceholder(item));
  if (index < 0) return body;
  while (index + 1 < input.length && isCallOutput(input[index + 1])) {
    index += 1;
  }
  return {
    ...body,
    input: [
      ...input.slice(0, index + 1),
      developerNote(),
      ...input.slice(index + 1),
    ],
  };
}

function appendNote(message: JsonObject): JsonObject {
  const content = message.content;
  if (typeof content === "string") {
    return { ...message, content: `${content}\n\n${placeholderNote}` };
  }
  if (Array.isArray(content)) {
    return {
      ...message,
      content: [...content, { type: "text", text: placeholderNote }],
    };
  }
  return message;
}

/**
 * The note in a Chat Completions request, where the instructions are the
 * first system message: appended to it when the tools hold a placeholder,
 * else to the earliest message that does, so that reply's own role says
 * it and the messages before stay as they were.
 */
export function withChatPlaceholderNote(body: JsonObject): JsonObject {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;
  if (hasPlaceholder(body.tools)) {
    const systemIndex = messages.findIndex(
      (message) => isRecord(message) && isSystemRole(message),
    );
    if (systemIndex >= 0) {
      return {
        ...body,
        messages: messages.map((message, index) =>
          index === systemIndex && isRecord(message)
            ? appendNote(message)
            : message,
        ),
      };
    }
    return {
      ...body,
      messages: [{ role: "system", content: placeholderNote }, ...messages],
    };
  }
  const index = messages.findIndex((message) => hasPlaceholder(message));
  if (index < 0 || !isRecord(messages[index])) return body;
  return {
    ...body,
    messages: messages.map((message, at) =>
      at === index && isRecord(message) ? appendNote(message) : message,
    ),
  };
}
