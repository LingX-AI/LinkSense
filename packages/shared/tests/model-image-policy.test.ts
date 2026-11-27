import { describe, expect, it } from "vitest";

import {
  modelImageOmittedPlaceholder,
  omitUnsupportedModelImages,
  splitModelContentParts,
} from "../src/model-image-policy.js";

describe("model image policy", () => {
  it("replaces Responses images in messages and tool outputs with text placeholders", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
        },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: [
            { type: "input_text", text: "Script completed" },
            { type: "input_image", image_url: "data:image/png;base64,BBBB" },
          ],
        },
      ],
    };

    expect(omitUnsupportedModelImages(body)).toBe(2);
    expect(body.input[0]?.content).toEqual([
      { type: "input_text", text: "look" },
      { type: "input_text", text: modelImageOmittedPlaceholder },
    ]);
    expect(body.input[1]?.output).toEqual([
      { type: "input_text", text: "Script completed" },
      { type: "input_text", text: modelImageOmittedPlaceholder },
    ]);
    expect(JSON.stringify(body)).not.toContain("base64");
    expect(omitUnsupportedModelImages(body)).toBe(0);
  });

  it("replaces Chat Completions image_url parts with text parts", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
          ],
        },
      ],
    };

    expect(omitUnsupportedModelImages(body)).toBe(1);
    expect(body.messages[0]?.content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: modelImageOmittedPlaceholder },
    ]);
  });

  it("does not rewrite tool definition trees", () => {
    const body = {
      tools: [
        {
          type: "function",
          name: "render",
          parameters: {
            type: "object",
            properties: { part: { type: "image_url" } },
          },
        },
      ],
      input: [],
    };

    expect(omitUnsupportedModelImages(body)).toBe(0);
    expect(body.tools[0]?.parameters.properties.part).toEqual({
      type: "image_url",
    });
  });
});

describe("splitModelContentParts", () => {
  it("keeps text and images from a tool output separate", () => {
    const image = {
      type: "input_image",
      image_url: "data:image/png;base64,AAAA",
    };
    expect(
      splitModelContentParts([
        { type: "input_text", text: "first" },
        image,
        { type: "input_text", text: "second" },
      ])
    ).toEqual({ text: "first\nsecond", images: [image] });
  });

  it("passes plain strings through unchanged", () => {
    expect(splitModelContentParts("plain text")).toEqual({
      text: "plain text",
      images: [],
    });
  });
});
