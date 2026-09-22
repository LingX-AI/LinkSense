import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { conversationRoutes } from "../src/modules/conversations/routes.js";
import type { AppServices } from "../src/services.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const TURN_ID = "30000000-0000-4000-8000-000000000003";
const USER_INPUT_REQUEST_ID = "30000000-0000-4000-8000-000000000005";
const PLAN_REVIEW_ID = "30000000-0000-4000-8000-000000000006";
const PENDING_REQUEST_ID = "30000000-0000-4000-8000-000000000002";
const SECOND_PENDING_REQUEST_ID = "30000000-0000-4000-8000-000000000004";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const KNOWLEDGE_BASE_ID = "40000000-0000-4000-8000-000000000002";
const PROJECT_ID = "40000000-0000-4000-8000-000000000003";
const AGENT_KEY = `agent_${"a".repeat(24)}`;
const apps: Array<ReturnType<typeof Fastify>> = [];

describe("interactive application message source", () => {
  it("passes the validated source alongside the complete prompt", async () => {
    const { app, startTurn: acceptTurn } = await conversationRouteFixture();
    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "完整研究要求",
        message_source: "interactive_application",
        file_ids: [MESSAGE_ID],
      },
    });
    expect(response.statusCode, response.body).toBe(202);
    expect(acceptTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        inputText: "完整研究要求",
        messageSource: "interactive_application",
        attachmentIds: [MESSAGE_ID],
      }),
      expect.any(Object),
    );
  });

  it.each([{ file_ids: ["invalid"] }, { file_ids: [MESSAGE_ID, MESSAGE_ID] }])("rejects invalid attachment selection %j", async ({ file_ids }) => {
    const { app, startTurn: acceptTurn } = await conversationRouteFixture();
    const response = await app.inject({ method: "POST", url: `/conversations/${CONVERSATION_ID}/turns`, payload: {
      input_text: "Analyze", message_source: "interactive_application", file_ids,
    } });
    expect(response.statusCode).toBe(400);
    expect(acceptTurn).not.toHaveBeenCalled();
  });

  it("rejects unsupported message sources before accepting a turn", async () => {
    const { app, startTurn: acceptTurn } = await conversationRouteFixture();
    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: { input_text: "研究要求", message_source: "system" },
    });
    expect(response.statusCode).toBe(400);
    expect(acceptTurn).not.toHaveBeenCalled();
  });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("conversation list route", () => {
  it("returns the validated source summary for the authenticated owner", async () => {
    const { app, getReferencedSources } = await conversationRouteFixture();
    const response = await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}/sources` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [{ url: "https://example.test/guide", title: "Guide" }] });
    expect(getReferencedSources).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
  });
  it("does not expose sources when resource access is denied", async () => {
    const { app, getReferencedSources } = await conversationRouteFixture();
    getReferencedSources.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));
    const response = await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}/sources` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toHaveProperty("data");
  });
  it("rejects invalid source task IDs before querying", async () => {
    const { app, getReferencedSources } = await conversationRouteFixture();
    const response = await app.inject({ method: "GET", url: "/conversations/invalid/sources" });
    expect(response.statusCode).toBe(400);
    expect(getReferencedSources).not.toHaveBeenCalled();
  });
  it.each([undefined, 26])("validates a history target and forwards the authenticated owner (around=%s)", async (around) => {
    const { app, get } = await conversationRouteFixture();
    const response = await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}${around ? `?around_turn=${around}` : ""}` });
    expect(response.statusCode).toBe(200);
    expect(get).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, around ? { around_turn: around } : {});
  });

  it.each(["0", "-1", "1.5", "nope", "9007199254740992"])("rejects invalid history target %s before reading messages", async (around) => {
    const { app, get } = await conversationRouteFixture();
    expect((await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}?around_turn=${around}` })).statusCode).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it("does not return history when resource authorization fails", async () => {
    const { app, get } = await conversationRouteFixture();
    get.mockRejectedValueOnce(new AppError("CONVERSATION_NOT_FOUND"));
    const response = await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}?around_turn=26` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toHaveProperty("data.messages");
  });
  it.each([
    ["缺省值", "/conversations", false],
    ["false 字面量", "/conversations?archived=false", false],
    ["true 字面量", "/conversations?archived=true", true],
  ])("将 archived 的%s解析为 %s", async (_label, url, archived) => {
    const { app, list } = await conversationRouteFixture();

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(OWNER_ID, {
      archived,
      limit: 30,
    });
  });

  it("拒绝非法的 archived 查询参数", async () => {
    const { app, list } = await conversationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: "/conversations?archived=not-a-boolean",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(list).not.toHaveBeenCalled();
  });

  it("校验并传递归档列表的搜索、项目和排序条件", async () => {
    const { app, list } = await conversationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/conversations?archived=true&search=%E4%BC%9A%E8%AE%AE&project_id=${PROJECT_ID}&sort=updated_asc&limit=50`,
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(OWNER_ID, {
      archived: true,
      search: "会议",
      projectId: PROJECT_ID,
      sort: "updated_asc",
      limit: 50,
    });
  });

  it.each([
    "/conversations?project_id=invalid",
    "/conversations?sort=created_desc",
  ])("拒绝非法的归档列表筛选条件：%s", async (url) => {
    const { app, list } = await conversationRouteFixture();

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("conversation create route", () => {
  it("creates an empty task without accepting composer draft content", async () => {
    const { app, create } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      payload: { collaboration_mode: "plan" },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(create).toHaveBeenCalledWith(OWNER_ID, {
      collaborationMode: "plan",
      fallbackLocale: "zh-CN",
    });
  });

  it("rejects removed server-draft fields", async () => {
    const { app, create } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      payload: { collaboration_mode: "default", input_text: "local only" },
    });

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("conversation archived clear route", () => {
  it("clears only the authenticated owner's archived tasks", async () => {
    const { app, clearArchived } = await conversationRouteFixture();

    const response = await app.inject({
      method: "DELETE",
      url: "/conversations/archived",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(clearArchived).toHaveBeenCalledWith(OWNER_ID, expect.any(Object));
    expect(response.json()).toMatchObject({
      success: true,
      data: { deleted_count: 2, failed_tasks: [] },
    });
  });
});

describe("conversation share route", () => {
  it("creates a snapshot share for the authenticated owner's task", async () => {
    const { app, createShare } = await conversationRouteFixture();
    const snapshot = {
      conversation: {
        id: CONVERSATION_ID,
        title: "Shared task",
        updated_at: "2026-09-09T00:00:00.000Z",
      },
      messages: [
        { id: MESSAGE_ID, role: "user", content_text: "Visible message" },
      ],
      turns: [],
      files: [],
      activities: [],
      turn_file_change_counts: {},
    };

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/share`,
      payload: { snapshot },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(createShare).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, {
      snapshot: expect.objectContaining(snapshot),
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: { url_path: `/share/${MESSAGE_ID}` },
    });
  });

  it.each([undefined, {}, { snapshot: {} }])(
    "rejects sharing without a valid preview",
    async (payload) => {
      const { app, createShare } = await conversationRouteFixture();
      const response = await app.inject({
        method: "POST",
        url: `/conversations/${CONVERSATION_ID}/share`,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode).toBe(400);
      expect(createShare).not.toHaveBeenCalled();
    },
  );
});

describe("conversation pinning route", () => {
  it.each([true, false])(
    "passes pinned=%s to the authenticated owner's task",
    async (pinned) => {
      const { app, patch } = await conversationRouteFixture();

      const response = await app.inject({
        method: "PATCH",
        url: `/conversations/${CONVERSATION_ID}`,
        payload: { pinned },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(patch).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, {
        pinned,
      });
    },
  );

  it("rejects a non-boolean pin value before calling the service", async () => {
    const { app, patch } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONVERSATION_ID}`,
      payload: { pinned: "true" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("conversation ordering route", () => {
  it("reorders the authenticated owner's complete recent task group", async () => {
    const { app, reorder } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: "/conversations/order",
      payload: {
        group: "recent",
        conversation_ids: [SECOND_PENDING_REQUEST_ID, CONVERSATION_ID],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(reorder).toHaveBeenCalledWith(OWNER_ID, {
      group: "recent",
      conversationIds: [SECOND_PENDING_REQUEST_ID, CONVERSATION_ID],
    });
  });

  it("rejects duplicate task ids before reordering", async () => {
    const { app, reorder } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: "/conversations/order",
      payload: {
        group: "pinned",
        conversation_ids: [CONVERSATION_ID, CONVERSATION_ID],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(reorder).not.toHaveBeenCalled();
  });
});

describe("conversation completion read route", () => {
  it("marks the authenticated owner's completion reminder as read", async () => {
    const { app, patch } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONVERSATION_ID}`,
      payload: { completion_read: true },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(patch).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, {
      completionRead: true,
    });
  });

  it("rejects attempts to write an unread reminder through the read endpoint", async () => {
    const { app, patch } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONVERSATION_ID}`,
      payload: { completion_read: false },
    });

    expect(response.statusCode).toBe(400);
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("conversation model preference routes", () => {
  it("reads the authenticated user's task-scoped model preference", async () => {
    const { app, getModelPreference } = await conversationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/model-preference`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(getModelPreference).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        selected_model: "model-a",
        selected_reasoning_effort: "medium",
      },
    });
  });

  it("updates only the requested task's model preference", async () => {
    const { app, updateModelPreference } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/model-preference`,
      payload: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(updateModelPreference).toHaveBeenCalledWith(
      OWNER_ID,
      {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
      expect.any(Object),
      CONVERSATION_ID,
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });
  });

  it("rejects an invalid task-scoped model preference before calling the service", async () => {
    const { app, updateModelPreference } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/model-preference`,
      payload: {
        selected_model: "",
        selected_reasoning_effort: "unsupported",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(updateModelPreference).not.toHaveBeenCalled();
  });

  it("rejects model changes for conversations managed by an application", async () => {
    const { app, updateModelPreference } = await conversationRouteFixture(
      "60000000-0000-4000-8000-000000000001",
    );

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/model-preference`,
      payload: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(updateModelPreference).not.toHaveBeenCalled();
  });

  it("allows model changes when the application delegates model selection", async () => {
    const { app, updateModelPreference } = await conversationRouteFixture(
      "60000000-0000-4000-8000-000000000001",
      true,
    );

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/model-preference`,
      payload: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(updateModelPreference).toHaveBeenCalledOnce();
  });
});

describe("conversation turn route", () => {
  it("starts context compaction with the client idempotency key", async () => {
    const { app, acceptCompaction } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/compact`,
      payload: { idempotency_key: IDEMPOTENCY_KEY },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(acceptCompaction).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      IDEMPOTENCY_KEY,
      expect.any(Object),
    );
  });

  it("prewarms only the authenticated user's worker and returns an accepted receipt", async () => {
    const { app, prewarm } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: "/conversations/prewarm",
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      data: { accepted: true },
    });
    expect(prewarm).toHaveBeenCalledWith(OWNER_ID, {
      collaborationMode: "default",
    });
  });

  it("保留用户选择的知识库顺序", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "search my knowledge",
        knowledge_base_ids: [KNOWLEDGE_BASE_ID],
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({ knowledgeBaseIds: [KNOWLEDGE_BASE_ID] }),
      expect.any(Object),
    );
  });

  it("forwards native Plan mode as the immutable turn submission mode", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "先制定完整计划",
        collaboration_mode: "plan",
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        inputText: "先制定完整计划",
        collaborationMode: "plan",
      }),
      expect.any(Object),
    );
  });

  it("returns a sanitized subagent detail snapshot for the selected turn", async () => {
    const { app, getSubAgentDetail } = await conversationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/turns/${TURN_ID}/subagents/${AGENT_KEY}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(getSubAgentDetail).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      TURN_ID,
      AGENT_KEY,
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        agentKey: AGENT_KEY,
        status: "completed",
      },
    });
  });

  it("returns owner-authorized subagent summaries for the selected turn", async () => {
    const { app, getSubAgentSummaries } = await conversationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${CONVERSATION_ID}/turns/${TURN_ID}/subagents`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(getSubAgentSummaries).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        agents: [
          {
            agentKey: AGENT_KEY,
            agentLabel: "New york overview",
            status: "completed",
          },
        ],
      },
    });
  });

  it("直接提交输入内容，不经过服务端草稿", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "ask about the selected element",
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        turn_id: "50000000-0000-4000-8000-000000000002",
        accepted: true,
        status: "starting",
      },
    });
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      {
        inputText: "ask about the selected element",
        priorityCapabilityIds: [],
        knowledgeBaseIds: [],
        collaborationMode: "default",
        submitMode: "normal",
      },
      expect.any(Object),
    );
  });

  it("拒绝已经移除的草稿策略字段", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "ask about the selected element",
        draft_policy: "discard",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("仅将结构化演示文稿注释传给服务端生成模型输入", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        message_display: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "  改为英文  ",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  shape_id: "7",
                  type: "text",
                  text: "生成式 AI 入门",
                  bounds: { x: 69, y: 149, width: 595, height: 173 },
                },
              ],
            },
          ],
        },
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        presentationAnnotation: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "改为英文",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  shape_id: "7",
                  type: "text",
                  text: "生成式 AI 入门",
                  bounds: { x: 69, y: 149, width: 595, height: 173 },
                },
              ],
            },
          ],
        },
      }),
      expect.any(Object),
    );
  });

  it("将结构化 Word 文本注释作为 Office 注释提交", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        message_display: {
          kind: "word_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "  改成正式语气  ",
              selection: {
                type: "text",
                para_id: "paragraph-3",
                selected_text: "我们赶紧做完",
                before: "项目已经启动，",
                after: "。",
                start_paragraph_index: 2,
                end_paragraph_index: 2,
                is_multi_paragraph: false,
                page_number: 1,
                position_from: 7,
                position_to: 13,
              },
            },
          ],
        },
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        officeAnnotation: expect.objectContaining({
          kind: "word_annotation",
          annotations: [
            expect.objectContaining({
              request: "改成正式语气",
              selection: expect.objectContaining({ para_id: "paragraph-3" }),
            }),
          ],
        }),
      }),
      expect.any(Object),
    );
  });

  it("将 Excel 图表注释作为有限的 Office 注释提交", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        message_display: {
          kind: "spreadsheet_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "改成折线图",
              sheet_name: "季度数据",
              sheet_index: 0,
              selection: {
                type: "chart",
                object_id: "chart-2",
                title: "季度销售",
                chart_type: "bar",
                element: {
                  kind: "series",
                  series_id: "series-1",
                  series_index: 0,
                },
                formula: "=SERIES(...) ",
              },
            },
          ],
        },
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        officeAnnotation: expect.objectContaining({
          kind: "spreadsheet_annotation",
          annotations: [
            expect.objectContaining({
              sheet_name: "季度数据",
              selection: expect.objectContaining({
                type: "chart",
                object_id: "chart-2",
              }),
            }),
          ],
        }),
      }),
      expect.any(Object),
    );
  });

  it("拒绝 Excel 注释携带图片源或原始工作簿数据", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        message_display: {
          kind: "spreadsheet_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "调整图片",
              sheet_name: "封面",
              sheet_index: 0,
              selection: {
                type: "image",
                object_id: "image-1",
                src: "data:image/png;base64,secret",
              },
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("拒绝同时提交普通输入和结构化演示文稿注释", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        input_text: "完整模型提示词",
        message_display: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "改为英文",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  type: "text",
                  bounds: { x: 0, y: 0, width: 100, height: 40 },
                },
              ],
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("拒绝客户端预先拼接的 locator 字段", async () => {
    const { app, startTurn } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/turns`,
      payload: {
        message_display: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "改为英文",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  type: "text",
                  bounds: { x: 0, y: 0, width: 100, height: 40 },
                },
              ],
            },
          ],
          locator: "不应由客户端拼接",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("conversation Goal routes", () => {
  it("starts a native Goal for the authenticated owner with its optional budget", async () => {
    const { app, startGoal } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/goal`,
      payload: {
        objective: "  完整实现目标功能  ",
        token_budget: 12_000,
        priority_capability_ids: [],
        knowledge_base_ids: [KNOWLEDGE_BASE_ID],
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(startGoal).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      {
        objective: "完整实现目标功能",
        tokenBudget: 12_000,
        priorityCapabilityIds: [],
        knowledgeBaseIds: [KNOWLEDGE_BASE_ID],
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      expect.any(Object),
    );
  });

  it("pauses, resumes, and clears only the authenticated owner's Goal", async () => {
    const { app, updateGoal, resumeGoal, clearGoal } =
      await conversationRouteFixture();

    const pause = await app.inject({
      method: "PATCH",
      url: `/conversations/${CONVERSATION_ID}/goal`,
      payload: { status: "paused" },
    });
    const resume = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/goal/resume`,
    });
    const clear = await app.inject({
      method: "DELETE",
      url: `/conversations/${CONVERSATION_ID}/goal`,
    });

    expect(pause.statusCode, pause.body).toBe(200);
    expect(resume.statusCode, resume.body).toBe(202);
    expect(clear.statusCode, clear.body).toBe(200);
    expect(updateGoal).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      { status: "paused" },
      expect.any(Object),
    );
    expect(resumeGoal).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.any(Object),
    );
    expect(clearGoal).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.any(Object),
    );
  });
});

