import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";

const PLAN_MODE = "plan";
const STOP_EVENT = "Stop";
const MAX_TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024;
const BLOCK_REASON =
  "This LinkSense turn is in Codex Plan Mode, but it ended without a renderable native Plan item. Do not implement the task, start producing the deliverable, discuss write permissions, or deliver artifacts. If a material decision is still unresolved, call request_user_input when that tool is available. Otherwise return exactly one complete, non-empty <proposed_plan>...</proposed_plan> block, with each outer tag alone on its own line. Inside the block use ordinary Markdown only: start with one `#` localized title, then exactly four `##` localized section headings for goals and scope; ordered implementation steps; validation and acceptance criteria; defaults, boundaries, and non-goals. For Chinese, use `## 目标与范围`, `## 实施步骤`, `## 验收标准`, and `## 默认项、边界与非目标`. Do not use nested HTML or XML tags such as <title> or <goals_and_scope>. The plan must describe only future work and be specific to the request.";

const input = await readHookInput();
const shouldInspect =
  process.env.LINKSENSE_COLLABORATION_MODE === PLAN_MODE &&
  input?.hook_event_name === STOP_EVENT &&
  input.stop_hook_active === false &&
  typeof input.last_assistant_message === "string" &&
  input.last_assistant_message.trim().length > 0;

if (!shouldInspect) {
  writeOutput({});
} else {
  const nativePlanState = await currentTurnNativePlanState(input);
  if (nativePlanState !== false) {
    // Fail open when the native transcript is unavailable. LinkSense's terminal
    // PLAN_OUTPUT_MISSING guard remains authoritative, while avoiding a second
    // Plan item for turns whose first Plan already completed.
    writeOutput({});
  } else {
    writeOutput({ decision: "block", reason: BLOCK_REASON });
  }
}

async function readHookInput() {
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  try {
    const parsed = JSON.parse(source);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function currentTurnNativePlanState(input) {
  if (
    typeof input.transcript_path !== "string" ||
    input.transcript_path.length === 0 ||
    typeof input.turn_id !== "string" ||
    input.turn_id.length === 0
  ) {
    return null;
  }

  try {
    const { start, skipPartialFirstLine } = await transcriptTail(
      input.transcript_path,
    );
    const lines = createInterface({
      input: createReadStream(input.transcript_path, {
        encoding: "utf8",
        start,
      }),
      crlfDelay: Infinity,
    });
    let firstLine = true;
    for await (const line of lines) {
      if (firstLine) {
        firstLine = false;
        if (skipPartialFirstLine) continue;
      }
      const entry = parseObject(line);
      if (!entry) continue;
      if (isCompletedNativePlan(entry, input.turn_id)) return true;
      if (isCurrentTurnTaggedPlan(entry, input.turn_id)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

async function transcriptTail(transcriptPath) {
  const metadata = await stat(transcriptPath);
  const start = Math.max(0, metadata.size - MAX_TRANSCRIPT_TAIL_BYTES);
  if (start === 0) return { start, skipPartialFirstLine: false };

  const handle = await open(transcriptPath, "r");
  try {
    const previousByte = Buffer.allocUnsafe(1);
    const { bytesRead } = await handle.read(previousByte, 0, 1, start - 1);
    return {
      start,
      skipPartialFirstLine:
        bytesRead === 1 && previousByte[0] !== "\n".charCodeAt(0),
    };
  } finally {
    await handle.close();
  }
}

function isCompletedNativePlan(entry, turnId) {
  if (entry.type !== "event_msg" || !isObject(entry.payload)) return false;
  const payload = entry.payload;
  if (
    payload.type !== "item_completed" ||
    payload.turn_id !== turnId ||
    !isObject(payload.item)
  ) {
    return false;
  }
  return (
    String(payload.item.type).toLowerCase() === "plan" &&
    typeof payload.item.text === "string" &&
    hasRequiredMarkdownPlanStructure(payload.item.text)
  );
}

function isCurrentTurnTaggedPlan(entry, turnId) {
  if (entry.type !== "response_item" || !isObject(entry.payload)) return false;
  const payload = entry.payload;
  if (
    payload.type !== "message" ||
    payload.role !== "assistant" ||
    !isObject(payload.internal_chat_message_metadata_passthrough) ||
    payload.internal_chat_message_metadata_passthrough.turn_id !== turnId ||
    !Array.isArray(payload.content)
  ) {
    return false;
  }
  const text = payload.content
    .filter(
      (content) =>
        isObject(content) &&
        content.type === "output_text" &&
        typeof content.text === "string",
    )
    .map((content) => content.text)
    .join("");
  return hasNonEmptyProposedPlanBlock(text);
}

function hasNonEmptyProposedPlanBlock(text) {
  let inPlan = false;
  let planText = "";
  for (const line of text.split(/\r?\n/u)) {
    const slug = line.trim();
    if (!inPlan && slug === "<proposed_plan>") {
      inPlan = true;
      planText = "";
      continue;
    }
    if (inPlan && slug === "</proposed_plan>") {
      if (hasRequiredMarkdownPlanStructure(planText)) return true;
      inPlan = false;
      continue;
    }
    if (inPlan) planText += `${line}\n`;
  }
  return inPlan && hasRequiredMarkdownPlanStructure(planText);
}

function hasRequiredMarkdownPlanStructure(text) {
  const lines = text.split(/\r?\n/u);
  if (
    lines.some((line) => /^\s*<\/?[A-Za-z][^>]*>\s*$/u.test(line))
  ) {
    return false;
  }
  const titleCount = lines.filter((line) => /^#\s+\S/u.test(line)).length;
  const sectionCount = lines.filter((line) => /^##\s+\S/u.test(line)).length;
  return titleCount === 1 && sectionCount === 4;
}

function parseObject(source) {
  try {
    const value = JSON.parse(source);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeOutput(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
