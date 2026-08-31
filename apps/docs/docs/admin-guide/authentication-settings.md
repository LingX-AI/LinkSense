---
title: 认证邮件、OIDC 与 Teams 设置
description: 在线管理登录能力并安全处理认证密钥。
---

# 认证邮件、OIDC 与 Teams 设置

:::info 管理员操作
认证设置位于“设置 → 系统设置”。SMTP、OIDC 和 Teams 分别独立保存和生效。
:::

## 配置来源模式

每种认证能力支持：

- 继承部署环境：使用当前环境变量。
- 由系统设置管理：使用页面保存的加密配置。
- 禁用：明确停用，不回退到环境变量。

从“系统管理”切换到其他模式或停用已配置能力时需要二次确认。

## 认证邮件

配置 SMTP 主机、端口、STARTTLS 或 TLS 直连、发件人、可选用户名和密码。用户名留空表示不使用 SMTP 密码认证。

该能力用于首次设密和密码重置邮件。保存后在系统健康页检查实际连接状态。

## OIDC

填写 HTTPS Issuer URL、client id 和 client secret。回调地址由 LinkSense 公网基址固定生成，只读展示，需要同步配置到身份提供方。

保存新 revision 后，旧配置发起但尚未完成的回调会被拒绝，用户需要重新登录。首次 SSO 用户的准入规则仍由 LinkSense 账号状态控制。

## Teams

填写 Microsoft Entra tenant id 和 client id。LinkSense 页面不会替代 Entra 应用注册、Application ID URI、Teams manifest 或管理员同意。

## 密钥处理

页面只返回“已配置”状态，不回显 SMTP 密码或 OIDC secret。处于系统管理模式时，更新非密钥字段可留空保留秘密；从其他模式切换到系统管理时必须重新输入所需秘密。

配置损坏、密钥不匹配或无法解密时会失败关闭，不会回退到未确认旧值。