describe("conversation native user input route", () => {
  it("forwards one validated response to the authenticated owner's request", async () => {
    const { app, respondToUserInputRequest } = await conversationRouteFixture();
    const responseBody = {
      action: "accept" as const,
      content: { implementation_scope: "完整实现（推荐）" },
    };

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/user-input-requests/${USER_INPUT_REQUEST_ID}/respond`,
      headers: { "user-agent": "Browser" },
      payload: responseBody,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(respondToUserInputRequest).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      USER_INPUT_REQUEST_ID,
      responseBody,
      expect.objectContaining({ userAgent: "Browser" }),
    );
  });

  it("rejects an invalid response before calling the service", async () => {
    const { app, respondToUserInputRequest } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/user-input-requests/${USER_INPUT_REQUEST_ID}/respond`,
      payload: { action: "accept", content: { implementation_scope: null } },
    });

    expect(response.statusCode).toBe(400);
    expect(respondToUserInputRequest).not.toHaveBeenCalled();
  });
});

describe("conversation Plan review action route", () => {
  it.each([
    ["implement", undefined],
    ["revise", "请补充回滚验证"],
  ] as const)(
    "starts the authenticated owner's %s follow-up with one idempotency key",
    async (action, feedback) => {
      const { app, actOnPlanReview } = await conversationRouteFixture();
      const payload = {
        action,
        ...(feedback ? { feedback } : {}),
        idempotency_key: IDEMPOTENCY_KEY,
      };

      const response = await app.inject({
        method: "POST",
        url: `/conversations/${CONVERSATION_ID}/plan-reviews/${PLAN_REVIEW_ID}/actions`,
        payload,
      });

      expect(response.statusCode, response.body).toBe(202);
      expect(actOnPlanReview).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        PLAN_REVIEW_ID,
        {
          action,
          ...(feedback ? { feedback } : {}),
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        expect.any(Object),
      );
      expect(response.json()).toMatchObject({
        success: true,
        data: {
          review: {
            id: PLAN_REVIEW_ID,
            status: "resolved",
            decision: action,
            follow_up_turn_id: TURN_ID,
          },
          turn: {
            id: TURN_ID,
            status: "running",
            collaboration_mode: action === "implement" ? "default" : "plan",
            codex_thread_id: "codex-thread-1",
          },
        },
      });
    },
  );

  it.each(["skip", "exit"] as const)(
    "resolves %s without requiring an idempotency key",
    async (action) => {
      const { app, actOnPlanReview } = await conversationRouteFixture();

      const response = await app.inject({
        method: "POST",
        url: `/conversations/${CONVERSATION_ID}/plan-reviews/${PLAN_REVIEW_ID}/actions`,
        payload: { action },
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(actOnPlanReview).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        PLAN_REVIEW_ID,
        { action },
        expect.any(Object),
      );
    },
  );

  it("rejects revise without non-empty feedback before calling the service", async () => {
    const { app, actOnPlanReview } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/plan-reviews/${PLAN_REVIEW_ID}/actions`,
      payload: {
        action: "revise",
        feedback: "   ",
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(actOnPlanReview).not.toHaveBeenCalled();
  });
});

describe("conversation message regeneration route", () => {
  it("trims the edited input and starts regeneration with one UUID operation", async () => {
    const { app, regenerate } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/regenerate`,
      headers: { "user-agent": "Browser" },
      payload: {
        input_text: "  edited request  ",
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        turn_id: "50000000-0000-4000-8000-000000000001",
        accepted: true,
        status: "starting",
      },
    });
    expect(regenerate).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
      {
        inputText: "edited request",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({ userAgent: "Browser" }),
    );
  });

  it.each([
    ["blank input", { input_text: "   ", idempotency_key: IDEMPOTENCY_KEY }],
    ["invalid operation id", { input_text: "edited", idempotency_key: "bad" }],
  ])("rejects %s before calling the service", async (_label, payload) => {
    const { app, regenerate } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/regenerate`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(regenerate).not.toHaveBeenCalled();
  });
});

describe("conversation message fork route", () => {
  it("creates a new task through the selected assistant message", async () => {
    const { app, forkConversation } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/fork`,
      headers: { "user-agent": "Browser" },
      payload: { idempotency_key: IDEMPOTENCY_KEY },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: { id: "50000000-0000-4000-8000-000000000009" },
    });
    expect(forkConversation).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
      IDEMPOTENCY_KEY,
      expect.objectContaining({ userAgent: "Browser" }),
    );
  });

  it("rejects an invalid operation id before calling the service", async () => {
    const { app, forkConversation } = await conversationRouteFixture();
    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/fork`,
      payload: { idempotency_key: "bad" },
    });

    expect(response.statusCode).toBe(400);
    expect(forkConversation).not.toHaveBeenCalled();
  });
});

describe("conversation pending request route", () => {
  it("将结构化演示文稿注释排队并保留暂存附件", async () => {
    const { app, createPending } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/pending-requests`,
      payload: {
        message_display: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "  改为英文  ",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  shape_id: "7",
                  type: "text",
                  text: "生成式 AI 入门",
                  bounds: { x: 69, y: 149, width: 595, height: 173 },
                },
              ],
            },
          ],
        },
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(createPending).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        idempotencyKey: IDEMPOTENCY_KEY,
        preserveStagedAttachments: true,
        priorityCapabilityIds: [],
        presentationAnnotation: {
          kind: "presentation_annotation",
          file_id: MESSAGE_ID,
          annotations: [
            {
              request: "改为英文",
              slide_number: 1,
              elements: [
                {
                  element_id: "title-1",
                  shape_id: "7",
                  type: "text",
                  text: "生成式 AI 入门",
                  bounds: { x: 69, y: 149, width: 595, height: 173 },
                },
              ],
            },
          ],
        },
      }),
      expect.any(Object),
    );
  });

  it("promotes a queued request to guide the running task", async () => {
    const { app, steerPending } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/${PENDING_REQUEST_ID}/steer`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(steerPending).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      PENDING_REQUEST_ID,
      expect.any(Object),
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: { turn_id: TURN_ID, accepted: true },
    });
  });

  it("reorders the complete pending request queue", async () => {
    const { app, reorderPending } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/order`,
      payload: {
        request_ids: [SECOND_PENDING_REQUEST_ID, PENDING_REQUEST_ID],
      },
    });

    expect(response.statusCode, response.body).toBe(204);
    expect(reorderPending).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      [SECOND_PENDING_REQUEST_ID, PENDING_REQUEST_ID],
      expect.any(Object),
    );
  });

  it("rejects duplicate pending request ids before reordering", async () => {
    const { app, reorderPending } = await conversationRouteFixture();

    const response = await app.inject({
      method: "PUT",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/order`,
      payload: { request_ids: [PENDING_REQUEST_ID, PENDING_REQUEST_ID] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(reorderPending).not.toHaveBeenCalled();
  });

  it("rejects an invalid pending request id before guiding", async () => {
    const { app, steerPending } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/not-a-uuid/steer`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(steerPending).not.toHaveBeenCalled();
  });

  it("restores a pending request to the local input payload", async () => {
    const { app, restorePendingToInput } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/${PENDING_REQUEST_ID}/restore-input`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(restorePendingToInput).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      PENDING_REQUEST_ID,
      expect.any(Object),
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        pending_request_id: PENDING_REQUEST_ID,
        input_text: "restored pending request",
        priority_capability_ids: [],
        knowledge_base_ids: [],
      },
    });
  });

  it("rejects an invalid pending request id before restoring", async () => {
    const { app, restorePendingToInput } = await conversationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/conversations/${CONVERSATION_ID}/pending-requests/not-a-uuid/restore-input`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error_code: "VALIDATION_ERROR" });
    expect(restorePendingToInput).not.toHaveBeenCalled();
  });
});

