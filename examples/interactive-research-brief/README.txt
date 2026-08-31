LinkSense 交互式应用示例：交互式研究简报

导入方式
1. 在 LinkSense 的“插件中心 > 应用”中点击“创建应用”。
2. 选择“导入交互式应用”。
3. 上传 interactive-research-brief-v1.1.0.zip。
4. 创建后点击“立即试用”，填写研究主题并提交。

可验证能力
- 通过 LinkSense JS SDK 读取当前登录用户。
- 读取并选择当前用户可用的技能、插件和知识库。
- 展示当前用户已启用且运行时自动可用的 MCP。
- 通过 SDK 启动和停止任务、显示或隐藏原生聊天区域。
- 接收 brief.insight_ready、brief.risk_ready、brief.action_ready 三种自定义业务事件。

注意
- ZIP 根目录必须直接包含 manifest.json 和 index.html。
- 本示例不接收聊天消息增量或工具执行进度；这些内容由 LinkSense 原生聊天区域负责展示。
