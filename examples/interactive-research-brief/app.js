(() => {
  "use strict";

  const copy = {
    "zh-CN": {
      workspaceLabel: "研究工作台", appTitle: "交互式研究简报", connecting: "正在连接 LinkSense", connected: "已连接 LinkSense", connectError: "无法连接 LinkSense",
      toggleChat: "显示 / 隐藏对话", configureTitle: "定义这次研究", configureHint: "填写目标与交付偏好，LinkSense 会据此组织完整任务。", loadingUser: "读取当前用户...", topicLabel: "你希望研究什么？",
      topicPlaceholder: "例如：评估生成式 AI 在制造业售后服务中的落地机会，并给出未来 90 天的行动建议", topicHint: "描述目标、背景和你真正需要做出的决定",
      audienceLabel: "目标读者", audienceManagement: "管理层 / 决策者", audienceProduct: "产品与业务团队", audienceTechnical: "技术团队", audienceClient: "客户 / 外部合作方",
      deliverableLabel: "交付形式", deliverableExecutive: "高管简报", deliverableComparison: "方案对比", deliverableAction: "行动计划", deliverableMemo: "决策备忘录",
      depthLabel: "研究深度", depthQuick: "快速扫描", depthStandard: "标准分析", depthDeep: "深度研究", focusLabel: "重点关注",
      focusOpportunities: "机会", focusOpportunitiesHint: "增长空间与可行路径", focusRisks: "风险", focusRisksHint: "限制条件与应对建议",
      focusMetrics: "指标", focusMetricsHint: "衡量结果的关键口径", focusActions: "行动", focusActionsHint: "下一步与优先级",
      constraintsLabel: "补充要求", optional: "可选", constraintsPlaceholder: "例如：优先使用近两年的资料；避免过度技术化；预算上限为 50 万元",
      resourceTitle: "选择可用资源", resourceHint: "仅选择本次研究真正需要使用的资源。", resourceTabsLabel: "资源类型", refreshResources: "刷新资源", capabilitiesTab: "技能与插件", knowledgeTab: "知识库", mcpAuto: "已启用的 MCP 会由 LinkSense 自动提供给任务，无需单独选择。",
      loadingResources: "正在读取可用资源...", noCapabilities: "当前没有可选择的技能或插件", noKnowledge: "当前没有可用的知识库", noMcp: "当前没有已启用的 MCP",
      unavailable: "暂不可选", readyTitle: "配置完成后即可开始", readyHint: "任务过程和最终结果会显示在 LinkSense 原生对话中", runTask: "生成研究简报",
      runningTask: "正在提交...", liveTitle: "结构化发现", eventUnit: "条", liveHint: "关键洞察、风险和行动建议会按约定格式出现在这里。",
      taskAccepted: "任务已提交", interruptTask: "停止任务", emptyTitle: "等待任务数据", emptyHint: "提交研究任务后，这里会逐步形成可操作的研究看板。",
      topicRequired: "请先填写研究主题", taskStarted: "任务已启动，已打开右侧对话", taskFailed: "任务提交失败，请稍后重试", taskInterrupted: "已请求停止当前任务",
      resourceFailed: "部分资源读取失败，可刷新后重试", insight: "洞察", risk: "风险", action: "行动", evidence: "依据", mitigation: "应对建议",
      priority: "优先级", impact: "影响", high: "高", medium: "中", low: "低", selected: "已选择", resourceUnit: "项", unknownUser: "LinkSense 用户"
    },
    "en-US": {
      workspaceLabel: "Research workspace", appTitle: "Interactive Research Brief", connecting: "Connecting to LinkSense", connected: "Connected to LinkSense", connectError: "Unable to connect to LinkSense",
      toggleChat: "Show / hide chat", configureTitle: "Define the research", configureHint: "Set the objective and delivery preferences so LinkSense can structure the task.", loadingUser: "Loading current user...", topicLabel: "What would you like to research?",
      topicPlaceholder: "Example: Evaluate generative AI opportunities in manufacturing after-sales service and propose a 90-day action plan", topicHint: "Describe the goal, context, and the decision you need to make",
      audienceLabel: "Audience", audienceManagement: "Leadership / decision makers", audienceProduct: "Product and business teams", audienceTechnical: "Technical team", audienceClient: "Clients / external partners",
      deliverableLabel: "Deliverable", deliverableExecutive: "Executive brief", deliverableComparison: "Option comparison", deliverableAction: "Action plan", deliverableMemo: "Decision memo",
      depthLabel: "Research depth", depthQuick: "Quick scan", depthStandard: "Standard analysis", depthDeep: "Deep research", focusLabel: "Focus areas",
      focusOpportunities: "Opportunities", focusOpportunitiesHint: "Growth areas and viable paths", focusRisks: "Risks", focusRisksHint: "Constraints and mitigations",
      focusMetrics: "Metrics", focusMetricsHint: "Measures of success", focusActions: "Actions", focusActionsHint: "Next steps and priorities",
      constraintsLabel: "Additional requirements", optional: "Optional", constraintsPlaceholder: "Example: Prefer sources from the past two years; keep it accessible; budget is capped at $50,000",
      resourceTitle: "Choose available resources", resourceHint: "Select only the resources this research actually needs.", resourceTabsLabel: "Resource types", refreshResources: "Refresh resources", capabilitiesTab: "Skills & plugins", knowledgeTab: "Knowledge bases", mcpAuto: "Enabled MCP connections are automatically available to the task; no selection is needed.",
      loadingResources: "Loading available resources...", noCapabilities: "No selectable skills or plugins", noKnowledge: "No knowledge bases available", noMcp: "No enabled MCP connections",
      unavailable: "Unavailable", readyTitle: "Ready when your configuration is complete", readyHint: "Progress and the final result will appear in the native LinkSense chat", runTask: "Generate research brief",
      runningTask: "Submitting...", liveTitle: "Structured findings", eventUnit: "items", liveHint: "Key insights, risks, and actions appear here in the agreed format.",
      taskAccepted: "Task submitted", interruptTask: "Stop task", emptyTitle: "Waiting for task data", emptyHint: "Submit a research task to build an actionable brief here.",
      topicRequired: "Enter a research topic first", taskStarted: "Task started and the chat panel is open", taskFailed: "Could not start the task. Please try again", taskInterrupted: "Stop requested for the current task",
      resourceFailed: "Some resources could not be loaded. Refresh to retry", insight: "Insight", risk: "Risk", action: "Action", evidence: "Evidence", mitigation: "Mitigation",
      priority: "Priority", impact: "Impact", high: "High", medium: "Medium", low: "Low", selected: "Selected", resourceUnit: "items", unknownUser: "LinkSense user"
    }
  };

  const state = {
    locale: "zh-CN",
    user: null,
    capabilities: [],
    knowledgeBases: [],
    mcpServers: [],
    eventCount: 0,
    activeTurnId: null,
    toastTimer: null,
    unsubscribers: []
  };

  const byId = (id) => document.getElementById(id);
  const t = (key) => copy[state.locale][key] || copy["zh-CN"][key] || key;

  function applyTranslations() {
    document.documentElement.lang = state.locale;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    });
  }

  function setConnection(mode, label) {
    const pill = byId("connection-pill");
    pill.classList.toggle("is-connected", mode === "connected");
    pill.classList.toggle("is-error", mode === "error");
    byId("connection-label").textContent = label;
  }

  function showToast(message, isError = false) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", isError);
    toast.hidden = false;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/u).filter(Boolean);
    if (!parts.length) return "LS";
    if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
    return `${Array.from(parts[0])[0] || ""}${Array.from(parts.at(-1))[0] || ""}`.toUpperCase();
  }

  function setUser(user) {
    state.user = user;
    if (user.language === "en-US") state.locale = "en-US";
    applyTranslations();
    const name = user.name || t("unknownUser");
    byId("user-name").textContent = name;
    byId("user-avatar").textContent = initials(name);
  }

  function setLoading(panel) {
    panel.replaceChildren(...[0, 1, 2, 3].map(() => {
      const skeleton = document.createElement("div");
      skeleton.className = "skeleton";
      skeleton.setAttribute("aria-label", t("loadingResources"));
      return skeleton;
    }));
  }

  function setListMessage(panel, message) {
    const empty = document.createElement("div");
    empty.className = "list-message";
    empty.textContent = message;
    panel.replaceChildren(empty);
  }

  function resourceItem(item, kind) {
    const label = document.createElement("label");
    label.className = `resource-item${item.can_select === false ? " is-disabled" : ""}`;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = kind;
    input.value = item.id;
    input.disabled = item.can_select === false;

    const copyNode = document.createElement("span");
    copyNode.className = "resource-item-copy";
    const name = document.createElement("span");
    name.className = "resource-item-name";
    name.textContent = item.name;
    const description = document.createElement("span");
    description.className = "resource-item-description";
    description.textContent = item.description || (item.can_select === false ? t("unavailable") : "");
    const badge = document.createElement("span");
    badge.className = "resource-badge";
    badge.textContent = kind === "capability" ? (item.type || "capability") : "knowledge";
    copyNode.append(name, description, badge);
    label.append(input, copyNode);
    return label;
  }

  function renderCapabilities() {
    const panel = byId("capabilities-panel");
    byId("capability-count").textContent = String(state.capabilities.length);
    if (!state.capabilities.length) return setListMessage(panel, t("noCapabilities"));
    panel.replaceChildren(...state.capabilities.map((item) => resourceItem(item, "capability")));
  }

  function renderKnowledge() {
    const panel = byId("knowledge-panel");
    byId("knowledge-count").textContent = String(state.knowledgeBases.length);
    if (!state.knowledgeBases.length) return setListMessage(panel, t("noKnowledge"));
    panel.replaceChildren(...state.knowledgeBases.map((item) => resourceItem({ ...item, can_select: item.availability_status !== "unavailable" }, "knowledge")));
  }

  function renderMcp() {
    const panel = byId("mcp-panel");
    byId("mcp-count").textContent = String(state.mcpServers.length);
    const note = document.createElement("p");
    note.className = "mcp-note";
    note.textContent = t("mcpAuto");
    if (!state.mcpServers.length) {
      const empty = document.createElement("div");
      empty.className = "list-message";
      empty.textContent = t("noMcp");
      return panel.replaceChildren(note, empty);
    }
    const items = state.mcpServers.map((item) => {
      const row = document.createElement("div");
      row.className = "resource-item mcp-item";
      const dot = document.createElement("span");
      dot.className = "mcp-dot";
      const copyNode = document.createElement("span");
      copyNode.className = "resource-item-copy";
      const name = document.createElement("span");
      name.className = "resource-item-name";
      name.textContent = item.name;
      const description = document.createElement("span");
      description.className = "resource-item-description";
      description.textContent = `${item.transport} · ${item.status}`;
      copyNode.append(name, description);
      row.append(dot, copyNode);
      return row;
    });
    panel.replaceChildren(note, ...items);
  }

  async function loadResources() {
    const refreshButton = byId("refresh-resources");
    refreshButton.disabled = true;
    refreshButton.classList.add("is-loading");
    ["capabilities-panel", "knowledge-panel", "mcp-panel"].forEach((id) => setLoading(byId(id)));
    const results = await Promise.allSettled([
      window.LinkSense.resources.listCapabilities(),
      window.LinkSense.resources.listKnowledgeBases(),
      window.LinkSense.resources.listMcpServers()
    ]);
    state.capabilities = results[0].status === "fulfilled" ? results[0].value.items : [];
    state.knowledgeBases = results[1].status === "fulfilled" ? results[1].value.items : [];
    state.mcpServers = results[2].status === "fulfilled" ? results[2].value.items : [];
    renderCapabilities();
    renderKnowledge();
    renderMcp();
    if (results.some((result) => result.status === "rejected")) showToast(t("resourceFailed"), true);
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
  }

  function selectedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`), (input) => input.value);
  }

  function selectedLabel(select) {
    return select.options[select.selectedIndex]?.textContent || select.value;
  }

  function buildPrompt() {
    const topic = byId("topic").value.trim();
    const constraints = byId("constraints").value.trim();
    const audience = selectedLabel(byId("audience"));
    const deliverable = selectedLabel(byId("deliverable"));
    const depthInput = document.querySelector('input[name="depth"]:checked');
    const depth = depthInput?.nextElementSibling?.textContent || depthInput?.value || "standard";
    const focus = selectedValues("focus").map((value) => ({
      opportunities: state.locale === "en-US" ? "opportunities" : "机会",
      risks: state.locale === "en-US" ? "risks" : "风险",
      metrics: state.locale === "en-US" ? "metrics" : "指标",
      actions: state.locale === "en-US" ? "actions" : "行动"
    })[value]);

    const eventInstruction = state.locale === "en-US"
      ? `During the work, use emit_application_event for structured business findings only:\n- brief.insight_ready for each material insight with title, finding, and evidence.\n- brief.risk_ready for each material risk with risk, impact (high/medium/low), and mitigation.\n- brief.action_ready for each actionable recommendation with title, rationale, and priority (high/medium/low).\nEmit useful events as findings become ready. Do not wrap chat messages or tool progress in these events. Put the complete reasoning and final deliverable in the native LinkSense chat.`
      : `执行过程中，仅针对结构化业务发现使用 emit_application_event：\n- 每形成一条关键洞察，发送 brief.insight_ready，数据包含 title、finding、evidence。\n- 每识别一条关键风险，发送 brief.risk_ready，数据包含 risk、impact（high/medium/low）、mitigation。\n- 每形成一条可执行建议，发送 brief.action_ready，数据包含 title、rationale、priority（high/medium/low）。\n数据就绪时即可逐条发送。不要把聊天消息或工具进度包装成这些事件。完整分析过程和最终交付物仍需在 LinkSense 原生对话中呈现。`;

    return [
      state.locale === "en-US" ? "Create a research brief using the following configuration:" : "请根据以下配置完成一份研究简报：",
      `${state.locale === "en-US" ? "Research topic" : "研究主题"}：${topic}`,
      `${t("audienceLabel")}：${audience}`,
      `${t("deliverableLabel")}：${deliverable}`,
      `${t("depthLabel")}：${depth}`,
      `${t("focusLabel")}：${focus.join(state.locale === "en-US" ? ", " : "、") || (state.locale === "en-US" ? "No preference" : "无特别偏好")}`,
      `${t("constraintsLabel")}：${constraints || (state.locale === "en-US" ? "None" : "无")}`,
      "",
      eventInstruction
    ].join("\n");
  }

  function eventCard(kind, payload) {
    const card = document.createElement("article");
    card.className = "event-card";
    card.dataset.kind = kind;
    const head = document.createElement("div");
    head.className = "event-card-head";
    const title = document.createElement("h3");
    title.className = "event-card-title";
    title.textContent = kind === "risk" ? payload.risk : payload.title;
    const badge = document.createElement("span");
    badge.className = "event-kind";
    badge.textContent = t(kind);
    head.append(title, badge);

    const body = document.createElement("p");
    body.className = "event-card-body";
    body.textContent = kind === "insight" ? payload.finding : kind === "risk" ? payload.mitigation : payload.rationale;
    card.append(head, body);

    if (kind === "insight") {
      const evidence = document.createElement("p");
      evidence.className = "event-card-evidence";
      evidence.textContent = `${t("evidence")} · ${payload.evidence}`;
      card.append(evidence);
    } else {
      const priority = document.createElement("span");
      const value = kind === "risk" ? payload.impact : payload.priority;
      priority.className = "priority";
      priority.dataset.priority = value;
      priority.textContent = `${t(kind === "risk" ? "impact" : "priority")} · ${t(value)}`;
      card.append(priority);
    }
    return card;
  }

  function receiveEvent(kind, event) {
    if (!event || typeof event.payload !== "object" || event.payload === null) return;
    const feed = byId("event-feed");
    byId("empty-state")?.remove();
    feed.prepend(eventCard(kind, event.payload));
    state.eventCount += 1;
    byId("event-count").textContent = String(state.eventCount);
    while (feed.children.length > 30) feed.lastElementChild?.remove();
  }

  async function submitTask(event) {
    event.preventDefault();
    const topic = byId("topic");
    if (!topic.value.trim()) {
      topic.focus();
      topic.setAttribute("aria-invalid", "true");
      showToast(t("topicRequired"), true);
      return;
    }
    topic.removeAttribute("aria-invalid");
    const button = byId("run-task");
    button.disabled = true;
    const buttonLabel = button.querySelector("span");
    buttonLabel.textContent = t("runningTask");
    try {
      const receipt = await window.LinkSense.tasks.run({
        prompt: buildPrompt(),
        capability_ids: selectedValues("capability"),
        knowledge_base_ids: selectedValues("knowledge"),
        idempotency_key: `interactive-brief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      state.activeTurnId = receipt.turn_id;
      byId("run-status").hidden = false;
      byId("turn-id").textContent = receipt.turn_id;
      await window.LinkSense.chat.show();
      showToast(t("taskStarted"));
    } catch (error) {
      console.error("Failed to start LinkSense task", error);
      showToast(t("taskFailed"), true);
    } finally {
      button.disabled = false;
      buttonLabel.textContent = t("runTask");
    }
  }

  async function interruptTask() {
    if (!state.activeTurnId) return;
    const button = byId("interrupt-task");
    button.disabled = true;
    try {
      await window.LinkSense.tasks.interrupt(state.activeTurnId);
      showToast(t("taskInterrupted"));
      byId("run-status").hidden = true;
      state.activeTurnId = null;
    } catch (error) {
      console.error("Failed to interrupt LinkSense task", error);
      showToast(t("taskFailed"), true);
    } finally {
      button.disabled = false;
    }
  }

  function bindUi() {
    byId("topic").addEventListener("input", (event) => {
      byId("topic-count").textContent = `${event.target.value.length} / 4000`;
      if (event.target.value.trim()) event.target.removeAttribute("aria-invalid");
    });
    byId("brief-form").addEventListener("submit", submitTask);
    byId("refresh-resources").addEventListener("click", loadResources);
    byId("chat-toggle").addEventListener("click", () => window.LinkSense.chat.toggle());
    byId("interrupt-task").addEventListener("click", interruptTask);
    document.querySelectorAll("[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab)));
        ["capabilities", "knowledge", "mcp"].forEach((name) => {
          byId(`${name}-panel`).hidden = name !== tab.dataset.tab;
        });
      });
    });
  }

  async function initialize() {
    bindUi();
    applyTranslations();
    try {
      await window.LinkSense.ready();
      const user = await window.LinkSense.context.getCurrentUser();
      setUser(user);
      setConnection("connected", t("connected"));
      state.unsubscribers.push(
        window.LinkSense.events.on("brief.insight_ready", (event) => receiveEvent("insight", event)),
        window.LinkSense.events.on("brief.risk_ready", (event) => receiveEvent("risk", event)),
        window.LinkSense.events.on("brief.action_ready", (event) => receiveEvent("action", event))
      );
      await loadResources();
    } catch (error) {
      console.error("Failed to initialize LinkSense SDK", error);
      setConnection("error", t("connectError"));
      showToast(t("connectError"), true);
    }
  }

  window.addEventListener("pagehide", () => state.unsubscribers.forEach((unsubscribe) => unsubscribe()));
  void initialize();
})();
