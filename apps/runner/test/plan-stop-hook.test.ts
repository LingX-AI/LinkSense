import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const hookPath = fileURLToPath(
  new URL("../../../deploy/runtime/node/plan-stop-hook.mjs", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("managed Plan Stop hook", () => {
  it("blocks one untagged Plan response and asks Codex to continue the same turn", async () => {
    const transcriptPath = await createTranscript([
      responseItem("turn-plan", "I already completed the requested report."),
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          last_assistant_message: "I already completed the requested report.",
        }),
      ),
    ).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("exactly one complete"),
    });
    const output = runHook(
      stopInput({
        turn_id: "turn-plan",
        transcript_path: transcriptPath,
        last_assistant_message: "I already completed the requested report.",
      }),
    );
    expect(output.reason).toContain("Do not implement the task");
    expect(output.reason).toContain("discuss write permissions");
    expect(output.reason).toContain("goals and scope");
    expect(output.reason).toContain("validation and acceptance criteria");
    expect(output.reason).toContain("exactly four `##` localized section headings");
    expect(output.reason).toContain("Do not use nested HTML or XML tags");
  });

  it("does not block the second Stop attempt", async () => {
    const transcriptPath = await createTranscript([
      responseItem("turn-plan", "Still not a plan."),
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          stop_hook_active: true,
          last_assistant_message: "Still not a plan.",
        }),
      ),
    ).toEqual({});
  });

  it("does not block Default mode or a Plan-only response", async () => {
    const transcriptPath = await createTranscript([]);

    expect(
      runHook(
        stopInput({
          transcript_path: transcriptPath,
          last_assistant_message: "ordinary answer",
        }),
        "default",
      ),
    ).toEqual({});
    expect(
      runHook(
        stopInput({
          transcript_path: transcriptPath,
          last_assistant_message: null,
        }),
      ),
    ).toEqual({});
  });

  it("does not create a second plan when the native Plan item has residual assistant text", async () => {
    const transcriptPath = await createTranscript([
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn-plan",
          item: { type: "Plan", text: structuredPlan("Valid plan") },
        },
      },
      responseItem(
        "turn-plan",
        `<proposed_plan>\n${structuredPlan("Valid plan")}\n</proposed_plan>\nPlan ready.`,
      ),
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          last_assistant_message: "Plan ready.",
        }),
      ),
    ).toEqual({});
  });

  it("recognizes the current turn's native tagged block even if the event stream is incomplete", async () => {
    const transcriptPath = await createTranscript([
      responseItem(
        "another-turn",
        `<proposed_plan>\n${structuredPlan("Other plan")}\n</proposed_plan>`,
      ),
      responseItem(
        "turn-plan",
        `Preface\n<proposed_plan>\n${structuredPlan("Current plan")}\n</proposed_plan>\nResidual`,
      ),
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          last_assistant_message: "Preface\nResidual",
        }),
      ),
    ).toEqual({});
  });

  it("blocks a non-renderable Plan that uses nested XML section tags", async () => {
    const transcriptPath = await createTranscript([
      responseItem(
        "turn-plan",
        [
          "<proposed_plan>",
          "<title>Hidden title</title>",
          "<goals_and_scope>Hidden body</goals_and_scope>",
          "</proposed_plan>",
        ].join("\n"),
      ),
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          last_assistant_message: "Hidden title Hidden body",
        }),
      ),
    ).toMatchObject({ decision: "block" });
  });

  it("fails open when the native transcript is unavailable", () => {
    expect(
      runHook(
        stopInput({
          transcript_path: "/missing/linksense/transcript.jsonl",
          last_assistant_message: "ordinary answer",
        }),
      ),
    ).toEqual({});
  });

  it("finds the current Plan item from a bounded transcript tail", async () => {
    const transcriptPath = await createTranscript([
      { padding: "x".repeat(8 * 1024 * 1024) },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn-plan",
          item: { type: "Plan", text: structuredPlan("Tail plan") },
        },
      },
    ]);

    expect(
      runHook(
        stopInput({
          turn_id: "turn-plan",
          transcript_path: transcriptPath,
          last_assistant_message: "Residual text after the plan.",
        }),
      ),
    ).toEqual({});
  });
});

function runHook(
  input: Record<string, unknown>,
  collaborationMode = "plan",
): Record<string, unknown> {
  const output = execFileSync(process.execPath, [hookPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      LINKSENSE_COLLABORATION_MODE: collaborationMode,
    },
    input: JSON.stringify(input),
  });
  return JSON.parse(output) as Record<string, unknown>;
}

function stopInput(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    turn_id: "turn-plan",
    transcript_path: null,
    stop_hook_active: false,
    last_assistant_message: null,
    ...overrides,
  };
}

async function createTranscript(entries: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-plan-stop-hook-"));
  roots.push(root);
  const transcriptPath = join(root, "rollout.jsonl");
  await writeFile(
    transcriptPath,
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
    "utf8",
  );
  return transcriptPath;
}

function responseItem(turnId: string, text: string): Record<string, unknown> {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
    },
  };
}

function structuredPlan(title: string): string {
  return [
    `# ${title}`,
    "## Goals and scope",
    "- Define the outcome.",
    "## Ordered implementation steps",
    "1. Implement the change.",
    "## Validation and acceptance criteria",
    "- Verify the result.",
    "## Defaults, boundaries, and non-goals",
    "- Record assumptions.",
  ].join("\n");
}
