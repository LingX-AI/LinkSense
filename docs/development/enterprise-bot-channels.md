# 企业消息渠道接入与本地验证

适用范围：企业微信内部智能机器人、钉钉企业内部应用机器人、Microsoft Teams 单租户机器人。接收指定成员的文本私聊和群内 @ 消息，复用 LinkSense 原生任务处理，返回最终文本。图片、文件、语音、卡片和企业微信客户消息不在本次范围内。

## 官方方案与依赖选择

调研日期：2026-09-06。优先使用官方 SDK，并复用现有 Prisma、Redis、Zod、Azure Identity、加密工具和 DurableWorkDispatcher。

| 渠道 | 官方接收方式 | 依赖 | 回复方式 |
| --- | --- | --- | --- |
| 企业微信 | 智能机器人 WebSocket 长连接 | `@wecom/aibot-node-sdk@1.0.7` | SDK `sendMessage` 主动发送，避免任务执行超过回调回复窗口 |
| 钉钉 | Stream 长连接、机器人消息回调 | `dingtalk-stream@2.1.7-beta.1` | 官方机器人单聊/群聊发送 API |
| Teams | 公网 HTTPS 接收 Activity | `@microsoft/teams.apps@2.0.16` | SDK 使用经过服务 JWT 验证并持久化的区域地址发送 |

三者均为 MIT 许可。Teams SDK 要求 Node.js 20 或以上，与项目运行环境一致。钉钉固定使用预发布版本：对比 2.1.5 的源码后，新版提供 HTTP 超时、异步回调容量限制和断开连接取消能力，降低无界等待与回调堆积风险。没有修改 SDK 或自行实现 WebSocket 协议；后续升级稳定版时需重跑适配器与断线恢复测试。该预发布依赖是当前需要持续关注的维护风险。

参考官方资料：

- [企业微信官方智能机器人 Node SDK](https://github.com/WecomTeam/aibot-node-sdk)
- [钉钉 Stream 模式说明](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview/)
- [钉钉官方 Stream Node SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
- [钉钉机器人群聊发送 API](https://open.dingtalk.com/document/orgapp/the-robot-sends-a-group-message)
- [钉钉机器人单聊发送 API](https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches)
- [Teams SDK 自行管理 HTTP 服务](https://microsoft.github.io/teams-sdk/llms_docs/docs_typescript/self-managing-your-server.txt)
- [Teams SDK 信任模型](https://microsoft.github.io/teams-sdk/typescript/essentials/app-authentication/trust-model/)
- [Microsoft Teams 官方 SDK 源码](https://github.com/microsoft/teams.ts)

## 数据和处理链路

配置 → 官方适配器 → Zod 消息投影与发送者限制 → PostgreSQL 收件记录 → 原生 ConversationService.acceptTurn → 原生完成事件与最终消息 → 持久化发件记录 → 官方发送 API。

- 新消息持久化后立即唤醒独立的收件处理器，不等待连接扫描或发件处理。每秒扫描是恢复遗漏通知与重试的保障；设置页每 5 秒刷新状态不会影响接收速度。
- 每个 LinkSense 用户每种渠道只能绑定一个机器人，同一个机器人不能被不同用户重复绑定。
- 群内只有配置的成员可以使用其绑定的 LinkSense 账号。群内机器人回复对群成员可见；发送内容前应考虑所在群的可见范围。
- 同一聊天的消息按入库顺序处理并复用任务。Teams 频道按帖子线程划分任务。
- 接收消息以连接和平台消息 ID 去重。原生任务使用持久化幂等键；恢复时查询已有任务，不自定义重放 Codex turn。
- 收件、发件、长连接归属和断开操作使用 Redis 租约；生命周期锁持续续租，丢失锁后停止新的提交或发送。多个工作进程共享 PostgreSQL 和 Redis。
- 钉钉在入库成功后 ACK；入库失败不 ACK。WeCom 的回调确认与重连由官方 SDK/平台协议管理。
- 回复按 UTF-8 字节拆分，单段不超过 3500 字节，最多 10 段。超长回复提示用户到 LinkSense 查看完整结果。
- 每成功发送一段就记录进度。失败重试不会重发已经确认的分段；平台已接收但网络超时、或成功后写入数据库前进程退出，仍可能重复发送无法确认的最后一段，平台没有通用的跨渠道恰好一次交付保证。
- 收件最多尝试 20 次；发件最多尝试 10 次，指数退避且有上限。达到上限保留失败状态。
- 应用凭据、回复路由及 Teams SDK 存储使用已有主密钥加密，绑定记录 ID 作为附加认证数据。管理接口不返回密钥。
- Teams 回调不需要 LinkSense 登录，但必须通过官方 SDK 的服务 JWT 签名、受众、签发者、有效期及 serviceUrl 校验；业务层再检查租户、成员、群聊 @。生产路径强制开启鉴权，并限制回复地址为公共 Teams 服务域名。

## 数据库变更

`20260906040000_add_enterprise_bot_channels` 仅新增以下表及其索引、检查约束：

- `bot_channel_connections`
- `bot_channel_peer_sessions`
- `bot_channel_inbound_messages`
- `bot_channel_outbound_deliveries`

不删除、改名或转换历史表/字段，不引入外键。断开连接事务删除该连接的收发记录和会话映射，保留原有 LinkSense 任务。删除任务时也清理本次新增的关联记录。迁移已在独立临时数据库执行，不代表已在部署环境应用。

## 自动化验证

常规单元测试无需平台账号和网络：

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api test test/bot-channels-projection.test.ts test/bot-channels-routes.test.ts test/bot-channels-clients.test.ts test/bot-channels-runtime.test.ts
pnpm --filter @linksense/web test:unit src/features/bot-channels/bot-channel-cards.test.tsx src/pages/weixin-channel-page.test.tsx
```

真实 PostgreSQL + Redis 集成脚本只允许本机、库名为 `linksense_channel_tests` 的独立测试库，不能加载正式 `.env`。先创建临时 PostgreSQL 和 Redis，使用 `DATABASE_URL` 指向测试库运行 `pnpm exec prisma migrate deploy`，再执行：

```sh
BOT_CHANNEL_TEST_DATABASE_URL='postgresql://<测试用户>:<测试密码>@127.0.0.1:<测试端口>/linksense_channel_tests' \
BOT_CHANNEL_TEST_REDIS_URL='redis://127.0.0.1:<测试端口>' \
pnpm --filter @linksense/api exec tsx test/integration/bot-channels-postgres.ts
```

脚本验证三个渠道的持久化收发、并发去重、两个工作进程、会话复用与顺序、发送者限制、重启后分段续发、禁用用户和断开清理。平台传输与模型执行边界使用测试替身，Prisma 查询、数据库约束、Redis 锁和任务完成记录读取为真实实现。测试创建的数据会在 finally 中清理。

## 后续真实联调

当前没有测试应用、账号和 Teams 公网 HTTPS 地址，因此不宣称真实平台收发已验收。部署后需分别配置应用并验证：私聊一条文本、群内 @、非授权成员拒绝、同聊天连续发送、服务重启后恢复、凭据错误和断开。Teams 还需配置 Azure Bot 终结点和 Teams 应用包的 personal/groupChat/team scopes。使用真实平台测试时不得将凭据或原始消息内容写入测试日志。
