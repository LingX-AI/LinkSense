# 企业消息渠道接入与本地验证

适用范围：企业微信内部智能机器人、钉钉企业内部应用机器人、Microsoft Teams 单租户机器人。企业微信和 Teams 由管理员集中配置，钉钉通过个人扫码创建授权；接收已关联账号的文本私聊和群内 @ 消息，复用 LinkSense 原生任务处理，返回最终文本。图片、文件、语音、卡片和企业微信客户消息不在本次范围内。

## 官方方案与依赖选择

调研日期：2026-10-29。优先使用官方 SDK，并复用现有 Prisma、Redis、Zod、Azure Identity、加密工具和 DurableWorkDispatcher。

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

配置/扫码授权 → 官方适配器 → Zod 消息投影 → 平台身份关联与活跃账号校验 → PostgreSQL 收件记录 → 原生 ConversationService.acceptTurn → 原生完成事件与最终消息 → 持久化发件记录 → 官方发送 API。

- 新消息持久化后立即唤醒独立的收件处理器，不等待连接扫描或发件处理。每秒扫描是恢复遗漏通知与重试的保障；设置页每 5 秒刷新状态不会影响接收速度。
- 钉钉每个用户只能连接一个个人机器人。企业微信、Teams 各有一个组织连接，凭据与启停操作仅管理员可访问，连接不会随配置管理员的停用而失效。
- 钉钉扫码复用[钉钉官方连接器的设备注册协议](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/88df00ee594072e9941ef3f71da90a37f3291ad3/src/device-auth.ts)。凭据只保存在后端加密存储中。注册会话存入加密 Redis，按官方间隔轮询，并用分布式租约及固定连接 ID 防止重复创建。
- 用户登录既有 LinkSense 账号获取 96 位随机确认码，私聊机器人完成一次性关联。代码按连接隔离、10 分钟有效、Redis 原子消费，重新生成或解除关联会撤销旧码；确认消息不进入任务收件箱。不能根据姓名、邮箱文本或首条消息认领账号，也不会自动注册用户。
- 每次接收、处理和发送时重新检查身份与活跃账号。任务、额度、资源及审计均使用实际发送成员。群内机器人回复对群成员可见。
- 按连接、聊天和 LinkSense 用户划分会话与排队。不同成员即使在同一群也不会共用任务上下文。同一成员按入库顺序继续任务；Teams 频道还按帖子线程划分任务。
- 接收消息以连接和平台消息 ID 去重。原生任务使用持久化幂等键；恢复时查询已有任务，不自定义重放 Codex turn。
- 收件、发件、长连接归属和断开操作使用 Redis 租约；生命周期锁持续续租，丢失锁后停止新的提交或发送。多个工作进程共享 PostgreSQL 和 Redis。
- 钉钉在入库成功后 ACK；入库失败不 ACK。WeCom 的回调确认与重连由官方 SDK/平台协议管理。
- 回复按 UTF-8 字节拆分，单段不超过 3500 字节，最多 10 段。超长回复提示用户到 LinkSense 查看完整结果。
- 每成功发送一段就记录进度。失败重试不会重发已经确认的分段；平台已接收但网络超时、或成功后写入数据库前进程退出，仍可能重复发送无法确认的最后一段，平台没有通用的跨渠道恰好一次交付保证。
- 收件最多尝试 20 次；发件最多尝试 10 次，指数退避且有上限。达到上限保留失败状态。
- 应用凭据、回复路由及 Teams SDK 存储使用已有主密钥加密，绑定记录 ID 作为附加认证数据。管理接口不返回密钥。
- Teams 回调不需要 LinkSense 登录，但必须通过官方 SDK 的服务 JWT 签名、受众、签发者、有效期及 serviceUrl 校验；业务层再检查租户、成员、群聊 @。生产路径强制开启鉴权，并限制回复地址为公共 Teams 服务域名。

## 数据库变更与升级

