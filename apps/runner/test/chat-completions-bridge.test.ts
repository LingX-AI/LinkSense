import { describe, expect, it } from "vitest";
import { buildChatCompletionRequest } from "../src/model-gateway/chat-completions-bridge.js";

describe("structured output protocol conversion", () => {
  it.each([false, true])("preserves the complete strict JSON schema when streaming is %s", (stream) => {
    const schema = { type: "object", properties: { memory: { type: "string" } }, required: ["memory"], additionalProperties: false };
    const format = { type: "json_schema", name: "memory", description: "Extract memory", strict: true, schema };
    const request = buildChatCompletionRequest({ model: "test", input: "history", text: { format } }, stream);
    expect(request.response_format).toEqual({ type: "json_schema", json_schema: { name: format.name, description: format.description, strict: true, schema } });
    expect(format.schema).toBe(schema);
  });

  it.each(["json_object", "text"])("preserves %s output mode", (type) => {
    expect(buildChatCompletionRequest({ text: { format: { type } } }, false).response_format).toEqual({ type });
  });

  it("does not invent a format for an ordinary response", () => {
    expect(buildChatCompletionRequest({ model: "test", input: "hello" }, false)).not.toHaveProperty("response_format");
  });

  it("preserves strict function tool schemas", () => {
    const parameters = { type: "object", properties: {}, additionalProperties: false };
    expect(buildChatCompletionRequest({ tools: [{ type: "function", name: "lookup", parameters, strict: false }] }, false)).toMatchObject({ tools: [{ function: { strict: false, parameters } }] });
  });
});
