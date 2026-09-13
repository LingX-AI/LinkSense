import { isDeepStrictEqual } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import {
  asyncAnswerText,
  respondToAsyncUserInput,
} from "../src/modules/conversations/async-user-input.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const turnId = "40000000-0000-4000-8000-000000000001";
const questions = [
  {
    id: "question-1",
    header: "1",
    question: "Which scope?",
    is_other: true,
    is_secret: false,
    options: [{ label: "Complete", description: "" }],
  },
];
const response = {
  action: "accept",
  content: { "question-1": "Complete" },
} as const;

function fixture(active = true) {
  let request: Record<string, unknown> = {
    id: requestId,
    conversationId,
    ownerId,
    turnId,
    codexThreadId: "thread-1",
    codexTurnId: "turn-1",
    codexItemId: "question-item",
    nativeRequestId: null,
    requestKind: "async_questions",
    questionsJson: questions,
    status: "pending",
    responseDeliveryJson: null,
    responseContentJson: null,
    resolvedAction: null,
  };
  const applyData = (data: Record<string, unknown>) => {
    request = {
      ...request,
      ...Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          value === Prisma.DbNull ? null : value,
        ]),
      ),
    };
    return request;
  };
  const model = {
    findFirst: vi.fn(async () => request),
    findUniqueOrThrow: vi.fn(async () => request),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      applyData(data),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const status = where.status;
        const allowed =
          typeof status === "string"
            ? [status]
            : (status as { in: string[] }).in;
        if (!allowed.includes(String(request.status))) return { count: 0 };
        const binding = where.responseDeliveryJson as
          { equals: unknown } | undefined;
        if (
          binding &&
          !isDeepStrictEqual(
            binding.equals === Prisma.DbNull ? null : binding.equals,
            request.responseDeliveryJson,
          )
        )
          return { count: 0 };
        applyData(data);
        return { count: 1 };
      },
    ),
  };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
    conversationUserInputRequest: model,
    conversation: {
      findFirst: vi.fn(async () => ({
        id: conversationId,
        ownerId,
        codexThreadId: "thread-1",
      })),
    },
    conversationTurn: {
      findFirst: vi.fn(async ({ where }: { where: { status?: string } }) =>
        where.status ? (active ? { id: turnId } : null) : { id: turnId },
      ),
    },
    conversationEvent: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => data,
      ),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(
      async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  } as unknown as PrismaClient;
  const deliver = vi.fn(async () => undefined);
  return {
    tx,
    model,
    deliver,
    get request() {
      return request;
    },
    setRequest: applyData,
    respond: (
      answer = response as
        | { action: "accept"; content: Record<string, string> }
        | { action: "cancel" },
    ) =>
      respondToAsyncUserInput({
        prisma,
        ownerId,
        conversationId,
        requestId,
        response: answer,
        deliver,
      }),
  };
}

