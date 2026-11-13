import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publicKnowledgeOutputLimit,
  type PublicKnowledgeRunnerInput,
} from "@linksense/shared";
import { PublicKnowledgeRuntime } from "../src/public-knowledge/runtime.js";
import { projectPublicKnowledgeProgress } from "../src/public-knowledge/progress.js";

const control = vi.hoisted(() => ({
  requests: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  release: vi.fn(),
  options: vi.fn(),
  gateway: vi.fn(),
  missingSkill: false,
  stream: null as null | ((emit: (value: unknown) => void) => void),
}));
vi.mock("../src/model-gateway/model-gateway.js", () => ({
  modelGatewayEnvironmentKey: "LINKSENSE_MODEL_GATEWAY_TOKEN",
  ModelGateway: class {
    baseUrl = "http://127.0.0.1:1";
    start = control.start;
    close = control.close;
    issueLease(options: unknown) {
      control.gateway(options);
      return {
        token: "fixture-lease",
        release: control.release,
        setTurnCorrelation: vi.fn(),
      };
    }
  },
}));
vi.mock("../src/codex/json-rpc-client.js", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    CodexJsonRpcClient: class extends EventEmitter {
      private readonly home: string;
      constructor(options: { userHome: string }) {
        super();
        this.home = options.userHome;
        control.options(options);
      }
      isHealthy = true;
      async initialize() {}
      async close() {
        this.emit("exit");
      }
      async request(method: string, params: { threadId?: string }) {
        control.requests(method, params);
        if (method === "skills/list") {
          const skills = [];
          if (!control.missingSkill)
            for (const id of await readdir(
              join(this.home, ".agents", "skills"),
            )) {
              const filename = await realpath(
                join(this.home, ".agents", "skills", id, "SKILL.md"),
              );
              skills.push({
                name: "answer-guide",
                path: filename,
                enabled: true,
              });
            }
          return { data: [{ skills }] };
        }
        if (method === "thread/start" || method === "thread/resume")
          return {
            thread: {
              id: params.threadId ?? "native-thread",
              modelProvider: "link-sense",
            },
          };
        if (method === "turn/start") {
          if (control.stream) {
            control.stream((value) => this.emit("notification", value));
            return { turn: { id: "native-turn" } };
          }
          queueMicrotask(() =>
            this.emit("notification", {
              method: "turn/completed",
              params: {
                threadId: params.threadId,
                turn: {
                  id: "native-turn",
                  status: "completed",
                  items: [
                    { type: "agentMessage", text: "Evidence answer [1]" },
                  ],
                },
              },
            }),
          );
          return { turn: { id: "native-turn" } };
        }
        return {};
      }
    },
  };
});

