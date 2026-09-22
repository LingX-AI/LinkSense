# SAML 2.0 企业登录

## 范围与入口

管理入口为“设置 → 系统设置 → 登录方式 → 企业账号登录 → 企业统一登录（SAML 2.0）”。支持一个组织身份平台，SP 发起的 HTTP-Redirect AuthnRequest 与 HTTP-POST ACS，要求签名断言，允许同时签名 Response。可选 RSA/SHA-256 请求签名。当前不支持 IdP 发起登录、加密断言、SLO、自动导入 IdP Metadata 或多证书轮换窗口。

| 用途 | 地址 |
| --- | --- |
| 公开可用状态 | `GET /api/v1/auth/saml/status` |
| SP Entity ID 与 Metadata | `GET /api/v1/auth/saml/metadata` |
| 发起登录 | `POST /api/v1/auth/saml/start` |
| ACS | `POST /api/v1/auth/saml/acs` |
| 登录结果页 | `/auth/saml/callback` |
| 管理员配置 | `GET / PUT /api/v1/admin/saml-authentication-settings` |

Entity ID、ACS 与结果页由 `LINKSENSE_PUBLIC_BASE_URL` 生成。站点必须使用 HTTPS；反向代理需保留外部 Host/Origin，并正确设置项目的代理信任策略。Metadata 只在配置启用且有效时开放下载，不包含私钥。

## 身份平台配置

1. 在身份平台创建 SAML 应用，登记页面显示的 Entity ID 和 ACS，使用 POST 返回响应。IdP 登录地址必须为 HTTPS。
2. 将身份平台 Entity ID、登录 URL 与有效的 PEM 签名证书保存到 LinkSense。断言必须签名，包含准确的 Issuer、Audience、Recipient、InResponseTo、有效时间、NameID、AuthnStatement 与邮箱属性。
3. 按平台实际发送的名称配置邮箱/姓名属性。默认邮箱属性为 `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`，姓名属性为 `http://schemas.microsoft.com/identity/claims/displayname`；姓名可留空，邮箱可显式选择 `NameID`。邮箱必须由组织控制，不应允许成员自行声明其他人的地址。
4. 如果要求签名 AuthnRequest，提供 SP RSA 证书及匹配私钥，启用请求签名，并将公开 SP 证书登记到 IdP。不要求请求签名时无需提供 SP 密钥。
5. 从 LinkSense 登录页发起登录。已存在且启用的账号按邮箱匹配并保留角色；新账号创建后保持禁用，等待管理员启用。不受第三方账号开放注册开关影响。

## 状态与安全边界

- 使用 `@node-saml/node-saml` 校验真实 XML 签名、Audience、有效期和请求关联；身份只取自其验证过的断言。额外强制校验 Issuer、Recipient、响应成功状态、版本和必需的有效期字段。
- RelayState 为随机不透明值，不接受跳转 URL。Redis 存储五分钟有效的流程及 AuthnRequest 关联，原子消费防重放，适用于多个 API worker。
- 登录与 `Secure; HttpOnly; SameSite=None` Cookie 绑定，防止将另一浏览器的登录响应用于当前浏览器。配置 revision 变化后旧流程失效。单 IP 每分钟最多发起 20 次登录。
- XML 禁止 DTD，限制回调体积；未通过验证的断言不会触发账号查询、创建或会话签发。错误页不展示身份平台原始报文，日志过滤 `SAMLResponse`、`RelayState` 和签名私钥。
- 配置存入现有 `system_settings.settings_json` 的独立加密项 `saml_authentication_encrypted`，使用既有凭据主密钥。保留 OIDC、Teams、邮件、产品及第三方登录设置。私钥仅在提交时接收，不返回到管理 API，不写入审计。
- 配置写入使用事务、系统设置共享 advisory lock 与 revision 乐观并发控制。到期/无效证书或不可解密配置均拒绝登录。私钥留空表示保留，关闭请求签名表示删除该 SP 证书和私钥。
- 本地退出仅结束 LinkSense 会话。身份平台上的登录状态及 MFA 策略由身份平台管理。

## 数据迁移与升级

