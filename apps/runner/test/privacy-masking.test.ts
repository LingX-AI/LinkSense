import { describe, expect, it } from "vitest";

import type { PrivacyMaskingRuntime } from "@linksense/shared";

import { PrivacyMasker } from "../src/privacy-masking/masker.js";
import { maskResponsesRequest } from "../src/privacy-masking/request.js";
import { PrivacyRestorer } from "../src/privacy-masking/restore.js";

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

  it("leaves an unknown placeholder as it came", () => {
    const mask = masker();
    const unknown = "{{API_KEY_0123456789abcdef}}";
    expect(mask.restoreText(`before ${unknown} after`)).toBe(
      `before ${unknown} after`,
    );
  });
});
