import { describe, expect, it } from "vitest";

import {
  conversationFormAcceptedOutcome,
  conversationFormRequestedSchema,
  conversationFormResponseSemanticsMatchesSchema,
  conversationFormResponseMatchesSchema,
  conversationUserInputRequestSchema,
  conversationUserInputResponseSchema,
  codexAsyncUserInputQuestionsSchema,
} from "../src/index.js";

const requestedSchema = conversationFormRequestedSchema.parse({
  type: "object",
  properties: {
    title: {
      type: "string",
      title: "标题",
      minLength: 2,
      maxLength: 100,
    },
    channel: {
      type: "string",
      title: "渠道",
      oneOf: [
        { const: "email", title: "邮件" },
        { const: "teams", title: "Teams" },
      ],
    },
    tags: {
      type: "array",
      title: "标签",
      minItems: 1,
      maxItems: 2,
      items: {
        anyOf: [
          { const: "product", title: "产品" },
          { const: "engineering", title: "研发" },
        ],
      },
    },
    publish_at: {
      type: "string",
      title: "发布时间",
      format: "date-time",
    },
    contact: {
      type: "string",
      title: "联系邮箱",
      format: "email",
    },
    retries: {
      type: "integer",
      title: "重试次数",
      minimum: 0,
      maximum: 3,
    },
    notify: { type: "boolean", title: "通知" },
  },
  required: [
    "title",
    "channel",
    "tags",
    "publish_at",
    "contact",
    "retries",
  ],
});

describe("conversation form contracts", () => {
  it.each([null, []])("accepts native free-text async questions with options=%j", (options) => {
    expect(codexAsyncUserInputQuestionsSchema.safeParse([{ title: "Constraints?", options }]).success).toBe(true);
  });
  it("accepts a bounded LinkSense form request", () => {
    expect(
      conversationUserInputRequestSchema.parse({
        id: "30000000-0000-4000-8000-000000000005",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: "30000000-0000-4000-8000-000000000003",
        item_id: "linksense-form-17",
        kind: "form",
        server_name: "linksense_core",
        message: "请确认发布信息",
        requested_schema: requestedSchema,
        ui_hints: {
          title: { control: "textarea", placeholder: "输入标题" },
          retries: { control: "number", placeholder: "0～3" },
        },
        response_semantics: { kind: "input" },
        response_content: null,
        status: "pending",
        auto_resolve_at: "2026-08-14T08:10:00.000Z",
        resolved_at: null,
        resolved_action: null,
        created_at: "2026-08-14T08:00:00.000Z",
        updated_at: "2026-08-14T08:00:00.000Z",
      }).kind,
    ).toBe("form");
  });

  it("derives ordinary submission and explicit approval outcomes", () => {
    const approvalSchema = conversationFormRequestedSchema.parse({
      type: "object",
      properties: {
        decision: {
          type: "string",
          oneOf: [
            { const: "approve", title: "同意" },
            { const: "reject", title: "拒绝" },
          ],
        },
      },
      required: ["decision"],
    });
    const approval = {
      kind: "approval" as const,
      decision_field_id: "decision",
      approve_value: "approve",
      reject_value: "reject",
    };

    expect(
      conversationFormResponseSemanticsMatchesSchema(
        approval,
        approvalSchema,
      ),
    ).toBe(true);
    expect(conversationFormAcceptedOutcome({ kind: "input" }, {})).toBe(
      "submitted",
    );
    expect(
      conversationFormAcceptedOutcome(approval, { decision: "approve" }),
    ).toBe("approved");
    expect(
      conversationFormAcceptedOutcome(approval, { decision: "reject" }),
    ).toBe("rejected");
  });

  it("rejects approval semantics without an exact required decision field", () => {
    const approval = {
      kind: "approval" as const,
      decision_field_id: "notify",
      approve_value: "yes",
      reject_value: "no",
    };

    expect(
      conversationFormResponseSemanticsMatchesSchema(approval, requestedSchema),
    ).toBe(false);
  });

  it("accepts up to 100 native async question answers and rejects an unbounded response", () => {
    const content = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `question-${index + 1}`,
        "Answer",
      ]),
    );
    expect(
      conversationUserInputResponseSchema.safeParse({
        action: "accept",
        content,
      }).success,
    ).toBe(true);
    expect(
      conversationUserInputResponseSchema.safeParse({
        action: "accept",
        content: { ...content, "question-101": "Answer" },
      }).success,
    ).toBe(false);
  });

  it("validates accepted content against required fields and constraints", () => {
    const content = conversationUserInputResponseSchema.parse({
      action: "accept",
      content: {
        title: "季度复盘",
        channel: "teams",
        tags: ["product"],
        publish_at: "2026-08-15T09:30:00.000Z",
        contact: "owner@example.com",
        retries: 2,
        notify: true,
      },
    });
    expect(content.action).toBe("accept");
    if (content.action !== "accept") throw new Error("unexpected action");
    expect(
      conversationFormResponseMatchesSchema(requestedSchema, content.content),
    ).toBe(true);
    expect(
      conversationFormResponseMatchesSchema(requestedSchema, {
        ...content.content,
        channel: "sms",
      }),
    ).toBe(false);
    expect(
      conversationFormResponseMatchesSchema(requestedSchema, {
        ...content.content,
        retries: 4,
      }),
    ).toBe(false);
    expect(
      conversationFormResponseMatchesSchema(requestedSchema, {
        ...content.content,
        contact: "not-an-email",
      }),
    ).toBe(false);
    const { title: _title, ...missingTitle } = content.content;
    expect(
      conversationFormResponseMatchesSchema(requestedSchema, missingTitle),
    ).toBe(false);
  });

  it("rejects unknown required fields and inconsistent option metadata", () => {
    expect(() =>
      conversationFormRequestedSchema.parse({
        type: "object",
        properties: {
          channel: {
            type: "string",
            enum: ["email", "teams"],
            enumNames: ["邮件"],
          },
        },
        required: ["missing"],
      }),
    ).toThrow();
  });

  it("rejects defaults that violate field formats, bounds, or uniqueness", () => {
    expect(() =>
      conversationFormRequestedSchema.parse({
        type: "object",
        properties: {
          publish_at: {
            type: "string",
            format: "date-time",
            default: "tomorrow morning",
          },
          retries: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            default: 4,
          },
          channels: {
            type: "array",
            items: { type: "string", enum: ["email", "teams"] },
            default: ["email", "email"],
          },
        },
      }),
    ).toThrow();
  });
});