用户已确认保留现有账号、登录记录和字段结构。新增迁移 `20260922090000_add_saml_login_method` 只将 `users.last_login_method` 的 CHECK 允许值扩展为包含 `saml`，保留原有 `NULL`、`password`、`oidc`、`teams`、`google`、`apple`、`microsoft` 和 `facebook`。不增删表或字段，不更新、删除历史行。Prisma 字段仍为原来的可空字符串，无需更改模型。

迁移文件已准备，开发任务未执行迁移。部署时先在发布流程中执行 `pnpm db:migrate:deploy`，确认包括前置迁移在内的待执行列表，再部署匹配的 API 与前端。完成所有旧 API worker 替换后，才启用 SAML。已有 OIDC、Teams 和第三方登录配置无需重新创建；未配置 SAML 时保持禁用。

发生 SAML 登录后，用户及会话中会出现新登录方式值；旧应用可能无法解析这些记录，**不能直接回滚旧应用**。需要停止 SAML 时，在当前版本禁用该配置，保留账号与记录，通过向前修复恢复服务。禁用不会清除已签发的 LinkSense 会话。迁移未实际在数据库演练，发布前仍需在备份/测试数据库确认。

## 依赖与验证

Node-SAML 5.1.0 提供 TypeScript 类型并使用 MIT 许可证；沿用已有 `saxes` 做有界 XML 预检，无自制签名算法。测试用 `xml-crypto` 和 `selfsigned` 生成临时证书与真实签名，测试不访问外部身份平台。

Node-SAML 与 xml-crypto 的 XML API 需要 xmldom 0.8 分支；仅对这两个依赖指定已修复的 `0.8.15`，其他消费者保留 `0.9.12` 安全覆盖。安全依赖测试同时约束这两条分支，拒绝旧的未修复版本。参考 [xmldom 安全公告](https://github.com/xmldom/xmldom/security/advisories/GHSA-6h8r-xr42-gp59)、[0.9 分支公告影响范围](https://github.com/advisories/GHSA-6mj3-qw4j-hgrw) 和 [Node-SAML 文档](https://github.com/node-saml/node-saml)。

单元测试覆盖真实签名登录、伪造/篡改、Issuer/Audience/Recipient/Destination/请求关联错误、过期、状态与版本错误、Cookie 绑定、重放、并发、限流、加密配置与旧设置可用性、管理员授权、敏感信息过滤、表单交互、登录回调与中英文回退。真实 Entra ID/Okta/Keycloak 联调需在配置有效 HTTPS 域名及对应 IdP 后进行；本任务不声称完成该联调。

已执行的验证命令（前端仅 Vitest，不含浏览器自动化）：

```sh
pnpm --filter @linksense/shared test
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api test test/saml.protocol.test.ts test/saml.settings.test.ts test/saml.routes.test.ts test/saml.state.test.ts test/auth.service.test.ts test/auth.routes.test.ts test/authentication-settings.test.ts test/users.service.test.ts test/social-auth.routes.test.ts
pnpm --filter @linksense/web exec vitest run src/features/saml/saml.test.tsx src/features/social-auth/social-auth.test.tsx src/pages/admin-settings.test.tsx src/App.test.tsx src/i18n.test.ts src/pages/auth-pages.test.tsx src/app/route-guards.maintenance.test.tsx --maxWorkers=4
pnpm exec node --test scripts/security-dependencies.test.mjs scripts/saml-migration.test.mjs
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/api lint
pnpm --filter @linksense/web lint
pnpm --filter @linksense/api build
pnpm --filter @linksense/web build
```

共享测试 536 项、API 相关测试 148 项通过；前端首次相关运行 222 项通过，随后新增两项场景并重新运行 SAML 测试文件（11 项全部通过），相关唯一用例合计 224 项；依赖和迁移静态测试共 5 项通过。类型检查与构建通过。前端 lint 保留既有 TanStack Virtual 编译警告，构建保留文档预览依赖的浏览器 externalization 和 chunk 体积警告，均无错误。实际数据库迁移、页面浏览器检查和真实 IdP 联调未执行。
