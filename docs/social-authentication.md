# 第三方账号注册与登录

## 管理入口

在“系统设置 → 登录方式 → 第三方账号登录”统一管理开放注册及 Google、Apple、Microsoft、Facebook、GitHub。
页面使用单列设置列表；顶部开放注册开关切换后立即保存，保存期间禁止重复操作，失败时恢复原状态并提示。各平台名称前显示品牌 Logo，通过右侧“配置”按钮打开配置弹窗。
该功能独立于企业 OIDC 和 Teams SSO，不需要替换当前登录系统。
各平台默认关闭。保存配置后立即生效，不需要重启 API。

每个平台的配置弹窗显示固定回调地址：

```text
https://<站点域名>/api/v1/auth/social/google/callback
https://<站点域名>/api/v1/auth/social/apple/callback
https://<站点域名>/api/v1/auth/social/microsoft/callback
https://<站点域名>/api/v1/auth/social/facebook/callback
https://<站点域名>/api/v1/auth/social/github/callback
```

地址由 `LINKSENSE_PUBLIC_BASE_URL` 生成，必须与平台后台配置完全一致。
前端、API 和回调必须通过同一站点访问；开发时使用 Vite 的 `/api` 代理。
生产环境使用 HTTPS；Apple 不支持本实现中的 HTTP 本地回调。
API 服务器必须能够访问平台的发现、密钥、令牌及资料接口；部署在国内不代表这些网络条件一定满足。

## 平台配置

- Google：创建 Web 应用 OAuth 客户端，填写客户端 ID、客户端密钥和授权重定向 URI。完成同意屏幕配置，测试模式下添加测试用户。
- Apple：为网站配置 Sign in with Apple 的 Services ID，作为应用 ID；填写 Team ID、Key ID 和 `.p8` 私钥内容，登记网站域名及返回 URL。服务端使用 `jose` 即时签发短期 client secret，接受 Apple 的 `form_post` 回调。若用户隐藏邮箱，邮件服务需要按 Apple 要求配置私密邮箱转发的发件域名。
- Microsoft：注册允许“个人 Microsoft 账号”的应用，使用 Web 重定向 URI，填写 Application (client) ID 与客户端密钥**值**。仅接受个人账号租户（consumers）；企业账号继续走原有企业登录入口。
- Facebook：创建提供 Facebook Login 的应用，填写 App ID、App Secret，以及该应用当前使用的 Graph API 版本，例如 `vXX.0`，不要直接填写占位示例。登记有效 OAuth 回调地址。面向普通用户开放前，完成该应用要求的发布、隐私政策、数据删除和审核配置。
- GitHub：在 Settings → Developer settings → OAuth Apps → New OAuth App 创建应用（例如 LinkSense），Homepage URL 填写站点地址，Authorization callback URL 完整复制 LinkSense 配置弹窗显示的地址。将 Client ID 和生成的 Client Secret 填入 LinkSense 并启用。测试与生产使用不同回调地址时分别创建 OAuth App。仅请求 `user:email`，不申请仓库权限。

正式发布所需的品牌、域名、业务验证及权限审核需在相应平台完成；保存凭据不表示已经完成平台审核。

官方参考：

- [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Apple 网站登录配置](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple)
- [Microsoft 支持的账号类型](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types)
- [Facebook 手动登录流程](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
- [GitHub OAuth 授权与 PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub 已验证邮箱](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)
- [openid-client](https://github.com/panva/openid-client)

## 注册与账号关联

- 新用户必须符合现有开放注册设置，创建普通、启用的用户，并继承自助注册积分配额。
- Google/Apple 提供已验证邮箱时可直接注册。GitHub 从邮箱接口选择已验证的主邮箱，没有时选择已验证的其他邮箱；不信任公开资料中的邮箱。未提供邮箱或不能确认邮箱所有权时（包括 Microsoft、Facebook），首次注册需验证邮箱。使用已有 SMTP 配置发送一次性邮件，在发起注册的同一浏览器中确认；无需设置密码。
- 同邮箱的现有账号不会自动合并。请先使用已有登录方式进入“设置 → 安全 → 已关联的第三方账号”，主动关联。
- 登录身份使用平台、应用 ID 和平台稳定用户 ID，不使用邮箱匹配。已关联用户不受关闭注册影响；被停用用户不能登录。
- 解除关联前必须已有密码或另一个启用中的社交登录方式；解除后撤销现有登录会话。可通过“设置或重置密码”邮件建立密码登录方式。
- 已存在绑定时不能更换应用 ID（Apple 还包括所属团队），以免所有既有身份失效。可以更新同一应用的密钥；配置变更使未完成的授权流程失效。
- 管理员关闭平台会停止该平台后续登录，并不自动解除关联或登出现有用户。应先确认受影响用户有其他登录方式。

## 安全边界

复用项目已有 `openid-client`、`jose`、JWT/刷新会话、Prisma、Redis、邮件和 AES-GCM 加密能力；没有引入新认证框架或保存平台 access/refresh token。
授权流程使用浏览器绑定的 HttpOnly Cookie、Redis 一次性 state、OIDC nonce、Google/Microsoft/GitHub PKCE、ID token 签名/issuer/audience/过期校验。GitHub 使用 OAuth 而非 OIDC，每次以新令牌请求固定的 GitHub 用户接口，以不可变数字 ID 作为身份，禁止资料请求跟随重定向。
Apple 和 Facebook 不假定支持 PKCE，分别保留 nonce 或 OAuth state 与浏览器绑定。
Facebook 资料请求携带 appsecret_proof。外部网络请求有超时。
邮件凭证置于 URL fragment，不进入服务端请求日志；确认时同时校验原浏览器与待注册身份。
管理员接口需要管理员权限，密钥只加密保存、不回显；留空表示保留原密钥。审计记录不包含密钥或平台令牌。

## 数据库与上线顺序

新增迁移 `20260921120000_add_social_authentication`：创建 `social_accounts`，扩展 `users_last_login_method_check`。
不删除用户、字段或历史记录，没有数据库外键。已有用户、邮箱密码、企业 OIDC/Teams 数据继续使用。
先备份并执行 `pnpm db:migrate:deploy`，再部署新 API/Web；开发客户端生成命令为 `pnpm db:generate`。
本次开发没有对实际数据库执行迁移。
GitHub 新增迁移 `20260922150000_add_github_login_method`，在同一事务中扩展账号平台及最近登录方式的检查约束，保留所有已有允许值（包括 SAML）和记录。旧配置不包含 GitHub 时默认停用，已有平台配置与关联继续可用。先执行迁移，再部署包含 GitHub 的 API/Web，最后配置并启用。GitHub 数据写入后不支持直接回滚至不识别 GitHub 的旧应用。
一旦新登录方法写入 `users.last_login_method`，旧应用版本无法识别它；不能直接回滚到旧二进制。应保留新版本并关闭社交平台入口，或在备份基础上规划明确的数据回退。

## 验证

单元测试覆盖平台协议、失败路径、账号与配置存储、Fastify 权限/Cookie 回调及页面交互。真实平台联调仍需要管理员提供平台凭据、有效域名和可访问的网络。
没有执行浏览器自动化验证，也未声称完成各平台的真实授权或平台审核。
