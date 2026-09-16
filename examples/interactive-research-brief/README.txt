LinkSense 交互式应用示例：交互式研究简报

导入方式
1. 在 LinkSense 的“插件中心 > 应用”中点击“创建应用”。
2. 选择“导入交互式应用”。
3. 上传 interactive-research-brief-v1.2.0.zip。
4. 创建后点击“立即试用”，填写研究主题并提交。

可验证能力
- 通过 LinkSense JS SDK 读取当前登录用户。
- 读取并选择当前用户可用的技能、插件和知识库。
- 展示当前用户已启用且运行时自动可用的 MCP。
- 选择多个参考文件，查看上传状态，重试或移除失败项，并按文件 ID 提交；重新进入任务可恢复待提交文件。
- 通过 SDK 启动和停止任务、显示或隐藏原生聊天区域。
- 接收 brief.insight_ready、brief.risk_ready、brief.action_ready 三种自定义业务事件。

注意
- ZIP 根目录必须直接包含 manifest.json 和 index.html。
- 本示例不接收聊天消息增量或工具执行进度；这些内容由 LinkSense 原生聊天区域负责展示。
