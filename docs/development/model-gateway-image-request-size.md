# 模型网关请求体积与图片历史

## 原因和边界

`view_image` 查看过的图片会作为内联图片继续出现在 Codex 的模型请求中。原始图片数据可能在原生上下文整理之前就超过 HTTP 请求体积限制，因此再次点击“继续”仍然携带相同的大请求。网关健康检查成功并不代表这个请求能够通过。

网关的默认请求上限从 32 MiB 调整为 **128 MiB（134,217,728 字节）**。HTTP 的 Content-Length 与分块读取、WebSocket 的输入消息与队列，以及最终转发的请求均保留有界检查。认证与模型授权在图片解码之前完成。

## 图片处理

请求不超过 32 MiB 时直接使用原内容。超过此阈值时，在网关中处理当前请求里的 `input_image`，包括旧会话的工具输出；不修改原文件、持久化会话历史或原生工具事件，也不删除消息、图片及工具调用关联。

复用项目现有版本的 Sharp。内联图片 URL 的目标总预算为 16 MiB，单张目标为 1 MiB，并根据请求中其他内容的体积进一步分配。先尝试无损 WebP，仍超过预算时使用质量 85、65 的编码。保持显示尺寸、透明通道与原有 detail；应用 EXIF 方向，避免去除元数据后图片转向。保持尺寸是为了保留截图坐标，参见 [OpenAI 图片输入文档](https://developers.openai.com/api/docs/guides/images-vision)。

单图预算是优化目标，不会为了满足它而缩小图片或删除内容；最终请求仍必须不超过 128 MiB。远程图片不会在网关下载，文件引用和文本中的图片字符串不作转换。只解码具有对应签名的 PNG、JPEG、GIF 和 WebP，解码上限为 64 Mi 像素，并限制处理时间。图片错误只返回现有通用错误码，不暴露解码器诊断或图片内容。

## 升级和验证

需要重新构建并部署包含 Runner 的执行镜像；本次没有数据库或会话格式迁移。原始请求在 128 MiB 内的旧会话会自动走新的处理路径，不需要编辑历史记录。超过接收上限的历史仍会被拒绝；上游模型自己的请求和上下文限制仍适用。

回归覆盖超过旧上限的 HTTP 与两种 WebSocket 模式、超过 128 MiB 的声明长度、分块超限、三种模型协议的图片请求、连续两次继续旧图片历史、像素与尺寸保留、有损压缩、权限拒绝和错误脱敏。部署 smoke 会实际加载原生编码器并完成图片转换。

```sh
pnpm --filter @linksense/runner test
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/runner lint
pnpm --filter @linksense/shared build
pnpm --filter @linksense/runner build
node --test scripts/runner-runtime-smoke.test.mjs scripts/deployment.test.mjs
```
