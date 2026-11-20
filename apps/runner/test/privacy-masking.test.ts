import { describe, expect, it } from "vitest";

import type { PrivacyMaskingRuntime } from "@linksense/shared";

import { PrivacyMasker } from "@linksense/shared/privacy-masking-engine";
import {
  placeholderNote,
  withChatPlaceholderNote,
  withPlaceholderNote,
} from "../src/privacy-masking/note.js";
import { maskResponsesRequest } from "../src/privacy-masking/request.js";
import {
  PrivacyRestorer,
  restoreJsonValue,
} from "../src/privacy-masking/restore.js";

const placeholderKey = "b".repeat(64);

function runtime(
  overrides: Partial<PrivacyMaskingRuntime> = {},
): PrivacyMaskingRuntime {
  return {
    revision: 1,
    secrets: true,
    personal: false,
    kinds: {},
    words: [],
    words_any_case: true,
    words_whole: true,
    actions: {},
    allow: [],
    placeholder_key: placeholderKey,
    ...overrides,
  };
}

function masker(
  overrides: Partial<PrivacyMaskingRuntime> = {},
): PrivacyMasker {
  return new PrivacyMasker(runtime(overrides));
}

describe("PrivacyMasker", () => {
  it("masks common secrets and restores them exactly", () => {
    const secrets = [
      `sk-proj-${"a".repeat(32)}`,
      `ghp_${"b".repeat(36)}`,
      `eyJ${"c".repeat(12)}.eyJ${"d".repeat(12)}.${"e".repeat(12)}`,
      `-----BEGIN PRIVATE KEY-----\n${"f".repeat(32)}\n-----END PRIVATE KEY-----`,
      `password = "correct horse battery staple"`,
      `Authorization: Bearer ${"g".repeat(24)}`,
      `postgres://user:${"h".repeat(12)}@db.example.test/app`,
    ];
    const text = secrets.join("\n");
    const mask = masker();
    const result = mask.maskText(text);
    expect(result.hits.length).toBeGreaterThanOrEqual(secrets.length);
    for (const secret of secrets) {
      expect(result.text).not.toContain(secret);
    }
    expect(result.text).toContain("{{API_KEY_");
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("keeps one placeholder per value and separates users' keys", () => {
    const first = masker();
    const second = masker({ placeholder_key: "c".repeat(64) });
    const text = "token=abcdefgh12345678";
    const one = first.maskText(text).text;
    const two = first.maskText(`again ${text}`).text;
    const other = second.maskText(text).text;
    const placeholder = one.match(/\{\{[A-Z_]+_[0-9a-f]+\}\}/u)?.[0];
    expect(placeholder).toBeTruthy();
    expect(two).toContain(placeholder);
    expect(other).not.toBe(one);
    expect(other.match(/\{\{[A-Z_]+_[0-9a-f]+\}\}/u)?.[0]).not.toBe(
      placeholder,
    );
  });

  it("lets allowlisted values and configured kinds through", () => {
    const mask = masker({
      allow: [`sk-proj-${"a".repeat(32)}`],
      secrets: false,
      words: ["Project Nightjar"],
    });
    const text = `sk-proj-${"a".repeat(32)} and Project Nightjar`;
    const result = mask.maskText(text);
    expect(result.text).toContain(`sk-proj-${"a".repeat(32)}`);
    expect(result.text).not.toContain("Project Nightjar");
    expect(result.text).toContain("{{TERM_");
  });

  it("masks Authorization and Cookie values in JSON text", () => {
    const mask = masker();
    const text =
      '{"authorization":"Bearer abcdefghijklmnop","cookie":"session=abcdefghijklmnop; theme=dark"}';
    const result = mask.maskText(text, "embedded-json");
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    expect(result.text).not.toContain("abcdefghijklmnop");
    expect(mask.restoreText(result.text, "embedded-json")).toBe(text);
  });

  it("does not mask variables, counts, or public-key names", () => {
    const mask = masker();
    const text = [
      "token = requestToken",
      "const apiKey = process.env.API_KEY",
      "token_count = 12345678",
      "sort_key = created_at",
      "public_key = abcdefghijklmnop",
    ].join("\n");
    expect(mask.maskText(text).text).toBe(text);
  });

  it("matches custom words by case and whole word", () => {
    const sensitive = masker({
      secrets: false,
      words: ["nightjar"],
      words_any_case: true,
      words_whole: true,
    });
    expect(sensitive.maskText("NIGHTJAR and xnightjarx").text).not.toContain(
      "NIGHTJAR",
    );
    expect(sensitive.maskText("NIGHTJAR and xnightjarx").text).toContain(
      "xnightjarx",
    );
    const exact = masker({
      secrets: false,
      words: ["Nightjar"],
      words_any_case: false,
      words_whole: true,
    });
    expect(exact.maskText("nightjar Nightjar").text).toContain("nightjar");
    expect(exact.maskText("nightjar Nightjar").text).not.toContain("Nightjar");
  });

  it("counts Chinese text as wordless like magpie's wordRune", () => {
    const mask = masker({
      secrets: false,
      words: ["Nightjar", "哈哈哈"],
      words_any_case: true,
      words_whole: true,
    });
    // Chinese puts no spaces between words, so its words match inside text.
    const chinese = mask.maskText("Nightjar 与哈哈哈今天上线。").text;
    expect(chinese).not.toContain("哈哈哈");
    expect(chinese.match(/\{\{TERM_/g)).toHaveLength(2);
    // A Latin word right beside a Chinese letter is still whole.
    expect(mask.maskText("用Nightjar做演示。").text).not.toContain("Nightjar");
    // A longer Latin token beside Chinese still keeps the word inside it.
    expect(mask.maskText("用XNightjar做演示。").text).toContain("XNightjar");
  });

  it("treats a number with its decimals as one whole word", () => {
    const mask = masker({
      secrets: false,
      words: ["123456"],
      words_whole: true,
    });
    expect(mask.maskText("code 123456.").text).not.toContain("123456");
    expect(mask.maskText("0.123456").text).toBe("0.123456");
    expect(mask.maskText("123456.78").text).toBe("123456.78");
  });

  it("leaves ids, schemas and sealed values alone while masking text", () => {
    const mask = masker({ words: ["Acme"] });
    const body = {
      model: "gpt-5.5",
      instructions: "You work for Acme.",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Acme secret" }] },
        {
          type: "function_call",
          name: "lookup",
          call_id: "call_123",
          arguments: '{"query":"Acme"}',
        },
        {
          type: "reasoning",
          encrypted_content: "Acme sealed",
          summary: [{ type: "summary_text", text: "Acme summary" }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Find Acme records",
          parameters: {
            type: "object",
            properties: { q: { type: "string", description: "Acme query" } },
          },
          strict: true,
        },
      ],
      prompt_cache_key: "Acme-cache",
      previous_response_id: "Acme-response",
    };
    const hits = maskResponsesRequest(body, mask);
    const serialized = JSON.stringify(body);
    expect(hits.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("You work for Acme");
    expect(serialized).not.toContain("Acme secret");
    expect(serialized).not.toContain('"Acme"');
    expect(serialized).not.toContain("Acme summary");
    expect(serialized).not.toContain("Find Acme records");
    expect(serialized).toContain('"model":"gpt-5.5"');
    expect(serialized).toContain('"call_id":"call_123"');
    expect(serialized).toContain('"name":"lookup"');
    expect(serialized).toContain('"parameters"');
    expect(serialized).toContain('"prompt_cache_key":"Acme-cache"');
    expect(serialized).toContain('"previous_response_id":"Acme-response"');
    expect(serialized).toContain("Acme sealed");
    expect(serialized).toContain("Acme query");
  });

  it("masks secrets in long compact JSON tool output", () => {
    const secret = `sk-proj-${"k".repeat(32)}`;
    const output = JSON.stringify({
      padding: "x".repeat(9_000),
      api_key: secret,
    });
    const body = {
      input: [
        { type: "function_call_output", call_id: "call_1", output },
      ],
    };
    const mask = masker();

    const hits = maskResponsesRequest(body, mask);

    expect(hits).not.toHaveLength(0);
    expect(body.input[0]?.output).not.toContain(secret);
    expect(mask.restoreText(body.input[0]?.output ?? "")).toBe(output);
  });

  it("masks and restores data-prefixed text while keeping binary data URLs", () => {
    const secret = `sk-proj-${"m".repeat(32)}`;
    const mask = masker({ words: ["AAAA"], words_whole: false });
    const body = {
      input: `data: my key is ${secret}`,
      file_data: "data:application/pdf;base64,AAAA",
      image_url: "data:image/png;base64,AAAA",
    };

    maskResponsesRequest(body, mask);

    expect(body.input).not.toContain(secret);
    expect(body.file_data).toBe("data:application/pdf;base64,AAAA");
    expect(body.image_url).toBe("data:image/png;base64,AAAA");
    expect(restoreJsonValue({ text: body.input }, mask)).toEqual({
      text: `data: my key is ${secret}`,
    });
  });

  it("restores a value with quotes and newlines inside tool arguments", () => {
    const value = 'p"w\\ord\nline';
    const mask = masker();
    const body = {
      input: [
        {
          type: "function_call",
          name: "run",
          call_id: "call_1",
          arguments: JSON.stringify({ password: value }),
        },
      ],
    };
    maskResponsesRequest(body, mask);
    const maskedArguments = (body.input[0] as { arguments: string }).arguments;
    expect(maskedArguments).not.toContain("p\\\"w");
    const placeholder = maskedArguments.match(
      /\{\{[A-Z_]+_[0-9a-f]+\}\}/u,
    )?.[0];
    expect(placeholder).toBeTruthy();
    const restorer = new PrivacyRestorer(mask);
    const [event] = restorer.restoreEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        name: "run",
        call_id: "call_1",
        arguments: maskedArguments,
      },
    });
    expect(event).toBeTruthy();
    const restored = event?.payload.item as { arguments: string };
    expect(JSON.parse(restored.arguments)).toEqual({ password: value });
  });

  it("keeps tool arguments valid when a value contains a secret header", () => {
    const value = `Bearer ${"r".repeat(24)}`;
    const args = {
      headers: `Authorization: ${value}`,
      other: "retained",
    };
    const body = {
      input: [
        {
          type: "function_call",
          name: "run",
          call_id: "call_1",
          arguments: JSON.stringify(args),
        },
      ],
    };
    const mask = masker();

    maskResponsesRequest(body, mask);

    const masked = body.input[0]?.arguments ?? "";
    expect(masked).not.toContain(value);
    expect(JSON.parse(masked)).toEqual({
      headers: expect.stringMatching(/^Authorization: \{\{SECRET_/u),
      other: "retained",
    });
    expect(JSON.parse(mask.restoreText(masked, "embedded-json"))).toEqual(
      args,
    );
  });

  it("restores a placeholder split between two deltas", () => {
    const mask = masker();
    const original = "my key is sk-proj-" + "z".repeat(32);
    const masked = mask.maskText(original).text;
    const placeholder = masked.match(
      /\{\{[A-Z_]+_[0-9a-f]+\}\}/u,
    )?.[0];
    expect(placeholder).toBeTruthy();
    const split = masked.indexOf(placeholder as string) + 6;
    const before = masked.slice(0, split);
    const after = masked.slice(split);
    const restorer = new PrivacyRestorer(mask);
    const first = restorer.restoreEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      item_id: "item_1",
      delta: before,
    });
    const second = restorer.restoreEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      item_id: "item_1",
      delta: after,
    });
    const text = [...first, ...second]
      .map((event) => event.payload.delta)
      .join("");
    expect(text).toBe(original);
  });

  it("restores placeholders split at every character boundary", () => {
    const mask = masker();
    const original = `sk-proj-${"v".repeat(32)}`;
    const masked = mask.maskText(original).text;

    for (let split = 1; split < masked.length; split += 1) {
      const restorer = new PrivacyRestorer(mask);
      const events = [
        ...restorer.restoreEvent("response.output_text.delta", {
          item_id: "item_1",
          delta: masked.slice(0, split),
        }),
        ...restorer.restoreEvent("response.output_text.delta", {
          item_id: "item_1",
          delta: masked.slice(split),
        }),
        ...restorer.flush(),
      ];
      expect(events.map((event) => event.payload.delta).join("")).toBe(
        original,
      );
    }
  });

  it("keeps a split placeholder across a keepalive event", () => {
    const mask = masker();
    const original = "my key is sk-proj-" + "y".repeat(32);
    const masked = mask.maskText(original).text;
    const placeholder = masked.match(
      /\{\{[A-Z_]+_[0-9a-f]+\}\}/u,
    )?.[0];
    const split = masked.indexOf(placeholder as string) + 6;
    const restorer = new PrivacyRestorer(mask);
    const first = restorer.restoreEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: "item_1",
      delta: masked.slice(0, split),
    });
    const keepalive = restorer.restoreEvent("response.in_progress", {
      type: "response.in_progress",
      response: { id: "resp_1", status: "in_progress" },
    });
    const second = restorer.restoreEvent("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: "item_1",
      delta: masked.slice(split),
    });
    const deltas = [...first, ...keepalive, ...second]
      .filter((event) => event.event === "response.output_text.delta")
      .map((event) => event.payload.delta)
      .join("");
    expect(deltas).toBe(original);
    expect(keepalive).toHaveLength(1);
  });

  it("restores split placeholders across interleaved tool calls", () => {
    const mask = masker();
    const values = [
      `sk-proj-${"n".repeat(32)}`,
      `sk-proj-${"o".repeat(32)}`,
    ];
    const arguments_ = values.map((value) =>
      JSON.stringify({ key: mask.maskText(value).text }),
    );
    const restorer = new PrivacyRestorer(mask);
    const events = [
      ...restorer.restoreEvent("response.function_call_arguments.delta", {
        item_id: "call_1",
        delta: arguments_[0]?.slice(0, 15),
      }),
      ...restorer.restoreEvent("response.output_item.added", {
        output_index: 1,
        item: { id: "call_2", type: "function_call" },
      }),
      ...restorer.restoreEvent("response.function_call_arguments.delta", {
        item_id: "call_2",
        delta: arguments_[1]?.slice(0, 15),
      }),
      ...restorer.restoreEvent("response.function_call_arguments.delta", {
        item_id: "call_2",
        delta: arguments_[1]?.slice(15),
      }),
      ...restorer.restoreEvent("response.output_item.done", {
        output_index: 1,
        item: { id: "call_2", type: "function_call" },
      }),
      ...restorer.restoreEvent("response.function_call_arguments.delta", {
        item_id: "call_1",
        delta: arguments_[0]?.slice(15),
      }),
      ...restorer.flush(),
    ];

    for (const [index, value] of values.entries()) {
      const text = events
        .filter(
          (event) =>
            event.event === "response.function_call_arguments.delta" &&
            event.payload.item_id === `call_${index + 1}`,
        )
        .map((event) => event.payload.delta)
        .join("");
      expect(JSON.parse(text)).toEqual({ key: value });
    }
  });

  it.each([
    "response.output_item.done",
    "response.completed",
    "response.failed",
    "response.incomplete",
  ])("flushes an unfinished placeholder before %s", (eventName) => {
    const restorer = new PrivacyRestorer(masker());
    const delta = "unfinished {{API_KEY_";
    expect(
      restorer.restoreEvent("response.output_text.delta", {
        item_id: "item_1",
        delta,
      }),
    ).toEqual([]);

    expect(
      restorer.restoreEvent(eventName, { item: { id: "item_1" } }),
    ).toMatchObject([
      { event: "response.output_text.delta", payload: { delta } },
      { event: eventName },
    ]);
    expect(restorer.flush()).toEqual([]);
  });

  it("leaves an unknown placeholder as it came", () => {
    const mask = masker();
    const unknown = "{{API_KEY_0123456789abcdef}}";
    expect(mask.restoreText(`before ${unknown} after`)).toBe(
      `before ${unknown} after`,
    );
  });
});

