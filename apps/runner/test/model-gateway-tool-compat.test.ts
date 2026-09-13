import { describe, expect, it } from "vitest";

import {
  rewriteResponsesPayload,
  translateResponsesRequest,
} from "../src/model-gateway/tool-compat.js";

describe("model gateway tool compatibility", () => {
  it("round-trips namespaced custom code tools independently from same-named root tools", () => {
    const input = [{ type: "custom_tool_call", namespace: "functions", name: "exec", id: "old", call_id: "old-call", input: "text(1)" }];
    const translated = translateResponsesRequest({ input: [
      { type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] }] },
      ...input,
    ], tools: [{ type: "custom", name: "exec" }] });
    expect(translated.body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "functions__exec", parameters: expect.objectContaining({ required: ["input"] }) }),
      expect.objectContaining({ name: "exec" }),
    ]));
    expect(translated.body.input).toEqual([{ type: "function_call", id: "old", call_id: "old-call", name: "functions__exec", arguments: '{"input":"text(1)"}' }]);
    expect(rewriteResponsesPayload({ output: [{ type: "function_call", id: "new", call_id: "new-call", name: "functions__exec", arguments: '{"input":"text(2)"}' }] }, translated.context))
      .toMatchObject({ output: [{ type: "custom_tool_call", namespace: "functions", name: "exec", input: "text(2)" }] });
    expect(translateResponsesRequest({ input }).body.input).toEqual(translated.body.input);
  });

  it("lifts additional tools and converts Codex-managed tool shapes to functions", () => {
    const translated = translateResponsesRequest({
      model: "model-a",
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [
            {
              type: "namespace",
              name: "mcp__files",
              tools: [
                {
                  name: "read.file",
                  description: "Read a file",
                  parameters: {
                    type: "object",
                    properties: { limit: { type: "integer" } },
                  },
                },
              ],
            },
          ],
        },
        {
          type: "tool_search_call",
          id: "search-item",
          call_id: "search-call",
          arguments: { query: "files", limit: 3 },
        },
        {
          type: "tool_search_output",
          call_id: "search-call",
          tools: [],
        },
        {
          type: "custom_tool_call",
          id: "custom-item",
          call_id: "custom-call",
          name: "apply_patch",
          input: "*** Begin Patch",
        },
      ],
      tools: [
        { type: "tool_search" },
        {
          type: "custom",
          name: "apply_patch",
          description: "Apply a patch",
        },
      ],
    });

    expect(translated.body.input).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "additional_tools" }),
      ]),
    );
    expect(translated.body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function",
          name: "tool_search",
        }),
        expect.objectContaining({
          type: "function",
          name: "apply_patch",
          parameters: expect.objectContaining({
            required: ["input"],
          }),
        }),
        expect.objectContaining({
          type: "function",
          description: "Read a file",
        }),
      ]),
    );
    expect(translated.body.tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "namespace" }),
        expect.objectContaining({ type: "custom" }),
        expect.objectContaining({ type: "tool_search" }),
      ]),
    );
    expect(translated.body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          name: "tool_search",
          arguments: '{"query":"files","limit":3}',
        }),
        expect.objectContaining({
          type: "function_call_output",
          output: "[]",
        }),
        expect.objectContaining({
          type: "function_call",
          name: "apply_patch",
          arguments: '{"input":"*** Begin Patch"}',
        }),
      ]),
    );
    const namespace = [...translated.context.mappingsByAlias.values()].find(
      (mapping) => mapping.kind === "namespace",
    );
    expect(namespace?.alias.length).toBeLessThanOrEqual(64);
    expect(namespace?.alias).not.toContain(".");
  });

  it("restores namespace, tool-search, and custom calls without global state", () => {
    const first = translateResponsesRequest({
      model: "model-a",
      input: [],
      tools: [
        {
          type: "namespace",
          name: "mcp__one",
          tools: [
            {
              name: "lookup",
              parameters: {
                type: "object",
                properties: {
                  limit: { type: "integer" },
                  enabled: { type: "boolean" },
                },
              },
            },
          ],
        },
        { type: "tool_search" },
        { type: "custom", name: "apply_patch" },
      ],
    });
    const second = translateResponsesRequest({
      model: "model-a",
      input: [],
      tools: [
        {
          type: "namespace",
          name: "mcp__two",
          tools: [{ name: "lookup" }],
        },
      ],
    });
    const namespace = [...first.context.mappingsByAlias.values()].find(
      (mapping) => mapping.kind === "namespace",
    );
    const custom = [...first.context.mappingsByAlias.values()].find(
      (mapping) => mapping.kind === "custom",
    );
    const toolSearch = [...first.context.mappingsByAlias.values()].find(
      (mapping) => mapping.kind === "tool_search",
    );
    if (!namespace || !custom || !toolSearch) {
      throw new Error("test mappings were not created");
    }

    expect(
      rewriteResponsesPayload(
        {
          type: "response.output_item.added",
          item: {
            id: "custom-item",
            type: "function_call",
            call_id: "custom-call",
            name: custom.alias,
            arguments: "",
          },
        },
        first.context,
      ),
    ).toMatchObject({
      item: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "",
      },
    });
    expect(
      rewriteResponsesPayload(
        {
          type: "response.output_item.done",
          item: {
            id: "namespace-item",
            type: "function_call",
            call_id: "namespace-call",
            name: namespace.alias,
            arguments: '{"limit":"4","enabled":"true"}',
          },
        },
        first.context,
      ),
    ).toMatchObject({
      item: {
        type: "function_call",
        namespace: "mcp__one",
        name: "lookup",
        arguments: '{"limit":4,"enabled":true}',
      },
    });
    expect(
      rewriteResponsesPayload(
        {
          type: "response.output_item.added",
          item: {
            id: "search-item",
            type: "function_call",
            call_id: "search-call",
            name: toolSearch.alias,
            arguments: '{"query":"files","limit":"5"}',
          },
        },
        first.context,
      ),
    ).toMatchObject({
      item: {
        type: "tool_search_call",
        execution: "client",
        arguments: { query: "files", limit: 5 },
      },
    });
    expect(
      rewriteResponsesPayload(
        {
          type: "response.function_call_arguments.delta",
          item_id: "search-item",
          delta: "{}",
        },
        first.context,
      ),
    ).toBeNull();
    expect(
      rewriteResponsesPayload(
        {
          type: "response.output_item.done",
          item: {
            id: "custom-item",
            type: "function_call",
            call_id: "custom-call",
            name: custom.alias,
            arguments: '{"input":"*** Begin Patch\\n*** End Patch"}',
          },
        },
        first.context,
      ),
    ).toMatchObject({
      item: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "*** Begin Patch\n*** End Patch",
      },
    });

    expect(
      [...second.context.mappingsByAlias.values()].some(
        (mapping) =>
          mapping.kind === "namespace" &&
          mapping.namespace === "mcp__one",
      ),
    ).toBe(false);
  });
});
