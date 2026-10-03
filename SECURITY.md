# Security Policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in public Issues or Discussions.

Send a private report to [security@linksense.org](mailto:security@linksense.org) with:

- the affected LinkSense version or commit;
- a concise description of the impact;
- reproduction steps or a proof of concept;
- any known mitigations;
- a safe way to contact you for follow-up.

We will acknowledge the report as soon as practical, investigate it privately, and coordinate disclosure after a fix or mitigation is available. Do not include real user data, production credentials, or other third-party confidential information in a report.

## Supported versions

Security fixes are provided for the latest released version. Before the first public release, reports should reference the affected commit.

## Execution boundaries

LinkSense isolates users in separate Docker Workers. Tasks belonging to one user share
that user's HOME, CODEX_HOME and project files. Ordinary execution uses Codex's
`approvalPolicy: never` and full-access sandbox policy. Plan mode uses a read-only
sandbox with network access disabled.

Treat webpages, uploaded documents and tool responses as untrusted inputs. Successful
prompt injection can cause an ordinary execution Task to read, modify or send the same
user's files without command approval. Worker internet egress is allowed; the application
does not enforce a general outbound allowlist or block cloud metadata addresses by default.
Use deployment network controls and cloud metadata settings to restrict exposure, and
keep instance roles limited to required permissions. These deployment controls are not
provided by Task directory separation.

The Runner controller has Docker daemon access and must be treated as a trusted
management component. A controller compromise can affect the containers and data
managed by that daemon. Task Workers do not mount the Docker socket, and Codex runs
as an unprivileged Task process; Task execution does not directly grant daemon access.

## 安全漏洞报告

请勿通过公开 Issue 或 Discussion 披露疑似安全漏洞。

请发送邮件至 [security@linksense.org](mailto:security@linksense.org)，并说明受影响的版本或 commit、影响、复现步骤、已知缓解措施和安全的后续联系方式。报告中不要包含真实用户数据、生产凭据或第三方机密信息。

## 执行安全边界

LinkSense 使用独立的 Docker Worker 隔离用户。同一用户的任务共享该用户的 HOME、CODEX_HOME 和项目文件。普通执行使用 Codex 的 `approvalPolicy: never` 和完全访问沙箱策略；Plan 模式使用只读且禁止网络的沙箱。

网页、上传文档和工具返回内容均应视为不可信输入。成功的提示词注入可能导致普通执行任务读取、修改或外传同一用户的文件，执行命令无需审批。Worker 允许互联网出站；应用没有通用出站白名单，也不会默认屏蔽云元数据地址。请通过部署网络控制和云元数据设置限制暴露范围，并限制实例角色权限；任务目录划分不提供这些防护。

Runner 控制器具有 Docker daemon 访问权限，应视为可信管理组件。控制器被攻破可能影响该 daemon 管理的容器及数据。任务 Worker 不挂载 Docker socket，Codex 以非特权任务进程运行；任务执行本身不直接获得 daemon 权限。
