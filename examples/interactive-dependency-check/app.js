(() => {
  const copy = {
    "zh-CN": {
      title: "交互式资源匹配测试", language: "语言 ", intro: "此页面只在点击后提交测试任务，不会自动读取或修改你的资源。",
      checklist: "验证要点", stepOne: "导入时可以让四类资源全部留空，应用仍应保存成功。",
      stepTwo: "在应用菜单配置所需资源，全部匹配后再运行测试。", stepThree: "共享或上架时仅能选择在线使用；接收者不需要再次匹配资源。",
      promptLabel: "测试请求", prompt: "请使用应用绑定的资源完成一次只读检查：读取一项测试知识库资料，并结合适用的技能给出简短摘要。不要修改数据或调用有写入副作用的工具。若缺少权限或资源不可用，请如实说明。",
      run: "提交只读测试", chat: "显示聊天", result: "测试结果", empty: "任务的最终结果会显示在聊天中；收到结果事件后也会展示在这里。",
      connecting: "等待连接 LinkSense…", ready: "已连接，可以提交测试。", standalone: "请将 ZIP 导入 LinkSense 后打开此应用。",
      sending: "正在提交…", accepted: "任务已受理，请在聊天中查看进度。", failed: "操作失败，请在聊天中查看详情，或检查资源配置后重试。",
    },
    "en-US": {
      title: "Interactive resource matching test", language: "Language ", intro: "This page submits a task only when clicked. It does not automatically read or modify your resources.",
      checklist: "What to verify", stepOne: "Leave all four resource types unselected during import. Import should still succeed.",
      stepTwo: "Configure required resources in the app menu before running this test.", stepThree: "Sharing and listing allow online use only. Recipients do not need to match resources again.",
      promptLabel: "Test request", prompt: "Perform a read-only check using the app's bound resources: read one test knowledge-base item and summarize it using an appropriate skill. Do not modify data or call tools with write side effects. Report missing permissions or unavailable resources honestly.",
      run: "Submit read-only test", chat: "Show chat", result: "Test result", empty: "The final result appears in chat and here when a result event arrives.",
      connecting: "Connecting to LinkSense…", ready: "Connected. Ready to submit.", standalone: "Import the ZIP into LinkSense and open the app there.",
      sending: "Submitting…", accepted: "Task accepted. Follow progress in chat.", failed: "The action failed. Check chat or your resource configuration and retry.",
    },
  };
  const byId = id => document.getElementById(id);
  let locale = "zh-CN", status = "connecting", ready = false, sending = false;
  const t = key => (copy[locale] || copy["zh-CN"])[key];
  function render() {
    document.documentElement.lang = locale;
    document.title = t("title");
    document.querySelectorAll("[data-copy]").forEach(element => { element.textContent = t(element.dataset.copy); });
    byId("status").textContent = t(status);
    byId("run").disabled = !ready || sending;
    byId("chat").disabled = !ready;
  }
  byId("prompt").value = t("prompt");
  byId("result").textContent = t("empty");
  byId("language").addEventListener("change", event => {
    const oldPrompt = t("prompt"), oldEmpty = t("empty");
    locale = event.target.value === "en-US" ? "en-US" : "zh-CN";
    if (byId("prompt").value === oldPrompt) byId("prompt").value = t("prompt");
    if (byId("result").textContent === oldEmpty) byId("result").textContent = t("empty");
    render();
  });
  const sdk = window.LinkSense;
  byId("test-form").addEventListener("submit", async event => {
    event.preventDefault();
    const prompt = byId("prompt").value.trim();
    if (!ready || sending || !prompt) return;
    sending = true; status = "sending"; render();
    try { await sdk.tasks.run({ prompt }); status = "accepted"; }
    catch { status = "failed"; }
    finally { sending = false; render(); }
  });
  byId("chat").addEventListener("click", async () => {
    try { await sdk.chat.show(); } catch { status = "failed"; render(); }
  });
  render();
  if (!sdk) { status = "standalone"; render(); return; }
  sdk.ready().then(() => {
    sdk.events.on("dependency_check.completed", event => {
      if (typeof event?.payload?.message === "string") byId("result").textContent = event.payload.message;
    });
    ready = true; status = "ready"; render();
  }).catch(() => { status = "failed"; render(); });
})();
