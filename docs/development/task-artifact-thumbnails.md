# 任务产物图片缩略图

资料库的任务产物列表在图片左侧展示 40×40 px 的圆角缩略图，保持现有任务分组、搜索、筛选、完整预览与原文件下载行为。缩略图接近滚动容器可视区域时才请求，解码完成后展示；请求、解码或显示失败时保留文件图标。

## 接口与生成

`GET /api/v1/conversations/:id/files/:fileId/thumbnail` 沿用任务所有者鉴权，仅接受已登记、可下载的图片产物。响应为静态 WebP，最大 80×80 px、10 KiB。图片等比居中裁切，不放大小图；动图只取首帧，SVG 光栅化，透明图片保留透明度。

原文件最多 20 MiB，且受现有上传大小限制；解码最多 4000 万像素，读取和图片转换分别设置 5 秒超时。生成使用项目已有 sharp。Redis 对同一文件去重，并将跨 API 实例的同时生成数限制为 4；等待生成额度有明确上限。

## 缓存和清理

派生对象保存在现有 ObjectStorage 中，使用 MinIO 或本地文件存储，键为 `conversations/{conversationId}/artifacts/{fileId}/thumbnails/v1.webp`。独立子目录避免与原文件名冲突；编码规则变化时需要更新缓存版本与清理范围。

首次访问按需生成，命中缓存时只读取小图。原文件按已登记的大小校验；存在 SHA-256 时同时校验摘要。已有记录缺少摘要时仍可生成，不新增数据库字段，不需要迁移或重新登记文件。

HTTP 响应设置私有缓存、ETag，并按 Authorization 和 Cookie 区分缓存；前端复用现有 API 客户端的鉴权和取消能力，通过 TanStack Query 缓存小图 Blob、去重请求，并在卸载时释放 Object URL。普通下载继续禁用 HTTP 缓存。

删除任务后，通过现有持久清理 outbox 删除缩略图，原始产物继续遵循审计留存规则。清理失败保留 outbox 以便重试；生成期间发生删除时，生成端重新检查原记录并清理新写入的小图，避免留下孤立缓存。

## 验证

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api test test/artifact-thumbnail.test.ts test/artifact-thumbnail-routes.test.ts test/files.routes.test.ts test/files.service.test.ts test/redis-rate-limit.test.ts test/jobs.test.ts
pnpm --filter @linksense/web exec vitest run src/features/task-artifacts/task-artifact-thumbnail.test.tsx src/features/task-artifacts/task-artifact-library.test.tsx src/api/client.test.ts src/i18n.test.ts
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/web typecheck
```

接口测试覆盖真实 sharp 转换、本地持久存储、缓存复用、权限拒绝与条件请求；Redis 测试使用独立临时 Redis 验证多实例并发。前端组件测试覆盖延迟请求、固定占位、解码等待、错误状态及资源释放，不依赖浏览器自动验收。
