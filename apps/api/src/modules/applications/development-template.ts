import type { Locale } from "@linksense/shared";

export function applicationDevelopmentTemplate(name: string, id: string, locale: Locale): Record<string, string> {
  const english = locale === "en-US";
  const labels = english
    ? { title: "Your application starts here", hint: "Describe the application you want in the conversation. Changes appear here automatically.", prompt: "What would you like to do?", run: "Try a task" }
    : { title: "从这里开始创建应用", hint: "在对话中描述你想要的应用，修改后的效果会自动显示在这里。", prompt: "你想完成什么任务？", run: "试运行任务" };
  const states = english
    ? { idle: "Ready", starting: "Accepted, starting…", running: "Working…", waiting_for_input: "Open the task panel to respond", completed: "Completed", failed: "Task failed. Check the task panel", interrupted: "Stopped" }
    : { idle: "可以开始", starting: "已受理，正在启动…", running: "正在执行…", waiting_for_input: "请打开任务面板处理", completed: "已完成", failed: "任务失败，请在任务面板查看", interrupted: "已停止" };
  const unavailable = english ? "Unable to read task status. Reopen the application to retry." : "暂时无法读取任务状态，请重新打开应用重试。";
  const submitFailed = english ? "Submission failed. Check the task panel before trying again." : "提交失败，请先查看任务面板再重试。";
  return {
    "manifest.json": JSON.stringify({ schema_version: 1, id: `app-${id}`, name, version: "1.0.0", sdk_version: 1, permissions: ["tasks:write", "files:write"], custom_events: [] }, null, 2),
    "index.html": `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)}</title><link rel="stylesheet" href="./styles.css"><script src="/api/v1/interactive-app-runtime/sdk/v1.js" defer></script><script src="./app.js" defer></script></head><body><main><p class="eyebrow">${escapeHtml(name)}</p><h1>${labels.title}</h1><p>${labels.hint}</p><form><label for="prompt">${labels.prompt}</label><textarea id="prompt" rows="4" required></textarea><button type="submit" disabled>${labels.run}</button></form><p id="status" role="status"></p></main></body></html>`,
    "styles.css": `:root{color-scheme:light dark;font-family:system-ui,sans-serif;color:#242424;background:#faf9f6}*{box-sizing:border-box}body{margin:0}main{max-width:680px;margin:8vh auto;padding:32px}h1{font-size:clamp(24px,5vw,36px);letter-spacing:-.04em}.eyebrow{font-size:13px;font-weight:600}p{line-height:1.7;color:#666}form{display:grid;gap:16px;margin-top:32px}textarea{width:100%;resize:vertical;padding:16px;border:1px solid #ccc;border-radius:12px;background:#fff;color:#222;font:inherit}button{justify-self:start;background:#242424;color:white;border:0;border-radius:999px;padding:12px 24px;font:inherit;cursor:pointer}button:disabled{opacity:.5}button:focus-visible,textarea:focus-visible{outline:3px solid #548c7c;outline-offset:3px}@media(prefers-color-scheme:dark){:root{color:#eee;background:#181818}p{color:#aaa}textarea{background:#242424;color:#eee;border-color:#555}button{background:#eee;color:#181818}}`,
    "app.js": `const form = document.querySelector('form');
const status = document.querySelector('#status');
const button = form.querySelector('button');
const labels = ${JSON.stringify(states)};
let taskState = null;
let submitting = false;
function render() {
  button.disabled = submitting || !taskState || !taskState.can_submit;
  if (taskState) status.textContent = labels[taskState.status];
}
function unavailable() { taskState = null; button.disabled = true; status.textContent = ${JSON.stringify(unavailable)}; }
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  submitting = true;
  render();
  try {
    await window.LinkSense.tasks.run({ prompt: document.querySelector('#prompt').value });
    await window.LinkSense.tasks.getState();
  } catch {
    try { await window.LinkSense.tasks.getState(); } catch { unavailable(); }
    if (taskState?.can_submit) status.textContent = ${JSON.stringify(submitFailed)};
  } finally { submitting = false; button.disabled = !taskState?.can_submit; }
});
async function initialize() {
  await window.LinkSense.ready();
  const off = window.LinkSense.tasks.onStateChange(state => { taskState = state; render(); }, unavailable);
  window.addEventListener('pagehide', off, { once: true });
  await window.LinkSense.tasks.getState();
}
void initialize().catch(unavailable);`,

  };
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