let root: string;
beforeEach(async () => {
  vi.clearAllMocks();
  control.missingSkill = false;
  control.stream = null;
  root = await mkdtemp(join(tmpdir(), "linksense-public-runtime-unit-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function fixture() {
  const runtime = new PublicKnowledgeRuntime({
    root,
    command: "fixture-codex",
    logger: pino({ level: "silent" }),
  });
  const input: PublicKnowledgeRunnerInput = {
    applicationId: randomUUID(),
    conversationId: randomUUID(),
    operationId: randomUUID(),
    threadId: null,
    instructions: "Website knowledge only",
    inputText: "A question",
    model: "gpt-5.4",
    reasoningEffort: "minimal",
    provider: {
      revision: 1,
      baseUrl: "https://inference.example.test/v1",
      apiKey: "fixture-private-key",
      protocolMode: "native_responses",
    },
  };
  return { runtime, input };
}
describe("public native runtime durability", () => {
  it("bounds completed public message previews without splitting an emoji or exposing native ids", () => {
    const projected = projectPublicKnowledgeProgress(
      {
        method: "item/completed",
        params: {
          threadId: "private-thread",
          turnId: "private-turn",
          item: {
            id: "private-message",
            type: "agentMessage",
            phase: "final_answer",
            text: "a" + "🦄".repeat(publicKnowledgeOutputLimit / 2),
          },
        },
      },
      {
        conversationId: randomUUID(),
        operationId: randomUUID(),
        workspace: root,
        codexHome: root,
      },
    );
    const event = projected[0]?.params.notification;
    expect(event?.method).toBe("item/completed");
    if (
      event?.method !== "item/completed" ||
      event.params.item.type !== "agentMessage"
    )
      throw new Error("expected a message preview");
    expect(event.params.item.text.length).toBeLessThanOrEqual(
      publicKnowledgeOutputLimit,
    );
    expect(event.params.item.text.endsWith("🦄")).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("private-message");
    expect(JSON.stringify(projected)).not.toContain("private-thread");
  });
  it.each(["commentary", "partial_answer"] as const)("publishes safe %s progress before completion and selects only the final answer", async (phase) => {
    const { runtime, input } = fixture();
    const publish = vi.fn(async () => undefined);
    let emit: (value: unknown) => void = () => undefined;
    control.stream = (send) => {
      emit = send;
    };
    const task = runtime.run(input, publish);
    await vi.waitFor(() =>
      expect(control.requests).toHaveBeenCalledWith(
        "turn/start",
        expect.anything(),
      ),
    );
    const notify = (method: string, values: Record<string, unknown>) =>
      emit({
        method,
        params: { threadId: "native-thread", turnId: "native-turn", ...values },
      });
    notify("turn/started", {
      turn: { id: "native-turn", status: "inProgress", items: [] },
    });
    notify("item/started", {
      item: {
        id: "comment",
        type: "agentMessage",
        phase,
        text: "Checking the evidence",
      },
    });
    notify("item/completed", {
      item: {
        id: "comment",
        type: "agentMessage",
        phase,
        text: "Checking the evidence",
      },
    });
    notify("item/started", {
      item: {
        id: "answer",
        type: "agentMessage",
        phase: "final_answer",
        text: "",
      },
    });
    notify("item/agentMessage/delta", {
      itemId: "answer",
      delta: "Answer in progress",
    });
    notify("item/started", {
      item: {
        id: "input",
        type: "userMessage",
        content: [{ type: "text", text: "PRIVATE_KNOWLEDGE" }],
      },
    });
    notify("item/reasoning/textDelta", {
      itemId: "reason",
      contentIndex: 0,
      delta: "PRIVATE_REASONING",
    });
    try {
      await vi.waitFor(() => expect(publish).toHaveBeenCalled());
      const progress = JSON.stringify(publish.mock.calls);
      expect(progress).toContain("Answer in progress");
      expect(progress).toContain(input.conversationId);
      expect(progress).toContain(input.operationId);
      expect(progress).not.toContain("PRIVATE_KNOWLEDGE");
      expect(progress).not.toContain("PRIVATE_REASONING");
      expect(progress).not.toContain("native-thread");
    } finally {
      notify("item/completed", {
        item: {
          id: "answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "Final answer",
        },
      });
      notify("turn/completed", {
        turn: {
          id: "native-turn",
          status: "completed",
          items: [
            {
              type: "agentMessage",
              phase,
              text: "Checking the evidence",
            },
            {
              type: "agentMessage",
              phase: "final_answer",
              text: "Final answer",
            },
          ],
        },
      });
      const result = await task;
      expect(result.outputText).toBe("Final answer");
      await runtime.close();
    }
  });
  it("does not return a partial answer as final output when native history contains no final answer", async () => {
    const { runtime, input } = fixture();
    let emit: (value: unknown) => void = () => undefined;
    control.stream = (send) => { emit = send; };
    const task = runtime.run(input);
    await vi.waitFor(() => expect(control.requests).toHaveBeenCalledWith("turn/start", expect.anything()));
    for (const [method, values] of [
      ["item/started", { item: { id: "partial", type: "agentMessage", phase: "partial_answer", text: "" } }],
      ["item/agentMessage/delta", { itemId: "partial", delta: "Preliminary answer" }],
      ["item/completed", { item: { id: "partial", type: "agentMessage", phase: "partial_answer", text: "Preliminary answer" } }],
      ["turn/completed", { turn: { id: "native-turn", status: "completed", items: [] } }],
    ] as const) {
      emit({ method, params: { threadId: "native-thread", turnId: "native-turn", ...values } });
    }
    expect((await task).outputText).toBe("");
    await runtime.close();
  });

  it("passes only selected guidance through native Skill inputs while retaining tool denial", async () => {
    const { runtime, input } = fixture();
    const skill = {
      id: randomUUID(),
      name: "answer-guide",
      markdown:
        "---\nname: answer-guide\ndescription: Guide answers\n---\nGUIDANCE_ONLY\n",
    };
    expect((await runtime.run({ ...input, skills: [skill] })).status).toBe(
      "completed",
    );
    const filename = await realpath(
      join(
        root,
        "public-knowledge",
        input.applicationId,
        input.conversationId,
        "home",
        ".agents",
        "skills",
        skill.id,
        "SKILL.md",
      ),
    );
    expect(await readFile(filename, "utf8")).toBe(skill.markdown);
    expect(control.requests).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        input: [
          { type: "text", text: input.inputText, text_elements: [] },
          { type: "skill", name: skill.name, path: filename },
        ],
      }),
    );
    expect(control.options).toHaveBeenCalledWith(
      expect.objectContaining({
        configOverrides: expect.arrayContaining([
          "skills.include_instructions=true",
          "features.shell_tool=false",
          "features.unified_exec=false",
          "mcp_servers={}",
        ]),
      }),
    );
    expect(control.gateway).toHaveBeenCalledWith(
      expect.objectContaining({ toolPolicy: "none" }),
    );
    control.requests.mockClear();
    await runtime.run({
      ...input,
      operationId: randomUUID(),
      threadId: "native-thread",
      skills: [],
    });
    expect(control.requests).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        input: [{ type: "text", text: input.inputText, text_elements: [] }],
      }),
    );
    await expect(readFile(filename)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("fails before inference if native discovery cannot find a selected Skill", async () => {
    const { runtime, input } = fixture();
    control.missingSkill = true;
    const result = await runtime.run({
      ...input,
      skills: [{ id: randomUUID(), name: "answer-guide", markdown: "fixture" }],
    });
    expect(result.status).toBe("failed");
    expect(
      control.requests.mock.calls.some((call) => call[0] === "turn/start"),
    ).toBe(false);
  });
  it("persists a terminal answer and observes the same operation without replaying inference", async () => {
    const { runtime, input } = fixture();
    const result = await runtime.run(input);
    expect(result).toMatchObject({
      status: "completed",
      outputText: "Evidence answer [1]",
    });
    expect(await runtime.run(input)).toEqual(result);
    expect(
      control.requests.mock.calls.filter((call) => call[0] === "turn/start"),
    ).toHaveLength(1);
    expect(runtime.size).toBe(0);
    expect(control.release).toHaveBeenCalledOnce();
    expect(
      await runtime.result(
        input.applicationId,
        randomUUID(),
        input.operationId,
      ),
    ).toBeNull();
  });
  it("honors a cancellation received before startup without submitting a model turn", async () => {
    const { runtime, input } = fixture();
    await runtime.interrupt(
      input.applicationId,
      input.conversationId,
      input.operationId,
    );
    expect((await runtime.run(input)).status).toBe("interrupted");
    expect(
      control.requests.mock.calls.some((call) => call[0] === "turn/start"),
    ).toBe(false);
    expect(runtime.size).toBe(0);
  });
  it("persists startup failure and closes the gateway without replaying a failed operation", async () => {
    const { runtime, input } = fixture();
    control.start.mockRejectedValueOnce(new Error("fixture failure"));
    expect((await runtime.run(input)).status).toBe("failed");
    expect((await runtime.run(input)).status).toBe("failed");
    expect(control.start).toHaveBeenCalledOnce();
    expect(control.close).toHaveBeenCalledOnce();
    expect(control.requests).not.toHaveBeenCalled();
  });
  it("refuses an uncertain previously started operation instead of starting a replacement", async () => {
    const { runtime, input } = fixture();
    const directory = join(
      root,
      "public-knowledge",
      input.applicationId,
      input.conversationId,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${input.operationId}.started`), "started");
    await expect(runtime.run(input)).rejects.toMatchObject({ code: "EEXIST" });
    expect(control.requests).not.toHaveBeenCalled();
  });
  it("observes an abandoned operation as failed after its native lock is gone", async () => {
    const { runtime, input } = fixture();
    const directory = join(
      root,
      "public-knowledge",
      input.applicationId,
      input.conversationId,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${input.operationId}.started`), "started");
    await writeFile(
      join(directory, "thread.json"),
      JSON.stringify("persisted-thread"),
    );
    const result = await runtime.result(
      input.applicationId,
      input.conversationId,
      input.operationId,
    );
    expect(result).toEqual({
      threadId: "persisted-thread",
      turnId: null,
      status: "failed",
      outputText: "",
    });
    expect(await runtime.run(input)).toEqual(result);
    expect(control.requests).not.toHaveBeenCalled();
  });
});