describe("placeholder note", () => {
  function maskedBody(text: string): Record<string, unknown> {
    const mask = masker();
    const body = {
      instructions: "You write files.",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text }] },
      ],
    };
    maskResponsesRequest(body, mask);
    return body;
  }

  it("says placeholders are put back, after the item they first appear in", () => {
    const body = maskedBody(`write ${`sk-proj-${"p".repeat(32)}`} to the file`);
    const noted = withPlaceholderNote(body) as {
      input: Array<Record<string, unknown>>;
    };
    expect(noted.input).toHaveLength(2);
    expect(noted.input[0]?.role).toBe("user");
    expect(noted.input[1]?.role).toBe("developer");
    expect(JSON.stringify(noted.input[1])).toContain(placeholderNote);
    expect(JSON.stringify(noted.input[1])).not.toContain("sk-proj-");
  });

  it("is not added when nothing was masked, and stays the same on later turns", () => {
    const clean = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };
    expect(withPlaceholderNote(clean)).toBe(clean);

    const body = maskedBody(`write ${`sk-proj-${"q".repeat(32)}`} to the file`);
    const first = withPlaceholderNote(body);
    const second = withPlaceholderNote(structuredClone(body));
    expect(second).toEqual(first);
  });

  it("skips a request that continues a stored response", () => {
    const body = maskedBody(`write ${`sk-proj-${"r".repeat(32)}`} to the file`);
    const stored = { ...body, previous_response_id: "resp_1" };
    expect(withPlaceholderNote(stored)).toBe(stored);
  });

  it("is never masked or restored as a placeholder itself", () => {
    const mask = masker();
    expect(mask.maskText(placeholderNote).text).toBe(placeholderNote);
    expect(mask.restoreText(placeholderNote)).toBe(placeholderNote);
    expect(placeholderNote).not.toMatch(/\{\{[A-Z_]+_[0-9a-f]{16,32}\}\}/u);
  });
});

describe("chat placeholder note", () => {
  it("joins the earliest message that holds a placeholder", () => {
    const chat = {
      messages: [
        { role: "system", content: "You write files." },
        { role: "user", content: "please write the file" },
        { role: "assistant", content: "ok", tool_calls: [] },
        { role: "user", content: "password={{SECRET_0123456789abcdef}}" },
      ],
    };
    const noted = withChatPlaceholderNote(chat) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(noted.messages[0]?.content).toBe("You write files.");
    expect(noted.messages[3]?.content).toBe(
      `password={{SECRET_0123456789abcdef}}\n\n${placeholderNote}`,
    );
  });

  it("appends to the system message when a tool holds the placeholder", () => {
    const chat = {
      messages: [{ role: "system", content: "You write files." }],
      tools: [{ type: "function", function: { name: "f", description: "{{TERM_0123456789abcdef}}" } }],
    };
    const noted = withChatPlaceholderNote(chat) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(noted.messages[0]?.content).toBe(
      `You write files.\n\n${placeholderNote}`,
    );
  });

  it("is left out when the conversation has no placeholder", () => {
    const chat = { messages: [{ role: "user", content: "hello" }] };
    expect(withChatPlaceholderNote(chat)).toBe(chat);
  });
});