async function conversationRouteFixture(
  applicationId: string | null = null,
  applicationAllowsUserModelSelection = false,
) {
  const list = vi.fn(async () => ({ items: [], next_cursor: null }));
  const getInteractiveTaskState = vi.fn(async () => ({ status: "idle", turn_id: null, file_ids: [], can_submit: true, interrupt_requested: false }));
  const get = vi.fn(async () => ({ conversation: { id: CONVERSATION_ID }, messages: [] }));
  const getReferencedSources = vi.fn(async () => ({ items: [{ url: "https://example.test/guide", title: "Guide" }] }));
  const create = vi.fn(async () => ({ id: CONVERSATION_ID }));
  const clearArchived = vi.fn(async () => ({ deleted_count: 2, failed_tasks: [] }));
  const reorder = vi.fn(async (_ownerId: string, input: {
    group: "pinned" | "recent";
    conversationIds: string[];
  }) => ({
    group: input.group,
    conversation_ids: input.conversationIds,
  }));
  const patch = vi.fn(
    async (
      _ownerId: string,
      _conversationId: string,
      input: { pinned?: boolean },
    ) => ({
      id: CONVERSATION_ID,
      pinned_at: input.pinned ? "2026-07-28T04:00:00.000Z" : null,
    }),
  );
  const getModelPreference = vi.fn(async () => ({
    configured: true,
    models: [],
    default_model: "model-a",
    selected_model: "model-a",
    selected_reasoning_effort: "medium" as const,
  }));
  const updateModelPreference = vi.fn(
    async (
      _userId: string,
      input: {
        selected_model: string;
        selected_reasoning_effort:
          "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
      },
    ) => ({
      configured: true,
      models: [],
      default_model: "model-a",
      selected_model: input.selected_model,
      selected_reasoning_effort: input.selected_reasoning_effort,
    }),
  );
  const prewarm = vi.fn(async () => ({
    accepted: true as const,
    conversation_id: CONVERSATION_ID,
  }));
  const regenerate = vi.fn(async () => ({
    turn_id: "50000000-0000-4000-8000-000000000001",
    accepted: true as const,
    status: "starting" as const,
  }));
  const forkConversation = vi.fn(async () => ({
    id: "50000000-0000-4000-8000-000000000009",
    title: "Task(2)",
  }));
  const startTurn = vi.fn(async () => ({
    turn_id: "50000000-0000-4000-8000-000000000002",
    accepted: true as const,
    status: "starting" as const,
  }));
  const startGoal = vi.fn(async () => ({
    turn_id: "50000000-0000-4000-8000-000000000005",
    accepted: true as const,
    status: "starting" as const,
  }));
  const acceptCompaction = vi.fn(async () => ({
    turn_id: "50000000-0000-4000-8000-000000000007",
    accepted: true as const,
    status: "starting" as const,
  }));
  const goal = {
    thread_id: "codex-thread-1",
    objective: "完整实现目标功能",
    status: "paused" as const,
    token_budget: 12_000,
    tokens_used: 800,
    time_used_seconds: 38,
    created_at: "2026-08-06T08:00:00.000Z",
    updated_at: "2026-08-06T08:00:38.000Z",
  };
  const getGoal = vi.fn(async () => goal);
  const updateGoal = vi.fn(async () => goal);
  const resumeGoal = vi.fn(async () => ({
    turn_id: "50000000-0000-4000-8000-000000000006",
    accepted: true as const,
    status: "starting" as const,
  }));
  const clearGoal = vi.fn(async () => ({ cleared: true }));
  const createPending = vi.fn(async () => ({
    id: PENDING_REQUEST_ID,
    conversation_id: CONVERSATION_ID,
    queue_no: 1,
    input_text: "改为英文",
    priority_capability_ids: [],
    status: "waiting_previous_turn",
  }));
  const restorePendingToInput = vi.fn(async () => ({
    pending_request_id: PENDING_REQUEST_ID,
    input_text: "restored pending request",
    priority_capability_ids: [],
    knowledge_base_ids: [],
  }));
  const steerPending = vi.fn(async () => ({
    turn_id: TURN_ID,
    accepted: true,
  }));
  const reorderPending = vi.fn(async () => ({ items: [] }));
  const getSubAgentDetail = vi.fn(async () => ({
    agentKey: AGENT_KEY,
    status: "completed" as const,
    turns: [],
  }));
  const getSubAgentSummaries = vi.fn(async () => ({
    agents: [
      {
        agentKey: AGENT_KEY,
        agentLabel: "New york overview",
        status: "completed" as const,
      },
    ],
  }));
  const respondToUserInputRequest = vi.fn(async () => ({
    id: USER_INPUT_REQUEST_ID,
    status: "answered" as const,
  }));
  const planReview = {
    id: PLAN_REVIEW_ID,
    conversation_id: CONVERSATION_ID,
    source_turn_id: TURN_ID,
    plan_message_id: MESSAGE_ID,
    status: "resolved" as const,
    decision: "implement" as const,
    follow_up_turn_id: TURN_ID,
    resolved_at: "2026-08-09T12:00:00.000Z",
    created_at: "2026-08-09T11:59:00.000Z",
    updated_at: "2026-08-09T12:00:00.000Z",
  };
  const actOnPlanReview = vi.fn(
    async (
      _ownerId: string,
      _conversationId: string,
      _reviewId: string,
      action: { action: "implement" | "revise" | "skip" | "exit" },
    ) => {
      const startsTurn =
        action.action === "implement" || action.action === "revise";
      return {
        review: {
          ...planReview,
          decision: action.action,
          follow_up_turn_id: startsTurn ? TURN_ID : null,
        },
        turn: startsTurn
          ? {
              id: TURN_ID,
              conversation_id: CONVERSATION_ID,
              sequence_no: 2,
              submitted_by: OWNER_ID,
              codex_thread_id: "codex-thread-1",
              codex_turn_id: "codex-turn-2",
              status: "running",
              task_kind: "turn",
              collaboration_mode:
                action.action === "implement" ? "default" : "plan",
              submit_mode: "normal",
              idempotency_key: IDEMPOTENCY_KEY,
              knowledge_base_ids: [],
              model: "test-model",
              reasoning_effort: "medium",
              started_at: "2026-08-09T12:00:00.000Z",
              completed_at: null,
              interrupt_requested_at: null,
              interrupted_at: null,
              error_code: null,
              error_message: null,
              created_at: "2026-08-09T12:00:00.000Z",
              updated_at: "2026-08-09T12:00:00.000Z",
            }
          : null,
      };
    },
  );
  const assertOwner = vi.fn(async () => ({ applicationId }));
  const assertModelPreferenceMutable = vi.fn(async () => {
    if (applicationId !== null && !applicationAllowsUserModelSelection) {
      throw new AppError("FORBIDDEN");
    }
  });
  const createShare = vi.fn(async () => ({
    id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    title: "Shared task",
    url_path: `/share/${MESSAGE_ID}`,
    created_at: "2026-09-03T04:00:00.000Z",
    updated_at: "2026-09-03T04:00:00.000Z",
  }));
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.authUser = {
      id: OWNER_ID,
      email: "owner@example.test",
      name: "Owner",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  await app.register(conversationRoutes, {
    prefix: "/conversations",
    services: {
      conversations: {
        getInteractiveTaskState,
        getReferencedSources,
        list,
        get,
        create,
        clearArchived,
        reorder,
        patch,
        assertOwner,
        assertModelPreferenceMutable,
        prewarm,
        acceptRegeneration: regenerate,
        forkConversationAtMessage: forkConversation,
        acceptTurn: startTurn,
        acceptGoal: startGoal,
        acceptCompaction,
        getGoal,
        updateGoal,
        resumeGoal,
        clearGoal,
        createPending,
        reorderPending,
        restorePendingToInput,
        steerPending,
        respondToUserInputRequest,
        actOnPlanReview,
        getSubAgentDetail,
        getSubAgentSummaries,
      },
      conversationShares: { create: createShare },
      system: { defaultLocale: "zh-CN" },
      modelProviderSettings: {
        getPreference: getModelPreference,
        updatePreference: updateModelPreference,
      },
    } as unknown as AppServices,
  });
  return {
    app,
    getInteractiveTaskState,
    getReferencedSources,
    list,
    get,
    create,
    clearArchived,
    reorder,
    patch,
    getModelPreference,
    updateModelPreference,
    prewarm,
    regenerate,
    forkConversation,
    startTurn,
    startGoal,
    acceptCompaction,
    getGoal,
    updateGoal,
    resumeGoal,
    clearGoal,
    createPending,
    reorderPending,
    restorePendingToInput,
    steerPending,
    respondToUserInputRequest,
    actOnPlanReview,
    getSubAgentDetail,
    getSubAgentSummaries,
    createShare,
  };
}

describe("task category request boundaries", () => {
  const projectId = "60000000-0000-4000-8000-000000000099";
  it.each([null, projectId])("passes category %s when creating and moving a task", async (project_id) => {
    const { app, create, patch } = await conversationRouteFixture();
    expect((await app.inject({ method: "POST", url: "/conversations", payload: { project_id } })).statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining({ projectId: project_id }));
    expect((await app.inject({ method: "PATCH", url: `/conversations/${CONVERSATION_ID}`, payload: { project_id } })).statusCode).toBe(200);
    expect(patch).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID, { projectId: project_id });
  });
  it("rejects invalid category IDs before task creation and assignment", async () => {
    const { app, create, patch } = await conversationRouteFixture();
    expect((await app.inject({ method: "POST", url: "/conversations", payload: { project_id: "bad" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/conversations/${CONVERSATION_ID}`, payload: { project_id: "bad" } })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("interactive task state route", () => {
  it("reads the current user's state and validates the conversation identity", async () => {
    const { app, getInteractiveTaskState } = await conversationRouteFixture();
    const result = await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}/interactive-task-state` });
    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({ status: "idle", can_submit: true });
    expect(getInteractiveTaskState).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    getInteractiveTaskState.mockClear();
    expect((await app.inject({ method: "GET", url: "/conversations/not-uuid/interactive-task-state" })).statusCode).toBe(400);
    expect(getInteractiveTaskState).not.toHaveBeenCalled();
    getInteractiveTaskState.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await app.inject({ method: "GET", url: `/conversations/${CONVERSATION_ID}/interactive-task-state` })).statusCode).toBe(403);
  });
});