describe("asynchronous user input", () => {
  it.each([true, false])(
    "delivers an answer through the native user-message path with active=%s and deduplicates resubmission",
    async (active) => {
      const f = fixture(active);
      expect((await f.respond()).request.status).toBe("answered");
      expect(f.deliver).toHaveBeenCalledWith(
        active
          ? { method: "steer", turnId, operationId: expect.any(String) }
          : { method: "start", idempotencyKey: `async-answer:${requestId}` },
        "> Which scope?\n\nComplete",
        "thread-1",
      );
      expect((await f.respond()).event).toBeNull();
      expect(f.deliver).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps questions answerable after their source turn completes", async () => {
    const f = fixture(false);
    await f.respond();
    expect(f.tx.conversationTurn.findFirst).toHaveBeenCalledWith({
      where: {
        id: turnId,
        conversationId,
        codexThreadId: "thread-1",
        codexTurnId: "turn-1",
      },
    });
  });

  it("retains the exact operation across uncertain delivery and rejects changing an answer in flight", async () => {
    const f = fixture();
    f.deliver.mockRejectedValueOnce(
      new AppError("TURN_STEER_REQUEST_UNCERTAIN"),
    );
    await expect(f.respond()).rejects.toMatchObject({
      code: "TURN_STEER_REQUEST_UNCERTAIN",
    });
    const delivery = f.request.responseDeliveryJson;
    await expect(
      f.respond({ action: "accept", content: { "question-1": "Different" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.respond();
    expect(f.deliver).toHaveBeenLastCalledWith(
      delivery,
      "> Which scope?\n\nComplete",
      "thread-1",
    );
    expect(f.request.status).toBe("answered");
  });

  it("releases an answer only when native steering definitely did not accept it", async () => {
    const f = fixture();
    f.deliver.mockRejectedValueOnce(new AppError("TURN_STEER_REQUEST_FAILED"));
    await expect(f.respond()).rejects.toMatchObject({
      code: "TURN_STEER_REQUEST_FAILED",
    });
    expect(f.request).toMatchObject({
      status: "pending",
      responseDeliveryJson: null,
      responseContentJson: null,
    });
  });

  it("resumes a persisted submission after an API restart using its original operation", async () => {
    const f = fixture();
    const delivery = {
      method: "steer",
      turnId,
      operationId: "50000000-0000-4000-8000-000000000001",
    };
    f.setRequest({
      status: "answering",
      resolvedAction: "accept",
      responseContentJson: response.content,
      responseDeliveryJson: delivery,
    });
    await f.respond();
    expect(f.deliver).toHaveBeenCalledWith(
      delivery,
      "> Which scope?\n\nComplete",
      "thread-1",
    );
  });

  it("does not clear a newer answer operation when a previous delivery fails late", async () => {
    const f = fixture();
    const newerDelivery = {
      method: "start",
      idempotencyKey: "newer-answer-operation",
    };
    f.deliver.mockImplementationOnce(async () => {
      f.setRequest({
        status: "answering",
        responseDeliveryJson: newerDelivery,
      });
      throw new AppError("TURN_STEER_REQUEST_FAILED");
    });
    await expect(f.respond()).rejects.toMatchObject({
      code: "TURN_STEER_REQUEST_FAILED",
    });
    expect(f.request).toMatchObject({
      status: "answering",
      responseDeliveryJson: newerDelivery,
    });
  });

  it("dismisses unanswered questions without starting or steering a turn", async () => {
    const f = fixture();
    expect((await f.respond({ action: "cancel" })).request.status).toBe(
      "cancelled",
    );
    expect(f.deliver).not.toHaveBeenCalled();
  });

  it.each(["request", "conversation", "source", "branch"])(
    "rejects an unavailable or unauthorized %s before delivery",
    async (boundary) => {
      const f = fixture();
      if (boundary === "request")
        f.model.findFirst.mockResolvedValueOnce(
          null as unknown as Record<string, unknown>,
        );
      if (boundary === "conversation")
        f.tx.conversation.findFirst.mockResolvedValueOnce(
          null as unknown as {
            id: string;
            ownerId: string;
            codexThreadId: string;
          },
        );
      if (boundary === "source")
        f.tx.conversationTurn.findFirst.mockResolvedValueOnce(null);
      if (boundary === "branch")
        f.tx.conversation.findFirst.mockResolvedValueOnce({
          id: conversationId,
          ownerId,
          codexThreadId: "different-thread",
        });
      await expect(f.respond()).rejects.toMatchObject({
        code: "USER_INPUT_REQUEST_UNAVAILABLE",
      });
      expect(f.deliver).not.toHaveBeenCalled();
      expect(f.model.findFirst).toHaveBeenCalledWith({
        where: {
          id: requestId,
          conversationId,
          ownerId,
          requestKind: "async_questions",
        },
      });
    },
  );

  it.each([
    {},
    { "question-1": "" },
    { "question-1": "Complete", extra: "ignored?" },
  ])("rejects malformed answers %j", (content) => {
    expect(() =>
      asyncAnswerText(questions, { action: "accept", content }),
    ).toThrow();
  });

  it("bounds UTF-8 question framing without breaking characters and keeps user free text", () => {
    const text = asyncAnswerText(
      [{ ...questions[0], question: "中".repeat(200) }],
      { action: "accept", content: { "question-1": "another choice" } },
    );
    expect(text).toBe(`> ${"中".repeat(170)}\n\nanother choice`);
  });
});