新增迁移 `20261029040000_split_personal_and_organization_bot_channels` 会清除旧企业微信、钉钉、Teams 连接、会话映射和收发队列，删除单一发送者字段，新增身份表及按成员隔离的会话键。该破坏性处理已获本次需求确认；用户、已有 LinkSense 任务、微信和飞书连接均保留。`20261029040500_allow_paused_bot_channels` 扩展状态约束，允许组织渠道暂停而不删除配置。

升级时先备份数据库并停止旧版 API 工作进程，再运行 Prisma 迁移、启动新版 API 和前端。旧的三个渠道需要按新方式重新连接，不能仅回退旧版二进制；回退需同时恢复升级前数据库备份。不得修改已应用迁移，也不增加旧配置兼容路径。

## 自动化验证

常规测试无需平台账号：

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api test test/bot-channels-projection.test.ts test/bot-channels-routes.test.ts test/bot-channels-clients.test.ts test/bot-channels-runtime.test.ts test/bot-channel-identity.test.ts test/dingtalk-registration-client.test.ts test/i18n.test.ts
pnpm --filter @linksense/web exec vitest run --project components src/features/bot-channels/bot-channel-cards.test.tsx --maxWorkers=2
pnpm --filter @linksense/web exec playwright test e2e/bot-channels.spec.ts --workers=1
```

PostgreSQL + Redis 集成脚本只接受本机、库名为 `linksense_channel_tests` 的独立测试库，不能加载正式数据库配置。先创建临时服务，并用显式的 `DATABASE_URL` 指向测试库运行 Prisma 迁移。分别执行以下脚本，避免共享单例渠道的测试并行冲突：

```sh
BOT_CHANNEL_TEST_DATABASE_URL='postgresql://<测试用户>:<测试密码>@127.0.0.1:<测试端口>/linksense_channel_tests' \
BOT_CHANNEL_TEST_REDIS_URL='redis://127.0.0.1:<测试端口>' \
pnpm --filter @linksense/api exec tsx test/integration/bot-channels-postgres.ts

BOT_CHANNEL_TEST_DATABASE_URL='postgresql://<测试用户>:<测试密码>@127.0.0.1:<测试端口>/linksense_channel_tests' \
BOT_CHANNEL_TEST_REDIS_URL='redis://127.0.0.1:<测试端口>' \
pnpm --filter @linksense/api exec tsx test/integration/bot-channel-organization-postgres.ts
```

前者验证三个适配器投影到持久化收发、两个进程并发去重、任务复用、顺序及重启后分段续发；后者验证一次性关联、撤销、同群两成员隔离、成员停用、组织启停和清理保留任务。Prisma 查询、约束、Redis 锁和完成记录读取使用真实实现，平台传输及模型执行使用测试替身。

升级回归要求一个全新的本机测试库 `linksense_channel_upgrade_tests`。脚本先部署本次改动前的迁移，填充旧连接和队列，再执行新版迁移并检查保留范围：

```sh
BOT_CHANNEL_UPGRADE_TEST_DATABASE_URL='postgresql://<测试用户>:<测试密码>@127.0.0.1:<测试端口>/linksense_channel_upgrade_tests' \
pnpm --filter @linksense/api exec tsx test/integration/bot-channel-upgrade-postgres.ts
```

修改随产品分发的中英文帮助文档后，应重新生成 `BUILT_IN_CAPABILITY_RUNTIME_REVISION`，并验证生成内容指纹和既有任务快照刷新。

## 真实平台验收边界

钉钉官方注册接口的二维码生成已实际验证。完整平台收发仍需手机扫码、有效的企业微信/Teams 测试应用及 Teams 公网 HTTPS 地址，不能由测试替身证明。逐渠道验收私聊文本、群内 @、未关联/停用账号拒绝、同群不同成员隔离、重启恢复和断开；凭据、确认码和原始消息不得写入测试日志。
