import { describe, expect, it } from "vitest";
import { buildChatCompletionRequest, chatCompletionStreamToResponses } from "../src/model-gateway/chat-completions-bridge.js";

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

describe("assistant tool-call history conversion", () => {
  const call = (id: string) => ({
    type: "function_call",
    call_id: id,
    name: "inspect_workspace",
    arguments: "{}",
  });
  const output = (id: string) => ({
    type: "function_call_output",
    call_id: id,
    output: "workspace inspected",
  });
  const message = (text: string) => ({
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  });

  it.each([false, true])("keeps a tool call and its result adjacent when commentary follows the call, streaming %s", (stream) => {
    const request = buildChatCompletionRequest({
      input: [call("call-a"), message("Inspecting the workspace."), output("call-a")],
    }, stream);

    expect(request.messages).toEqual([
      {
        role: "assistant",
        content: "Inspecting the workspace.",
        tool_calls: [{ id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
    ]);
  });

  it("keeps commentary before a tool call in the same assistant message", () => {
    const request = buildChatCompletionRequest({ input: [message("Inspecting."), call("call-a"), output("call-a")] }, false);
    expect(request.messages).toEqual([
      { role: "assistant", content: "Inspecting.", tool_calls: [{ id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
    ]);
  });

  it("groups parallel calls and interleaved commentary before their matching results", () => {
    const request = buildChatCompletionRequest({ input: [
      call("call-a"), message("Inspecting the workspace."),
      { type: "reasoning", summary: [] },
      call("call-b"), message("Checking the output."),
      output("call-a"), output("call-b"), message("Both checks finished."),
    ] }, true);
    expect(request.messages).toEqual([
      { role: "assistant", content: "Inspecting the workspace.\n\nChecking the output.", tool_calls: [
        { id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } },
        { id: "call-b", type: "function", function: { name: "inspect_workspace", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
      { role: "tool", tool_call_id: "call-b", content: "workspace inspected" },
      { role: "assistant", content: "Both checks finished." },
    ]);
  });

  it("keeps separate tool rounds and user messages in their original order", () => {
    const user = { role: "user", content: "Run another check." };
    const request = buildChatCompletionRequest({ input: [
      call("call-a"), message("First check."), output("call-a"), message("First check finished."), user,
      call("call-b"), message("Second check."), output("call-b"),
    ] }, true);
    expect(request.messages).toEqual([
      { role: "assistant", content: "First check.", tool_calls: [{ id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
      { role: "assistant", content: "First check finished." }, user,
      { role: "assistant", content: "Second check.", tool_calls: [{ id: "call-b", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-b", content: "workspace inspected" },
    ]);
  });

  it("preserves separate text-only assistant messages", () => {
    expect(buildChatCompletionRequest({ input: [message("First."), message("Second.")] }, false).messages).toEqual([
      { role: "assistant", content: "First." }, { role: "assistant", content: "Second." },
    ]);
  });

  it.each([false, true])("preserves instruction boundaries, image inputs, and the original history when streaming is %s", (stream) => {
    const source = {
      instructions: "Follow the task instructions.",
      input: [
        { role: "system", content: "System context." },
        message("Earlier answer."),
        { role: "developer", content: [{ type: "input_text", text: "Updated instructions." }] },
        { role: "user", content: [
          { type: "input_text", text: "Inspect this image." },
          { type: "input_image", image_url: "https://files.example.test/image.png" },
        ] },
        call("call-a"), message("Inspecting."), output("call-a"),
        message("Finished."), { role: "user", content: "Thank you." },
      ],
    };
    const original = structuredClone(source);

    expect(buildChatCompletionRequest(source, stream).messages).toEqual([
      { role: "system", content: "Follow the task instructions." },
      { role: "system", content: "System context." },
      { role: "assistant", content: "Earlier answer." },
      { role: "system", content: "Updated instructions." },
      { role: "user", content: [
        { type: "text", text: "Inspect this image." },
        { type: "image_url", image_url: { url: "https://files.example.test/image.png" } },
      ] },
      { role: "assistant", content: "Inspecting.", tool_calls: [{ id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
      { role: "assistant", content: "Finished." },
      { role: "user", content: "Thank you." },
    ]);
    expect(source).toEqual(original);
  });

  it.each([false, true])("preserves a tool-only history with stored item IDs and object arguments when streaming is %s", (stream) => {
    expect(buildChatCompletionRequest({ input: [
      { type: "function_call", id: "stored-call", name: "inspect_workspace", arguments: { path: "README.md" } },
      { type: "function_call_output", id: "stored-call", output: { exists: true } },
      message("The file exists."),
    ] }, stream).messages).toEqual([
      { role: "assistant", content: "", tool_calls: [{ id: "stored-call", type: "function", function: { name: "inspect_workspace", arguments: '{"path":"README.md"}' } }] },
      { role: "tool", tool_call_id: "stored-call", content: '{"exists":true}' },
      { role: "assistant", content: "The file exists." },
    ]);
  });

  it.each([false, true])("round-trips a mixed streaming response into a valid follow-up when text arrives first: %s", async (textFirst) => {
    const text = { choices: [{ delta: { content: "Inspecting the workspace." } }] };
    const tool = { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] } }] };
    const chunks = textFirst ? [text, tool] : [tool, text];
    const upstream = new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
    const events = [];
    for await (const event of chatCompletionStreamToResponses(upstream, "test")) events.push(event);
    const completed = events.find((event) => event.event === "response.completed")?.data.response;
    if (typeof completed !== "object" || completed === null || !("output" in completed) || !Array.isArray(completed.output)) {
      throw new Error("Missing completed response output");
    }
    const request = buildChatCompletionRequest({ input: [...completed.output, output("call-a")] }, true);
    expect(request.messages).toEqual([
      { role: "assistant", content: "Inspecting the workspace.", tool_calls: [{ id: "call-a", type: "function", function: { name: "inspect_workspace", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-a", content: "workspace inspected" },
    ]);
  });
});
